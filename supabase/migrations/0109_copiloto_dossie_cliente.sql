-- 0109_copiloto_dossie_cliente.sql
--
-- 17/09/2026 — "a IA passa a conhecer a família do cliente". Decisão do
-- Marcio: *"pode liberar tudo pra IA, patrimônio, documentos, tudo"* (vault
-- `05 Decisoes/2026-09-17 - SIC-HF dossie completo liberado para a IA.md`),
-- ao ser apresentado o bloqueio B1 (opções A/B/C/D — a recomendação técnica
-- era B, "dossiê sem números"; ele escolheu ALÉM: liberação total).
--
-- Isto REVERTE três documentos que afirmavam o oposto POR CONSTRUÇÃO:
--   1. `src/server/copiloto/contexto.ts` (comentário de topo) — reescrito
--      nesta mesma rodada (fora desta migration).
--   2. `docs/ARQUITETURA-FASE-10.md` §7.
--   3. `05 Decisoes/2026-09-15 - SIC-HF plano das tres frentes` §1.
--
-- 🔴 A LIBERAÇÃO É JURÍDICA; A TRAVA QUE SOBRA É FÍSICA — o p95 do ciclo
-- automático está em 9.191 ms contra timeout de 8.000 ms (medido 15/09/2026,
-- `contexto.ts`), 2 de 14 execuções já estourando. Por isso o dossiê:
--   - NUNCA carrega conteúdo de documento (só metadado: que tipos existem);
--   - é montado 1× por sessão (não por ciclo) — ver (a) abaixo, a coluna que
--     torna isso possível;
--   - é enxuto por desenho (~85-95 tokens medidos, `src/server/copiloto/
--     dossie.ts`), nunca "manda tudo porque agora pode".
--
-- O QUE ENTRA
--   (a) `sessoes_copiloto.dossie_cliente jsonb` — NULL até a 1ª chamada de
--       `montarContextoCopiloto` para aquela sessão; a partir daí, o dossiê
--       persistido (`DossieCliente`, types/copiloto.ts), lido pelo MESMO
--       select que `contexto.ts` já faz hoje — ZERO query nova no caminho
--       quente do ciclo automático.
--   (b) `configuracoes['copiloto_sessao.dossie_cliente']` — kill-switch.
--       Nasce TRUE (pedido explícito do dono — mesma filosofia fail-OPEN da
--       0108: é remoção de restrição, não trava nova). FALSE faz
--       `montarContextoCopiloto` devolver `dossie: null` sem montar nem
--       gravar nada, mesmo que a coluna já tenha valor de uma sessão
--       anterior a desligar — reversão sem precisar apagar dado gravado.
--
-- RLS/GRANT — NENHUM SCHEMA NOVO, NENHUMA TABELA NOVA. `sessoes_copiloto`
-- já tem RLS `force` com policies de `app.ve_patrimonio()` (0091) cobrindo
-- TODAS as colunas da tabela, incluindo a nova por definição (Postgres não
-- tem RLS por coluna) — nenhuma policy nova necessária. Mesma lógica para
-- `configuracoes` (0027, já tem policy de leitura para `authenticated` e
-- escrita só por admin). `service_role` já tinha bypass de RLS antes desta
-- migration; nenhum GRANT novo é necessário.
--
-- MEDIÇÃO — `alter table ... add column if not exists` é DDL puro (não
-- reescreve a tabela: coluna nasce NULL para toda linha existente, custo
-- O(1) em Postgres 11+, sem lock exclusivo longo). O `insert ... on conflict
-- (chave) do nothing` em `configuracoes` usa a mesma PK já medida em
-- migrations irmãs (0101, 0103, 0106, 0108) — Conflict Arbiter Index
-- `configuracoes_pkey`, 1 linha, sem varredura.
--
-- ⚠️ Este agente NÃO tem acesso ao banco de produção nesta máquina e NÃO
-- buscou credencial nenhuma (regra da casa). Os planos acima são a
-- EXPECTATIVA (mesmos predicados já provados em produção por migrations
-- irmãs — 0101 para o `add column` aditivo em `sessoes_copiloto`, 0108 para
-- o INSERT em `configuracoes`), não uma medição nova desta rodada. RODAR
-- `begin; explain (analyze) ...; rollback;` fica PENDENTE — o dono tem MCP e
-- roda (ver ROTEIRO DE VERIFICAÇÃO abaixo).
--
-- ROTEIRO DE VERIFICAÇÃO (rodar dentro de `begin; ...; rollback;` — não
-- aplica nada):
--   0. PRÉ: select count(*) from sessoes_copiloto;  -- guardar o número
--   1. Coluna nova, NULL em toda linha existente:
--        select count(*) from sessoes_copiloto where dossie_cliente is not null;  → 0
--   2. Kill-switch gravado, nasce TRUE:
--        select valor from configuracoes where chave = 'copiloto_sessao.dossie_cliente';  → true
--   3. Reaplicar a migration inteira não duplica a chave nem falha no add column:
--        (rodar o bloco (a)+(b) de novo na mesma transação) → sem erro, `configuracoes` continua com 1 linha para a chave
--   4. `explain (analyze) update sessoes_copiloto set dossie_cliente = '{}'::jsonb where sessao_id = <uuid real>;`
--      → Index Scan em `sessoes_copiloto_pkey` (sessao_id é PK, 0091) — colar a saída real.
--
-- ROLLBACK:
--   delete from configuracoes where chave = 'copiloto_sessao.dossie_cliente';
--   alter table sessoes_copiloto drop column if exists dossie_cliente;
-- ===========================================================================


