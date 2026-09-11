-- 0091_copiloto_sessao.sql
-- Fase 10 · Fatia 1 (docs/ARQUITETURA-FASE-10.md §8, §6.2). Copiloto ao vivo da
-- Sessão de Viabilidade — só a fatia DETERMINÍSTICA PURA: zero IA, zero
-- subprocessador, zero consentimento novo. As fatias 2-5 (sugestão por IA,
-- ciclo automático, bot na sala, expurgo) NÃO entram aqui.
--
-- 100% ADITIVA. Nenhuma tabela, coluna, view, função ou policy existente é
-- alterada. `sessoes_copiloto.estado` nasce 'aguardando';
-- `copiloto_sessao.ativo` e `copiloto_sessao.audio_ao_vivo` nascem 'false'.
--
-- O QUE ENTRA
--   (a) sessoes_copiloto            — 1 linha por sessão; vínculo com o bot
--                                      (fatia 4) e o resumo acumulado (fatia 2).
--   (b) sessoes_copiloto_segmentos  — fala fatiada, ao vivo ou digitada
--                                      (origem='manual' é o caminho desta fatia).
--   (c) copiloto_sugestoes          — sugestão da IA (fatia 2). Entra AGORA,
--                                      vazia de trigger, porque `sessoes_copiloto
--                                      .transcricao_id` e o índice do polling
--                                      (§2.2/§4.1) fazem parte do modelo de
--                                      dados único da Fase 10 — criar a tabela
--                                      cedo evita uma 2ª migration de DDL puro
--                                      só para isso. NINGUÉM escreve nela nesta
--                                      fatia: a rota de sugestão só existe na
--                                      fatia 2, e não há prompt ativo (0093
--                                      ainda não existe).
--   (d) configuracoes['copiloto_sessao.*'] — 10 chaves, todas com o valor
--                                      inicial do rascunho do plano.
--
-- CONFLITO C2 do plano — POR QUE A TRIGGER DE TRAVA JURÍDICA NÃO ESTÁ AQUI:
-- o plano é explícito (§8, Fatia 1): "sem decisão jurídica, sem consentimento
-- novo". `app.exige_decisao_copiloto_ao_vivo()` é 0092 (Fatia 2) — ela passa a
-- proteger os DOIS INSERTs (segmentos e sugestões) quando a IA entrar no
-- caminho. Nesta fatia os segmentos são só texto digitado/colado pela própria
-- advogada, gravado localmente sob RLS de `app.ve_patrimonio()` (mesmo recorte
-- de `transcricoes`, 0032) e NUNCA saem para IA nenhuma — a rota de leitura do
-- estado do copiloto (`GET /api/sessoes/[id]/copiloto`) é determinística, sem
-- chamada de IA. `app.exige_decisao_copiloto_ao_vivo` chega em 0092 como
-- `create or replace` + `create trigger` sobre as MESMAS duas tabelas —
-- aditiva por cima do que esta migration cria, sem tocar aqui.
--
-- ROTEIRO DE VERIFICAÇÃO: `scripts/verificacao-0091.sql`.
--
-- ROLLBACK (ordem inversa):
--   drop index if exists idx_copiloto_sugestoes_polling;
--   drop table if exists copiloto_sugestoes;
--   drop index if exists idx_copiloto_segmentos_polling;
--   drop table if exists sessoes_copiloto_segmentos;
--   drop table if exists sessoes_copiloto;
--   delete from configuracoes where chave like 'copiloto_sessao.%';
-- ===========================================================================


