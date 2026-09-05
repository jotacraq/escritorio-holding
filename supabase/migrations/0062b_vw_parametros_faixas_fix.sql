-- 0062b_vw_parametros_faixas_fix.sql — correção da 0062 (orquestrador, 05/09/2026).
-- A view `vw_parametros_faixas` fazia `jsonb_array_elements(pm.faixas)`, mas `faixas`
-- é um OBJETO `{modo, isento_ate?, teto?, faixas: [...]}` — o array está em
-- `faixas->'faixas'`. Qualquer SELECT na view falhava com 22023
-- "cannot extract elements from an object". Achado ao rodar o roteiro da 0062.
--
-- VERIFICAÇÃO: select count(*) from vw_parametros_faixas;  -- esperado: 9 (4 + 5 faixas do seed)
-- REVERSÃO: reaplicar o bloco `create view vw_parametros_faixas` da 0062 (com o bug).
drop view if exists vw_parametros_faixas;
create view vw_parametros_faixas
with (security_invoker = true) as
select
  pm.id                                 as parametro_id,
  pm.chave, pm.versao, pm.uf, pm.municipio, pm.ativo, pm.vigente_de, pm.base_legal,
  pm.faixas->>'modo'                    as modo,
  (pm.faixas->>'isento_ate')::numeric   as isento_ate,
  (pm.faixas->>'teto')::numeric         as teto,
  (f->>'ordem')::int                    as ordem,
  (f->>'ate')::numeric                  as ate,
  (f->>'aliquota')::numeric             as aliquota,
  (f->>'valor')::numeric                as valor_faixa,
  (f->>'deduzir')::numeric              as deduzir
from parametros_metodo pm
cross join lateral jsonb_array_elements(pm.faixas->'faixas') f
where pm.faixas is not null;
comment on view vw_parametros_faixas is
  'Uma linha por faixa de cada versão de parâmetro. Só leitura: a versão é imutável e o jsonb é a fonte. (0062b corrige o caminho do array.)';
revoke all on vw_parametros_faixas from public, anon;
grant select on vw_parametros_faixas to authenticated, service_role;
