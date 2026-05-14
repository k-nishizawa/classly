'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
]

export default function OnboardingPage() {
  const router   = useRouter()
  const supabase = createClient()

  const [schoolName,    setSchoolName]    = useState('')
  const [state,         setState]         = useState('')
  const [fullName,      setFullName]      = useState('')
  const [preferredName, setPreferredName] = useState('')
  const [email,         setEmail]         = useState('')
  const [password,      setPassword]      = useState('')
  const [error,         setError]         = useState<string | null>(null)
  const [loading,       setLoading]       = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    // 1. Create auth user
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name:      fullName.trim(),
          preferred_name: preferredName.trim() || null,
          role:           'admin',
        },
      },
    })

    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
      return
    }

    const userId = signUpData.user?.id
    if (!userId) {
      setError('Signup failed — please try again.')
      setLoading(false)
      return
    }

    // 2. Insert school
    const { data: school, error: schoolError } = await supabase
      .from('schools')
      .insert({ name: schoolName.trim(), city: state, country: 'US' })
      .select('id')
      .single()

    if (schoolError || !school) {
      setError(schoolError?.message ?? 'Failed to create school record.')
      setLoading(false)
      return
    }

    // 3. Upsert profile with admin role and school
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id:             userId,
        email:          signUpData.user?.email ?? email,
        full_name:      fullName.trim(),
        preferred_name: preferredName.trim() || null,
        role:           'admin',
        school_id:      school.id,
      }, { onConflict: 'id' })

    if (profileError) {
      console.error('[onboarding] profile upsert error:', profileError)
      setError('Account created but profile setup failed: ' + profileError.message)
      setLoading(false)
      return
    }

    router.push('/admin')
    router.refresh()
  }

  const canSubmit = schoolName.trim() && state &&
                    fullName.trim() && email.trim() && password.length >= 6

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-indigo-600 rounded-2xl mb-4 shadow-md">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Set up your school</h1>
          <p className="text-slate-500 text-sm mt-1">Get your school on Classly in under a minute.</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-7 space-y-6">

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>

            {/* School info */}
            <div>
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">School</h2>
              <div className="space-y-4">
                <Field label="School name *">
                  <input
                    type="text"
                    value={schoolName}
                    onChange={e => setSchoolName(e.target.value)}
                    required
                    placeholder="e.g. Sakura Language Academy"
                    className={inputCls}
                  />
                </Field>

                <Field label="State *">
                  <select
                    value={state}
                    onChange={e => setState(e.target.value)}
                    required
                    className={inputCls}
                  >
                    <option value="">— Select state —</option>
                    {US_STATES.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>

            <div className="border-t border-slate-100" />

            {/* Admin account */}
            <div>
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Your admin account</h2>
              <div className="space-y-4">
                <Field label="Full name *">
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

                <Field label="Email address *">
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="you@school.com"
                    className={inputCls}
                  />
                </Field>

                <Field label="Password *">
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
              </div>
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !canSubmit}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? 'Setting up…' : 'Create school & account'}
            </button>
          </form>

        </div>

        <p className="text-center text-sm text-slate-500 mt-6">
          Already have an account?{' '}
          <Link href="/login" className="text-indigo-600 font-medium hover:underline">
            Sign in
          </Link>
        </p>

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
