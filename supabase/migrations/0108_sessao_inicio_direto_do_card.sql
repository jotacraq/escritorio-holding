-- 0108_sessao_inicio_direto_do_card.sql
--
-- 17/09/2026 — Fatia 1 "iniciar a sessão quando quiser, sem burocracia".
-- Kill-switch de `POST /api/jornadas/[id]/sessao/iniciar`
-- (`server/agenda/config.ts::CHAVE_INICIO_DIRETO_DO_CARD`).
--
-- Nasce `true` — pedido EXPLÍCITO do dono, e ao contrário dos outros
-- kill-switches deste projeto (fail-closed por padrão), este é
-- deliberadamente fail-OPEN: a filosofia da fatia é REMOVER exigência, não
-- acrescentar trava nova. Desligar é ato deliberado em Admin, não estado de
-- fábrica.
-- ===========================================================================

insert into configuracoes (chave, valor, descricao) values
 ('sessao.inicio_direto_do_card', 'true'::jsonb,
  'Liga o botao "Iniciar sessao agora" direto do card da jornada, sem exigir agendamento/contrato/formulario previo (Fatia 1, 17/09/2026). Nasce TRUE por pedido explicito do dono. FALSE faz POST /api/jornadas/[id]/sessao/iniciar devolver 409 inicio_direto_desligado. Lida por server/agenda/config.ts::lerConfiguracaoBool.')
on conflict (chave) do nothing;
