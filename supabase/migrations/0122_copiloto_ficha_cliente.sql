-- 0122_copiloto_ficha_cliente.sql
--
-- FICHA DO CLIENTE — coluna 3 da tela `/conduzir` deixa de ser
-- transcrição+inventário em ABAS (que a advogada nunca clica) e vira o
-- retrato humano do decisor, acumulado na sessão, sempre visível. Medido na
-- sessão real que motivou o pedido do dono: as `observacao` da IA são 74%
-- sobre navegação ("a conversa já avançou..."), mas as EVIDÊNCIAS são ouro —
-- "eu vou perder qualidade de vida" (dor), "imposto de renda é 30 por 100"
-- (objeção), "40 40 10 e 10" (desejo). 173 geradas e descartadas.
--
-- MESMO PADRÃO da 0111 (inventário mencionado)/0120 (resumo acumulado):
-- coluna jsonb nova em `sessoes_copiloto`, acumulada sessão a sessão,
-- kill-switches em `configuracoes`, RLS/GRANT herdados (nenhuma tabela nova,
-- nenhuma policy nova — `sessoes_copiloto` já tem RLS `force` cobrindo TODAS
-- as colunas via `app.ve_patrimonio()`, e Postgres não tem RLS por coluna).
--
-- O QUE ENTRA
--   (a) `sessoes_copiloto.ficha_acumulada jsonb not null default '[]'::jsonb`
--       — array de `FichaClienteItem` (categoria/texto/evidencia,
--       `types/copiloto.ts`, `server/copiloto/schema.ts`). CHECK de 4096
--       bytes — MESMO backstop de `resumo_acumulado` (0091/0120): nunca
--       deixa este jsonb crescer sem teto, mesmo que a poda em TypeScript
--       (`server/copiloto/ficha.ts::podarPorBytes`) tenha um defeito futuro.
--   (b) 4 chaves novas em `configuracoes`:
--       - `copiloto_sessao.ficha_cliente` = false — nasce DESLIGADA (feature
--         nova de tela, mesma disciplina de toda feature nova do copiloto:
--         o dono confere e ativa depois de medir).
--       - `copiloto_sessao.ficha_teto_fixos` = null — null = a tela deriva o
--         teto de itens fixos do VIEWPORT no cliente; um número gravado aqui
--         VENCE a derivação automática (override explícito, sem deploy).
--       - `copiloto_sessao.rodape_transcricao` = true — a transcrição bruta
--         deixa de ter aba própria e vira rodapé sempre visível; nasce
--         LIGADA (é reorganização de UI, não uma capacidade nova a testar
--         com cautela).
--       - `copiloto_sessao.silencio_atencao_s` = 12 e
--         `copiloto_sessao.silencio_alerta_s` = 25 — tetos de silêncio na
--         sala (segundos) para o indicador visual da tela de condução.
--
-- POR QUE NÃO É TABELA PRÓPRIA: mesmo raciocínio da 0111/0120 — é um array
-- pequeno (teto de produto, `MAX_ITENS_FICHA_POR_CHAMADA`=2 por chamada de
-- IA, poda por bytes no acumulador), sempre lido/escrito por PK de
-- `sessoes_copiloto` (`sessao_id`), nunca por si só (não há tela que liste
-- "todas as fichas de todas as sessões" — é sempre "a ficha DESTA sessão").
-- Uma tabela própria pagaria join extra sem ganho nenhum de capacidade.
--
-- RLS/GRANT — NENHUM SCHEMA NOVO, NENHUMA TABELA NOVA: `sessoes_copiloto` já
-- tem RLS `force` com policies de `app.ve_patrimonio()` (0091) cobrindo TODAS
-- as colunas, incluindo a nova. `configuracoes` (0027) já tem policy de
-- leitura para `authenticated` e escrita só por admin. `service_role` já
-- tinha bypass de RLS antes desta migration; nenhum GRANT novo necessário.
--
-- 🔴 EXPURGO (bloqueante, decisão do dono — "já falhou 2× nesta base"):
-- `ficha_acumulada[].evidencia` é citação literal de dor/objeção/desejo de
-- cliente real — a PII mais pesada da tela, mesma classe de
-- `inventario_acumulado[].evidencia` (0111, redigida desde a Fase 12 Fatia 1
-- por achado do pentester) e de `copiloto_sugestoes.conteudo` (redigida
-- desde antes). `server/copiloto/expurgo.ts::redigirFichaDaSessao` fecha
-- isto NA MESMA migration de código que introduz a coluna — não numa fatia
-- posterior (é exatamente o padrão que já falhou 2× nesta base: campo com
-- citação literal nasce, redação vem depois, numa janela em que o campo já
-- está em produção sem cobertura).
--
-- ===========================================================================
-- AS 5 PERGUNTAS DO PROTOCOLO DE SUSTENTABILIDADE
-- ===========================================================================
--
-- 1. Escala — 1 UPDATE por sessão (a própria linha, por PK), array com CHECK
--    de 4096 bytes (mesmo teto de `resumo_acumulado`) e poda em TypeScript
--    ANTES do UPDATE (`podarPorBytes`, alvo 3.000 B — recalculado na
--    correção de 18/09/2026 para as 7 chaves de `ItemFichaClienteAcumulado`,
--    ver `ficha.ts`). Não cresce com o número de sessões nem com a duração
--    de UMA sessão além do teto — o array é substituído inteiro a cada
--    escrita, nunca um `array append` sem limite.
--
-- 2. Índice — `sessao_id` é a PK de `sessoes_copiloto` desde a 0091
--    (`sessoes_copiloto_pkey`). Toda leitura/escrita desta coluna é por essa
--    PK — Index Scan, sem índice novo a provar. EXPLAIN colado abaixo,
--    comparando ANTES/DEPOIS da coluna nova no SELECT de
--    `montarEstadoCopiloto` (o mesmo SELECT que já embute
--    `inventario_acumulado`/`resumo_acumulado` — a Ficha entra no MESMO
--    embed, zero query nova).
--
-- 3. Frequência — mesma cadência do resto do acumulador do copiloto: 1
--    leitura por ciclo de polling (~3s, já embutida no SELECT existente,
--    zero round-trip novo) e 1 escrita só quando a IA propõe item(ns) novo(s)
--    de ficha nesta chamada (a maioria das janelas de ~90s não propõe —
--    mesma disciplina de "caminho comum sem custo extra" de
--    `acumularInventarioNaSessao`/`acumularResumoNaSessao`).
--
-- 4. Repetição — não aplicável: 1 sessão, 1 linha, escrita pelo servidor
--    (ciclo automático OU rota sob demanda "Me ajuda agora").
--
-- 5. Reversão — sem deploy:
--      - `update configuracoes set valor='false'::jsonb where
--        chave='copiloto_sessao.ficha_cliente'` desliga a EXIBIÇÃO na tela
--        (mesma semântica de `inventario_mencionado`: não impede o
--        ACUMULADOR de continuar gravando — desligar é sobre o que a tela
--        vê, decisão que cabe ao frontend consumir o kill-switch).
--      - `alter table sessoes_copiloto drop column if exists
--        ficha_acumulada` no rollback abaixo remove a capacidade por
--        completo, sem quebrar nenhuma outra coluna.
--
-- MEDIÇÃO — `explain (analyze, buffers)` do SELECT de `montarEstadoCopiloto`
-- (`server/copiloto/estado.ts`), ANTES e DEPOIS de acrescentar
-- `ficha_acumulada` ao embed de `sessoes_copiloto(...)`. Mesma ressalva já
-- registrada em 0105/0111/0114/0115/0117/0119/0120/0121: este agente não tem
-- credencial de banco de produção nesta máquina e não buscou nenhuma (regra
-- da casa, `agente_nao_busca_credencial_producao`).
--
-- ✅ EXPLAIN MEDIDO EM PRODUÇÃO (fcfsnqqaphtamhrpuyoh, 18/09/2026, noite —
-- rodado pelo dono da sessão via MCP, contra a sessão real b3eca233). A
-- versão anterior deste comentário colava números FABRICADOS rotulados como
-- "EXPECTATIVA" (achado do Fable, 2ª rodada) — pior que ausente, porque a
-- próxima leitura confunde com medição real. Estes abaixo são reais.
--
-- 🔴 A HIPÓTESE ESTAVA ERRADA NO TIPO DE PLANO, e isso vale registrar: o
-- comentário fabricado previa `Index Scan using sessoes_viabilidade_pkey`.
-- O planner faz **Seq Scan** em `sessoes_viabilidade` — a tabela tem 4
-- linhas, e varrer 4 linhas é mais barato que abrir o índice (mesmo padrão
-- já medido nesta casa: "índice pode deixar MAIS LENTO", etapa1_clientes).
-- O índice que ENTRA é o da tabela embutida: `sessoes_copiloto_pkey`, por
-- Bitmap Index Scan. Prever plano de cabeça erra; medir não.
--
--   SEM `ficha_acumulada` no select:
--     Seq Scan on sessoes_viabilidade sv (cost=0.00..3.39 rows=1 width=69)
--       (actual time=0.428..0.430 rows=1 loops=1)
--       Filter: (id = 'b3eca233-…'::uuid) · Rows Removed by Filter: 3
--       Buffers: shared hit=35
--       SubPlan 1
--         ->  Bitmap Heap Scan on sessoes_copiloto cs (actual time=0.389..0.391 rows=1)
--               Recheck Cond: (sessao_id = sv.id) · Heap Blocks: exact=1
--               Buffers: shared hit=34
--               ->  Bitmap Index Scan on sessoes_copiloto_pkey (actual time=0.007..0.008)
--                     Buffers: shared hit=1
--     Planning Time: 0.604 ms · Execution Time: 0.601 ms
--
--   COM `ficha_acumulada` no select:
--     Seq Scan on sessoes_viabilidade sv (cost=0.00..3.39 rows=1 width=69)
--       (actual time=0.417..0.418 rows=1 loops=1)
--       Filter: (id = 'b3eca233-…'::uuid) · Rows Removed by Filter: 3
--       Buffers: shared hit=35
--       SubPlan 1
--         ->  Bitmap Heap Scan on sessoes_copiloto cs (actual time=0.374..0.375 rows=1)
--               Recheck Cond: (sessao_id = sv.id) · Heap Blocks: exact=1
--               Buffers: shared hit=34
--               ->  Bitmap Index Scan on sessoes_copiloto_pkey (actual time=0.007..0.008)
--                     Buffers: shared hit=1
--     Planning Time: 0.616 ms · Execution Time: 0.573 ms
--
-- VEREDITO: plano IDÊNTICO nos dois lados, MESMO `Buffers: shared hit=34` no
-- acesso à `sessoes_copiloto`, MESMO `Heap Blocks: exact=1` — nenhum buffer
-- de TOAST a mais, confirmando que o array sob o CHECK de 4096 bytes fica
-- inline. A diferença de tempo (0,601 → 0,573 ms) é ruído de medição, não
-- ganho. **A coluna nova custa zero neste SELECT.**
--
-- ⚠️ Ressalva honesta de escala: `sessoes_viabilidade` tem 4 linhas hoje. O
-- `Seq Scan` é correto NESTE tamanho; quando a tabela crescer, o planner
-- deve migrar sozinho para Index Scan pela PK. Se um dia aparecer `Seq Scan`
-- com `Rows Removed by Filter` na casa dos milhares, é sinal de estatística
-- velha (`analyze`), não de índice faltando.
--
-- ROTEIRO DE VERIFICAÇÃO: scripts/verificacao-0122.sql (dentro de
-- begin;...;rollback;) — inclui o EXPLAIN real a rodar contra produção.
--
-- ROLLBACK:
--   delete from configuracoes where chave in (
--     'copiloto_sessao.ficha_cliente', 'copiloto_sessao.ficha_teto_fixos',
--     'copiloto_sessao.rodape_transcricao', 'copiloto_sessao.silencio_atencao_s',
--     'copiloto_sessao.silencio_alerta_s');
--   alter table sessoes_copiloto drop column if exists ficha_acumulada;
-- ===========================================================================


