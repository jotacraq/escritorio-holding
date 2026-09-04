-- 0047 — reafirma `security_invoker` nas views de custo de IA. APLICADA.
--
-- Achado ALTO do pentest de 04/09/2026. A `0041b` foi reconstruída a partir de
-- `pg_get_viewdef()`, que devolve só o SELECT — as reloptions não aparecem ali.
-- O arquivo ficou sem `with (security_invoker = true)`.
--
-- No banco vivo nada quebrou: `create or replace view` PRESERVA as reloptions
-- da view existente quando elas não são declaradas. Mas num banco novo
-- (recriação, staging, restore) o arquivo criaria as views SEM a cláusula, e
-- aí a RLS de `execucoes_ia` (`ex_sel`, restrita a `app.ve_patrimonio()`)
-- seria avaliada como o dono da view em vez de quem consulta — custo de IA
-- vazando para `relacionamento`/`assistente` pelo PostgREST.
--
-- Lição para quem for reconstruir migration por introspecção: `pg_get_viewdef`
-- NÃO é a definição inteira. Confira `pg_class.reloptions` também.
--
-- Conferência (esperado: nenhuma linha):
--   select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relkind = 'v'
--      and not (coalesce(c.reloptions, '{}') @> array['security_invoker=true']);
alter view vw_custo_ia_por_prompt   set (security_invoker = true);
alter view vw_custo_ia_por_variante set (security_invoker = true);
alter view vw_custo_ia_por_jornada  set (security_invoker = true);
alter view vw_custo_ia_mensal       set (security_invoker = true);