-- ===========================================================================
-- (a) sessoes_copiloto — 1 linha por sessão conduzida com o copiloto. Mora
-- aqui o vínculo com o bot (gravacao_externa_id, fatia 4), os participantes
-- (fatia 4) e o resumo acumulado (jsonb com TETO por CHECK — contexto O(1)
-- por chamada de IA, fatia 2, §2.1/§4.3). Nesta fatia só `estado` e os
-- carimbos de tempo têm efeito prático: o PRIMEIRO segmento registrado cria
-- a linha (`POST .../copiloto/segmentos`, já nascendo `ativo`) — não a
-- abertura da aba, que só lê.
-- ===========================================================================
create table sessoes_copiloto (
  sessao_id            uuid primary key references sessoes_viabilidade(id) on delete cascade,
  estado               text not null default 'aguardando'
                         check (estado in ('aguardando', 'ativo', 'encerrado', 'erro')),

  -- Id OPACO que O SISTEMA gera ao pedir o bot (fatia 4); o webhook resolve a
  -- sessão a partir dele, nunca a partir do sessao_id que vem no corpo
  -- (§4.2 do plano — vínculo forjável é a superfície que essa indireção
  -- fecha). NULL nesta fatia: nenhuma rota daqui gera esse id.
  gravacao_externa_id  text unique,
  provedor             text,          -- nome do subprocessador de áudio (fatia 4), para auditoria

  iniciado_em          timestamptz,
  encerrado_em         timestamptz,

  -- Participantes como o provedor da sala entregou (fatia 4). PII (nome de
  -- pessoa da família) — nasce vazio; ausente é ausente, nunca inventado.
  participantes        jsonb not null default '[]'::jsonb,

  -- Resumo estruturado acumulado (fatia 2, §4.3 item E). Teto DURO por CHECK,
  -- não por `if` de aplicação — é o que torna o custo de IA O(1) por chamada
  -- em vez de O(duração²). Nasce vazio; nenhuma rota desta fatia escreve aqui.
  resumo_acumulado     jsonb not null default '{}'::jsonb
                         check (pg_column_size(resumo_acumulado) <= 4096),

  -- Preenchido ao consolidar a transcrição da sessão em `transcricoes` (0032)
  -- — fatia 3. NULL nesta fatia.
  transcricao_id       uuid references transcricoes(id),

  criado_em            timestamptz not null default now()
);

comment on table sessoes_copiloto is
  'Fase 10, Fatia 1. 1 linha por sessão conduzida com o copiloto ao vivo. '
  'resumo_acumulado e participantes só ganham conteúdo nas fatias 2 e 4 — '
  'aqui nascem vazios por desenho, não por atraso.';
comment on column sessoes_copiloto.gravacao_externa_id is
  'Id opaco gerado pelo sistema ao pedir o bot (fatia 4). O webhook resolve a '
  'sessão por AQUI, nunca pelo sessao_id do corpo — impede injeção de fala em '
  'sessão alheia por quem tiver o segredo do webhook (§4.2).';
comment on column sessoes_copiloto.resumo_acumulado is
  'Teto de 4096 bytes por CHECK (não por if): sustenta contexto O(1) por '
  'chamada de IA (fatia 2, §4.3-E). Vazio nesta fatia — zero IA aqui.';


-- ===========================================================================
-- (b) sessoes_copiloto_segmentos — fala fatiada. `origem='manual'` é o
-- caminho INTEIRO desta fatia: a Dra. Elaine digita/cola trecho, sem bot,
-- sem IA. `origem='bot'` só passa a ser gravada de verdade na fatia 4
-- (o webhook nem existe ainda).
--
-- `ordem` é INT, não timestamptz (§2.2): dois segmentos do mesmo segundo não
-- podem trocar de lugar na tela — é o índice do polling que a fatia 3 lê.
-- ===========================================================================
create table sessoes_copiloto_segmentos (
  id                uuid primary key default gen_random_uuid(),
  sessao_id         uuid not null references sessoes_viabilidade(id) on delete cascade,
  ordem             int not null,
  falante           text,              -- rótulo do provedor (fatia 4); NULL sem diarização
  falante_confianca numeric(3,2),      -- NULL = provedor não informou. NULL é NULL, não 1.0
  texto             text not null check (length(trim(texto)) > 0),
  iniciado_ms       int,               -- offset em ms desde o início da sessão (fatia 4); NULL no manual
  origem            text not null default 'bot' check (origem in ('bot', 'manual')),
  criado_em         timestamptz not null default now(),
  unique (sessao_id, ordem)            -- idempotência de reentrega do webhook (fatia 4) e trava contra ordem duplicada no manual
);

-- Índice do caminho quente do polling (fatia 3) — a query DEVE ser,
-- caractere a caractere:
--   select ... from sessoes_copiloto_segmentos where sessao_id = $1 and ordem > $2 order by ordem
-- `explain (analyze)` A MEDIR contra o banco real (sem .env nesta máquina —
-- ver aviso de honestidade no topo do plano); o comando exato está em
-- `scripts/verificacao-0091.sql`.
create index idx_copiloto_segmentos_polling on sessoes_copiloto_segmentos (sessao_id, ordem);

