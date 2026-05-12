import Link from 'next/link'

type Profile = {
  full_name: string
  preferred_name?: string | null
  email: string
  role: string
  schools?: { name: string } | null
}

export default function Nav({ profile }: { profile: Profile | null }) {
  const roleColors: Record<string, string> = {
    teacher: 'bg-indigo-100 text-indigo-700',
    admin:   'bg-purple-100 text-purple-700',
    student: 'bg-slate-100 text-slate-600',
  }
  const roleColor = profile?.role ? roleColors[profile.role] ?? roleColors.student : roleColors.student

  return (
    <nav className="bg-white border-b border-slate-200 sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <span className="font-bold text-slate-900 text-base">Classly</span>
          </Link>

          {profile?.role === 'teacher' || profile?.role === 'admin' ? (
            <Link
              href="/teacher"
              className="text-sm text-slate-500 hover:text-slate-800 transition-colors"
            >
              Dashboard
            </Link>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          {profile?.schools?.name && (
            <span className="hidden sm:block text-xs text-slate-400 max-w-[180px] truncate">
              {profile.schools.name}
            </span>
          )}
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-semibold text-indigo-700">
              {(profile?.preferred_name || profile?.full_name || profile?.email || '?')[0].toUpperCase()}
            </div>
            <span className="hidden sm:block text-sm text-slate-700 font-medium max-w-[140px] truncate">
              {profile?.preferred_name && profile.preferred_name !== profile.full_name
                ? `${profile.preferred_name} (${profile.full_name})`
                : profile?.full_name || profile?.email}
            </span>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${roleColor}`}>
            {profile?.role}
          </span>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="text-sm text-slate-400 hover:text-slate-700 transition-colors ml-1"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </nav>
  )
}
