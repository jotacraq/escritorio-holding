-- 0041_mede_tokens_de_raciocinio.sql
-- 91% do custo de um briefing esta na SAIDA (medido em producao: entrada 4.697
-- tokens = US$ 0,0094; saida 9.377 = US$ 0,0938). O unico parametro que da para
-- ajustar sem mexer no metodo e o `reasoning.max_tokens` — e reasoning e
-- faturado COMO SAIDA.
--
-- O adaptador ja recebia `completion_tokens_details.reasoning_tokens` do
-- OpenRouter e jogava fora. Sem esse numero, calibrar o teto de reasoning e
-- chute. Passa a ser gravado.
--
-- NOTA: `tokens_raciocinio` esta CONTIDO em `tokens_saida`, nao soma por fora.
alter table execucoes_ia add column tokens_raciocinio int;

comment on column execucoes_ia.tokens_raciocinio is
  'Tokens de extended thinking, ja CONTIDOS em tokens_saida (nao somar). NULL = provedor nao informou (o adaptador Anthropic direto nao separa). Existe para calibrar reasoning.max_tokens com medida, nao com chute.';

create or replace view vw_custo_ia_por_prompt with (security_invoker = true) as
select
  e.prompt_versao_id,
  p.chave,
  p.versao,
  p.ativo                                      as versao_ativa,
  e.modo,
  count(*)                                     as execucoes,
  coalesce(sum(e.custo_usd), 0)::numeric(14,6)  as custo_usd_total,
  round(avg(e.custo_usd)::numeric, 6)           as custo_usd_medio,
  round(avg(e.tokens_entrada))                  as tokens_entrada_medio,
  round(avg(e.tokens_saida))                    as tokens_saida_medio,
  round(avg(e.tokens_raciocinio))               as tokens_raciocinio_medio,
  case when sum(e.tokens_saida) > 0
       then round(sum(coalesce(e.tokens_raciocinio, 0))::numeric * 100 / sum(e.tokens_saida), 1)
  end                                           as pct_saida_em_raciocinio,
  round(avg(e.latencia_ms) / 1000.0, 1)         as segundos_medio
from execucoes_ia e
join prompts_versoes p on p.id = e.prompt_versao_id
group by 1, 2, 3, 4, 5
order by p.chave, p.versao desc, e.modo;

comment on view vw_custo_ia_por_prompt is
  'Admin > Custo de IA, por versao de prompt. `pct_saida_em_raciocinio` responde onde o dinheiro esta indo.';
