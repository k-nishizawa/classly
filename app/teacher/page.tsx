import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/nav'

// ─── types ────────────────────────────────────────────────────────────────────

type Profile = {
  id: string
  email: string
  full_name: string
  preferred_name: string | null
  role: 'teacher' | 'student' | 'admin'
  school_id: string | null
  schools: { name: string } | null
}

type ClassWithStats = {
  id: string
  name: string
  language: string | null
  level: string | null
  description: string | null
  is_active: boolean
  max_students: number
  memberCount: number
  hasActiveSession: boolean
  attendanceRate: number | null
  atRiskCount: number
}

type ClosedSession = {
  id: string
  class_id: string
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default async function TeacherDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, preferred_name, role, school_id, schools(name)')
    .eq('id', user.id)
    .single() as { data: Profile | null }

  if (profile?.role === 'student') redirect('/')

  // ── fetch classes ──────────────────────────────────────────────────────────
  const { data: rawClasses } = await supabase
    .from('classes')
    .select('id, name, language, level, description, is_active, max_students')
    .eq('teacher_id', user.id)
    .order('name')

  const classes = rawClasses ?? []
  const classIds = classes.map((c) => c.id)

  // ── parallel data fetches ──────────────────────────────────────────────────
  const [membersRes, sessionsRes, closedSessionsRes, messagesRes] = await Promise.all([
    // Member counts + student IDs
    classIds.length
      ? supabase.from('class_members').select('class_id, student_id').in('class_id', classIds)
      : Promise.resolve({ data: [] }),

    // Active sessions (not expired)
    classIds.length
      ? supabase
          .from('attendance_sessions')
          .select('id, class_id, expires_at, session_token')
          .in('class_id', classIds)
          .eq('status', 'active')
          .gt('expires_at', new Date().toISOString())
      : Promise.resolve({ data: [] }),

    // Closed sessions for rate calculation
    classIds.length
      ? supabase
          .from('attendance_sessions')
          .select('id, class_id')
          .in('class_id', classIds)
          .eq('status', 'closed')
      : Promise.resolve({ data: [] }),

    // Recent messages
    classIds.length
      ? supabase
          .from('messages')
          .select('id, subject, body, created_at, class_id, classes(name)')
          .eq('sender_id', user.id)
          .order('created_at', { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] }),
  ])

  // Fetch attendance records for all closed sessions
  const closedSessions = (closedSessionsRes.data ?? []) as ClosedSession[]
  const closedSessionIds = closedSessions.map(s => s.id)
  const { data: rawRecords } = closedSessionIds.length
    ? await supabase
        .from('attendance_records')
        .select('session_id, student_id')
        .in('session_id', closedSessionIds)
    : { data: [] }

  // ── compute per-class stats ────────────────────────────────────────────────
  const memberCounts: Record<string, number> = {}
  const membersByClass: Record<string, Set<string>> = {}
  for (const m of membersRes.data ?? []) {
    memberCounts[m.class_id] = (memberCounts[m.class_id] ?? 0) + 1
    if (!membersByClass[m.class_id]) membersByClass[m.class_id] = new Set()
    membersByClass[m.class_id].add(m.student_id)
  }

  const activeSessionSet = new Set((sessionsRes.data ?? []).map((s) => s.class_id))

  // Build session→class map and count closed sessions per class
  const sessionToClass: Record<string, string> = {}
  const closedCountPerClass: Record<string, number> = {}
  for (const s of closedSessions) {
    sessionToClass[s.id] = s.class_id
    closedCountPerClass[s.class_id] = (closedCountPerClass[s.class_id] ?? 0) + 1
  }

  // Count how many sessions each student attended per class
  const attendedPerStudentClass: Record<string, number> = {} // key: `classId|studentId`
  for (const r of rawRecords ?? []) {
    const classId = sessionToClass[r.session_id]
    if (!classId) continue
    const key = `${classId}|${r.student_id}`
    attendedPerStudentClass[key] = (attendedPerStudentClass[key] ?? 0) + 1
  }

  const classesWithStats: ClassWithStats[] = classes.map((c) => {
    const totalSessions = closedCountPerClass[c.id] ?? 0
    const students      = membersByClass[c.id] ?? new Set<string>()

    let rateSum  = 0
    let atRisk   = 0

    for (const studentId of students) {
      const attended = attendedPerStudentClass[`${c.id}|${studentId}`] ?? 0
      const rate     = totalSessions > 0 ? (attended / totalSessions) * 100 : null
      if (rate !== null) rateSum += rate
      if (rate !== null && rate < 80) atRisk++
      if (rate === null && totalSessions > 0) atRisk++ // member with no records = 0%
    }

    const avgRate = totalSessions > 0 && students.size > 0
      ? Math.round(rateSum / students.size)
      : null

    return {
      ...c,
      memberCount:      students.size,
      hasActiveSession: activeSessionSet.has(c.id),
      attendanceRate:   avgRate,
      atRiskCount:      atRisk,
    }
  })

  // ── top-level stats ────────────────────────────────────────────────────────
  const totalStudents  = Object.values(memberCounts).reduce((s, n) => s + n, 0)
  const activeClasses  = classesWithStats.filter((c) => c.is_active).length
  const activeSessions = sessionsRes.data?.length ?? 0
  const atRiskTotal    = classesWithStats.reduce((s, c) => s + c.atRiskCount, 0)

  const recentMessages = messagesRes.data ?? []

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav profile={profile} />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Teacher Dashboard</h1>
            <p className="text-slate-500 text-sm mt-0.5">
              Welcome back, {
                profile?.preferred_name && profile.preferred_name !== profile.full_name
                  ? `${profile.preferred_name} (${profile.full_name})`
                  : profile?.full_name || 'Teacher'
              }
              {profile?.schools?.name ? ` · ${profile.schools.name}` : ''}
            </p>
          </div>
          <Link
            href="/"
            className="text-sm text-slate-500 hover:text-slate-800 transition-colors"
          >
            ← All classes
          </Link>
        </div>

        {/* ── Stat cards ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Active classes"   value={activeClasses}   color="indigo" />
          <StatCard label="Total students"   value={totalStudents}   color="slate"  />
          <StatCard label="Live sessions"    value={activeSessions}  color="emerald" />
          <StatCard
            label="Visa at-risk"
            value={atRiskTotal}
            color={atRiskTotal > 0 ? 'red' : 'slate'}
            subtitle={atRiskTotal > 0 ? 'below 80%' : 'all compliant'}
          />
        </div>

        {/* ── Classes ────────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-slate-800">Classes</h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400">{classesWithStats.length} total</span>
              <Link
                href="/teacher/classes/new"
                className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-3 py-1.5 rounded-lg transition-colors"
              >
                + Create Class
              </Link>
            </div>
          </div>

          {classesWithStats.length === 0 ? (
            <div className="bg-white border border-dashed border-slate-300 rounded-xl p-10 text-center">
              <p className="text-slate-500 text-sm mb-3">No classes yet.</p>
              <Link
                href="/teacher/classes/new"
                className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-3 py-2 rounded-lg transition-colors"
              >
                Create your first class
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {classesWithStats.map((cls) => (
                <ClassRow key={cls.id} cls={cls} />
              ))}
            </div>
          )}
        </section>

        {/* ── Recent Messages ────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-slate-800">Recent Announcements</h2>
          </div>

          {recentMessages.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-6 text-center">
              <p className="text-slate-400 text-sm">No announcements sent yet.</p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
              {recentMessages.map((msg: any) => (
                <div key={msg.id} className="px-5 py-3.5 flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0 mt-0.5">
                    <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {msg.subject || 'Announcement'}
                      </p>
                      {msg.classes?.name && (
                        <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded shrink-0">
                          {msg.classes.name}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{msg.body}</p>
                  </div>
                  <time className="text-xs text-slate-400 shrink-0 mt-0.5">
                    {new Date(msg.created_at).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric',
                    })}
                  </time>
                </div>
              ))}
            </div>
          )}
        </section>

      </main>
    </div>
  )
}

// ─── sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label, value, color, subtitle,
}: {
  label: string
  value: number
  color: 'indigo' | 'emerald' | 'red' | 'slate'
  subtitle?: string
}) {
  const bg: Record<string, string> = {
    indigo:  'bg-indigo-50  text-indigo-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    red:     'bg-red-50     text-red-600',
    slate:   'bg-slate-100  text-slate-700',
  }
  return (
    <div className={`rounded-xl p-4 ${bg[color]}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs font-medium mt-0.5 opacity-80">{label}</p>
      {subtitle && <p className="text-xs opacity-60 mt-0.5">{subtitle}</p>}
    </div>
  )
}

const LEVEL_SHORT: Record<string, string> = {
  beginner:             'Beg',
  elementary:           'Elem',
  intermediate:         'Int',
  'upper-intermediate': 'Upper',
  advanced:             'Adv',
}

function ClassRow({ cls }: { cls: ClassWithStats }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex items-center gap-4 hover:shadow-sm transition-shadow">
      {/* Active session pulse */}
      <div className="shrink-0">
        {cls.hasActiveSession ? (
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
          </span>
        ) : (
          <span className="h-3 w-3 rounded-full bg-slate-200 inline-flex" />
        )}
      </div>

      {/* Class info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-slate-900 truncate">{cls.name}</h3>
          {cls.level && (
            <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
              {LEVEL_SHORT[cls.level] ?? cls.level}
            </span>
          )}
          {!cls.is_active && (
            <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">
              Inactive
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400 mt-0.5">
          {cls.memberCount} student{cls.memberCount !== 1 ? 's' : ''}
          {cls.language ? ` · ${cls.language}` : ''}
        </p>
      </div>

      {/* Attendance rate */}
      <div className="shrink-0 text-right hidden sm:block">
        {cls.attendanceRate !== null ? (
          <>
            <p className={`text-sm font-semibold ${
              cls.attendanceRate >= 80 ? 'text-emerald-600' : 'text-red-500'
            }`}>
              {cls.attendanceRate}%
            </p>
            <p className="text-xs text-slate-400">avg attendance</p>
          </>
        ) : (
          <p className="text-xs text-slate-400">No data yet</p>
        )}
      </div>

      {/* At-risk badge */}
      {cls.atRiskCount > 0 && (
        <div className="shrink-0 hidden sm:flex items-center gap-1 bg-red-50 text-red-600 text-xs font-medium px-2.5 py-1 rounded-lg">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          {cls.atRiskCount} at risk
        </div>
      )}

      {/* Actions */}
      <div className="shrink-0 flex items-center gap-2">
        <Link
          href={`/teacher/attendance/${cls.id}`}
          className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-3 py-1.5 rounded-lg transition-colors"
        >
          Attendance
        </Link>
        <Link
          href={`/teacher/classes/${cls.id}`}
          className="text-xs text-slate-500 hover:text-slate-800 font-medium px-2 py-1.5 transition-colors"
        >
          View
        </Link>
      </div>
    </div>
  )
}
