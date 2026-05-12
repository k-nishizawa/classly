-- 1. Check profiles table schema
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'profiles'
ORDER BY ordinal_position;

-- 2. Update your account to teacher role
UPDATE public.profiles
SET role = 'teacher'
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'kntnszw@gmail.com'
);

-- 3. Verify the change
SELECT p.id, u.email, p.role
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
WHERE u.email = 'kntnszw@gmail.com';