comment on table sessoes_copiloto_segmentos is
  'Fase 10, Fatia 1. Fala fatiada da sessão, viva ou digitada. origem=manual é '
  'o único caminho de escrita desta fatia (POST /api/sessoes/[id]/copiloto/segmentos). '
  'ordem é INT (não timestamp) para dois segmentos do mesmo segundo não trocarem de posição.';
comment on column sessoes_copiloto_segmentos.origem is
  'manual = digitado/colado pela advogada nesta fatia. bot = webhook do provedor de áudio (fatia 4, ainda não existe).';


-- ===========================================================================
-- (c) copiloto_sugestoes — DDL só. Ninguém escreve aqui nesta fatia: a rota
-- que gera sugestão (`POST /api/admin/copiloto/...` ou o ciclo automático) é
-- fatia 2/3, e o prompt `copiloto_sessao` (0093) ainda não existe. Entra
-- agora para o modelo de dados da Fase 10 nascer inteiro numa migration só,
-- em vez de fatiar DDL entre 0091 e 0092/0093 sem necessidade.
--
-- `ordem_evento` é bigint identity (não uuid): cursor do polling tem que
-- ORDENAR (§2.2) — uuid não ordena e o polling perderia sugestão sem erro.
-- ===========================================================================
create table copiloto_sugestoes (
  id             uuid primary key default gen_random_uuid(),
  sessao_id      uuid not null references sessoes_viabilidade(id) on delete cascade,
  ordem_evento   bigint generated always as identity,
  bloco_id       text,               -- id de bloco DO ROTEIRO ATIVO, validado no servidor (fatia 2)
  gatilho        text not null check (gatilho in ('intervalo', 'virada_bloco', 'sob_demanda')),
  conteudo       jsonb not null,     -- a saída já validada do modelo (fatia 2, §4.3)
  confianca      numeric(3,2),
  execucao_ia_id uuid references execucoes_ia(id),
  desfecho       text check (desfecho in ('aceita', 'ignorada', 'expirada')),
  desfecho_em    timestamptz,
  criado_em      timestamptz not null default now()
);

create index idx_copiloto_sugestoes_polling on copiloto_sugestoes (sessao_id, ordem_evento);

comment on table copiloto_sugestoes is
  'Fase 10, Fatia 2 (DDL antecipado nesta migration, sem chamador nesta '
  'fatia). Sugestão da IA sobre o roteiro em curso, nunca ação executada — '
  'a tela sempre renderiza com botão (aceitar/ignorar), nunca navega sozinha.';


-- ===========================================================================
-- RLS — mesmo recorte de `transcricoes` (0032): app.ve_patrimonio(), porque
-- o conteúdo é transcrição de conversa patrimonial familiar, não o eh_interno()
-- mais largo. Escrita: authenticated com o MESMO papel para as duas tabelas
-- que a tela desta fatia usa (sessoes_copiloto, sessoes_copiloto_segmentos);
-- copiloto_sugestoes fica sem policy de INSERT/UPDATE — a fatia 2 abre isso
-- quando existir chamador (mesmo padrão de `agente_whatsapp_respostas`, 0088:
-- nasce sem gaveta de escrita para authenticated, service_role grava por RPC).
-- `service_role` não dispensa RLS nem GRANT (regra da casa): revoke amplo +
-- grants nomeados nas três tabelas.
-- ===========================================================================
alter table sessoes_copiloto enable row level security;
alter table sessoes_copiloto force row level security;
alter table sessoes_copiloto_segmentos enable row level security;
alter table sessoes_copiloto_segmentos force row level security;
alter table copiloto_sugestoes enable row level security;
alter table copiloto_sugestoes force row level security;

revoke all on sessoes_copiloto            from public, anon, authenticated;
revoke all on sessoes_copiloto_segmentos  from public, anon, authenticated;
revoke all on copiloto_sugestoes          from public, anon, authenticated;

create policy sc_sel on sessoes_copiloto for select to authenticated
  using ((select app.ve_patrimonio()));
create policy sc_ins on sessoes_copiloto for insert to authenticated
  with check ((select app.ve_patrimonio()));
create policy sc_upd on sessoes_copiloto for update to authenticated
  using ((select app.ve_patrimonio())) with check ((select app.ve_patrimonio()));
