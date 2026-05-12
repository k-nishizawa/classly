-- ============================================================
-- Classly – Database Schema
-- ============================================================
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor)
-- or via: supabase db reset
-- ============================================================

-- Extensions
create extension if not exists "pgcrypto";


-- ============================================================
-- TABLES (dependency order)
-- ============================================================

-- 1. Schools
create table public.schools (
  id            uuid        primary key default gen_random_uuid(),
  name          text        not null,
  address       text,
  city          text,
  country       text        not null default 'Japan',
  contact_email text,
  phone         text,
  created_at    timestamptz not null default now()
);

-- 2. Profiles (extends auth.users 1-to-1)
create table public.profiles (
  id          uuid        primary key references auth.users(id) on delete cascade,
  email       text        not null,
  full_name   text        not null default '',
  avatar_url  text,
  role        text        not null default 'student'
                check (role in ('teacher', 'student', 'admin')),
  school_id   uuid        references public.schools(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 3. Classes
create table public.classes (
  id           uuid        primary key default gen_random_uuid(),
  school_id    uuid        not null references public.schools(id) on delete cascade,
  teacher_id   uuid        not null references public.profiles(id),
  name         text        not null,
  description  text,
  language     text,                  -- language being taught e.g. 'Japanese', 'English'
  level        text        check (level in (
                              'beginner', 'elementary', 'intermediate',
                              'upper-intermediate', 'advanced'
                            )),
  -- { "days": ["Mon","Wed","Fri"], "time": "10:00", "duration_minutes": 90 }
  schedule     jsonb,
  max_students int         not null default 20,
  is_active    boolean     not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 4. Class Members (enrollment)
create table public.class_members (
  id         uuid        primary key default gen_random_uuid(),
  class_id   uuid        not null references public.classes(id) on delete cascade,
  student_id uuid        not null references public.profiles(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  unique (class_id, student_id)
);

-- 5. Attendance Sessions (QR code sessions created by teachers)
--    A new row = a new rotating QR code; expires_at enforces the 15-minute window.
create table public.attendance_sessions (
  id            uuid        primary key default gen_random_uuid(),
  class_id      uuid        not null references public.classes(id) on delete cascade,
  teacher_id    uuid        not null references public.profiles(id),
  -- Unique random token embedded in the QR code; regenerated each session
  session_token text        not null unique
                              default encode(gen_random_bytes(32), 'hex'),
  session_date  date        not null default current_date,
  expires_at    timestamptz not null default (now() + interval '15 minutes'),
  status        text        not null default 'active'
                              check (status in ('active', 'expired', 'closed')),
  created_at    timestamptz not null default now()
);

-- 6. Attendance Records
create table public.attendance_records (
  id         uuid        primary key default gen_random_uuid(),
  session_id uuid        not null references public.attendance_sessions(id) on delete cascade,
  student_id uuid        not null references public.profiles(id),
  class_id   uuid        not null references public.classes(id),
  status     text        not null default 'present'
               check (status in ('present', 'late', 'absent', 'excused')),
  -- Optional GPS coordinates captured at scan time
  latitude   numeric(9, 6),
  longitude  numeric(9, 6),
  marked_at  timestamptz not null default now(),
  notes      text,
  unique (session_id, student_id)
);

-- 7. Messages (class announcements or direct messages)
create table public.messages (
  id              uuid        primary key default gen_random_uuid(),
  class_id        uuid        references public.classes(id) on delete cascade,
  sender_id       uuid        not null references public.profiles(id),
  -- null recipient_id = class-wide announcement
  recipient_id    uuid        references public.profiles(id),
  subject         text,
  body            text        not null,
  is_announcement boolean     not null default false,
  created_at      timestamptz not null default now()
);

-- 7b. Message read receipts (tracks who has seen each announcement)
create table public.message_reads (
  message_id uuid        not null references public.messages(id) on delete cascade,
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- 8. Words (vocabulary for the study/flashcard feature)
create table public.words (
  id               uuid        primary key default gen_random_uuid(),
  class_id         uuid        not null references public.classes(id) on delete cascade,
  added_by         uuid        not null references public.profiles(id),
  term             text        not null,
  definition       text        not null,
  example_sentence text,
  translation      text,        -- native-language translation
  image_url        text,
  audio_url        text,
  tags             text[],
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);


-- ============================================================
-- INDEXES
-- ============================================================

create index on public.profiles (school_id);
create index on public.classes (school_id);
create index on public.classes (teacher_id);
create index on public.class_members (class_id);
create index on public.class_members (student_id);
create index on public.attendance_sessions (class_id);
create index on public.attendance_sessions (session_token);   -- QR lookup
create index on public.attendance_sessions (expires_at);      -- expiry sweep
create index on public.attendance_sessions (status);
create index on public.attendance_records (session_id);
create index on public.attendance_records (student_id);
create index on public.attendance_records (class_id);
create index on public.messages (class_id);
create index on public.messages (sender_id);
create index on public.messages (recipient_id);
create index on public.words (class_id);
create index on public.words using gin (tags);                -- tag-based search


-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-update updated_at columns
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger set_classes_updated_at
  before update on public.classes
  for each row execute function public.set_updated_at();

create trigger set_words_updated_at
  before update on public.words
  for each row execute function public.set_updated_at();

-- Auto-create profile row when a user signs up via Supabase Auth
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Expire stale attendance sessions (call this from a pg_cron job or Edge Function):
--   select public.expire_attendance_sessions();
create or replace function public.expire_attendance_sessions()
returns void
language sql
security definer
as $$
  update public.attendance_sessions
  set    status = 'expired'
  where  status = 'active'
    and  expires_at < now();
$$;


-- ============================================================
-- VIEWS
-- ============================================================

-- Attendance rate per student per class, with visa compliance flag.
-- Visa compliance rule: student must maintain >= 80% attendance.
-- Only completed sessions (status = 'expired' | 'closed') count toward totals.
create or replace view public.attendance_rates
with (security_invoker = true)   -- RLS of the calling user applies
as
select
  cm.student_id,
  cm.class_id,
  p.full_name                                                         as student_name,
  p.email                                                             as student_email,
  c.name                                                              as class_name,

  count(distinct s.id)                                                as total_sessions,

  count(distinct ar.session_id)
    filter (where ar.status in ('present', 'late'))                   as attended_sessions,

  count(distinct ar.session_id)
    filter (where ar.status = 'absent')                               as absent_sessions,

  count(distinct ar.session_id)
    filter (where ar.status = 'excused')                              as excused_sessions,

  -- Attendance percentage (0–100); 100 when no sessions recorded yet
  case
    when count(distinct s.id) = 0 then 100.00
    else round(
      count(distinct ar.session_id) filter (where ar.status in ('present', 'late'))
        ::numeric
      / count(distinct s.id)::numeric
      * 100,
      2
    )
  end                                                                 as attendance_rate,

  -- true  = student meets the 80% visa-compliance threshold
  -- true  = assumed compliant when no sessions have been held yet
  case
    when count(distinct s.id) = 0 then true
    else (
      count(distinct ar.session_id) filter (where ar.status in ('present', 'late'))
        ::numeric
      / count(distinct s.id)::numeric
      * 100
    ) >= 80
  end                                                                 as visa_compliant,

  -- How many more sessions the student must attend to reach 80%.
  -- 0 means already compliant; positive means at risk.
  greatest(
    0,
    ceil(0.8 * count(distinct s.id))
      - count(distinct ar.session_id) filter (where ar.status in ('present', 'late'))
  )::int                                                              as sessions_needed_for_compliance

from       public.class_members      cm
join       public.profiles           p   on p.id = cm.student_id
join       public.classes            c   on c.id = cm.class_id
left join  public.attendance_sessions s  on  s.class_id = cm.class_id
                                        and s.status    in ('expired', 'closed')
left join  public.attendance_records  ar on ar.session_id = s.id
                                        and ar.student_id = cm.student_id
group by
  cm.student_id,
  cm.class_id,
  p.full_name,
  p.email,
  c.name;


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.schools              enable row level security;
alter table public.profiles             enable row level security;
alter table public.classes              enable row level security;
alter table public.class_members        enable row level security;
alter table public.attendance_sessions  enable row level security;
alter table public.attendance_records   enable row level security;
alter table public.messages             enable row level security;
alter table public.message_reads        enable row level security;
alter table public.words                enable row level security;


-- ── Helper functions (security definer so they bypass RLS internally) ────────

create or replace function public.is_admin()
returns boolean
language sql
security definer stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_teacher_or_admin()
returns boolean
language sql
security definer stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('teacher', 'admin')
  );
$$;

create or replace function public.is_class_member(p_class_id uuid)
returns boolean
language sql
security definer stable
as $$
  select exists (
    select 1 from public.class_members
    where class_id = p_class_id and student_id = auth.uid()
  );
$$;

create or replace function public.is_class_teacher(p_class_id uuid)
returns boolean
language sql
security definer stable
as $$
  select exists (
    select 1 from public.classes
    where id = p_class_id and teacher_id = auth.uid()
  );
$$;


-- ── schools ──────────────────────────────────────────────────────────────────

create policy "Authenticated users can view schools"
  on public.schools for select
  to authenticated
  using (true);

create policy "Admins can manage schools"
  on public.schools for all
  to authenticated
  using     (public.is_admin())
  with check (public.is_admin());


-- ── profiles ─────────────────────────────────────────────────────────────────

create policy "Users can view their own profile"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

-- Teachers need to see their students' names/emails
create policy "Teachers can view profiles of students in their classes"
  on public.profiles for select
  to authenticated
  using (
    exists (
      select 1
      from   public.class_members cm
      join   public.classes       c  on c.id = cm.class_id
      where  cm.student_id = profiles.id
        and  c.teacher_id  = auth.uid()
    )
  );

create policy "Admins can view all profiles"
  on public.profiles for select
  to authenticated
  using (public.is_admin());

create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using     (id = auth.uid())
  with check (id = auth.uid());

-- Role changes are admin-only
create policy "Admins can update any profile"
  on public.profiles for update
  to authenticated
  using     (public.is_admin())
  with check (public.is_admin());


-- ── classes ───────────────────────────────────────────────────────────────────

create policy "Students can view their enrolled classes"
  on public.classes for select
  to authenticated
  using (public.is_class_member(id));

create policy "Teachers can view and manage their own classes"
  on public.classes for all
  to authenticated
  using     (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

create policy "Admins can view all classes"
  on public.classes for select
  to authenticated
  using (public.is_admin());

create policy "Admins can manage all classes"
  on public.classes for all
  to authenticated
  using     (public.is_admin())
  with check (public.is_admin());


-- ── class_members ─────────────────────────────────────────────────────────────

create policy "Students can view their own memberships"
  on public.class_members for select
  to authenticated
  using (student_id = auth.uid());

create policy "Teachers can view and manage members of their classes"
  on public.class_members for all
  to authenticated
  using     (public.is_class_teacher(class_id))
  with check (public.is_class_teacher(class_id));

create policy "Admins can manage all memberships"
  on public.class_members for all
  to authenticated
  using     (public.is_admin())
  with check (public.is_admin());


-- ── attendance_sessions ───────────────────────────────────────────────────────

create policy "Teachers can manage sessions for their classes"
  on public.attendance_sessions for all
  to authenticated
  using     (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

-- Students can read an active, non-expired session to validate the QR they scanned
create policy "Students can view active sessions for their classes"
  on public.attendance_sessions for select
  to authenticated
  using (
    status     = 'active'
    and expires_at > now()
    and public.is_class_member(class_id)
  );


-- ── attendance_records ────────────────────────────────────────────────────────

-- Students submit their own record only while the session is still active
create policy "Students can mark their own attendance"
  on public.attendance_records for insert
  to authenticated
  with check (
    student_id = auth.uid()
    and exists (
      select 1 from public.attendance_sessions s
      where  s.id        = session_id
        and  s.status    = 'active'
        and  s.expires_at > now()
    )
  );

create policy "Students can view their own attendance records"
  on public.attendance_records for select
  to authenticated
  using (student_id = auth.uid());

create policy "Teachers can view and manage attendance for their classes"
  on public.attendance_records for all
  to authenticated
  using     (public.is_class_teacher(class_id))
  with check (public.is_class_teacher(class_id));

create policy "Admins can manage all attendance records"
  on public.attendance_records for all
  to authenticated
  using     (public.is_admin())
  with check (public.is_admin());


-- ── messages ──────────────────────────────────────────────────────────────────

create policy "Senders can view messages they sent"
  on public.messages for select
  to authenticated
  using (sender_id = auth.uid());

create policy "Recipients can view direct messages addressed to them"
  on public.messages for select
  to authenticated
  using (recipient_id = auth.uid());

create policy "Class members can view announcements for their class"
  on public.messages for select
  to authenticated
  using (
    is_announcement = true
    and public.is_class_member(class_id)
  );

create policy "Teachers can send messages in their classes"
  on public.messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_class_teacher(class_id)
  );

create policy "Teachers can delete their own messages"
  on public.messages for delete
  to authenticated
  using (sender_id = auth.uid());


-- ── message_reads ─────────────────────────────────────────────────────────────

create policy "Users can mark messages as read"
  on public.message_reads for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users can view their own read receipts"
  on public.message_reads for select
  to authenticated
  using (user_id = auth.uid());

-- Teachers can see who has read their announcements
create policy "Teachers can view read receipts for messages they sent"
  on public.message_reads for select
  to authenticated
  using (
    exists (
      select 1 from public.messages m
      where  m.id = message_id and m.sender_id = auth.uid()
    )
  );


-- ── words ─────────────────────────────────────────────────────────────────────

create policy "Class members can view vocabulary words"
  on public.words for select
  to authenticated
  using (
    public.is_class_member(class_id)
    or public.is_class_teacher(class_id)
  );

create policy "Teachers can add words to their classes"
  on public.words for insert
  to authenticated
  with check (
    added_by = auth.uid()
    and public.is_class_teacher(class_id)
  );

create policy "Teachers can update words in their classes"
  on public.words for update
  to authenticated
  using     (public.is_class_teacher(class_id))
  with check (public.is_class_teacher(class_id));

create policy "Teachers can delete words from their classes"
  on public.words for delete
  to authenticated
  using (public.is_class_teacher(class_id));

