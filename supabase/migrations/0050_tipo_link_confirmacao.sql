-- 0050_tipo_link_confirmacao.sql
-- Fase 4 · F1 (agente A). SÓ o valor novo do enum — nada mais neste arquivo.
--
-- POR QUE UM ARQUIVO SÓ PARA ISTO (CONFLITO C25 do plano, armadilha de
-- Postgres): `alter type ... add value` não pode ser USADO na mesma transação
-- em que foi criado ("unsafe use of new value"). Cada migration é aplicada
-- como uma transação — então o valor 'confirmacao' entra sozinho aqui e só é
-- referenciado a partir da 0051. Quem juntar os dois arquivos derruba a 0051
-- inteira.
--
-- ROTEIRO DE VERIFICAÇÃO (orquestrador, via MCP, depois de aplicar):
--   1) select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
--       where t.typname = 'tipo_link_publico' order by enumsortorder;
--      -- esperado: formulario, agendamento, documentos, material, confirmacao
--
-- REVERSÃO: valor de enum não se remove no Postgres. Sem uso (0051 não
-- aplicada) o valor é inerte — nenhuma linha, função ou policy o referencia.

alter type tipo_link_publico add value if not exists 'confirmacao';
