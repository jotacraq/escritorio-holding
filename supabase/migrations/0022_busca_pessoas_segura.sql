-- 0022_busca_pessoas_segura.sql
-- MÉDIO 2 (pentest, reproduzido ao vivo): GET /api/jornadas interpolava o termo
-- de busca dentro de `.or()` do PostgREST (src/app/api/jornadas/route.ts).
-- Vírgula/parênteses/ponto são meta-caracteres da gramática do PostgREST — um
-- termo como `)*or(etapa.eq.holding_contratada` reescreveu a árvore lógica do
-- filtro e devolveu linhas fora do filtro pretendido.
--
-- Correção: RPC parametrizada. `p_termo` chega como bind parameter do
-- PostgREST — nunca é concatenado em SQL, então não existe meta-caractere que
-- escape do valor. Usa o índice já existente `idx_pessoas_nome_busca`
-- (to_tsvector('pt_unaccent', nome)) para nome, e ILIKE parametrizado
-- (seguro mesmo sem index dedicado) para email/telefone, replicando a busca
-- que a rota já fazia. RLS de `pessoas` (`pessoas_sel`) filtra por
-- app.eh_interno() da mesma forma que filtrava antes.
create or replace function public.buscar_pessoas_por_termo(p_termo text)
returns table(pessoa_id uuid)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select p.id
    from pessoas p
   where p_termo is not null and length(trim(p_termo)) > 0
     and (
       to_tsvector('pt_unaccent', p.nome) @@ websearch_to_tsquery('pt_unaccent', p_termo)
       or p.nome     ilike '%' || p_termo || '%'
       or p.email    ilike '%' || p_termo || '%'
       or p.telefone ilike '%' || p_termo || '%'
     )
$$;

comment on function public.buscar_pessoas_por_termo(text) is
  'Busca segura por nome/email/telefone (MÉDIO 2 do pentest de 03/09/2026). '
  'p_termo é sempre bind parameter — nunca interpolado em filtro PostgREST.';

revoke execute on function public.buscar_pessoas_por_termo(text) from public, anon;
grant  execute on function public.buscar_pessoas_por_termo(text) to authenticated;
