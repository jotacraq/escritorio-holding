-- 0096_copiloto_ciclos.sql
-- Fase 10 · Fatia 3 (docs/ARQUITETURA-FASE-10.md §6.2, §8, §11 "Faseamento do
-- DDL"). A claim atômica do ciclo automático de IA.
--
-- POR QUE SÓ AGORA, NÃO NA 0091 (o próprio plano nomeia isto por escrito,
-- §11): "Na Fatia 1 e 2 não existe ciclo: a Fatia 1 não chama IA, e a Fatia 2
-- só dispara por botão, onde a corrida que a claim resolve não acontece.
-- Criar a tabela antes seria DDL sem função, que é o tipo de peso morto que o
-- critério de otimização reprova." A Fatia 3 é o PRIMEIRO chamador real.
--
-- 100% ADITIVA. Nenhuma tabela, coluna, view, função ou policy existente é
-- alterada.
--
-- O QUE ENTRA
--   copiloto_ciclos — 1 linha por (sessao_id, janela) que efetivamente
--     disparou (ou tentou disparar) uma execução de IA do ciclo automático.
--     `janela = floor(segundos_desde_inicio / intervalo_segundos)` (§4.3): a
--     PK `(sessao_id, janela)` É a claim — duas abas abertas na mesma sessão
--     fazem `insert ... on conflict do nothing returning id`, e só quem
--     recebe a linha de volta chama a IA. Mesmo padrão de
--     `agente_whatsapp_respostas` (0088, Fase 9), que já provou funcionar:
--     `unique (mensagem_recebida_id)` lá, PK composta aqui — a claim é o
--     INSERT em si, não um SELECT seguido de UPDATE (que teria janela de
--     corrida entre as duas idas ao banco).
--
--     A claim é ANTERIOR ao gate jurídico (§4.3 passo 0) e ao orçamento —
--     nesta ordem: 1) tentar reivindicar a janela; 2) só quem reivindicou
--     confere gate + orçamento + chama IA. Reivindicar e depois recusar por
--     gate/orçamento é comportamento correto e ESPERADO (a claim marca "esta
--     janela já foi avaliada", não "esta janela gerou sugestão") — impede
--     que duas abas avaliem a MESMA janela duas vezes, o que reavaliaria o
--     gate em duplicidade sem necessidade, não só duplicaria a chamada de IA.
--
--     `gatilho` registra POR QUE esta janela disparou — é o mesmo enum de
--     `copiloto_sugestoes.gatilho` (0091), mas esta tabela não é join com
--     aquela: uma janela pode ser claimada e não gerar sugestão nenhuma
--     (gate fechado, orçamento estourado, timeout) — a claim é sobre a
--     TENTATIVA, a sugestão é sobre o RESULTADO. Ficam desacopladas de
--     propósito: se acoplássemos por FK, teríamos que criar `copiloto_ciclos`
--     ANTES de saber se haverá sugestão, ou `copiloto_sugestoes` DEPOIS — a
--     ordem real da requisição não permite as duas ao mesmo tempo.
--
-- RLS + GRANTS: MESMO RECORTE das outras três tabelas da 0091 — SELECT para
-- `app.ve_patrimonio()`, escrita só `service_role` (quem escreve é sempre o
-- servidor, nunca a tela: a claim não tem gaveta de INSERT para
-- `authenticated`, porque a tela não decide quando um ciclo dispara, só o
-- servidor, a cada `GET .../copiloto` de polling). `service_role` NÃO
-- dispensa RLS nem GRANT (regra da casa) — RLS habilitada e forçada, revoke
-- amplo, grants nomeados, exatamente como a 0091 fez para as outras três.
--
-- ROTEIRO DE VERIFICAÇÃO: `scripts/verificacao-0096.sql`.
--
-- ROLLBACK:
--   drop table if exists copiloto_ciclos;
-- ===========================================================================


-- ===========================================================================
-- copiloto_ciclos — claim atômica de janela de tempo do ciclo automático.
-- ===========================================================================
create table copiloto_ciclos (
  sessao_id  uuid not null references sessoes_viabilidade(id) on delete cascade,
  -- floor(segundos_desde_inicio / intervalo_segundos) — §4.3 do plano. Não é
  -- serial nem timestamptz: é a JANELA DISCRETA que dois gatilhos concorrentes
  -- (tempo+fala-nova de uma aba, virada-de-bloco de outra) podem calcular
  -- igual para o MESMO instante — é exatamente essa coincidência que a PK
  -- precisa capturar para barrar a 2ª tentativa.
  janela     int  not null check (janela >= 0),
  -- Por que ESTA janela dependeu deste gatilho, não daquele — auditoria de
  -- desenho (§4.3: "o primeiro que ocorrer"), mesmo enum de
  -- copiloto_sugestoes.gatilho (0091), mas SEM constraint de igualdade entre
  -- as duas tabelas (comentário de topo: desacopladas de propósito).
  gatilho    text not null check (gatilho in ('intervalo', 'virada_bloco', 'sob_demanda')),
  -- Índice do bloco do roteiro NO MOMENTO desta claim — é o que o gatilho de
  -- "virada de bloco" da PRÓXIMA avaliação compara contra o índice atual da
  -- tela para saber se a advogada avançou/voltou desde o último ciclo
  -- (server/copiloto/gatilho.ts::decidirGatilho). NULL não deveria ocorrer em
  -- uso normal (todo ciclo sabe em que bloco está), mas a coluna aceita NULL
  -- para nunca travar o INSERT por um índice que, por alguma razão de
  -- integração futura, não esteja disponível.
  bloco_indice int,
  criado_em  timestamptz not null default now(),
  primary key (sessao_id, janela)
);

comment on table copiloto_ciclos is
  'Fase 10, Fatia 3. Claim atômica do ciclo automático de IA: PK (sessao_id, '
  'janela) garante que duas abas abertas na mesma sessão NUNCA disparam duas '
  'execucoes de IA para a mesma janela de tempo. Mesmo padrao de '
  'agente_whatsapp_respostas (0088, Fase 9). Escrita so service_role — a '
  'claim e sempre decidida pelo servidor, nunca pela tela.';
comment on column copiloto_ciclos.janela is
  'floor(segundos_desde_inicio / copiloto_sessao.intervalo_segundos), §4.3 do '
  'plano. int, nao serial: precisa ser CALCULAVEL de forma identica por duas '
  'requisicoes concorrentes para a PK barrar a corrida.';


-- ===========================================================================
-- RLS — mesmo recorte de sessoes_copiloto/sessoes_copiloto_segmentos/
-- copiloto_sugestoes (0091): app.ve_patrimonio(), porque a existencia de um
-- ciclo (e o gatilho que o disparou) e metadado de uma conversa patrimonial
-- em curso. Sem policy de INSERT/UPDATE para authenticated — so leitura, para
-- eventual tela de auditoria futura; a claim e sempre do servidor.
-- ===========================================================================
alter table copiloto_ciclos enable row level security;
alter table copiloto_ciclos force row level security;

revoke all on copiloto_ciclos from public, anon, authenticated;

create policy cc_sel on copiloto_ciclos for select to authenticated
  using ((select app.ve_patrimonio()));
grant select on copiloto_ciclos to authenticated;
grant select, insert on copiloto_ciclos to service_role;
-- Sem UPDATE nem DELETE para ninguém: a claim é append-only, como
-- sessoes_copiloto_segmentos (0091) — uma janela claimada não se "libera"
-- de volta; se a tentativa falhar por gate/orçamento/timeout, a janela
-- simplesmente não gera sugestão, mas já foi avaliada e não deve ser
-- reavaliada até a PRÓXIMA janela (o intervalo de 45s já garante isso).


-- ===========================================================================
-- CORREÇÃO DE DESCRIÇÃO (dado, não schema) — achado da revisão do frontend/
-- coordenador nesta fatia: duas chaves de `copiloto_sessao.*` (0091) tinham
-- DESCRIÇÃO prometendo comportamento que o código ainda não entregava.
-- "Reversão que não desliga não é reversão" (Fable, Fatia 1) tem o mesmo
-- formato aqui — "ajuste que não ajusta"/"promessa que a fatia não cumpriu".
-- Aditivo: só ATUALIZA a `descricao` de linhas já existentes, nenhum valor
-- muda, nenhum schema muda.
--
--   `polling_ms`: agora É lida por `server/copiloto/config.ts::
--     lerConfigPollingCopiloto`, exposta em `GET /api/sessoes/[id]/copiloto`
--     no campo `polling.em_foco_ms` (o front deixa de hardcodar o valor).
--   `duracao_maxima_minutos`: agora É conferida em
--     `server/copiloto/ciclo.ts::executarCicloCopiloto`, ANTES de avaliar
--     gatilho — sessão esquecida aberta além do teto encerra sozinha
--     (mesmo efeito de `POST .../encerrar`, via `server/copiloto/
--     encerrar.ts`, reusado). Descrição da 0091 já dizia "fatia 3" — esta
--     migration é a fatia 3 cumprindo a própria promessa.
-- ===========================================================================
update configuracoes set descricao =
  'Intervalo do polling da tela, em ms (fatia 3, §4.1). Lido em ' ||
  'server/copiloto/config.ts::lerConfigPollingCopiloto e exposto em ' ||
  'GET /api/sessoes/[id]/copiloto no campo polling.em_foco_ms. O valor ' ||
  '"sem foco" (polling.sem_foco_ms) NÃO tem chave própria: é sempre ' ||
  'em_foco_ms * (10000/3000), a mesma proporção do default 3000ms->10000ms ' ||
  '- regra de UX derivada, não parâmetro operacional novo.'
 where chave = 'copiloto_sessao.polling_ms';

update configuracoes set descricao =
  'Sessão de copiloto aberta além deste tempo (minutos) encerra sozinha — ' ||
  'lido em server/copiloto/ciclo.ts::executarCicloCopiloto, ANTES de ' ||
  'avaliar gatilho. Efeito idêntico a POST /api/sessoes/[id]/copiloto/encerrar ' ||
  '(consolida transcrição, expira sugestões pendentes) — sessão esquecida ' ||
  'aberta não sangra IA.'
 where chave = 'copiloto_sessao.duracao_maxima_minutos';
