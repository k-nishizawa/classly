'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import Nav from '@/components/nav'

// ─── types ────────────────────────────────────────────────────────────────────

type AdminProfile = {
  id: string
  full_name: string
  preferred_name: string | null
  email: string
  role: string
  school_id: string | null
  schools: { name: string } | null
}

type Teacher = {
  id: string
  full_name: string
  preferred_name: string | null
}

type Invite = {
  id: string
  token: string
  created_at: string
  expires_at: string
  used_by: string | null
  used_at: string | null
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const router   = useRouter()
  const supabase = createClient()

  const [profile,    setProfile]    = useState<AdminProfile | null>(null)
  const [teachers,   setTeachers]   = useState<Teacher[]>([])
  const [invites,    setInvites]    = useState<Invite[]>([])
  const [loading,    setLoading]    = useState(true)
  const [generating, setGenerating] = useState(false)
  const [origin,     setOrigin]     = useState('')
  const [copied,     setCopied]     = useState<string | null>(null)

  useEffect(() => {
    setOrigin(window.location.origin)
    fetchData()
  }, [])

  async function fetchData() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: prof } = await supabase
      .from('profiles')
      .select('id, full_name, preferred_name, role, school_id, schools(name)')
      .eq('id', user.id)
      .single()

    if (!prof || prof.role !== 'admin') { router.push('/'); return }

    const adminProfile: AdminProfile = {
      ...(prof as any),
      email: user.email ?? '',
    }
    setProfile(adminProfile)

    const [teachersRes, invitesRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, preferred_name')
        .eq('school_id', prof.school_id)
        .eq('role', 'teacher')
        .order('full_name'),

      supabase
        .from('teacher_invites')
        .select('id, token, created_at, expires_at, used_by, used_at')
        .eq('school_id', prof.school_id)
        .order('created_at', { ascending: false }),
    ])

    setTeachers((teachersRes.data as Teacher[]) ?? [])
    setInvites((invitesRes.data as Invite[]) ?? [])
    setLoading(false)
  }

  async function generateInvite() {
    if (!profile?.school_id) return
    setGenerating(true)

    const { data, error } = await supabase
      .from('teacher_invites')
      .insert({ school_id: profile.school_id, created_by: profile.id })
      .select('id, token, created_at, expires_at, used_by, used_at')
      .single()

    if (!error && data) {
      setInvites(prev => [data as Invite, ...prev])
    }
    setGenerating(false)
  }

  async function copyLink(token: string) {
    await navigator.clipboard.writeText(`${origin}/invite/teacher/${token}`)
    setCopied(token)
    setTimeout(() => setCopied(null), 2000)
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400">Loading…</div>
  }

  const pendingInvites = invites.filter(i => !i.used_by && new Date(i.expires_at) > new Date())
  const usedInvites    = invites.filter(i => i.used_by)
  const expiredInvites = invites.filter(i => !i.used_by && new Date(i.expires_at) <= new Date())

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav profile={profile} />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>
          <p className="text-slate-500 text-sm mt-0.5">{profile?.schools?.name}</p>
        </div>

        {/* ── Teachers ───────────────────────────────────────────────── */}
        <section>
          <h2 className="text-base font-semibold text-slate-800 mb-3">
            Teachers ({teachers.length})
          </h2>

          {teachers.length === 0 ? (
            <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center">
              <p className="text-slate-400 text-sm">No teachers yet. Generate an invite link below.</p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
              {teachers.map(t => (
                <div key={t.id} className="px-5 py-3.5 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-semibold text-indigo-700 shrink-0">
                    {(t.preferred_name || t.full_name || '?')[0].toUpperCase()}
                  </div>
                  <p className="text-sm font-medium text-slate-800">
                    {t.preferred_name && t.preferred_name !== t.full_name
                      ? `${t.preferred_name} (${t.full_name})`
                      : t.full_name}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Invite Links ───────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-slate-800">Teacher Invitations</h2>
            <button
              onClick={generateInvite}
              disabled={generating}
              className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
            >
              {generating ? 'Generating…' : '+ Generate invite link'}
            </button>
          </div>

          {/* Pending */}
          {pendingInvites.length > 0 && (
            <div className="space-y-2 mb-4">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Pending ({pendingInvites.length})</p>
              <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                {pendingInvites.map(inv => (
                  <div key={inv.id} className="px-5 py-3.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-slate-400 truncate">
                        {origin}/invite/teacher/{inv.token}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Expires {new Date(inv.expires_at).toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric', year: 'numeric',
                        })}
                      </p>
                    </div>
                    <button
                      onClick={() => copyLink(inv.token)}
                      className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                        copied === inv.token
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                      }`}
                    >
                      {copied === inv.token ? 'Copied!' : 'Copy link'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pendingInvites.length === 0 && usedInvites.length === 0 && expiredInvites.length === 0 && (
            <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center">
              <p className="text-slate-400 text-sm">No invitations yet. Generate one to invite a teacher.</p>
            </div>
          )}

          {/* Used */}
          {usedInvites.length > 0 && (
            <div className="space-y-2 mb-4">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Used ({usedInvites.length})</p>
              <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                {usedInvites.map(inv => (
                  <div key={inv.id} className="px-5 py-3.5 flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-slate-300 truncate">{inv.token}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Claimed {inv.used_at
                          ? new Date(inv.used_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                          : '—'}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs bg-emerald-50 text-emerald-600 font-medium px-2 py-0.5 rounded-full">
                      Used
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Expired */}
          {expiredInvites.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Expired ({expiredInvites.length})</p>
              <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                {expiredInvites.map(inv => (
                  <div key={inv.id} className="px-5 py-3.5 flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-slate-300 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-slate-300 truncate">{inv.token}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Expired {new Date(inv.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs bg-slate-100 text-slate-400 font-medium px-2 py-0.5 rounded-full">
                      Expired
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

      </main>
    </div>
  )
}