grant select, insert, update on sessoes_copiloto to authenticated;
grant select, insert, update on sessoes_copiloto to service_role;

create policy scs_sel on sessoes_copiloto_segmentos for select to authenticated
  using ((select app.ve_patrimonio()));
create policy scs_ins on sessoes_copiloto_segmentos for insert to authenticated
  with check ((select app.ve_patrimonio()) and origem = 'manual');
-- Sem policy de UPDATE/DELETE: segmento é append-only (fala já dita não se
-- edita) — mesmo raciocínio de `agente_whatsapp_respostas` (0088). Corrigir
-- um segmento errado é registrar outro, a tela decide o que mostrar.
grant select, insert on sessoes_copiloto_segmentos to authenticated;
grant select, insert on sessoes_copiloto_segmentos to service_role;
-- service_role ganha INSERT sem o `check origem='manual'` da policy de
-- authenticated (RLS não filtra service_role, que sempre a ignora) — é o
-- caminho do webhook do bot na fatia 4, aditivo sobre este GRANT.

-- copiloto_sugestoes: só leitura para authenticated nesta fatia (mostrar,
-- quando a fatia 2 tiver o que mostrar). Escrita só service_role — a fatia 2
-- grava por RPC/rota com service_role, nunca INSERT direto da tela.
create policy cs_sel on copiloto_sugestoes for select to authenticated
  using ((select app.ve_patrimonio()));
grant select on copiloto_sugestoes to authenticated;
grant select, insert, update on copiloto_sugestoes to service_role;


-- ===========================================================================
-- (d) Interruptores e tetos. `copiloto_sessao.ativo` e
-- `copiloto_sessao.audio_ao_vivo` nascem 'false' — a aba Copiloto da tela e o
-- pedido de bot (fatia 4) ficam desligados até o João ligar em Admin. Toda
-- trava é configuração (dado), não constante em TS — muda sem deploy (§2.5).
-- ===========================================================================
insert into configuracoes (chave, valor, descricao) values
 ('copiloto_sessao.ativo', 'false'::jsonb,
  'Liga a aba Copiloto na tela Conduzir Sessão. FALSE ao nascer: com ele desligado a aba não aparece e nenhuma rota do copiloto grava nada. Interruptor 1 de 5 do plano de reversão (§2.5).'),
 ('copiloto_sessao.audio_ao_vivo', 'false'::jsonb,
  'Liga o pedido de bot na sala (fatia 4, ainda não implementada). FALSE ao nascer: com ele desligado o copiloto só funciona no modo digitado desta fatia.'),
 ('copiloto_sessao.provedor_audio', '"nenhum"'::jsonb,
  'Nome do subprocessador de áudio contratado (fatia 4, B75). "nenhum" = não contratado — nenhum fornecedor entra no código antes do DPA.'),
 ('copiloto_sessao.intervalo_segundos', '45'::jsonb,
  'Intervalo mínimo entre duas chamadas de IA por gatilho de tempo (fatia 2/3, §4.3). Não lido por nenhuma rota desta fatia — zero IA aqui.'),
 ('copiloto_sessao.polling_ms', '3000'::jsonb,
  'Intervalo do polling da tela (fatia 3, §4.1). Não lido por nenhuma rota desta fatia.'),
 ('copiloto_sessao.teto_ia_sessao', '30'::jsonb,
  'Máximo de execuções de IA do copiloto por sessão (fatia 2, §4.4). Estourou: copiloto vira só-transcrição.'),
 ('copiloto_sessao.teto_ia_dia', '150'::jsonb,
  'Máximo de execuções de IA do copiloto por dia, somando todas as sessões (fatia 2, §4.4).'),
 ('copiloto_sessao.duracao_maxima_minutos', '150'::jsonb,
  'Sessão de copiloto aberta além deste tempo encerra sozinha (fatia 3) — sessão esquecida aberta não sangra IA.'),
 ('copiloto_sessao.confianca_minima', '0.6'::jsonb,
  'Sugestão da IA com confiança abaixo disto não aparece na tela (fatia 2, §4.3).'),
 ('copiloto_sessao.retencao_dias_segmentos', '7'::jsonb,
  'Dias de retenção de sessoes_copiloto_segmentos antes do expurgo (fatia 5, B69). Job de expurgo ainda não existe — chave só documenta a decisão.')
on conflict (chave) do nothing;
