-- 0128_timeline_tipos_do_servidor.sql
--
-- QUEM PODE ESCREVER `tipo='retrospecto'` NA LINHA DO TEMPO.
-- Achado F2 do `security-pentester` na Fase 13 (19/09/2026), severidade MÉDIA.
--
-- ===========================================================================
-- O FURO
-- ===========================================================================
-- A 0126 criou o índice único parcial `uniq_timeline_retrospecto_sessao` e
-- `server/copiloto/retrospecto.ts::registrarRetrospectoNaTimeline` passou a
-- tratar `23505` como SUCESSO — "o evento já existe" é o resultado desejado
-- de um segundo encerramento.
--
-- Só que `eventos_timeline` tem, desde a 0014:25, `tl_ins` para INSERT de
-- QUALQUER `authenticated` que satisfaça `app.eh_interno()` — recorte largo,
-- que inclui `relacionamento` — e `tipo` é `text` SEM CHECK. Junte as duas
-- coisas e existe este caminho:
--
--   1. alguém de dentro insere uma linha `tipo='retrospecto'` com
--      `dados->>'sessao_id'` da sessão que vai acontecer, e com `titulo` e
--      `descricao` escolhidos por ela;
--   2. a sessão encerra; o servidor tenta gravar o evento de verdade;
--   3. o índice devolve `23505`; a rotina dizia "já existe" e seguia MUDA;
--   4. o Histórico daquele cliente passa a exibir o texto da pessoa 1 como
--      se fosse registro do SISTEMA — numa tabela APPEND-ONLY (0014:26: sem
--      update, sem delete), que a aplicação não tem como corrigir.
--
-- Não é escalação de privilégio: quem faz isso já é da equipe. É FALSIFICAÇÃO
-- DE REGISTRO — e num sistema cujo Histórico é usado para reconstruir o que
-- aconteceu com um cliente, um fato falso permanente vale mais que um acesso
-- indevido de leitura.
--
-- ===========================================================================
-- A CORREÇÃO, EM DUAS CAMADAS (esta migration é a de baixo)
-- ===========================================================================
-- (código, já feito) `registrarRetrospectoNaTimeline` relê a linha
--   conflitante no ramo `23505` e só trata como sucesso se for a linha do
--   SISTEMA; caso contrário registra `#evento_squatado` com o id de quem
--   gravou. Detecta, mas não impede.
--
-- (banco, esta migration) `tl_ins` deixa de aceitar `tipo='retrospecto'` de
--   `authenticated`. Impede.
--
-- O PRECEDENTE é `scs_ins` da 0091, literalmente o mesmo desenho:
--   create policy scs_ins on sessoes_copiloto_segmentos for insert to authenticated
--     with check ((select app.ve_patrimonio()) and origem = 'manual');
-- — `authenticated` insere, mas SÓ a variedade que a tela dela produz; a
-- variedade que o servidor produz fica para `service_role`, que não passa por
-- policy nenhuma.
--
-- ===========================================================================
-- POR QUE SÓ `retrospecto`, E NÃO A LISTA INTEIRA DOS TIPOS DO SERVIDOR
-- ===========================================================================
-- A tentação é barrar de uma vez todos os tipos que hoje só o servidor
-- escreve (`link`, `transcricao`, `analise_sessao`, `croqui_exportacao`…).
-- NÃO FAÇO isso aqui, por um motivo medido: `app.registrar_evento_timeline`
-- (0014:31) é chamada de dentro de TRIGGERS (`app.timeline_jornada`,
-- `app.timeline_formulario`, `app.timeline_ligacao`…) que disparam em DML
-- feito por `authenticated` pela tela. Essa função **não é SECURITY
-- DEFINER** — o comentário da 0014:29 diz isso com todas as letras ("Não
-- precisamos de SECURITY DEFINER aqui — a policy `tl_ins` já libera qualquer
-- `eh_interno()`"). Então o INSERT dela roda como `authenticated` e é a
-- `tl_ins` que o autoriza.
--
-- Barrar `tipo in ('etapa','formulario','ligacao',…)` em `tl_ins` QUEBRARIA
-- esses gatilhos — a advogada mudaria a etapa de uma jornada pela tela e
-- levaria `42501` vindo de um trigger que ela não sabe que existe. É
-- exatamente a armadilha catalogada nesta casa de ampliar escopo
-- compartilhado sem ler cada consumidor.
--
-- `retrospecto` é seguro porque NENHUM trigger o escreve: o único escritor é
-- `registrarRetrospectoNaTimeline`, que usa `criarClienteAdmin()`
-- (`service_role`). Conferido por grep no diff inteiro da fase.
--
-- Quem quiser fechar os outros tipos um dia precisa, ANTES, decidir o que
-- fazer com `app.registrar_evento_timeline` (torná-la SECURITY DEFINER, ou
-- dar a ela um caminho próprio) — e isso é uma mudança na trava de
-- `protege_carimbo_anonimizacao` e em 6 triggers. Não cabia neste achado.
--
-- ===========================================================================
-- AS 5 PERGUNTAS DO PROTOCOLO DE SUSTENTABILIDADE
-- ===========================================================================
-- 1. Escala — `with check` é avaliado por LINHA inserida por `authenticated`.
--    A expressão nova é uma comparação de texto (`tipo <> 'retrospecto'`),
--    sem subquery e sem função: custo desprezível, e NÃO toca o caminho de
--    `service_role` (que não passa por policy).
-- 2. Índice — não se aplica: é policy de INSERT, não de leitura.
-- 3. Frequência — a cada INSERT feito pela tela/trigger. Já era.
-- 4. Repetição — não se aplica.
-- 5. Reversão — recriar a `tl_ins` da 0014, sem o predicado (bloco de
--    ROLLBACK abaixo, copiado do texto vigente).
--
-- 🔴 BACKFILL: NENHUM, e nada muda de valor. Medido em produção em
-- 19/09/2026: `eventos_timeline` tem 52 linhas e **ZERO** com
-- `tipo='retrospecto'`. Policy de INSERT não reavalia linha existente —
-- nenhum registro histórico é invalidado nem reclassificado por esta
-- migration.
--
-- ⚠️ ORDEM: `drop policy` + `create policy` NÃO é atômico do ponto de vista
-- de quem estiver inserindo no mesmo instante — mas roda dentro da
-- transação da migration, então ninguém vê a janela sem policy. Não trocar
-- por `alter policy` sem necessidade: `alter policy ... with check` existe,
-- mas o `drop`+`create` deixa o texto INTEIRO da policy visível no arquivo,
-- que é o que o próximo leitor precisa (lição de "recriar função parte do
-- corpo vigente": policy meio-descrita é pior que policy inteira).
--
-- ROTEIRO DE VERIFICAÇÃO: scripts/verificacao-0128.sql.
--
-- ROLLBACK:
--   drop policy if exists tl_ins on eventos_timeline;
--   create policy tl_ins on eventos_timeline for insert to authenticated
--     with check ((select app.eh_interno()));
-- ===========================================================================

drop policy if exists tl_ins on eventos_timeline;

create policy tl_ins on eventos_timeline for insert to authenticated
  with check (
    (select app.eh_interno())
    -- 🔴 F2: tipos escritos SÓ pelo servidor não entram por aqui. Hoje a
    -- lista tem um item; acrescentar outro exige antes conferir que nenhum
    -- trigger o escreve (ver o cabeçalho desta migration).
    and tipo <> 'retrospecto'
  );

comment on policy tl_ins on eventos_timeline is
  'INSERT de evento pela EQUIPE (app.eh_interno()), como desde a 0014 — mais '
  'a restricao da 0128 (achado F2 do pentest da Fase 13): tipo=retrospecto e '
  'escrito SO pelo servidor (service_role, via '
  'server/copiloto/retrospecto.ts::registrarRetrospectoNaTimeline). Sem esta '
  'restricao, alguem interno podia PLANTAR a linha antes do encerramento e, '
  'como a 0126 tornou o evento unico por sessao e o codigo trata 23505 como '
  '"ja existe", o texto plantado passaria a figurar no Historico do cliente '
  'como registro do sistema — numa tabela append-only. Mesmo desenho de '
  'scs_ins (0091): authenticated insere, mas so a variedade que a tela dela '
  'produz.';
