-- 0065b_revoga_privilegios_default.sql — correção (orquestrador, 05/09/2026).
-- Achado do roteiro da 0065/0067: no Supabase, `alter default privileges` dá ALL
-- em tabela nova para `authenticated`. As migrations 0063/0065/0067 fizeram
-- `revoke all ... from public, anon` e `grant select, insert / update (colunas)`
-- para `authenticated`, mas NÃO revogaram o que o default já tinha dado — então
-- `grant update (conferido_em, ...)` não restringia nada (UPDATE em todas as
-- colunas continuava concedido; só a FK barrou `mensagem_id` no teste) e DELETE
-- ficou concedido (a RLS sem policy de DELETE apaga 0 linhas em silêncio, mas o
-- privilégio não devia existir). Mesma lição da 0061: privilégio explícito, sempre.
--
-- VERIFICAÇÃO (as 4 devem dar 'f'):
--   select has_table_privilege('authenticated','documentos_pedidos','delete'),
--          has_column_privilege('authenticated','documentos_pedidos','mensagem_id','update'),
--          has_table_privilege('authenticated','execucao_jornada_marcos','delete'),
--          has_table_privilege('authenticated','croqui_calculos','insert');
-- REVERSÃO: não há — é só remoção de privilégio indevido.
revoke all on documentos_pedidos from authenticated;
grant select, insert on documentos_pedidos to authenticated;
grant update (conferido_em, dispensado_em, nota) on documentos_pedidos to authenticated;

revoke all on execucao_jornada_marcos from authenticated;
grant select, insert on execucao_jornada_marcos to authenticated;
grant update (nota) on execucao_jornada_marcos to authenticated;

revoke all on execucao_modelos, execucao_marcos from authenticated;
grant select, insert, update on execucao_modelos, execucao_marcos to authenticated;  -- policy limita a admin; sem DELETE

revoke all on croqui_calculos from authenticated;
grant select, update on croqui_calculos to authenticated;   -- INSERT só pela RPC (service definer); atual só pela RPC
