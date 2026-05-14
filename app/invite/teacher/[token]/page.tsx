'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

type Status = 'loading' | 'valid' | 'invalid' | 'expired' | 'used' | 'error'

type Invite = {
  id: string
  school_id: string
  used_by: string | null
  expires_at: string
  schools: { name: string } | null
}

export default function TeacherInvitePage() {
  const params   = useParams()
  const token    = params.token as string
  const router   = useRouter()
  const supabase = createClient()

  const [status,        setStatus]        = useState<Status>('loading')
  const [invite,        setInvite]        = useState<Invite | null>(null)
  const [fullName,      setFullName]      = useState('')
  const [preferredName, setPreferredName] = useState('')
  const [email,         setEmail]         = useState('')
  const [password,      setPassword]      = useState('')
  const [error,         setError]         = useState<string | null>(null)
  const [submitting,    setSubmitting]    = useState(false)

  useEffect(() => {
    validateToken()
  }, [])

  async function validateToken() {
    const { data, error } = await supabase
      .from('teacher_invites')
      .select('id, school_id, used_by, expires_at, schools(name)')
      .eq('token', token)
      .single()

    if (error || !data) { setStatus('invalid'); return }

    const inv = data as unknown as Invite
    if (inv.used_by)                           { setStatus('used');    return }
    if (new Date(inv.expires_at) < new Date()) { setStatus('expired'); return }

    setInvite(inv)
    setStatus('valid')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!invite) return
    setError(null)
    setSubmitting(true)

    const preferredNameTrimmed = preferredName.trim()

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name:      fullName.trim(),
          preferred_name: preferredNameTrimmed || null,
          role:           'teacher',
        },
      },
    })

    if (signUpError) {
      setError(signUpError.message)
      setSubmitting(false)
      return
    }

    const userId = signUpData.user?.id
    if (!userId) {
      setError('Signup failed — please try again.')
      setSubmitting(false)
      return
    }

    // Upsert profile with teacher role — runs after signUp so the session exists.
    // The DB trigger may have already created the row with role='student'; this overwrites it.
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id:             userId,
        email:          signUpData.user?.email ?? email,
        full_name:      fullName.trim(),
        preferred_name: preferredNameTrimmed || null,
        role:           'teacher',
        school_id:      invite.school_id,
      }, { onConflict: 'id' })

    if (profileError) {
      console.error('[invite] profile upsert error:', profileError)
      setError('Account created but profile setup failed: ' + profileError.message)
      setSubmitting(false)
      return
    }

    // Mark invite as used only after profile is confirmed set
    await supabase
      .from('teacher_invites')
      .update({ used_by: userId, used_at: new Date().toISOString() })
      .eq('token', token)

    router.push('/')
    router.refresh()
  }

  // ─── loading ────────────────────────────────────────────────────────────────

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-400 text-sm">Validating invite…</p>
      </div>
    )
  }

  // ─── error states ────────────────────────────────────────────────────────────

  const errorStates: Partial<Record<Status, { title: string; body: string }>> = {
    invalid: {
      title: 'Invalid invite link',
      body:  'This link doesn\'t match any invitation. Ask your administrator to send a new one.',
    },
    expired: {
      title: 'Invite link expired',
      body:  'This invitation has expired (links are valid for 7 days). Ask your administrator for a new one.',
    },
    used: {
      title: 'Invite already used',
      body:  'This invitation has already been claimed. If you haven\'t signed up yet, contact your administrator.',
    },
  }

  const errorState = errorStates[status]
  if (errorState) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-5">
            <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">{errorState.title}</h1>
          <p className="text-sm text-slate-500">{errorState.body}</p>
          <Link href="/login" className="mt-6 inline-block text-sm font-medium text-indigo-600 hover:underline">
            Go to sign in
          </Link>
        </div>
      </div>
    )
  }

  // ─── valid — show signup form ─────────────────────────────────────────────────

  const schoolName = (invite?.schools as { name: string } | null)?.name

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-indigo-600 rounded-2xl mb-4 shadow-md">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Join as a Teacher</h1>
          {schoolName && (
            <p className="text-slate-500 text-sm mt-1">{schoolName}</p>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-7">
          <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2 mb-5">
            <svg className="w-4 h-4 text-indigo-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs text-indigo-700 font-medium">Valid teacher invitation — your account will have teacher access.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <Field label="Full name">
              <input
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                required
                autoComplete="name"
                placeholder="Jane Smith"
                className={inputCls}
              />
            </Field>

            <Field label="Preferred name (optional)">
              <input
                type="text"
                value={preferredName}
                onChange={e => setPreferredName(e.target.value)}
                autoComplete="nickname"
                placeholder="Jane"
                className={inputCls}
              />
            </Field>

            <Field label="Email address">
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
                className={inputCls}
              />
            </Field>

            <Field label="Password">
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                placeholder="••••••••"
                className={inputCls}
              />
              <p className="text-xs text-slate-400 mt-1">Minimum 6 characters</p>
            </Field>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !fullName.trim() || !email.trim() || !password}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed mt-1"
            >
              {submitting ? 'Creating account…' : 'Create teacher account'}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-slate-500">
            Already have an account?{' '}
            <Link href="/login" className="text-indigo-600 font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

const inputCls =
  'w-full px-3 py-2 text-sm text-gray-900 border border-slate-300 rounded-lg placeholder-slate-400 ' +
  'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      {children}
    </div>
  )
}
