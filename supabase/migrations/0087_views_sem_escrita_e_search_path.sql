-- 0087 — ressalvas da trava do Fable (Fase 8, 07/09/2026)
--
-- 1. As quatro views da Fase 8 nasceram com `revoke all from public, anon` +
--    `grant select to authenticated`, mas o ACL padrão deixou ALL (insert/
--    update/delete/truncate/references/trigger) para `authenticated`. Inerte
--    hoje (nenhuma é atualizável), mas a 0064 já provou que `grant` sem
--    `revoke` NOMEADO não restringe nada — e uma view vira atualizável por
--    acidente na primeira `create or replace` que simplifique o select.
-- 2. `app.pagamento_ordem_do_evento` (0084) é trigger sem `set search_path`.
--    Só usa NEW/OLD, mas toda função nova desta base nasce com o caminho fixo.
--    `alter function ... set` não toca o corpo vigente (regra da casa: recriar
--    função parte do corpo VIGENTE; aqui nem isso é preciso).
--
-- Reversão:
--   grant all on vw_pagamentos_jornada, vw_pendencias_sistema, vw_croqui_estado, vw_jornada_kanban to authenticated;
--   alter function app.pagamento_ordem_do_evento() reset search_path;

revoke insert, update, delete, truncate, references, trigger
  on vw_pagamentos_jornada, vw_pendencias_sistema, vw_croqui_estado, vw_jornada_kanban
  from authenticated;

alter function app.pagamento_ordem_do_evento() set search_path = pg_catalog, public;
