-- 0125_copiloto_retrospecto_sessao.sql
--
-- RETROSPECTO DA SESSÃO — o fim do copiloto passa a ser escrito.
--
-- Pedido do Marcio (19/09/2026): "ao finalizar a sessão e o copiloto, abra um
-- pop-up que gere o score rate da sessão, e os principais observações do
-- cliente, pontos de melhoria e etc, em um pop-up que dê para baixar também,
-- e consultar depois da sessão".
--
-- Plano: docs/ARQUITETURA-FASE-13.md §D. Decisões do dono já tomadas e NÃO
-- reabertas aqui: (a) o "score" da v1 é COBERTURA DO ROTEIRO (N de 13
-- partes), sem nota de 0 a 10; (b) o retrospecto é gravado em TODOS os
-- caminhos de encerramento (manual, duração máxima, retomada de sessão em
-- 'erro'); (c) o pop-up abre só no encerramento manual — isso é da TELA,
-- não deste modelo de dado; (d) ZERO chamada de IA nesta fase.
--
-- POR QUE TABELA PRÓPRIA (e não mais uma coluna jsonb em `sessoes_copiloto`,
-- como fizeram a 0111/0120/0122): as outras três são ESTADO VIVO da sessão,
-- lido e reescrito a cada ciclo de polling, por PK. Este é um ARTEFATO
-- CONGELADO — escrito uma vez, no encerramento, lido depois por OUTRA tela
-- (Ficha 360, aba "Retrospecto") e por outra pergunta ("todos os
-- retrospectos deste cliente"). Colocá-lo dentro de `sessoes_copiloto` faria
-- TODA leitura do ciclo (a cada 3 s, sessão ao vivo) carregar um documento
-- de ~8-12 KB que o ciclo não usa.
--
-- POR QUE NÃO SE CHAMA "RELATÓRIO": `relatorios_sessao` já existe e é o
-- documento que a advogada preenche À MÃO (brain/03 - Dominio/Glossario.md,
-- "Relatório da SV"; `RelatorioAba.tsx`; item de pasta `relatorio_sv`). Dois
-- "Relatório" na mesma aba da Ficha 360 seria ambiguidade permanente. Regra
-- da casa: os nomes do negócio são os nomes do código — e o inverso também
-- vale, não se reusa um nome ocupado para uma coisa nova.
--
-- ===========================================================================
-- MEDIDO EM PRODUÇÃO (fcfsnqqaphtamhrpuyoh, 19/09/2026, via PostgREST com o
-- service role do `.env.local` — só agregados, nenhuma evidência literal
-- impressa). É isto que sustenta o desenho abaixo:
--
--   `copiloto_sugestoes`                369 em 3 sessões (70 · 178 · 121)
--   `desfecho`                          366 expirada · 3 aceita · 0 ignorada
--   `conteudo.cobriu_no_bloco` (0119)   11 itens, em 8 de 369, em 1 de 3 sessões
--   `bloco_id` distintos por sessão     4 · 9 · 6   (denominador 13 nas três)
--   `inventario_acumulado`              0 · 31 · 70 itens
--   `ficha_acumulada`                   0 itens em 3 de 3 sessões
--   `confianca` média                   0,636 (0,52 · 0,66 · 0,67 por sessão)
--   evidência não conferida             223 de 369 = 60,4%
--   duração real                        3h03 · 1h54 · 2h01
--   `sessoes_viabilidade.resultado`     NULL em 4 de 4
--   `execucoes_ia.stop_reason`          65 'max_tokens' entre as 'falhou'
--
-- CONCLUSÃO QUE MUDA O MODELO: NÃO existe hoje base medida para uma NOTA de
-- condução. Os dois campos que a 0119 criou justamente para isso estão
-- vazios (`cobriu_no_bloco` = 11 itens em 369; `desfecho` = 99,2%
-- 'expirada'). Uma nota construída sobre isso daria um número plausível e
-- FALSO — o padrão já catalogado nesta casa de "buraco virando número
-- plausível por 5 semanas" (COALESCE). O que existe medido e é AUDITÁVEL é
-- COBERTURA: fração com denominador fixo, conferível por quem olha a
-- `BarraPartes` da tela. Por isso as duas colunas abaixo são
-- `blocos_com_atividade` + `blocos_no_roteiro`, NUNCA um percentual pronto.
-- ===========================================================================
--
-- ===========================================================================
-- AS 5 PERGUNTAS DO PROTOCOLO DE SUSTENTABILIDADE
-- ===========================================================================
--
-- 1. Escala — 1 linha por SESSÃO, escrita 1 vez, no encerramento. Hoje: 3
--    sessões. 10×: 30 linhas. `conteudo` com CHECK de 32.768 bytes
--    (`pg_column_size`), MESMO backstop de `resumo_acumulado`/
--    `ficha_acumulada` (0091/0120/0122) — e a poda em TypeScript
--    (`server/copiloto/retrospecto.ts::podarConteudo`, alvo 28.000 B)
--    acontece ANTES de qualquer escrita chegar a esse limite. Nunca cresce
--    com a duração da sessão além do teto.
--
-- 2. Índice — `sessao_id` é a PK (leitura do pop-up e da rota `GET
--    .../retrospecto` é sempre por ela: Index Scan, índice implícito da PK).
--    `idx_copiloto_retrospectos_jornada (jornada_id, criado_em desc)` serve
--    à OUTRA pergunta, a da Ficha 360: "os retrospectos deste cliente, mais
--    recente primeiro" — um índice, as duas leituras que existem.
--
-- 3. Frequência — 1 escrita por sessão encerrada (≈ 1/dia hoje); leitura sob
--    demanda, nunca em polling. ZERO query nova no caminho quente: o ciclo
--    de 3 s não toca esta tabela.
--
-- 4. Repetição — impossível por construção: `sessao_id` é PK. Encerrar duas
--    vezes NÃO PODE gerar dois retrospectos, e nenhuma rota futura consegue
--    violar isso por descuido. A idempotência deixa de ser disciplina de
--    código e vira INVARIANTE DE BANCO (o código ainda faz `on conflict
--    (sessao_id) do nothing` como cinto e suspensório, para a corrida entre
--    o clique e o ciclo automático no mesmo segundo não virar 500 na cara da
--    advogada).
--
-- 5. Reversão — sem deploy, em 1 comando:
--      update configuracoes set valor='false'::jsonb
--        where chave in ('copiloto_sessao.retrospecto_ativo',
--                        'copiloto_sessao.saude_captura');
--    A TABELA PODE FICAR: sem escritor, ela apenas guarda o que já
--    produziu. `drop table copiloto_retrospectos cascade` só se for
--    descartar o histórico DE PROPÓSITO — nunca no rollback de um deploy
--    ruim.
--
-- 🔴 BACKFILL: NENHUM. As 3 sessões já encerradas NÃO ganham retrospecto
-- retroativo. Medido: as 3 têm `encerrado_em` e transcrição consolidada,
-- então seria tecnicamente possível — mas o retrospecto afirma "foi isto que
-- a máquina observou AO VIVO", e reconstruir isso depois produziria um
-- documento com data de hoje sobre uma sessão de anteontem. NENHUMA linha
-- existente muda de valor; ninguém é promovido nem rebaixado por esta
-- migration (regra da casa: "backfill de migration reclassifica gente em
-- silêncio" — aqui não há reclassificação nenhuma porque não há backfill).
-- Se o dono quiser as 3 retroativas, é comando manual explícito, com o
-- carimbo de que foi reconstruído — nunca default de migration.
--
-- ROTEIRO DE VERIFICAÇÃO: scripts/verificacao-0125.sql (tudo dentro de
-- sub-blocos terminados em `raise exception 'rollback_proposital'`) — prova
-- `relrowsecurity`, `relforcerowsecurity`, o `proacl` da tabela, o CHECK de
-- 32 KB, a recusa de INSERT como `authenticated`, e o teste de "encerrar 2×
-- → 1 linha".
--
-- ROLLBACK:
--   update configuracoes set valor='false'::jsonb
--     where chave in ('copiloto_sessao.retrospecto_ativo',
--                     'copiloto_sessao.saude_captura');
--   -- e, SÓ se for descartar o histórico de propósito:
--   -- drop index if exists idx_copiloto_retrospectos_jornada;
--   -- drop table if exists copiloto_retrospectos;
--   delete from configuracoes where chave in (
--     'copiloto_sessao.retrospecto_ativo', 'copiloto_sessao.saude_captura');
--   -- `copiloto_sessao.rodape_transcricao` NÃO é apagada por esta migration
--   -- nem pelo rollback dela: só a `descricao` muda (ver bloco (c)).
-- ===========================================================================


-- ===========================================================================
-- (a) A TABELA.
-- ===========================================================================
create table if not exists copiloto_retrospectos (
  -- PK = sessao_id: a idempotência vira INVARIANTE DE BANCO, não disciplina
  -- de código. `on delete cascade` dos DOIS lados (sessão e jornada) — apagar
  -- a sessão apaga o retrospecto dela, nunca deixa órfão com PII dentro.
  sessao_id       uuid primary key
                    references sessoes_copiloto(sessao_id) on delete cascade,
  jornada_id      uuid not null references jornadas(id) on delete cascade,

  -- 'derivado' = calculado do que a sessão já gravou (v1, ZERO chamada de IA).
  -- 'ia'       = produzido por chamada de IA sobre a transcrição consolidada
  --              (FORA da v1 — a coluna existe para a ponte ligar sem
  --              migration nova, mesma técnica de croqui_analises.schema_versao,
  --              0043, que ligou a v2 sem DDL).
  origem          text not null default 'derivado'
                    check (origem in ('derivado', 'ia')),
  schema_versao   smallint not null default 1 check (schema_versao > 0),
  -- Prompt é versionado (regra não negociável do CLAUDE.md). NULL enquanto
  -- origem='derivado' — e o CHECK abaixo torna isso uma REGRA, não um
  -- costume: origem='ia' SEM execucao_ia_id é um retrospecto de IA sem
  -- prompt rastreável, exatamente o que a regra proíbe.
  execucao_ia_id  uuid references execucoes_ia(id),
  constraint copiloto_retrospectos_ia_exige_execucao
    check (origem <> 'ia' or execucao_ia_id is not null),

  -- COBERTURA — não se chama "score" porque NÃO É NOTA: é fração com
  -- denominador explícito. Medido em 19/09 nas 3 sessões reais: 4/13, 9/13,
  -- 6/13. Os dois campos SEPARADOS (nunca só o percentual) para a tela poder
  -- escrever "9 de 13 partes" — número sozinho esconde o denominador, e
  -- denominador escondido é como métrica mente nesta casa.
  blocos_com_atividade smallint not null check (blocos_com_atividade >= 0),
  blocos_no_roteiro    smallint not null check (blocos_no_roteiro > 0),
  constraint copiloto_retrospectos_cobertura_coerente
    check (blocos_com_atividade <= blocos_no_roteiro),

  -- O corpo. jsonb (não colunas) porque a v2 vai acrescentar seções e a
  -- forma ainda vai mudar — mas com CHECK de tamanho, MESMO backstop de
  -- resumo_acumulado/ficha_acumulada (0091/0120/0122): nunca cresce sem
  -- teto, mesmo que a poda em TypeScript tenha um defeito futuro.
  -- Medido: `conteudo` de sugestão = 834 B em média, 1.602 B no máximo; um
  -- retrospecto com ~20 observações + ~15 pontos de melhoria fica na ordem
  -- de 8-12 KB. 32 KB é ~3× folga real, não um teto que já nasce apertado.
  conteudo        jsonb not null,
  constraint copiloto_retrospectos_conteudo_teto
    check (pg_column_size(conteudo) <= 32768),

  -- Redação de PII (expurgo): mesmo carimbo de `sessoes_copiloto`.
  -- NULL = o conteúdo ainda tem citação literal; timestamp = já redigido por
  -- server/copiloto/expurgo.ts::redigirRetrospectoDaSessao.
  evidencias_redigidas_em timestamptz,

  criado_em       timestamptz not null default now(),
  -- 🔴 DESVIO DELIBERADO DO RASCUNHO DO PLANO (§D.3 escrevia `references
  -- auth.users(id)`): a convenção desta base, em TODAS as ~25 tabelas com
  -- autoria (0002 a 0059), é `criado_por uuid references perfis_equipe(id)`.
  -- `perfis_equipe.id` NÃO é `auth.users.id` — o vínculo é
  -- `perfis_equipe.auth_user_id`. Apontar para `auth.users` faria o INSERT
  -- falhar com 23503 quando o código gravasse `usuario.id` (que é o id do
  -- PERFIL, o que `exigirVePatrimonio` devolve e o que o resto do sistema
  -- usa em `ator_perfil_id`). O rascunho avisava para conferir os nomes
  -- contra a 0091/0122 no checkout — conferido, e corrigido aqui.
  --
  -- NULL quando quem gravou foi o CICLO AUTOMÁTICO (encerramento por
  -- `duracao_maxima_minutos`): não há humano por trás, e inventar um seria
  -- mentir sobre autoria. `on delete set null`: desativar/apagar o perfil de
  -- alguém da equipe não pode apagar o documento do cliente.
  criado_por      uuid references perfis_equipe(id) on delete set null
);

create index if not exists idx_copiloto_retrospectos_jornada
  on copiloto_retrospectos (jornada_id, criado_em desc);

comment on table copiloto_retrospectos is
  'Fase 13 (19/09/2026) — RETROSPECTO DA SESSAO: o fechamento do copiloto, '
  'ou seja, o que a maquina observou enquanto a Sessao de Viabilidade '
  'acontecia, congelado no instante em que ela terminou. NAO e o "Relatorio '
  'da SV" (relatorios_sessao), que a advogada preenche a mao (Glossario.md). '
  'E gerado, nao preenchido, e imutavel: PK=sessao_id torna a idempotencia '
  'INVARIANTE DE BANCO (encerrar 2x nunca gera 2). Escrito por '
  'server/copiloto/retrospecto.ts::gravarRetrospectoDaSessao, chamado de '
  'dentro de executarEncerramentoCopiloto nos TRES caminhos de encerramento. '
  'Kill-switch: configuracoes copiloto_sessao.retrospecto_ativo.';

comment on column copiloto_retrospectos.blocos_com_atividade is
  'Numerador da COBERTURA: partes do roteiro em que o copiloto registrou '
  'pelo menos 1 sugestao (count distinct copiloto_sugestoes.bloco_id, '
  'contando so bloco que existe no roteiro DAQUELA sessao). Medido em '
  '19/09/2026 nas 3 sessoes reais: 4, 9 e 6.';
comment on column copiloto_retrospectos.blocos_no_roteiro is
  'Denominador da COBERTURA: total de blocos do roteiro DAQUELA sessao '
  '(sessoes_viabilidade.roteiro_versao_id, com o mesmo fallback para o '
  'roteiro ativo que estado.ts/contexto.ts aplicam quando a FK e nula). '
  'NUNCA o roteiro ativo de hoje quando a sessao declarou outro — sessao '
  'antiga conduzida por roteiro de 11 partes nao pode ser julgada contra um '
  'roteiro de 13. Guardado JUNTO com o numerador porque a tela escreve "9 de '
  '13 partes": percentual sozinho esconde o denominador.';
comment on column copiloto_retrospectos.conteudo is
  'O corpo do documento (ConteudoRetrospecto, types/copiloto.ts): cobertura '
  '+ nao percorridos, duracao, patrimonio captado, observacoes sobre o '
  'cliente (ficha_acumulada + conteudo.observacao agrupada por tipo), pontos '
  'de melhoria (falta_no_bloco[].item que nunca apareceu em cobriu_no_bloco) '
  'e saude do motor. CHECK de <= 32768 bytes (pg_column_size), mesmo '
  'backstop de resumo_acumulado/ficha_acumulada. Contem CITACAO LITERAL '
  '(observacoes_do_cliente[].evidencia) ate o expurgo passar — ver '
  'evidencias_redigidas_em.';
comment on column copiloto_retrospectos.evidencias_redigidas_em is
  'NULL = o conteudo ainda tem citacao literal de fala de cliente real. '
  'Timestamp = server/copiloto/expurgo.ts::redigirRetrospectoDaSessao ja '
  'zerou observacoes_do_cliente[].evidencia, no MESMO instante em que os '
  'segmentos de fala da sessao foram expurgados. Mesmo carimbo/disciplina de '
  'inventario_acumulado e ficha_acumulada.';
comment on column copiloto_retrospectos.origem is
  'derivado = montado do que a sessao ja gravou, ZERO chamada de IA (toda a '
  'v1). ia = produzido por chamada de IA sobre a transcricao consolidada '
  '(fora da v1). origem=ia SEM execucao_ia_id e recusado por CHECK: prompt '
  'versionado e regra nao negociavel.';


-- ===========================================================================
-- (b) RLS — MESMO recorte de sessoes_copiloto/copiloto_sugestoes (0091):
-- `app.ve_patrimonio()`, NUNCA o `eh_interno()` mais largo. O conteúdo
-- carrega objeção/dor/desejo com citação literal de família real.
--
--   * enable + FORCE row level security: `service_role` não dispensa RLS nem
--     GRANT (regra da casa). A 0065b revogou os default privileges, então o
--     GRANT explícito é obrigatório — sem ele a tabela nasce INACESSÍVEL,
--     não "aberta".
--   * SELECT: `authenticated` com `app.ve_patrimonio()`.
--   * INSERT/UPDATE/DELETE: NENHUMA policy para `authenticated`. Quem
--     escreve é `service_role`, pelo caminho do encerramento; a tela só lê.
--     Mesmo padrão de `copiloto_sugestoes` (0091) e `agente_whatsapp_
--     respostas` (0088): nasce sem gaveta de escrita para authenticated.
--   * `service_role` ganha `delete` junto com insert/update porque o
--     `on delete cascade` de `sessoes_copiloto` já apaga esta linha, e o
--     expurgo precisa poder corrigir um retrospecto órfão à mão sem trocar
--     de credencial. Nenhuma policy de DELETE para authenticated existe.
-- ===========================================================================
alter table copiloto_retrospectos enable row level security;
alter table copiloto_retrospectos force row level security;

revoke all on copiloto_retrospectos from public, anon, authenticated;

drop policy if exists cr_sel on copiloto_retrospectos;
create policy cr_sel on copiloto_retrospectos for select to authenticated
  using ((select app.ve_patrimonio()));

grant select on copiloto_retrospectos to authenticated;
grant select, insert, update, delete on copiloto_retrospectos to service_role;


-- ===========================================================================
-- (c) CONFIGURAÇÕES.
-- ===========================================================================
insert into configuracoes (chave, valor, descricao) values

 ('copiloto_sessao.saude_captura', 'true'::jsonb,
  '19/09/2026 (Fase 13) — mostra a LINHA DE SAUDE DA CAPTURA no rodape da '
  'tela /conduzir: ponto tricolor (ouvindo / sem audio ha Ns / sem captura '
  'ha Ns) + ultima fala, 1 linha, SEMPRE visivel em qualquer aba da coluna '
  '3. Nasce TRUE: e reorganizacao de UI sobre dado que o poller ja traz, '
  'nao capacidade nova. SUBSTITUI copiloto_sessao.rodape_transcricao '
  '(0122), que foi DEPRECADA porque o nome passou a mentir — o rodape nao '
  'tem mais transcricao nenhuma. Lido por lerConfiguracoesEmLote '
  '(server/ia/configuracao.ts), devolvido no payload de polling por '
  'montarEstadoCopiloto (server/copiloto/estado.ts) como saude_captura. '
  'FAIL-CLOSED no codigo: chave ausente = false (o indicador some), nunca '
  'true — ausencia da chave e estado de defeito, e defeito nao liga '
  'feature.'),

 ('copiloto_sessao.retrospecto_ativo', 'true'::jsonb,
  '19/09/2026 (Fase 13) — kill-switch do RETROSPECTO DA SESSAO '
  '(copiloto_retrospectos). Liga a GRAVACAO no encerramento, a rota GET '
  '/api/sessoes/[id]/copiloto/retrospecto (JSON e ?formato=docx) e o pop-up '
  'de fim de sessao. FALSE: o encerramento volta a ser exatamente o que era '
  'antes da Fase 13 — sem retrospecto, sem pop-up — e a rota recusa com '
  'retrospecto_desligado; as linhas ja gravadas ficam no banco, nada e '
  'apagado. Caminho de volta em 1 comando. Nasce TRUE porque a v1 nao gasta '
  'IA nenhuma (origem=derivado: montagem do que a sessao ja gravou) e nao '
  'acrescenta query no caminho quente do polling. FAIL-CLOSED no codigo: '
  'chave ausente = false. Lido por lerConfiguracoesEmLote '
  '(server/ia/configuracao.ts).')

on conflict (chave) do nothing;

-- `copiloto_sessao.rodape_transcricao` (0122) — 🔴 NAO APAGAR. `ativo=false`
-- em vez de `delete` é a regra da casa: a linha antiga vira HISTORICO, não
-- some. O que muda é só a `descricao`, para quem ler a chave pela tela/REST
-- saber que ela está morta e qual a substituta. O CODIGO deixa de ler esta
-- chave nesta mesma entrega (`server/copiloto/estado.ts`) — nenhum caminho
-- do sistema a consulta depois da Fase 13.
update configuracoes set descricao =
  'DEPRECADA em 19/09/2026 pela migration 0125 (Fase 13). NAO E MAIS LIDA '
  'POR NENHUM CODIGO. Motivo: o rodape da tela /conduzir nao tem mais '
  'transcricao nenhuma — o OverlayTranscricao saiu e a transcricao virou ABA '
  'da coluna 3, ao lado de Inventario e Ficha do cliente. O nome desta chave '
  'passaria a descrever um rodape de transcricao que nao existe. '
  'SUBSTITUIDA POR copiloto_sessao.saude_captura, que liga o que de fato '
  'sobrou no rodape: o indicador tricolor de saude da captura + a ultima '
  'fala. Linha preservada como historico (regra da casa: ativo=false, nunca '
  'delete). Texto anterior (18/09/2026, 0122/0124): "mostra a transcricao '
  'bruta como RODAPE sempre visivel na tela /conduzir, substituindo a aba '
  'propria que a advogada nunca clicava."'
 where chave = 'copiloto_sessao.rodape_transcricao';