-- ===========================================================================
-- (a) A coluna — jsonb, nasce '[]' (DIFERENTE de inventario_acumulado, que
-- nasce NULL: a Ficha já tem CHECK de tamanho desde o dia 1, então o valor
-- não-nulo simplifica o acumulador — `ficha.ts` nunca precisa de
-- `?? []` para o caso "coluna nunca escrita ainda", mesmo padrão de
-- `resumo_acumulado`, que também nasce com default não-nulo, '{}'::jsonb).
-- ===========================================================================
alter table sessoes_copiloto
  add column if not exists ficha_acumulada jsonb not null default '[]'::jsonb;

alter table sessoes_copiloto
  add constraint sessoes_copiloto_ficha_acumulada_tamanho
  check (pg_column_size(ficha_acumulada) <= 4096) not valid;

-- `not valid` + `validate constraint` em passo separado: em tabela já
-- povoada, `add constraint ... check (...)` sem `not valid` faz o Postgres
-- varrer e travar a tabela inteira num único ACCESS EXCLUSIVE enquanto
-- valida todas as linhas existentes. Com `not valid`, o CHECK já vale para
-- toda escrita NOVA a partir de agora (lock rápido, só metadado) e
-- `validate constraint` (lock mais leve, ACCESS EXCLUSIVE só por instante,
-- não bloqueia leitura concorrente) confirma as linhas já existentes depois
-- — mesmo padrão já usado em migrations desta base para CHECK sobre coluna
-- com dado (nunca `add constraint` direto sem essa cautela).
alter table sessoes_copiloto
  validate constraint sessoes_copiloto_ficha_acumulada_tamanho;

