-- 0041b — colunas de medição de variante/effort e de qualidade de entrada.
--
-- ATENÇÃO: esta migration foi APLICADA no banco antes de existir como arquivo
-- (04/09/2026 descobriu-se que as colunas estavam em produção e o .sql não
-- estava no repositório). Foi reconstruída por introspecção do banco e é
-- idempotente de propósito: rodar de novo não quebra nada. Repo que não
-- reproduz o banco é armadilha — se você criar coluna pela MCP, escreva o
-- arquivo no mesmo movimento.

-- --------------------------------------------------------------- medição
alter table execucoes_ia add column if not exists effort   text;
alter table execucoes_ia add column if not exists variante text;

comment on column execucoes_ia.effort is
  'Effort pedido ao modelo nesta execução. Vem da linha ativa de prompts_versoes, '
  'ou do override da bancada de medição. Sem isto não dá para comparar custo entre variantes.';
comment on column execucoes_ia.variante is
  'Rótulo da variante quando a execução veio da bancada (scripts/bancada-ia.ts). '
  'NULL = execução de produção.';

-- ------------------------------------------------- qualidade da entrada
alter table briefings add column if not exists completude_entrada int;
alter table briefings add column if not exists verificacao        jsonb;

comment on column briefings.completude_entrada is
  'Score 0-100 do quanto o contexto estava completo quando este briefing foi gerado. '
  'Briefing ruim com entrada pobre não é falha do modelo — sem isto não dá para separar os dois casos.';
comment on column briefings.verificacao is
  'Resultado da verificação de fidelidade: frases literais localizadas ou não no contexto, '
  'cobertura de evidência. IA que inventa citação aparece aqui.';

-- ------------------------------------------------------------------ views
create or replace view vw_custo_ia_por_prompt as
 SELECT e.prompt_versao_id,
    p.chave,
    p.versao,
    p.ativo AS versao_ativa,
    e.modo,
    count(*) AS execucoes,
    COALESCE(sum(e.custo_usd), 0::numeric)::numeric(14,6) AS custo_usd_total,
    round(avg(e.custo_usd), 6) AS custo_usd_medio,
    round(avg(e.tokens_entrada)) AS tokens_entrada_medio,
    round(avg(e.tokens_saida)) AS tokens_saida_medio,
    round(avg(e.tokens_raciocinio)) AS tokens_raciocinio_medio,
        CASE
            WHEN sum(e.tokens_saida) > 0 THEN round(sum(COALESCE(e.tokens_raciocinio, 0))::numeric * 100::numeric / sum(e.tokens_saida)::numeric, 1)
            ELSE NULL::numeric
        END AS pct_saida_em_raciocinio,
    round(avg(e.latencia_ms) / 1000.0, 1) AS segundos_medio
   FROM execucoes_ia e
     JOIN prompts_versoes p ON p.id = e.prompt_versao_id
  GROUP BY e.prompt_versao_id, p.chave, p.versao, p.ativo, e.modo
  ORDER BY p.chave, p.versao DESC, e.modo;

create or replace view vw_custo_ia_por_variante as
 SELECT p.chave,
    e.modelo,
    COALESCE(e.variante, 'producao'::text) AS variante,
    COALESCE(e.effort, '(nao registrado)'::text) AS effort,
    count(*) AS execucoes,
    round(avg(e.custo_usd), 6) AS custo_usd_medio,
    round(avg(e.tokens_saida)) AS saida_media,
    round(avg(e.tokens_raciocinio)) AS raciocinio_medio,
        CASE
            WHEN sum(e.tokens_saida) > 0 THEN round(sum(COALESCE(e.tokens_raciocinio, 0))::numeric * 100::numeric / sum(e.tokens_saida)::numeric, 1)
            ELSE NULL::numeric
        END AS pct_saida_raciocinio,
    round(avg(e.latencia_ms) / 1000.0, 1) AS segundos_medio,
    count(*) FILTER (WHERE e.status = 'falhou'::status_execucao_ia) AS falhas
   FROM execucoes_ia e
     JOIN prompts_versoes p ON p.id = e.prompt_versao_id
  GROUP BY p.chave, e.modelo, (COALESCE(e.variante, 'producao'::text)), (COALESCE(e.effort, '(nao registrado)'::text))
  ORDER BY p.chave, (round(avg(e.custo_usd), 6));
