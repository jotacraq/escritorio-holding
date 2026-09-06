-- 0073b_token_link_cifrado_grant_por_coluna.sql
-- Fase 7 (06/09/2026) — correção provada pelo roteiro `verificacao-0073.sql` (passo 2 falhou):
-- `revoke select (token_link_cifrado) ... from authenticated` (0073) é NO-OP quando o papel
-- tem SELECT de TABELA inteira (0053 deu `grant select on ligacoes_ia to authenticated`).
-- Em Postgres, privilégio de coluna só restringe quando NÃO existe o de tabela.
-- Solução: trocar o SELECT de tabela por SELECT nas 26 colunas que a equipe pode ver.
-- Coluna nova em `ligacoes_ia` a partir daqui precisa de `grant select (coluna)` explícito —
-- é o preço de esconder o token cifrado do `select *` da Ficha.
revoke select on ligacoes_ia from authenticated;
grant select (
  id, jornada_id, provedor, status, tentativa, nao_antes_de, telefone, origem, solicitada_por,
  link_id, id_externo, disparada_em, atendida_em, encerrada_em, duracao_segundos, resultado,
  horario_escolhido, agendamento_id, transcricao, resumo, gravacao_url, custo_usd, erro,
  expurgado_em, criado_em, atualizado_em
) on ligacoes_ia to authenticated;
-- `update (status)` da 0053 é de coluna e não é tocado.
