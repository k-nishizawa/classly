'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

// ─── types ────────────────────────────────────────────────────────────────────

type Status =
  | 'loading'
  | 'success'
  | 'already_checked_in'
  | 'session_expired'
  | 'session_not_found'
  | 'no_token'
  | 'error'

// ─── inner component (uses useSearchParams — must be inside Suspense) ─────────

function JoinInner() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const token        = searchParams.get('token')

  const [status,    setStatus]    = useState<Status>('loading')
  const [className, setClassName] = useState('')
  const [errorMsg,  setErrorMsg]  = useState('')

  useEffect(() => {
    handleJoin()
  }, [])

  async function handleJoin() {
    if (!token) {
      setStatus('no_token')
      return
    }

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      const redirectPath = `/join?token=${encodeURIComponent(token)}`
      router.push(`/login?redirect=${encodeURIComponent(redirectPath)}`)
      return
    }

    // Look up the session by token
    const { data: session, error: sessionError } = await supabase
      .from('attendance_sessions')
      .select('id, class_id, status, expires_at, classes(name)')
      .eq('session_token', token)
      .single()

    if (sessionError || !session) {
      setStatus('session_not_found')
      return
    }

    // Validate the session is still live
    const isExpired = new Date(session.expires_at) < new Date()
    if (session.status !== 'active' || isExpired) {
      setStatus('session_expired')
      return
    }

    const cls = session.classes as unknown as { name: string } | null
    setClassName(cls?.name ?? '')

    // Ensure the student is a class member regardless of whether they've already checked in
    const { error: memberError } = await supabase
      .from('class_members')
      .upsert(
        { class_id: session.class_id, student_id: user.id },
        { onConflict: 'class_id,student_id', ignoreDuplicates: true }
      )
    if (memberError) console.error('[join] class_members upsert error:', memberError)

    // Check for an existing record (prevent duplicate check-in)
    const { data: existing } = await supabase
      .from('attendance_records')
      .select('id')
      .eq('session_id', session.id)
      .eq('student_id', user.id)
      .maybeSingle()

    if (existing) {
      setStatus('already_checked_in')
      return
    }

    // Insert the attendance record
    const { error: insertError } = await supabase
      .from('attendance_records')
      .insert({ session_id: session.id, student_id: user.id, class_id: session.class_id })

    if (insertError) {
      setErrorMsg(insertError.message)
      setStatus('error')
      return
    }

    setStatus('success')
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-400 text-sm">Checking in…</p>
      </div>
    )
  }

  const states: Record<Status, { icon: React.ReactNode; title: string; body: string } | null> = {
    loading: null,
    success: {
      icon: (
        <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-5">
          <svg className="w-7 h-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      ),
      title: 'Attendance marked!',
      body: className ? `You're checked in to ${className}.` : "You're checked in.",
    },
    already_checked_in: {
      icon: (
        <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-5">
          <svg className="w-7 h-7 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      ),
      title: 'Already checked in',
      body: 'Your attendance for this session is already recorded.',
    },
    session_expired: {
      icon: (
        <div className="w-14 h-14 rounded-full bg-yellow-100 flex items-center justify-center mx-auto mb-5">
          <svg className="w-7 h-7 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      ),
      title: 'Session expired',
      body: 'This QR code is no longer active. Ask your teacher to start a new session.',
    },
    session_not_found: {
      icon: (
        <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-5">
          <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      ),
      title: 'Invalid QR code',
      body: 'This link doesn\'t match any attendance session.',
    },
    no_token: {
      icon: (
        <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-5">
          <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      ),
      title: 'Missing token',
      body: 'No session token found in this link. Try scanning the QR code again.',
    },
    error: {
      icon: (
        <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-5">
          <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
      ),
      title: 'Something went wrong',
      body: errorMsg || 'Could not record your attendance. Please try again.',
    },
  }

  const state = states[status]
  if (!state) return null

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
        {state.icon}
        <h1 className="text-xl font-bold text-slate-900 mb-2">{state.title}</h1>
        <p className="text-sm text-slate-500">{state.body}</p>
        <Link
          href="/"
          className="mt-6 inline-block text-sm font-medium text-indigo-600 hover:underline"
        >
          Go to home
        </Link>
      </div>
    </div>
  )
}

// ─── page export (wraps in Suspense for useSearchParams) ──────────────────────

export default function JoinPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-400 text-sm">Loading…</p>
      </div>
    }>
      <JoinInner />
    </Suspense>
  )
}
