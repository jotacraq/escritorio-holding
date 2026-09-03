-- 0039_formulario_publico_origem_cliente_link.sql
-- CAUSA REAL do ALTO 1 do pentest da Fase 2: o formulario publico respondia 500
-- em TODA tentativa — o fluxo mais usado da fase, quebrado.
--
-- `responder_formulario_publico` (0028) grava
-- `formularios_respostas.origem = 'cliente_link'`, valor que o CHECK da coluna,
-- escrito na 0006 (antes de existir superficie publica), nao aceita:
--   check (origem in ('sistema','typeform','importado'))
--
-- Erro real, lido do log do servidor:
--   23514 new row for relation "formularios_respostas"
--   violates check constraint "formularios_respostas_origem_check"
--
-- Registro porque a licao vale mais que a correcao: o pentest levantou a
-- hipotese de que fosse falta de grant de `app.registrar_evento_timeline` para
-- `anon` — plausivel, porque essa classe de bug ja mordeu o projeto tres vezes,
-- e o proprio relatorio marcou como "hipotese, nao confirmada por log". Estava
-- errada. O grant foi concedido na 0038, o 500 continuou, e so o erro real do
-- Postgres resolveu. Diagnostico plausivel nao e diagnostico.
-- (O grant da 0038 fica: e correto por si e evita o proximo caso do padrao.)
alter table formularios_respostas drop constraint formularios_respostas_origem_check;
alter table formularios_respostas add constraint formularios_respostas_origem_check
  check (origem in ('sistema', 'typeform', 'importado', 'cliente_link'));

comment on column formularios_respostas.origem is
  'De onde veio a resposta. `cliente_link` = o proprio cliente respondeu pela pagina publica (POP 02 como o metodo manda). `sistema` = a equipe digitou. Distinguir importa: o Protocolo 01 exige evidencia, e a resposta do proprio cliente e a fonte primaria.';
