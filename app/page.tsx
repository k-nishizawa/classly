'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type Class = {
  id: string
  name: string
}

export default function Home() {
  const [classes, setClasses] = useState<Class[]>([])
  const [role, setRole] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile) setRole(profile.role)

    if (profile?.role === 'teacher') {
      const { data } = await supabase
        .from('classes')
        .select('*')
        .order('created_at', { ascending: false })
      if (data) setClasses(data)
    } else {
      const { data } = await supabase
        .from('class_members')
        .select('class_id, classes(id, name)')
        .eq('student_id', user.id)
      if (data) {
        setClasses(data.map((d: any) => d.classes).filter(Boolean))
      }
    }
    setLoading(false)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">Loading...</div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold text-green-700">Classly</h1>
        <div className="flex gap-4">
          {role === 'teacher' && (
            <button
              onClick={() => router.push('/teacher')}
              className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-purple-700 transition"
            >
              Teacher Dashboard
            </button>
          )}
          <button
            onClick={handleLogout}
            className="text-gray-500 text-sm hover:text-gray-700"
          >
            Log out
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-semibold mb-4 text-gray-700">
            {role === 'teacher' ? 'Your Classes' : 'My Classes'} ({classes.length})
          </h2>
          {classes.length === 0 ? (
            <div className="py-6">
              {role === 'teacher' ? (
                <p className="text-gray-400 text-center py-4">
                  No classes yet. Go to Teacher Dashboard to create one.
                </p>
              ) : (
                <div className="text-center py-4 space-y-3">
                  <p className="text-gray-500 font-medium">You are not enrolled in any class yet.</p>
                  <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 text-left max-w-sm mx-auto">
                    <p className="text-sm font-semibold text-indigo-800 mb-1">How to join a class</p>
                    <ol className="text-sm text-indigo-700 space-y-1 list-decimal list-inside">
                      <li>Ask your teacher to open an attendance session</li>
                      <li>Scan the QR code shown on their screen</li>
                      <li>Your class will appear here automatically</li>
                    </ol>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <ul className="space-y-3">
              {classes.map((c) => (
                <li
                  key={c.id}
                  onClick={() => router.push(
                    role === 'teacher'
                      ? `/teacher/classes/${c.id}`
                      : `/student/classes/${c.id}`
                  )}
                  className="flex justify-between items-center border border-gray-100 rounded-xl p-4 cursor-pointer hover:bg-gray-50 transition"
                >
                  <p className="font-semibold text-gray-800">{c.name}</p>
                  <span className="text-gray-400">→</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  )
}