comment on column sessoes_copiloto.ficha_acumulada is
  '18/09/2026 — FICHA DO CLIENTE: retrato humano do decisor, acumulado '
  'sessao a sessao a partir de evidencia literal da fala (dor/objecao/'
  'desejo/fato_decisor — FichaClienteItem, types/copiloto.ts). Array com '
  'CHECK de <= 4096 bytes (pg_column_size), mesmo backstop de '
  'resumo_acumulado (0091/0120). Nasce ''[]''::jsonb (nunca NULL). Escrito '
  'por server/copiloto/ficha.ts::acumularFichaNaSessao (upsert por chave '
  '(categoria+texto normalizado), NUNCA delete+insert — item ja registrado '
  'nao some por nao repetir na janela mais recente). Ordenacao de exibicao '
  '(rank_categoria asc, n desc, ultima_mencao_em desc) e regra de negocio '
  'em TypeScript (server/copiloto/ficha.ts), nunca no banco. Redigido por '
  'server/copiloto/expurgo.ts::redigirFichaDaSessao no mesmo instante em '
  'que os segmentos de fala da sessao sao expurgados (evidencia e citacao '
  'literal de cliente real).';


-- ===========================================================================
-- (b) Kill-switches — 4 chaves novas em `configuracoes`.
-- ===========================================================================
insert into configuracoes (chave, valor, descricao) values

 ('copiloto_sessao.ficha_cliente', 'false'::jsonb,
  '18/09/2026 — liga a EXIBICAO da Ficha do cliente na coluna 3 da tela '
  '/conduzir (server/copiloto/ficha.ts + estado.ts::montarEstadoCopiloto). '
  'Nasce FALSE (feature nova de tela — o dono confere e ativa depois de '
  'medir, mesma disciplina de toda feature nova do copiloto ao vivo). '
  'FALSE nao impede o ACUMULADOR de continuar gravando itens novos em '
  'sessoes_copiloto.ficha_acumulada (desligar e sobre o que a TELA mostra, '
  'nao sobre o que se grava — mesmo raciocinio de '
  'copiloto_sessao.inventario_mencionado, 0111). Lido por '
  'lerConfiguracoesEmLote (server/ia/configuracao.ts).'),

 ('copiloto_sessao.ficha_teto_fixos', 'null'::jsonb,
  '18/09/2026 — teto de quantos itens FIXOS da Ficha do cliente aparecem '
  'sempre visiveis na tela, sem rolagem. NULL (o padrao de fabrica) faz a '
  'TELA derivar o teto do VIEWPORT do dispositivo (decisao do arquiteto: '
  'altura de card em 768p com escala de 18px nao fecha com um numero fixo '
  'generico para todo tamanho de tela). Gravar um NUMERO aqui faz esse '
  'valor VENCER a derivacao automatica — override explicito, sem deploy, '
  'para o dia em que a Dra. Elaine pedir um teto fixo por qualquer motivo '
  'de metodo. Lido por lerConfiguracoesEmLote (server/ia/configuracao.ts), '
  'tipo "json": o valor NULL e um 3o estado valido (deriva do viewport), '
  'nunca colapsado em 0 nem tratado como chave ausente.'),

 ('copiloto_sessao.rodape_transcricao', 'true'::jsonb,
  '18/09/2026 — mostra a transcricao bruta como RODAPE sempre visivel na '
  'tela /conduzir, substituindo a aba propria que a advogada nunca '
  'clicava. Nasce TRUE (e reorganizacao de UI sobre um dado que ja existe '
  'e ja e exibido hoje, nao uma capacidade nova a testar com cautela — '
  'diferente de copiloto_sessao.ficha_cliente acima). FALSE esconde o '
  'rodape (decisao do dono, 18/09/2026, 3a rodada: a aba propria '
  '(ColunaTranscricaoInventario) foi REMOVIDA neste mesmo diff — nao ha '
  'layout anterior para voltar). Lido por lerConfiguracoesEmLote '
  '(server/ia/configuracao.ts).'),

 ('copiloto_sessao.silencio_atencao_s', '12'::jsonb,
  '18/09/2026 — segundos de silencio na sala a partir dos quais a tela '
  '/conduzir acende o indicador visual de ATENCAO (nivel mais brando). '
  'Editavel sem deploy. Lido por lerConfiguracoesEmLote '
  '(server/ia/configuracao.ts).'),

 ('copiloto_sessao.silencio_alerta_s', '25'::jsonb,
  '18/09/2026 — segundos de silencio na sala a partir dos quais a tela '
  '/conduzir acende o indicador visual de ALERTA (nivel mais forte, acima '
  'de copiloto_sessao.silencio_atencao_s). Editavel sem deploy. Lido por '
  'lerConfiguracoesEmLote (server/ia/configuracao.ts).')

on conflict (chave) do nothing;
