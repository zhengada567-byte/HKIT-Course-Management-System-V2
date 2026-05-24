-- Run this in Supabase Dashboard -> SQL Editor -> Run
-- Copy ALL result tabs/output and send to the assistant.
-- This works even when pg_dump is not installed locally.

-- ============================================================
-- 1) Tables + columns
-- ============================================================
select
  c.table_schema,
  c.table_name,
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.is_nullable,
  c.column_default,
  c.character_maximum_length,
  c.numeric_precision,
  c.numeric_scale
from information_schema.columns c
where c.table_schema = 'public'
order by c.table_name, c.ordinal_position;

-- ============================================================
-- 2) Primary keys, unique, check, foreign keys
-- ============================================================
select
  tc.table_schema,
  tc.table_name,
  tc.constraint_type,
  tc.constraint_name,
  kcu.column_name,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name,
  pg_get_constraintdef(pgc.oid, true) as constraint_definition
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
  on tc.constraint_schema = kcu.constraint_schema
 and tc.constraint_name = kcu.constraint_name
left join information_schema.constraint_column_usage ccu
  on ccu.constraint_schema = tc.constraint_schema
 and ccu.constraint_name = tc.constraint_name
left join pg_constraint pgc
  on pgc.conname = tc.constraint_name
 and pgc.connamespace = 'public'::regnamespace
where tc.table_schema = 'public'
  and tc.constraint_type in ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY', 'CHECK')
order by tc.table_name, tc.constraint_type, tc.constraint_name, kcu.ordinal_position;

-- ============================================================
-- 3) Indexes (including unique indexes not exposed as constraints)
-- ============================================================
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
order by tablename, indexname;

-- ============================================================
-- 4) RLS enabled + policies
-- ============================================================
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by c.relname;

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- ============================================================
-- 5) Grants
-- ============================================================
select
  grantee,
  table_schema,
  table_name,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
order by table_name, grantee, privilege_type;

-- ============================================================
-- 6) Functions / RPC used by app (optional but useful)
-- ============================================================
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as result_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname, arguments;
