-- 0100_copiloto_dispensa_gate_juridico.sql
--
-- ⚠️ Mesmo caso da 0099: aplicada por MCP em 14/09/2026 e materializada no repo
-- só depois. Par da 0099 — aquela removeu as triggers do BANCO, esta desliga o
-- gate na APLICAÇÃO (`server/copiloto/gate.ts::gateJuridicoDispensado`).
--
-- Fail-closed de propósito: ausência da chave, erro de leitura ou valor de
-- outro tipo mantêm o gate VALENDO. Ninguém dispensa por acidente — só por ato
-- deliberado em Admin.
--
-- Para religar a trava inteira: pôr `false` aqui E recriar as 3 triggers (o SQL
-- exato está no cabeçalho da 0099).
-- ===========================================================================

insert into configuracoes (chave, valor, descricao) values
 ('copiloto_sessao.dispensa_gate_juridico', 'false'::jsonb,
  'DISPENSA o gate juridico do copiloto (decisao juridica ativa + consentimento do titular). Decisao do Marcio em 14/09/2026, apos o risco ser apontado duas vezes. TRUE = o bot entra e a IA roda SEM registro de quem autorizou gravar, e revogar consentimento de um titular deixa de barrar. Par da migration 0099, que removeu as 3 triggers equivalentes no banco. Lida por server/copiloto/gate.ts::gateJuridicoDispensado, fail-closed: ausencia da chave ou erro de leitura mantem o gate VALENDO. Para religar a trava: por false aqui E recriar as 3 triggers (SQL no cabecalho da 0099).')
on conflict (chave) do nothing;

-- Em produção esta chave foi setada para `true` no mesmo ato (decisão do
-- Marcio). O INSERT acima nasce `false` de propósito: um ambiente novo começa
-- COM o gate valendo, e dispensá-lo é ato deliberado, não herança de seed.
