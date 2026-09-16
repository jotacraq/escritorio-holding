-- scripts/verificacao-0106.sql — roteiro da Fase 12, Fatia 1 (inferência do
-- bloco atual pelo servidor — só DML: 2 chaves em configuracoes + update do
-- corpo do prompt v1 copiloto_sessao).
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- `postgres`, com 0091 a 0105 já aplicadas e 0106 AINDA NÃO aplicada — este
-- roteiro mede o `explain (analyze)` do próprio DML de 0106 DENTRO de
-- `begin; ...; rollback;`, então pode (e deve) rodar ANTES de aplicar a
-- migration de verdade. A última instrução devolve `resultado_0106` (ordem,
-- passo, ok, detalhe).
--
-- ⚠️ Nenhum passo deste roteiro foi executado contra o banco real
-- (fcfsnqqaphtamhrpuyoh) por este agente — sem acesso de produção nesta
-- máquina, por regra dura da operação. Rode antes de aplicar 0106.
--
-- O QUE ESTE ROTEIRO PROVA
--   0  as duas chaves de configuração NÃO existem ainda (senão o teste de
--        `on conflict do nothing` não prova nada — mediria um no-op)
--   1  `explain (analyze, buffers)` do INSERT de
--        `copiloto_sessao.inferencia_bloco_ativa` — `Conflict Arbiter
--        Indexes: configuracoes_pkey`, sem Seq Scan
--   2  `explain (analyze, buffers)` do UPDATE em `prompts_versoes` (chave,
--        versao) — Index Scan sobre a unique `(chave, versao)`, sem Seq Scan
--   3  `explain (analyze, buffers)` da leitura que
--        `estado.ts::resolverBlocoAtual` faz quando NÃO há fixação manual:
--        `select bloco_id, confianca, criado_em from copiloto_sugestoes
--         where sessao_id = $1 and bloco_id is not null
--         order by ordem_evento desc limit 1` — MESMO índice do polling
--        (`idx_copiloto_sugestoes_polling (sessao_id, ordem_evento)`, 0091),
--        nenhum índice novo criado por esta migration
--   4  tudo com ROLLBACK — nada fica gravado por este roteiro
-- ---------------------------------------------------------------------------

drop table if exists resultado_0106;
create temp table resultado_0106 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r106(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0106 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;


-- ===========================================================================
-- 0. Pré-condição: as chaves ainda não existem (senão o passo 1 mediria um
--    no-op do `on conflict do nothing`, não o INSERT real).
-- ===========================================================================
do $$
declare
  v_existentes int;
begin
  select count(*) into v_existentes from configuracoes
   where chave in ('copiloto_sessao.inferencia_bloco_ativa', 'copiloto_sessao.janela_fixacao_manual_segundos');
  perform pg_temp.r106('0. chaves novas ainda não existem', v_existentes = 0,
    format('encontradas=%s (esperado 0 antes de aplicar 0106)', v_existentes));
end $$;


-- ===========================================================================
-- 1. EXPLAIN do INSERT de configuracoes — DENTRO de begin/rollback (explain
--    em DML EXECUTA o DML; 0102/0105 já erraram nisso, aqui não).
-- ===========================================================================
begin;
  explain (analyze, buffers)
  insert into configuracoes (chave, valor, descricao) values
   ('copiloto_sessao.inferencia_bloco_ativa', 'true'::jsonb, 'medição — não persiste (rollback)')
  on conflict (chave) do nothing;
rollback;
-- Aceite: "Conflict Arbiter Indexes: configuracoes_pkey" no plano acima,
-- "Tuples Inserted: 1" (a chave ainda não existia, passo 0 confirmou),
-- nenhum "Seq Scan". Colar a saída real no relatório da tarefa.


-- ===========================================================================
-- 2. EXPLAIN do UPDATE em prompts_versoes (chave, versao) — dentro de
--    begin/rollback.
-- ===========================================================================
begin;
  explain (analyze, buffers)
  update prompts_versoes
     set corpo_sistema = corpo_sistema || ' -- medição, não persiste (rollback)'
   where chave = 'copiloto_sessao' and versao = 1;
rollback;
-- Aceite: Index Scan sobre a unique (chave, versao) de prompts_versoes
-- (0009) — mesma chave que todo `insert ... on conflict (chave, versao)`
-- desta tabela já usa (0042/0059/0066/0090/0094). "Rows Removed by Filter"
-- deve ser 0 ou muito baixo. Colar a saída real no relatório.


-- ===========================================================================
-- 3. EXPLAIN da leitura de inferência mais recente
--    (estado.ts::resolverBlocoAtual, ramo "sem fixação manual"). Usa uma
--    sessao_id QUALQUER que já tenha copiloto_sugestoes com bloco_id
--    preenchido — trocar '<sessao_id_real>' por um id de teste/local antes
--    de rodar; sem isso o plano ainda é válido, só com rows=0.
-- ===========================================================================
explain (analyze, buffers)
select bloco_id, confianca, criado_em
  from copiloto_sugestoes
 where sessao_id = '00000000-0000-0000-0000-000000000000'::uuid
   and bloco_id is not null
 order by ordem_evento desc
 limit 1;
-- Aceite: Index Scan using idx_copiloto_sugestoes_polling (sessao_id,
-- ordem_evento) — MESMO índice que o polling coalescido já usa
-- (route.ts::buscarSugestoesNovas), nenhum índice novo. "bloco_id is not
-- null" é filtro RESIDUAL dentro do Index Scan já restrito por sessao_id —
-- mesmo raciocínio já documentado em gatilho.ts/contexto.ts para filtros
-- sem índice próprio sobre uma cardinalidade pequena por sessão.


select * from resultado_0106 order by ordem;
