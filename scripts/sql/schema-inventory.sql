-- ============================================================================
-- Track Tuner schema inventory - READ ONLY
-- ============================================================================
-- What a database actually holds, one object per line, so the hosted project
-- can be diffed against a database built from supabase/migrations/. The
-- per-migration audit beside this file (audit-migrations-against-database.sql)
-- answers which migrations a database has by one sentinel each; this answers
-- everything else those migrations made, and anything made by hand that no
-- migration describes. docs/beta-runbook.md, "Check the hosted schema for
-- drift", is how it is run; scripts/schema-drift.mjs (npm run db:drift) does the
-- diff.
--
-- It is a single SELECT over the system catalogues. It performs no DDL, no
-- INSERT/UPDATE/DELETE, no SET ROLE, and it reads no rows from any application
-- table. The only non-catalogue source is storage.buckets, and only its
-- configuration columns (id, public, size limit, mime allow-list) - never
-- storage.objects, and never a user table.
--
-- Output: one text column, `line`, in a stable order. In the Supabase SQL
-- editor: run it, then use "Download CSV" rather than copying rows out of the
-- grid.
-- ============================================================================
with
scoped_ns as (
  select oid, nspname from pg_namespace where nspname in ('public', 'auth', 'storage')
),
scoped_rel as (
  select c.oid, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
         c.relacl, c.relowner, c.reloptions, n.nspname
  from pg_class c
  join scoped_ns n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm')
    and n.nspname = 'public'          -- inventory only the app's own relations
),
lines as (

  -- TABLE ---------------------------------------------------------------
  -- options= carries reloptions, which is where a view's security_invoker
  -- lives - one of the things `supabase db diff` is known to miss.
  select format('TABLE       %I.%I  kind=%s  owner=%s  options=%s', r.nspname, r.relname,
                case r.relkind when 'r' then 'table' when 'p' then 'partitioned'
                               when 'v' then 'view'  when 'm' then 'matview' end,
                pg_get_userbyid(r.relowner),
                coalesce(array_to_string(r.reloptions, ','), '-')) as line
  from scoped_rel r

  union all
  -- VIEW ----------------------------------------------------------------
  -- The definition reduced to an md5, as function bodies are below: it says that
  -- a view differs, and pg_get_viewdef on both sides says how.
  select format('VIEW        %I.%I  defmd5=%s', r.nspname, r.relname,
                md5(pg_get_viewdef(r.oid)))
  from scoped_rel r
  where r.relkind in ('v', 'm')

  union all
  -- RLS -----------------------------------------------------------------
  select format('RLS         %I.%I  enabled=%s forced=%s', r.nspname, r.relname,
                r.relrowsecurity, r.relforcerowsecurity)
  from scoped_rel r
  where r.relkind in ('r', 'p')

  union all
  -- COLUMN --------------------------------------------------------------
  -- The column's ordinal position is deliberately NOT printed. A column added by a
  -- later migration lands at a later ordinal than the same column on a database
  -- built in one pass, so printing it manufactures a diff on exactly the columns
  -- this exercise is about. Names and types are what the Data API and the app use.
  select format('COLUMN      %I.%I.%I  type=%s  notnull=%s  default=%s  identity=%s  generated=%s',
                r.nspname, r.relname, a.attname,
                format_type(a.atttypid, a.atttypmod),
                a.attnotnull,
                coalesce(pg_get_expr(d.adbin, d.adrelid), '-'),
                case a.attidentity when '' then '-' else a.attidentity::text end,
                case a.attgenerated when '' then '-' else a.attgenerated::text end)
  from scoped_rel r
  join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum

  union all
  -- CONSTRAINT ----------------------------------------------------------
  select format('CONSTRAINT  %I.%I  %I  %s', r.nspname, r.relname, k.conname,
                pg_get_constraintdef(k.oid))
  from scoped_rel r
  join pg_constraint k on k.conrelid = r.oid

  union all
  -- INDEX ---------------------------------------------------------------
  select format('INDEX       %I.%I  %I  %s', r.nspname, r.relname, ic.relname,
                pg_get_indexdef(i.indexrelid))
  from scoped_rel r
  join pg_index i on i.indrelid = r.oid
  join pg_class ic on ic.oid = i.indexrelid

  union all
  -- POLICY (public tables) ----------------------------------------------
  select format('POLICY      %I.%I  %s  perm=%s  cmd=%s  roles=%s  using=%s  check=%s',
                r.nspname, r.relname, p.polname,
                case p.polpermissive when true then 'PERMISSIVE' else 'RESTRICTIVE' end,
                p.polcmd,
                coalesce((select string_agg(case when x = 0 then 'PUBLIC' else pg_get_userbyid(x) end, ','
                                             order by case when x = 0 then 'PUBLIC' else pg_get_userbyid(x) end)
                          from unnest(p.polroles) as x), 'PUBLIC'),
                coalesce(pg_get_expr(p.polqual, p.polrelid), '-'),
                coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'))
  from scoped_rel r
  join pg_policy p on p.polrelid = r.oid

  union all
  -- POLICY (storage.objects - vehicle photo policies live here) ----------
  select format('POLICY      %I.%I  %s  perm=%s  cmd=%s  roles=%s  using=%s  check=%s',
                n.nspname, c.relname, p.polname,
                case p.polpermissive when true then 'PERMISSIVE' else 'RESTRICTIVE' end,
                p.polcmd,
                coalesce((select string_agg(case when x = 0 then 'PUBLIC' else pg_get_userbyid(x) end, ','
                                             order by case when x = 0 then 'PUBLIC' else pg_get_userbyid(x) end)
                          from unnest(p.polroles) as x), 'PUBLIC'),
                coalesce(pg_get_expr(p.polqual, p.polrelid), '-'),
                coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'))
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'storage' and c.relname = 'objects'

  union all
  -- TRIGGER (public, plus auth.users and storage.objects) ----------------
  select format('TRIGGER     %I.%I  %I  enabled=%s  %s', n.nspname, c.relname, t.tgname,
                t.tgenabled, pg_get_triggerdef(t.oid))
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal
    and (n.nspname = 'public'
         or (n.nspname = 'auth' and c.relname = 'users')
         or (n.nspname = 'storage' and c.relname = 'objects'))

  union all
  -- FUNCTION ------------------------------------------------------------
  select format('FUNCTION    %I.%I(%s)  returns=%s  lang=%s  security=%s  volatile=%s  searchpath=%s  bodymd5=%s',
                n.nspname, p.proname,
                pg_get_function_identity_arguments(p.oid),
                pg_get_function_result(p.oid),
                l.lanname,
                case p.prosecdef when true then 'DEFINER' else 'INVOKER' end,
                p.provolatile,
                coalesce(array_to_string(p.proconfig, ' '), '-'),
                md5(pg_get_functiondef(p.oid)))
                || format('  owner=%s', pg_get_userbyid(p.proowner))
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public' and p.prokind in ('f', 'p')

  union all
  -- FUNCGRANT (execute privileges; NULL acl = Postgres default, EXECUTE to PUBLIC)
  select format('FUNCGRANT   %I.%I(%s)  %s', n.nspname, p.proname,
                pg_get_function_identity_arguments(p.oid),
                case when p.proacl is null then '<default acl: EXECUTE to PUBLIC>'
                     else (select string_agg(format('%s=%s', coalesce(nullif(pg_get_userbyid(g.grantee), ''), 'PUBLIC'), g.privilege_type),
                                             ', ' order by pg_get_userbyid(g.grantee), g.privilege_type)
                           from aclexplode(p.proacl) g)
                end)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind in ('f', 'p')

  union all
  -- TABGRANT (all table-level privileges, per grantee, aggregated) -------
  select format('TABGRANT    %I.%I  %s  %s', r.nspname, r.relname,
                case when g.grantee = 0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end,
                string_agg(g.privilege_type, ',' order by g.privilege_type))
  from scoped_rel r
  cross join lateral aclexplode(r.relacl) g
  group by r.nspname, r.relname, g.grantee

  union all
  -- TABGRANT for relations whose acl is NULL (owner-only default) --------
  select format('TABGRANT    %I.%I  <null acl: owner-only default>', r.nspname, r.relname)
  from scoped_rel r
  where r.relacl is null

  union all
  -- COLGRANT (column-level privileges, if any) --------------------------
  select format('COLGRANT    %I.%I.%I  %s  %s', r.nspname, r.relname, a.attname,
                case when g.grantee = 0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end,
                string_agg(g.privilege_type, ',' order by g.privilege_type))
  from scoped_rel r
  join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
       and a.attacl is not null
  cross join lateral aclexplode(a.attacl) g
  group by r.nspname, r.relname, a.attname, g.grantee

  union all
  -- DEFACL (default privileges) -----------------------------------------
  select format('DEFACL      schema=%s  owner=%s  objtype=%s  %s',
                coalesce(dn.nspname, '<all>'), pg_get_userbyid(d.defaclrole),
                d.defaclobjtype,
                (select string_agg(format('%s=%s', case when g.grantee = 0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end, g.privilege_type),
                                   ', ' order by case when g.grantee = 0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end, g.privilege_type)
                 from aclexplode(d.defaclacl) g))
  from pg_default_acl d
  left join pg_namespace dn on dn.oid = d.defaclnamespace
  where dn.nspname = 'public' or dn.nspname is null

  union all
  -- ENUM ----------------------------------------------------------------
  select format('ENUM        %I.%I  values=%s', n.nspname, t.typname,
                (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
                 from pg_enum e where e.enumtypid = t.oid))
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  where t.typtype = 'e' and n.nspname = 'public'

  union all
  -- EXTENSION -----------------------------------------------------------
  select format('EXTENSION   %s  version=%s  schema=%s', e.extname, e.extversion,
                coalesce(n.nspname, '-'))
  from pg_extension e
  left join pg_namespace n on n.oid = e.extnamespace

  union all
  -- BUCKET (storage configuration only - no objects, no user data) -------
  select format('BUCKET      %s  public=%s  file_size_limit=%s  allowed_mime_types=%s',
                b.id, b.public, coalesce(b.file_size_limit::text, '-'),
                coalesce(array_to_string(b.allowed_mime_types, ','), '-'))
  from storage.buckets b

  union all
  -- MIGRATION HISTORY (present only if the CLI has ever pushed) ----------
  select format('MIGRATIONS  table_exists=%s',
                exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                        where n.nspname = 'supabase_migrations' and c.relname = 'schema_migrations')::text)
)
-- Newlines and indentation inside catalogue-rendered expressions are collapsed so
-- every record is exactly one line and two databases diff cleanly.
select regexp_replace(line, '\s+', ' ', 'g') as line
from lines
order by 1;
