'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { QRCodeSVG } from 'qrcode.react'
import Link from 'next/link'
import Nav from '@/components/nav'

// ─── types ────────────────────────────────────────────────────────────────────

type Tab = 'students' | 'attendance' | 'announcements' | 'messages'

type ClassData = {
  id: string
  name: string
  language: string | null
  level: string | null
  description: string | null
  is_active: boolean
  max_students: number
  teacher_id: string
}

type Member = {
  id: string
  student_id: string
  joined_at: string
  profiles: { full_name: string; preferred_name: string | null; email: string } | null
}

type AttendanceSession = {
  id: string
  class_id: string
  session_token: string
  status: string
  expires_at: string
  created_at: string
}

type AttendanceRecord = {
  id: string
  session_id: string
  student_id: string
  marked_at: string
}

type Message = {
  id: string
  body: string
  created_at: string
}

type StudentMessage = {
  id: string
  body: string
  sender_id: string
  created_at: string
}

type Profile = {
  id: string
  email: string
  full_name: string
  preferred_name: string | null
  role: string
  school_id: string | null
  schools: { name: string } | null
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function ClassDetailPage() {
  const params    = useParams()
  const classId   = params.classId as string
  const router    = useRouter()
  const supabase  = createClient()

  const [cls,           setCls]           = useState<ClassData | null>(null)
  const [profile,       setProfile]       = useState<Profile | null>(null)
  const [members,       setMembers]       = useState<Member[]>([])
  const [sessions,      setSessions]      = useState<AttendanceSession[]>([])
  const [activeSession, setActiveSession] = useState<AttendanceSession | null>(null)
  const [records,       setRecords]       = useState<AttendanceRecord[]>([])
  const [messages,        setMessages]        = useState<Message[]>([])
  const [studentMessages, setStudentMessages] = useState<StudentMessage[]>([])
  const [tab,             setTab]             = useState<Tab>('students')
  const [loading,       setLoading]       = useState(true)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [msgContent,    setMsgContent]    = useState('')
  const [msgLoading,    setMsgLoading]    = useState(false)
  const [msgError,      setMsgError]      = useState<string | null>(null)
  const [origin,        setOrigin]        = useState('')

  useEffect(() => {
    setOrigin(window.location.origin)
    fetchAll()
  }, [])

  async function fetchAll() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const [clsRes] = await Promise.all([
      supabase.from('classes').select('*').eq('id', classId).eq('teacher_id', user.id).single(),
    ])

    if (clsRes.error || !clsRes.data) { router.push('/teacher'); return }

    setCls(clsRes.data)
    setProfile({
      id:             user.id,
      email:          user.email ?? '',
      full_name:      user.user_metadata?.full_name ?? user.email ?? '',
      preferred_name: user.user_metadata?.preferred_name ?? null,
      role:           'teacher',
      school_id:      null,
      schools:        null,
    })

    await Promise.all([fetchMembers(), fetchSessions(), fetchMessages(), fetchStudentMessages(user.id)])
    setLoading(false)
  }

  async function fetchMembers() {
    const { data } = await supabase
      .from('class_members')
      .select('id, student_id, joined_at, profiles(full_name, preferred_name, email)')
      .eq('class_id', classId)
      .order('joined_at', { ascending: false })
    setMembers(((data ?? []) as unknown as Member[]))
  }

  async function fetchSessions() {
    const { data } = await supabase
      .from('attendance_sessions')
      .select('*')
      .eq('class_id', classId)
      .order('created_at', { ascending: false })

    const all = (data as AttendanceSession[]) ?? []
    setSessions(all)

    const now    = new Date().toISOString()
    const active = all.find(s => s.status === 'active' && s.expires_at > now) ?? null
    setActiveSession(active)
    if (all.length) await fetchAllRecords(all.map(s => s.id))
  }

  async function fetchAllRecords(sessionIds: string[]) {
    const { data } = await supabase
      .from('attendance_records')
      .select('id, session_id, student_id, marked_at')
      .in('session_id', sessionIds)
      .order('marked_at', { ascending: false })
    setRecords((data as AttendanceRecord[]) ?? [])
  }

  async function fetchStudentMessages(teacherId: string) {
    const { data } = await supabase
      .from('messages')
      .select('id, body, sender_id, created_at')
      .eq('class_id', classId)
      .eq('recipient_id', teacherId)
      .eq('is_announcement', false)
      .order('created_at', { ascending: false })
    setStudentMessages((data as StudentMessage[]) ?? [])
  }

  async function fetchMessages() {
    const { data } = await supabase
      .from('messages')
      .select('id, body, created_at')
      .eq('class_id', classId)
      .eq('is_announcement', true)
      .order('created_at', { ascending: false })
    setMessages((data as Message[]) ?? [])
  }

  async function startSession() {
    setSessionLoading(true)

    const { data: { user } } = await supabase.auth.getUser()
    const payload = { class_id: classId, teacher_id: user?.id }
    console.log('[startSession] inserting:', payload)

    const { data, error } = await supabase
      .from('attendance_sessions')
      .insert(payload)
      .select()
      .single()

    console.log('[startSession] data:', data)
    console.log('[startSession] error:', error)

    if (!error && data) {
      const session = data as AttendanceSession
      setActiveSession(session)
      setSessions(prev => [session, ...prev])
      setRecords([])
    }
    setSessionLoading(false)
  }

  async function endSession() {
    if (!activeSession) return
    setSessionLoading(true)
    await supabase
      .from('attendance_sessions')
      .update({ status: 'closed' })
      .eq('id', activeSession.id)

    setSessions(prev => prev.map(s => s.id === activeSession.id ? { ...s, status: 'closed' } : s))
    setActiveSession(null)
    setRecords([])
    setSessionLoading(false)
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!msgContent.trim()) return
    setMsgLoading(true)
    setMsgError(null)

    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('messages').insert({
      class_id:     classId,
      sender_id:    user?.id,
      body:            msgContent.trim(),
      is_announcement: true,
    })

    if (error) {
      setMsgError(error.message)
    } else {
      setMsgContent('')
      await fetchMessages()
    }
    setMsgLoading(false)
  }

  // ─── loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400">Loading…</div>
  }

  const joinUrl = activeSession ? `${origin}/join?token=${activeSession.session_token}` : ''

  // ─── render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav profile={profile} />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* ── Header ────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
              <Link href="/teacher" className="hover:text-slate-600 transition-colors">Dashboard</Link>
              <span>/</span>
              <span className="text-slate-600">{cls?.name}</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">{cls?.name}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              {cls?.language && (
                <span className="text-sm text-slate-500">{cls.language}</span>
              )}
              {cls?.level && (
                <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded capitalize">
                  {cls.level}
                </span>
              )}
              {!cls?.is_active && (
                <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">
                  Inactive
                </span>
              )}
              <span className="text-xs text-slate-400">
                {members.length} / {cls?.max_students} students
              </span>
            </div>
            {cls?.description && (
              <p className="text-sm text-slate-500 mt-1.5 max-w-xl">{cls.description}</p>
            )}
          </div>
        </div>

        {/* ── QR Invite ─────────────────────────────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-800">Attendance QR Code</h2>
            <div className="flex items-center gap-2">
              {activeSession && (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  <span className="text-xs text-emerald-600 font-medium mr-1">Session active</span>
                  <button
                    onClick={endSession}
                    disabled={sessionLoading}
                    className="text-xs bg-red-50 hover:bg-red-100 text-red-600 font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
                  >
                    End Session
                  </button>
                </>
              )}
              {!activeSession && (
                <button
                  onClick={startSession}
                  disabled={sessionLoading}
                  className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
                >
                  {sessionLoading ? 'Starting…' : 'Start Session'}
                </button>
              )}
            </div>
          </div>

          {activeSession ? (
            <div className="flex flex-col sm:flex-row items-center gap-6">
              <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm shrink-0">
                <QRCodeSVG value={joinUrl} size={180} level="M" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-600 mb-2">Students scan to mark attendance for this session.</p>
                <p className="text-xs font-mono text-slate-400 break-all bg-slate-50 rounded-lg px-3 py-2">
                  {joinUrl}
                </p>
                <p className="text-xs text-slate-400 mt-2">
                  Expires {new Date(activeSession.expires_at).toLocaleString()}
                </p>
                {(() => {
                  const n = records.filter(r => r.session_id === activeSession?.id).length
                  return n > 0 ? (
                    <p className="text-sm font-semibold text-emerald-600 mt-3">
                      {n} student{n !== 1 ? 's' : ''} checked in
                    </p>
                  ) : null
                })()}
              </div>
            </div>
          ) : (
            <p className="text-slate-400 text-sm text-center py-6">
              Start a session to generate a QR code. A new code is issued each session.
            </p>
          )}
        </div>

        {/* ── Tabs ──────────────────────────────────────────────────── */}
        <div>
          <div className="flex border-b border-slate-200 mb-4 -mt-2">
            {(['students', 'attendance', 'announcements', 'messages'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                  tab === t
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {t === 'students'      && `Students (${members.length})`}
                {t === 'attendance'    && `Attendance (${sessions.length})`}
                {t === 'announcements' && `Announcements (${messages.length})`}
                {t === 'messages'      && (
                  <span className="flex items-center gap-1.5">
                    Messages
                    {studentMessages.length > 0 && (
                      <span className="bg-indigo-600 text-white text-xs font-semibold px-1.5 py-0.5 rounded-full leading-none">
                        {studentMessages.length}
                      </span>
                    )}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Students tab ────────────────────────────────────────── */}
          {tab === 'students' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              {members.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-10">
                  No students enrolled yet. Share the QR code so students can join.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {members.map(m => (
                    <li key={m.id} className="px-5 py-3.5 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-semibold text-indigo-700 shrink-0">
                        {(m.profiles?.preferred_name || m.profiles?.full_name || m.profiles?.email || '?')[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800">
                          {m.profiles?.preferred_name && m.profiles.preferred_name !== m.profiles.full_name
                            ? `${m.profiles.preferred_name} (${m.profiles.full_name})`
                            : m.profiles?.full_name || '—'}
                        </p>
                        <p className="text-xs text-slate-400">{m.profiles?.email}</p>
                      </div>
                      <span className="text-xs text-slate-400 shrink-0">
                        Joined {new Date(m.joined_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ── Attendance tab ──────────────────────────────────────── */}
          {tab === 'attendance' && (
            <div className="space-y-3">
              {sessions.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
                  <p className="text-slate-400 text-sm">No attendance sessions yet.</p>
                </div>
              ) : (
                sessions.map(s => {
                  const sessionRecs = records.filter(r => r.session_id === s.id)
                  const isActive    = s.id === activeSession?.id

                  return (
                    <div
                      key={s.id}
                      className={`rounded-xl border overflow-hidden ${
                        isActive ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'
                      }`}
                    >
                      {/* Session header */}
                      <div className={`px-5 py-3 flex items-center gap-3 ${
                        isActive ? 'border-b border-emerald-200' : sessionRecs.length ? 'border-b border-slate-100' : ''
                      }`}>
                        {isActive ? (
                          <span className="relative flex h-2 w-2 shrink-0">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                          </span>
                        ) : (
                          <span className="w-2 h-2 rounded-full bg-slate-300 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${isActive ? 'text-emerald-800' : 'text-slate-700'}`}>
                            {new Date(s.created_at).toLocaleDateString('en-US', {
                              weekday: 'short', month: 'short', day: 'numeric',
                            })}
                            {' · '}
                            {new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded shrink-0 ${
                          isActive
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}>
                          {isActive ? 'Live' : 'Closed'} · {sessionRecs.length}
                        </span>
                      </div>

                      {/* Records */}
                      {sessionRecs.length > 0 && (
                        <ul className="divide-y divide-slate-100">
                          {sessionRecs.map(r => {
                            const member = members.find(m => m.student_id === r.student_id)
                            const p      = member?.profiles
                            const name   = p
                              ? (p.preferred_name && p.preferred_name !== p.full_name
                                  ? `${p.preferred_name} (${p.full_name})`
                                  : p.full_name || p.email)
                              : r.student_id
                            return (
                              <li key={r.id} className="px-5 py-2.5 flex items-center gap-3">
                                <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-semibold text-indigo-700 shrink-0">
                                  {name[0].toUpperCase()}
                                </div>
                                <span className={`text-sm flex-1 ${isActive ? 'text-emerald-900' : 'text-slate-700'}`}>
                                  {name}
                                </span>
                                <span className="text-xs text-slate-400 tabular-nums shrink-0">
                                  {new Date(r.marked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </li>
                            )
                          })}
                        </ul>
                      )}

                      {sessionRecs.length === 0 && isActive && (
                        <p className="px-5 py-3 text-xs text-emerald-600">No check-ins yet.</p>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          )}

          {/* ── Announcements tab ───────────────────────────────────── */}
          {tab === 'announcements' && (
            <div className="space-y-4">
              {/* Send form */}
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-slate-800 mb-3">Send announcement</h3>
                <form onSubmit={sendMessage} className="space-y-3">
                  <textarea
                    placeholder="Write your announcement…"
                    value={msgContent}
                    onChange={e => setMsgContent(e.target.value)}
                    required
                    rows={3}
                    className={inputCls + ' resize-none'}
                  />
                  {msgError && (
                    <p className="text-xs text-red-500">{msgError}</p>
                  )}
                  <button
                    type="submit"
                    disabled={msgLoading || !msgContent.trim()}
                    className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {msgLoading ? 'Sending…' : 'Send'}
                  </button>
                </form>
              </div>

              {/* Message list */}
              {messages.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-6">No announcements sent yet.</p>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                  {messages.map(msg => (
                    <div key={msg.id} className="px-5 py-4">
                      <time className="text-xs text-slate-400">
                        {new Date(msg.created_at).toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric', year: 'numeric',
                        })}
                      </time>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap mt-1">{msg.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Messages from students tab ──────────────────────────── */}
          {tab === 'messages' && (
            <div>
              {studentMessages.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
                  <p className="text-slate-400 text-sm">No messages from students yet.</p>
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                  {studentMessages.map(msg => (
                    <div key={msg.id} className="px-5 py-4 flex items-start gap-3">
                      <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-xs font-semibold text-slate-500 shrink-0 mt-0.5">
                        S
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-700 whitespace-pre-wrap">{msg.body}</p>
                        <time className="text-xs text-slate-400 mt-1 block">
                          {new Date(msg.created_at).toLocaleDateString('en-US', {
                            month: 'short', day: 'numeric', year: 'numeric',
                          })}
                          {' · '}
                          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </time>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

const inputCls =
  'w-full px-3 py-2 text-sm border border-slate-300 rounded-lg placeholder-slate-400 ' +
  'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition'
