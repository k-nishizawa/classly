'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

const LEVELS = [
  'beginner',
  'elementary',
  'intermediate',
  'upper-intermediate',
  'advanced',
]

const inputCls =
  'w-full px-3 py-2 text-sm text-gray-900 border border-slate-300 rounded-lg placeholder-slate-400 ' +
  'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition'

export default function NewClassPage() {
  const router = useRouter()

  const [name, setName]               = useState('')
  const [language, setLanguage]       = useState('')
  const [level, setLevel]             = useState('')
  const [description, setDescription] = useState('')
  const [maxStudents, setMaxStudents] = useState(30)
  const [error, setError]             = useState<string | null>(null)
  const [loading, setLoading]         = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: profile } = await supabase
      .from('profiles')
      .select('school_id')
      .eq('id', user.id)
      .single()

    const { data, error: insertError } = await supabase
      .from('classes')
      .insert({
        name:        name.trim(),
        language:    language.trim() || null,
        level:       level || null,
        description: description.trim() || null,
        max_students: maxStudents,
        teacher_id:  user.id,
        school_id:   profile?.school_id,
        is_active:   true,
      })
      .select('id')
      .single()

    if (insertError) {
      setError(insertError.message)
      setLoading(false)
      return
    }

    router.push(`/teacher/classes/${data.id}`)
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">

        <div className="mb-6">
          <Link
            href="/teacher"
            className="text-sm text-slate-400 hover:text-slate-700 transition-colors"
          >
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 mt-3">Create a new class</h1>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-7 space-y-5">
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>

            <Field label="Class name *">
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                required
                placeholder="e.g. Business English B2"
                className={inputCls}
              />
            </Field>

            <Field label="Language">
              <input
                type="text"
                value={language}
                onChange={e => setLanguage(e.target.value)}
                placeholder="e.g. English, Spanish"
                className={inputCls}
              />
            </Field>

            <Field label="Level">
              <select
                value={level}
                onChange={e => setLevel(e.target.value)}
                className={inputCls}
              >
                <option value="">— Select level —</option>
                {LEVELS.map(l => (
                  <option key={l} value={l} className="capitalize">{l}</option>
                ))}
              </select>
            </Field>

            <Field label="Description">
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Optional description or notes"
                rows={3}
                className={inputCls + ' resize-none'}
              />
            </Field>

            <Field label="Max students">
              <input
                type="number"
                min={1}
                max={200}
                value={maxStudents}
                onChange={e => setMaxStudents(Number(e.target.value))}
                className={inputCls}
              />
            </Field>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={loading || !name.trim()}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? 'Creating…' : 'Create Class'}
              </button>
              <Link
                href="/teacher"
                className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-300 rounded-lg transition-colors"
              >
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      {children}
    </div>
  )
}
