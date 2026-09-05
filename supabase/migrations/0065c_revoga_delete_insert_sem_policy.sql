-- 0065c_revoga_delete_insert_sem_policy.sql — hardening sistêmico (orquestrador, 05/09/2026).
-- Varredura após a 0065b: 51 tabelas de `public` tinham DELETE concedido a `authenticated`
-- sem NENHUMA policy de DELETE (e ~20 tinham INSERT sem policy de INSERT) — herança do
-- `alter default privileges` do Supabase. Como toda tabela tem RLS `force`, o efeito
-- prático era "0 linhas afetadas" (DELETE) ou 42501 (INSERT) — mas privilégio sem
-- policy é dívida: uma policy `for all` futura ou um `disable row level security`
-- acidental abriria a porta. Regra: privilégio só onde há policy.
--
-- O que faz: para cada tabela de `public` onde `authenticated` tem DELETE e não existe
-- policy DELETE/ALL para authenticated/public → revoke delete. Idem para INSERT.
-- Não toca em UPDATE/SELECT nem em service_role. Idempotente.
--
-- VERIFICAÇÃO: a query da varredura (abaixo, em comentário) deve devolver 0 linhas.
--   select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
--    where n.nspname='public' and c.relkind='r'
--      and has_table_privilege('authenticated',c.oid,'delete')
--      and not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=c.relname
--                        and p.cmd in ('DELETE','ALL') and ('authenticated'=any(p.roles) or 'public'=any(p.roles)));
-- NOTA: usar c.oid (não 'public.'||relname): o planner avaliava a função antes do filtro de schema e quebrava em pg_statistic.
-- REVERSÃO: `grant delete/insert on <tabela> to authenticated` caso a caso — não há motivo.
do $$
declare r record;
begin
  for r in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and has_table_privilege('authenticated', c.oid, 'delete')
       and not exists (
         select 1 from pg_policies p
          where p.schemaname = 'public' and p.tablename = c.relname
            and p.cmd in ('DELETE', 'ALL')
            and ('authenticated' = any(p.roles) or 'public' = any(p.roles)))
  loop
    execute format('revoke delete on public.%I from authenticated', r.relname);
  end loop;
  for r in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and has_table_privilege('authenticated', c.oid, 'insert')
       and not exists (
         select 1 from pg_policies p
          where p.schemaname = 'public' and p.tablename = c.relname
            and p.cmd in ('INSERT', 'ALL')
            and ('authenticated' = any(p.roles) or 'public' = any(p.roles)))
  loop
    execute format('revoke insert on public.%I from authenticated', r.relname);
  end loop;
end $$;
