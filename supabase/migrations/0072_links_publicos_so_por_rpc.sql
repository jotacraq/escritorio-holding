-- 0072 — links_publicos: escrita SÓ pelas RPCs (achado ALTO do pentest da Fase 6, 05/09/2026)
--
-- As policies lp_ins/lp_upd da 0028 (linhas 141-145) só conferiam PAPEL. Medido pelo pentester
-- em produção, via PostgREST com sessão de advogada: ressuscitar link revogado (estado→ativo),
-- zerar `usos` de link consumido, estender `expira_em` para 2099, mover o link para OUTRA
-- jornada, trocar `tipo` e `token_hash`, e inserir link sem passar pelo pepper — tudo 200/201.
-- A promessa da barra "Enviar" ("emitir de novo revoga o anterior") era contornável.
--
-- Nenhum escritor em `src/` usa a sessão nesta tabela: emissão e revogação passam pelas RPCs
-- `security definer` (`emitir_link_*`, `revogar_link_publico`, `emitir_link_confirmacao_sistema`)
-- e as leituras públicas pelo cliente `service_role`. Logo: revoke de INSERT/UPDATE/DELETE de
-- `authenticated` + drop das duas policies. SELECT (lp_sel, `eh_interno`) fica — a Ficha lista links.
--
-- Reversão (não recomendada):
--   grant insert, update on links_publicos to authenticated;
--   create policy lp_ins on links_publicos for insert to authenticated
--     with check ((select app.papel()) in ('admin','advogada','relacionamento'));
--   create policy lp_upd on links_publicos for update to authenticated
--     using ((select app.papel()) in ('admin','advogada','relacionamento'))
--     with check ((select app.papel()) in ('admin','advogada','relacionamento'));

drop policy if exists lp_ins on links_publicos;
drop policy if exists lp_upd on links_publicos;
revoke insert, update, delete on links_publicos from public, anon, authenticated;

comment on table links_publicos is
  'Links públicos (formulário, agendamento, confirmação, material, documentos). Escrita SÓ pelas '
  'RPCs security definer (emitir_link_*, revogar_link_publico); desde a 0072 authenticated só lê '
  '(lp_sel/eh_interno). Token nunca é gravado — só token_hash (pepper) e token_prefixo.';
