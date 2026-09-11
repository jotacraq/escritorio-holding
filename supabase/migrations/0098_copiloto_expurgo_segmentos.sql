-- 0098_copiloto_expurgo_segmentos.sql
-- Fase 10 · Fatia 5 (docs/ARQUITETURA-FASE-10.md §8 Fatia 5, §10 B69). Fecha
-- o B19, aberto desde a Fase 7: "por quanto tempo guardar gravação,
-- transcrição... hoje guardamos tudo, nenhuma política de expurgo escrita" —
-- aqui é só sobre `sessoes_copiloto_segmentos` (o áudio/vídeo no fornecedor é
-- B76, já resolvido em código na Fatia 4: `retention` obrigatório e
-- conferido — `bot/route.ts:192-206`, `recall.ts`).
--
-- 100% ADITIVA. Nenhuma tabela, coluna, view, função ou policy existente é
-- ALTERADA. Só ACRESCENTA: 2 colunas em `sessoes_copiloto` (o rastro do
-- expurgo), 1 índice parcial e 1 chave nova em `configuracoes`.
--
-- 🔴 REGRA DURA (pedido explícito do coordenador, mais séria aqui do que nas
-- outras fatias desta fase): "NASCE DESLIGADO... Sem B69 respondido, nada é
-- apagado". A 0091 já grava `copiloto_sessao.retencao_dias_segmentos = 7`
-- desde a Fatia 1 — mas aquele número é só o PRAZO proposto (hipótese
-- conservadora do plano), nunca uma AUTORIZAÇÃO para apagar. Misturar as
-- duas coisas numa chave só significaria que ALTERAR O PRAZO (ação de
-- configuração, sem intenção de "ligar o apagamento") LIGARIA o apagamento
-- sozinho — exatamente o tipo de kill-switch fantasma que esta fase já
-- catalogou (6 ocorrências, comentário do coordenador). Por isso esta
-- migration cria uma 2ª chave, SEPARADA e SEM RELAÇÃO NUMÉRICA com o prazo:
-- `copiloto_sessao.expurgo_ativo` (booleano, nasce 'false'). É o 6º
-- interruptor do plano de reversão (§2.5 descrevia 5; o expurgo é o 6º, e é
-- o único cujo padrão de fábrica é "nunca ligou", não "já ligou e pode ser
-- desligado").
--
-- O QUE ENTRA
--   (a) sessoes_copiloto.expurgo_segmentos_em (timestamptz) +
--       .expurgo_segmentos_motivo (text) — o RASTRO de que os segmentos
--       daquela sessão foram removidos, quando, e sob qual política. Mesmo
--       raciocínio de `ligacoes_ia.expurgado_em` (server/ligacao-ia/
--       expurgo.ts): a linha-PAI (`sessoes_copiloto`) sobrevive e carrega o
--       carimbo; só o CONTEÚDO sensível (os segmentos) é removido. Nasce
--       NULL nas duas — nenhuma sessão existente é tocada por este DDL.
--   (b) idx_copiloto_sessoes_pendentes_expurgo — índice PARCIAL sobre o
--       predicado EXATO de `buscarSessoesElegiveis` (server/copiloto/
--       expurgo.ts): `where transcricao_id is not null and
--       expurgo_segmentos_em is null order by criado_em`. Prova exigida
--       pela regra da casa ("índice novo: prove que a query usa o
--       predicado; índice parcial só serve se a query provar o WHERE") —
--       `explain (analyze)` no roteiro de verificação, comando (a).
--   (c) configuracoes['copiloto_sessao.expurgo_ativo'] = 'false' — o
--       interruptor mestre. Só quando TRUE o job de expurgo (server/
--       copiloto/expurgo.ts, chamado pelo cron) apaga qualquer linha.
--
-- ROTEIRO DE VERIFICAÇÃO: `scripts/verificacao-0098.sql`.
--
-- ROLLBACK:
--   delete from configuracoes where chave = 'copiloto_sessao.expurgo_ativo';
--   drop index if exists idx_copiloto_sessoes_pendentes_expurgo;
--   alter table sessoes_copiloto drop column if exists expurgo_segmentos_motivo;
--   alter table sessoes_copiloto drop column if exists expurgo_segmentos_em;
-- ===========================================================================


-- ===========================================================================
-- (a) O rastro do expurgo — vive na SESSÃO (entidade-pai), não numa tabela de
-- log genérica nova (a casa não tem uma; o precedente de `ligacoes_ia`
-- carimba a própria linha). `sessoes_copiloto` não é apagada nem quando os
-- segmentos são: ela é o registro de que a sessão existiu e teve copiloto —
-- o expurgo tira só a FALA BRUTA, nunca esse fato.
-- ===========================================================================
alter table sessoes_copiloto
  add column if not exists expurgo_segmentos_em timestamptz;
alter table sessoes_copiloto
  add column if not exists expurgo_segmentos_motivo text;

comment on column sessoes_copiloto.expurgo_segmentos_em is
  'Fase 10, Fatia 5 (B69/B19). Instante em que server/copiloto/expurgo.ts '
  'removeu os segmentos brutos (sessoes_copiloto_segmentos) desta sessão por '
  'retenção vencida. NULL = nunca expurgada (inclui: expurgo desligado, '
  'sessão ainda dentro do prazo, ou sessão sem transcrição consolidada — o '
  'expurgo NUNCA roda antes de transcricao_id estar preenchido).';
comment on column sessoes_copiloto.expurgo_segmentos_motivo is
  'Fase 10, Fatia 5. Texto curto e estável, NUNCA mensagem livre — mas NÃO '
  'é um formato único (correção do coordenador: "já são quatro, antes que '
  'vire a nona promessa"). Família fechada, todas geradas por '
  'server/copiloto/expurgo.ts::carimbarSessoesSemPendencia: '
  '(1) "retencao_dias_segmentos vencida (N dias)" — caminho comum, nada '
  'sobrou; '
  '(2) "concluído; N segmento(s) pós-encerramento retido(s) (nunca '
  'apagados)" — backstop reteve por criado_em > encerrado_em, os segmentos '
  'CONTINUAM na tabela; '
  '(3) "concluído; N segmento(s) sem encerrado_em conhecido, retido(s) por '
  'fail-closed (nunca apagados)" — mesmo efeito de (2), causa diferente '
  '(sessoes_copiloto.encerrado_em nulo); '
  '(4) "concluído; esvaziada em passagem anterior (carimbo pendente '
  'resolvido agora)" — sessão sem nenhum segmento restante cujo carimbo '
  'não rodou na passagem que a esvaziou (erro transiente no laço). Em '
  'todos os casos, é a POLÍTICA/CAUSA sob a qual o carimbo aconteceu, para '
  'auditoria futura mesmo que a chave de configuração mude de valor '
  'depois — quem adicionar um 5º motivo tem de atualizar este comentário '
  'junto, não depois.';


-- ===========================================================================
-- (b) Índice PARCIAL sobre o predicado exato de `buscarSessoesElegiveis`
-- (server/copiloto/expurgo.ts) — a cada passagem do cron, essa é a PRIMEIRA
-- query do job: `where transcricao_id is not null and expurgo_segmentos_em
-- is null order by criado_em asc limit 50`. `sessoes_copiloto` é pequena
-- (1 linha por SESSÃO, não por segmento — ordens de grandeza menor que
-- `sessoes_copiloto_segmentos`, §2.1 do plano), mas o predicado roda com a
-- frequência do cron (potencialmente centenas de vezes/dia, `POST /api/
-- cron/regua`), e o `order by criado_em` (adicionado depois do achado de
-- que SEM ordem o teto de 50 sessões poderia devolver sempre o mesmo
-- conjunto "ainda não vencido", nunca alcançando sessões mais antigas —
-- comentário de `buscarSessoesElegiveis`) precisa de um caminho barato para
-- não virar um Sort sobre a tabela inteira à medida que ela cresce.
--
-- Índice PARCIAL: só indexa a fatia relevante (`transcricao_id is not null
-- and expurgo_segmentos_em is null`) — sessões já carimbadas (a maioria, ao
-- longo do tempo, se o expurgo estiver ligado) NUNCA entram no índice,
-- mantendo-o pequeno mesmo com a base crescendo. Caractere a caractere, o
-- WHERE do índice bate com o WHERE da query (regra da casa) — provar com
-- `explain (analyze)`, comando (a) do roteiro de verificação.
-- ===========================================================================
create index idx_copiloto_sessoes_pendentes_expurgo
  on sessoes_copiloto (criado_em)
  where transcricao_id is not null and expurgo_segmentos_em is null;

comment on index idx_copiloto_sessoes_pendentes_expurgo is
  'Fase 10, Fatia 5. Parcial: só sessões consolidadas e ainda não '
  'expurgadas — cobre buscarSessoesElegiveis (server/copiloto/expurgo.ts), '
  'a primeira query de cada passagem do job de expurgo.';


-- ===========================================================================
-- (c) O interruptor mestre — SEPARADO do prazo (retencao_dias_segmentos,
-- 0091), de propósito (ver comentário de topo). Nasce 'false': o job de
-- expurgo (chamado pelo cron a cada passagem) sempre lê esta chave PRIMEIRO
-- e devolve `pulada: 'expurgo_desligado'` sem tocar em nenhuma linha
-- enquanto ela não virar 'true' — mesma mecânica de `copiloto_sessao.ativo`
-- (0091) e do padrão já usado em `ligacao_ia.retencao_dias` (server/
-- ligacao-ia/expurgo.ts): "não saber/não decidir" cai SEMPRE no lado que não
-- apaga nada.
-- ===========================================================================
insert into configuracoes (chave, valor, descricao) values
 ('copiloto_sessao.expurgo_ativo', 'false'::jsonb,
  'Interruptor MESTRE do expurgo de sessoes_copiloto_segmentos (Fatia 5, B69/B19). '
  'FALSE ao nascer e deve PERMANECER false até a Dra. Elaine decidir a política de '
  'retenção — mudar copiloto_sessao.retencao_dias_segmentos NÃO liga isto sozinho, '
  'são duas chaves independentes de propósito. Só quando TRUE o cron '
  '(/api/cron/regua) remove segmentos vencidos, e só de sessão com transcricao_id '
  'preenchido (consolidada).')
on conflict (chave) do nothing;