-- ===========================================================================
-- (a) A coluna — jsonb, NULL até a 1ª montagem (server/copiloto/contexto.ts
-- ::montarOuReaproveitarDossie).
-- ===========================================================================
alter table sessoes_copiloto
  add column if not exists dossie_cliente jsonb;

comment on column sessoes_copiloto.dossie_cliente is
  '17/09/2026 — dossiê do cliente para a IA (decisão do Marcio: "pode liberar '
  'tudo pra IA, patrimonio, documentos, tudo"; vault 05 Decisoes/2026-09-17 - '
  'SIC-HF dossie completo liberado para a IA.md). NULL ate a 1a chamada de '
  'montarContextoCopiloto para esta sessao; a partir dai, o formato '
  'DossieCliente (types/copiloto.ts): faixa_patrimonio (rotulo, nunca valor), '
  'familiares (papel+nome+regime), patrimonio_tipos, documentos_recebidos, '
  'documentos_pendentes. NUNCA conteudo de documento (IR, contrato social) — '
  'so metadado, por orcamento de latencia (p95 do ciclo automatico), nao por '
  'LGPD. Montado 1x por sessao (server/copiloto/dossie.ts), nunca por ciclo — '
  'ver comentario de topo de contexto.ts.';


-- ===========================================================================
-- (b) Kill-switch — nasce TRUE (pedido explícito do dono, filosofia da
-- 0108: remover restrição, não empilhar trava nova).
-- ===========================================================================
insert into configuracoes (chave, valor, descricao) values
 ('copiloto_sessao.dossie_cliente', 'true'::jsonb,
  'Liga o dossie do cliente (familia/patrimonio/documentos) no contexto de IA '
  'do copiloto ao vivo (17/09/2026, decisao do Marcio — vault 05 Decisoes/'
  '2026-09-17 - SIC-HF dossie completo liberado para a IA.md). Nasce TRUE. '
  'FALSE faz server/copiloto/contexto.ts devolver dossie: null sem montar nem '
  'gravar nada nesta chamada (nao apaga sessoes_copiloto.dossie_cliente ja '
  'gravado de antes de desligar — reversao e so parar de MOSTRAR, nao '
  'apagar). Lido por lerConfiguracaoBool (server/ia/configuracao.ts).')
on conflict (chave) do nothing;
