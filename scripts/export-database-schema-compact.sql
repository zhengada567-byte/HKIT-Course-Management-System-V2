-- Supabase SQL Editor: Run ALL, then copy each result tab and send to assistant.
-- Each query returns ONE row with a big text block (easy to copy).

-- ============================================================
-- TAB 1: All tables + columns
-- ============================================================
select string_agg(
  format(
    '%-40s | %-30s | %-25s | nullable=%-3s | default=%s',
    table_name,
    column_name,
    data_type,
    is_nullable,
    coalesce(left(column_default, 80), '')
  ),
  E'\n'
  order by table_name, ordinal_position
) as tables_and_columns
from information_schema.columns
where table_schema = 'public';

-- ============================================================
-- TAB 2: All constraints (PK / UNIQUE / FK / CHECK)
-- ============================================================
select string_agg(
  format(
    '%-30s | %-12s | %-40s | %s',
    tc.table_name,
    tc.constraint_type,
    tc.constraint_name,
    pg_get_constraintdef(pgc.oid, true)
  ),
  E'\n'
  order by tc.table_name, tc.constraint_type, tc.constraint_name
) as constraints
from information_schema.table_constraints tc
join pg_constraint pgc
  on pgc.conname = tc.constraint_name
 and pgc.connamespace = 'public'::regnamespace
where tc.table_schema = 'public'
  and tc.constraint_type in ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY', 'CHECK');

-- ============================================================
-- TAB 3: All indexes
-- ============================================================
select string_agg(
  format('%-30s | %-40s | %s', tablename, indexname, indexdef),
  E'\n'
  order by tablename, indexname
) as indexes
from pg_indexes
where schemaname = 'public';

-- ============================================================
-- TAB 4: RLS status + policies
-- ============================================================
select string_agg(
  format(
    'TABLE %-35s | rls=%-5s | forced=%-5s',
    c.relname,
    c.relrowsecurity,
    c.relforcerowsecurity
  ),
  E'\n'
  order by c.relname
) as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r';

select string_agg(
  format(
    '%-30s | %-35s | roles=%s | cmd=%-6s | using=%s | check=%s',
    tablename,
    policyname,
    array_to_string(roles, ','),
    cmd,
    coalesce(left(qual, 120), ''),
    coalesce(left(with_check, 120), '')
  ),
  E'\n'
  order by tablename, policyname
) as rls_policies
from pg_policies
where schemaname = 'public';

-- ============================================================
-- TAB 5: Grants
-- ============================================================
select string_agg(
  format('%-30s | grantee=%-15s | %s', table_name, grantee, privilege_type),
  E'\n'
  order by table_name, grantee, privilege_type
) as grants
from information_schema.role_table_grants
where table_schema = 'public';

-- ============================================================
-- TAB 6: Functions (you already sent this — run again for completeness)
-- ============================================================
select string_agg(
  format(
    '%-35s(%s) -> %s',
    p.proname,
    pg_get_function_identity_arguments(p.oid),
    pg_get_function_result(p.oid)
  ),
  E'\n'
  order by p.proname, pg_get_function_identity_arguments(p.oid)
) as functions
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public';
