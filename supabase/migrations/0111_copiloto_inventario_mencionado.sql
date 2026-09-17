-- 0111_copiloto_inventario_mencionado.sql
--
-- 17/09/2026 — "anotar o que os decisores forem comunicando sobre empresas,
-- total de empresas e tudo mais... lógica de contagem com base nas empresas
-- que eles consideram como deles de fato" (pedido do dono). Reproduz o
-- padrão do script oficial da SV (PARTE 03: "levantar a lista de bens... EM
-- NOME DE QUEM?") e do dossiê de exemplo (`tmp/dossie-exemplo-maria.md` §5:
-- quantos · de quem · ordem de grandeza).
--
-- DIFERENTE da 0109 (dossiê CADASTRAL, já no banco antes da sessão): isto é
-- o que o DECISOR relata AO VIVO, acumulado sessão a sessão — pode não
-- existir cadastro nenhum por trás ainda.
--
-- O QUE ENTRA
--   (a) `sessoes_copiloto.inventario_acumulado jsonb` — NULL até o 1º item
--       de inventário que a IA propuser e o validador aceitar
--       (`server/copiloto/validar.ts` + `server/copiloto/inventario.ts`::
--       acumularInventarioNaSessao). Formato `ItemInventarioAcumulado[]`
--       (types/copiloto.ts) — array plano, upsert por chave interna
--       (categoria + descrição normalizada), NUNCA delete+insert (regra
--       "anti-piscada": item já registrado não some por não repetir na
--       janela de 90s mais recente).
--   (b) `configuracoes['copiloto_sessao.inventario_mencionado']` —
--       kill-switch do bloco G do contexto de IA (o RESUMO por categoria,
--       nunca a lista item a item — teto físico de latência). Nasce TRUE
--       (mesma filosofia fail-OPEN da 0109/0108: remoção de restrição, não
--       trava nova). FALSE faz `montarContextoCopiloto` devolver
--       `inventario_resumo: null` sem deixar de ACUMULAR (a rota/ciclo
--       continuam gravando itens novos mesmo com o bloco desligado na
--       leitura — desligar é sobre o que a IA VÊ, não sobre o que se grava;
--       reversão de exibição sem perder o levantamento já feito).
--
-- RLS/GRANT — NENHUM SCHEMA NOVO, NENHUMA TABELA NOVA (mesmo raciocínio da
-- 0109): `sessoes_copiloto` já tem RLS `force` com policies de
-- `app.ve_patrimonio()` (0091) cobrindo TODAS as colunas da tabela,
-- incluindo a nova (Postgres não tem RLS por coluna) — nenhuma policy nova
-- necessária. `configuracoes` (0027) já tem policy de leitura para
-- `authenticated` e escrita só por admin. `service_role` já tinha bypass de
-- RLS antes desta migration; nenhum GRANT novo é necessário.
--
-- MEDIÇÃO — `alter table ... add column if not exists` é DDL puro (coluna
-- nasce NULL para toda linha existente, custo O(1) em Postgres 11+, sem lock
-- exclusivo longo). O `insert ... on conflict (chave) do nothing` em
-- `configuracoes` usa a mesma PK já medida em migrations irmãs (0101, 0103,
-- 0106, 0108, 0109) — Conflict Arbiter Index `configuracoes_pkey`, 1 linha,
-- sem varredura.
--
-- ⚠️ Este agente NÃO tem acesso ao banco de produção nesta máquina e NÃO
-- buscou credencial nenhuma (regra da casa). Os planos acima são a
-- EXPECTATIVA (mesmos predicados já provados em produção pela 0109, que é o
-- MESMO desenho: `add column` aditivo em `sessoes_copiloto` + INSERT em
-- `configuracoes`), não uma medição nova desta rodada. RODAR
-- `begin; explain (analyze) ...; rollback;` fica PENDENTE — o dono tem MCP e
-- roda (ver ROTEIRO DE VERIFICAÇÃO abaixo).
--
-- ROTEIRO DE VERIFICAÇÃO (rodar dentro de `begin; ...; rollback;` — não
-- aplica nada):
--   0. PRÉ: select count(*) from sessoes_copiloto;  -- guardar o número
--   1. Coluna nova, NULL em toda linha existente:
--        select count(*) from sessoes_copiloto where inventario_acumulado is not null;  → 0
--   2. Kill-switch gravado, nasce TRUE:
--        select valor from configuracoes where chave = 'copiloto_sessao.inventario_mencionado';  → true
--   3. Reaplicar a migration inteira não duplica a chave nem falha no add column:
--        (rodar o bloco (a)+(b) de novo na mesma transação) → sem erro, `configuracoes` continua com 1 linha para a chave
--   4. `explain (analyze) update sessoes_copiloto set inventario_acumulado = '[]'::jsonb where sessao_id = <uuid real>;`
--      → Index Scan em `sessoes_copiloto_pkey` (sessao_id é PK, 0091) — colar a saída real.
--
-- ROLLBACK:
--   delete from configuracoes where chave = 'copiloto_sessao.inventario_mencionado';
--   alter table sessoes_copiloto drop column if exists inventario_acumulado;
-- ===========================================================================


-- ===========================================================================
-- (a) A coluna — jsonb, NULL até o 1º item aceito
-- (server/copiloto/inventario.ts::acumularInventarioNaSessao).
-- ===========================================================================
alter table sessoes_copiloto
  add column if not exists inventario_acumulado jsonb;

comment on column sessoes_copiloto.inventario_acumulado is
  '17/09/2026 — inventario patrimonial MENCIONADO NA FALA, acumulado sessao a '
  'sessao (pedido do dono: "lógica de contagem com base nas empresas que eles '
  'consideram como deles de fato"). Array de ItemInventarioAcumulado '
  '(types/copiloto.ts): categoria, descricao, titularidade, posse '
  '(propria/terceiro/incerta — so propria conta no total), valor_mencionado '
  '(texto como foi dito, nunca numero), evidencia (citacao literal), chave '
  '(dedupe), primeira_mencao_em, ultima_mencao_em. NULL ate o 1o item aceito '
  'pelo validador. Escrito por server/copiloto/inventario.ts::'
  'acumularInventarioNaSessao (upsert por chave, NUNCA delete+insert — item ja '
  'registrado nao some por nao repetir na janela de 90s mais recente). Lido '
  '(resumido por categoria, nunca item a item) por '
  'server/copiloto/contexto.ts (bloco G).';


-- ===========================================================================
-- (b) Kill-switch — nasce TRUE (mesma filosofia fail-OPEN da 0109/0108).
-- ===========================================================================
insert into configuracoes (chave, valor, descricao) values
 ('copiloto_sessao.inventario_mencionado', 'true'::jsonb,
  'Liga o RESUMO do inventario mencionado (bloco G) no contexto de IA do '
  'copiloto ao vivo (17/09/2026, pedido do dono — vault a registrar). Nasce '
  'TRUE. FALSE faz server/copiloto/contexto.ts devolver inventario_resumo: '
  'null nesta chamada (nao impede a ROTA/CICLO de continuar ACUMULANDO itens '
  'novos em sessoes_copiloto.inventario_acumulado — desligar e sobre o que a '
  'IA VE, nao sobre o que se grava). Lido por lerConfiguracaoBool '
  '(server/ia/configuracao.ts).')
on conflict (chave) do nothing;
