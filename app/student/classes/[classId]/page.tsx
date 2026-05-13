'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

// ─── types ────────────────────────────────────────────────────────────────────

type ClassData = {
  id: string
  name: string
  language: string | null
  level: string | null
  teacher_id: string
}

type Message = {
  id: string
  body: string
  created_at: string
}

type AttendanceRecord = {
  id: string
  session_id: string
  marked_at: string
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function StudentClassPage() {
  const params   = useParams()
  const classId  = params.classId as string
  const router   = useRouter()
  const supabase = createClient()

  const [cls,            setCls]            = useState<ClassData | null>(null)
  const [messages,       setMessages]       = useState<Message[]>([])
  const [records,        setRecords]        = useState<AttendanceRecord[]>([])
  const [totalSessions,  setTotalSessions]  = useState(0)
  const [loading,        setLoading]        = useState(true)
  const [dmBody,         setDmBody]         = useState('')
  const [dmLoading,      setDmLoading]      = useState(false)
  const [dmError,        setDmError]        = useState<string | null>(null)
  const [dmSent,         setDmSent]         = useState(false)

  useEffect(() => {
    fetchAll()
  }, [])

  async function fetchAll() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    // Verify student is a member of this class
    const { data: membership } = await supabase
      .from('class_members')
      .select('class_id')
      .eq('class_id', classId)
      .eq('student_id', user.id)
      .single()

    if (!membership) { router.push('/'); return }

    const [clsRes, messagesRes, recordsRes, sessionsRes] = await Promise.all([
      supabase
        .from('classes')
        .select('id, name, language, level, teacher_id')
        .eq('id', classId)
        .single(),

      supabase
        .from('messages')
        .select('id, body, created_at')
        .eq('class_id', classId)
        .eq('is_announcement', true)
        .order('created_at', { ascending: false }),

      supabase
        .from('attendance_records')
        .select('id, session_id, marked_at')
        .eq('class_id', classId)
        .eq('student_id', user.id)
        .order('marked_at', { ascending: false }),

      supabase
        .from('attendance_sessions')
        .select('id, created_at')
        .eq('class_id', classId),
    ])

    const fetchedRecords  = (recordsRes.data as AttendanceRecord[]) ?? []
    const allSessions     = sessionsRes.data ?? []

    // Only count sessions that started on or after the student's first attendance
    const earliestRecord  = fetchedRecords.length > 0
      ? fetchedRecords.reduce((a, b) => a.marked_at < b.marked_at ? a : b)
      : null
    const joinDate        = earliestRecord ? new Date(earliestRecord.marked_at) : null
    const relevantCount   = joinDate
      ? allSessions.filter((s: { created_at: string }) => new Date(s.created_at) >= joinDate).length
      : allSessions.length

    if (clsRes.data) setCls(clsRes.data)
    setMessages((messagesRes.data as Message[]) ?? [])
    setRecords(fetchedRecords)
    setTotalSessions(relevantCount)
    setLoading(false)
  }

  async function sendDm(e: React.FormEvent) {
    e.preventDefault()
    if (!dmBody.trim() || !cls) return
    setDmLoading(true)
    setDmError(null)
    setDmSent(false)

    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('messages').insert({
      class_id:       classId,
      sender_id:      user?.id,
      recipient_id:   cls.teacher_id,
      body:           dmBody.trim(),
      is_announcement: false,
    })

    if (error) {
      setDmError(error.message)
    } else {
      setDmBody('')
      setDmSent(true)
    }
    setDmLoading(false)
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400">Loading…</div>
  }

  const attendedSessions = new Set(records.map(r => r.session_id)).size

  const attendanceRate = totalSessions > 0
    ? Math.round((attendedSessions / totalSessions) * 100)
    : null

  const rateColor = attendanceRate === null
    ? 'text-slate-400'
    : attendanceRate >= 80
    ? 'text-emerald-600'
    : 'text-red-500'

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Visa warning banner ─────────────────────────────────────── */}
      {attendanceRate !== null && attendanceRate < 80 && totalSessions > 0 && (
        <div className="bg-red-600 text-white px-4 py-3 text-sm font-medium text-center">
          ⚠️ Visa Warning: Your attendance rate is {attendanceRate}%. Student visa requires 80% minimum.
        </div>
      )}

      {/* ── Nav ─────────────────────────────────────────────────────── */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <span className="font-bold text-slate-900 text-base">Classly</span>
          </Link>
          <Link href="/" className="text-sm text-slate-500 hover:text-slate-800 transition-colors">
            ← My classes
          </Link>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* ── Header ────────────────────────────────────────────────── */}
        <div>
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
          </div>
        </div>

        {/* ── Attendance summary ────────────────────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center gap-5">
          <div className="shrink-0">
            <p className={`text-3xl font-bold tabular-nums ${rateColor}`}>
              {attendanceRate !== null ? `${attendanceRate}%` : '—'}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">Attendance rate</p>
          </div>
          <div className="h-10 w-px bg-slate-100 shrink-0" />
          <div className="flex gap-5 text-center">
            <div>
              <p className="text-lg font-semibold text-slate-800">{attendedSessions}</p>
              <p className="text-xs text-slate-400">Sessions attended</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-slate-800">{totalSessions}</p>
              <p className="text-xs text-slate-400">Total sessions</p>
            </div>
          </div>
          {attendanceRate !== null && attendanceRate < 80 && (
            <div className="ml-auto shrink-0 text-xs bg-red-50 text-red-600 font-medium px-2.5 py-1 rounded-lg">
              Below 80%
            </div>
          )}
        </div>

        {/* ── Attendance history ────────────────────────────────────── */}
        <section>
          <h2 className="text-base font-semibold text-slate-800 mb-3">
            Attendance history ({records.length})
          </h2>
          {records.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-6 text-center">
              <p className="text-slate-400 text-sm">No attendance recorded yet.</p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
              {records.map(r => (
                <div key={r.id} className="px-5 py-3 flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                  <span className="text-sm text-slate-700">
                    {new Date(r.marked_at).toLocaleDateString('en-US', {
                      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
                    })}
                  </span>
                  <span className="ml-auto text-xs text-slate-400 tabular-nums">
                    {new Date(r.marked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Announcements ─────────────────────────────────────────── */}
        <section>
          <h2 className="text-base font-semibold text-slate-800 mb-3">
            Announcements ({messages.length})
          </h2>
          {messages.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-6 text-center">
              <p className="text-slate-400 text-sm">No announcements yet.</p>
            </div>
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
        </section>

        {/* ── Message Teacher ───────────────────────────────────────── */}
        <section>
          <h2 className="text-base font-semibold text-slate-800 mb-3">Message Teacher</h2>
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <form onSubmit={sendDm} className="space-y-3">
              <textarea
                placeholder="Write a message to your teacher…"
                value={dmBody}
                onChange={e => { setDmBody(e.target.value); setDmSent(false) }}
                required
                rows={3}
                className={inputCls + ' resize-none'}
              />
              {dmError && (
                <p className="text-xs text-red-500">{dmError}</p>
              )}
              {dmSent && (
                <p className="text-xs text-emerald-600">Message sent.</p>
              )}
              <button
                type="submit"
                disabled={dmLoading || !dmBody.trim()}
                className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {dmLoading ? 'Sending…' : 'Send'}
              </button>
            </form>
          </div>
        </section>

      </main>
    </div>
  )
}

const inputCls =
  'w-full px-3 py-2 text-sm text-gray-900 border border-slate-300 rounded-lg placeholder-slate-400 ' +
  'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition'
