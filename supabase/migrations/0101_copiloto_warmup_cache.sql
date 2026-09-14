-- RENUMERADA de 0099 para 0101 em 14/09/2026: as 0099 e 0100 já existiam no
-- BANCO (remoção do gate jurídico e a chave de dispensa, aplicadas por MCP
-- no mesmo dia) e só agora viraram arquivo no repo. Numerar por cima teria
-- criado duas 0099 com conteúdos diferentes.
-- 0101_copiloto_warmup_cache.sql
-- Fase 10 · Fatia 3, correção de Otimização (medido em produção, 1ª sessão ao
-- vivo, docs/ARQUITETURA-FASE-10.md §4.3/§4.4). A 1ª chamada de IA de cada
-- sessão ESCREVE o prompt em cache e é sistematicamente mais lenta que as
-- seguintes — medido nas 8 execuções reais: 1 "escreveu cache" em 9.642 ms
-- (> TIMEOUT_COPILOTO_MS = 8.000 ms, `server/copiloto/executar-ia.ts`) contra
-- 7 "leu cache" em [2.766, 8.948] ms, média 5.623 ms. A primeira sugestão de
-- toda sessão é DESCARTADA por timeout — a advogada não vê nada logo na
-- abertura, que é justamente quando ela mais precisa se orientar.
--
-- CORREÇÃO: uma chamada de IA "de aquecimento", disparada no primeiro
-- segmento registrado (`POST .../copiloto/segmentos`, quando a sessão vira
-- 'ativo'), cujo ÚNICO efeito é escrever o prompt em cache — o resultado é
-- descartado, nunca vira `copiloto_sugestoes`. A PRIMEIRA sugestão REAL (do
-- ciclo automático, ~45s depois) já lê cache quente.
--
-- 100% ADITIVA. Nenhuma tabela, coluna, view, função ou policy existente é
-- ALTERADA. Só ACRESCENTA: 1 coluna em `sessoes_copiloto` (a claim) e 1 chave
-- nova em `configuracoes`.
--
-- O QUE ENTRA
--   (a) sessoes_copiloto.aquecido_em (timestamptz, nasce NULL) — a CLAIM de
--       "uma vez por sessão". `server/copiloto/warmup.ts` reivindica por
--       `update sessoes_copiloto set aquecido_em = now() where sessao_id =
--       $1 and aquecido_em is null` (count exact: >0 linha = claim ganha) —
--       atômico de `copiloto_ciclos` (0096: "a claim é o UPDATE/INSERT em
--       si, não um SELECT seguido de escrita, que teria janela de corrida
--       entre as duas idas ao banco"). NÃO reusa `copiloto_ciclos`: aquela
--       tabela tem `check (janela >= 0)` e o invariante de negócio "1 linha
--       = 1 janela de tempo REAL que o ciclo automático avaliou" (comentário
--       de 0096) — fabricar uma janela sentinela (`-1`) ali confundiria
--       auditoria futura ("essa sessão teve uma janela de tempo negativa?")
--       com uma coisa que não é isso: o warm-up não é um ciclo, não tem
--       gatilho, não tem bloco. Uma coluna na linha 1:1 por sessão que já
--       existe é o lugar mais simples e correto — mesmo raciocínio de
--       `pendencia_encerramento_bot`/`expurgo_segmentos_em` (0097/0098):
--       carimbo de UM evento que acontece no máximo uma vez por sessão.
--   (b) configuracoes['copiloto_sessao.warmup_ativo'] = 'true' — interruptor
--       PRÓPRIO, nascendo LIGADO (é otimização, não risco — diferente de
--       `copiloto_sessao.ativo`/`audio_ao_vivo`, que nascem 'false' porque
--       abrem superfície nova de risco). Desligável sem deploy: `update
--       configuracoes set valor='false' where chave =
--       'copiloto_sessao.warmup_ativo'`.
--
-- RLS/GRANT: a coluna nova em `sessoes_copiloto` já está coberta pela
-- policy/GRANT de 0091 (policy é por LINHA, não por coluna — mesma nota de
-- 0097/0098). Nenhum GRANT novo é necessário.
--
-- CUSTO DECLARADO: ~US$ 0,013 por sessão (1 chamada de escrita de cache,
-- medida na 1ª execução real). No teto de 30 chamadas/sessão
-- (`copiloto_sessao.teto_ia_sessao`), é ~4% do orçamento de uma sessão — o
-- warm-up É CONTADO nesse teto (usa `executarIaCopiloto`, que passa por
-- `executarComAuditoria`, que grava `execucoes_ia`; `conferirOrcamentoCopiloto`
-- conta todas as linhas de `execucoes_ia` do prompt `copiloto_sessao` na
-- sessão, sem distinguir warm-up de ciclo real — não há decisão de negócio
-- aqui em excluir o warm-up da conta: furar o teto para aquecer cache é
-- exatamente o que a regra da casa proíbe).
--
-- ROTEIRO DE VERIFICAÇÃO: `scripts/verificacao-0099.sql`.
--
-- ROLLBACK:
--   delete from configuracoes where chave = 'copiloto_sessao.warmup_ativo';
--   alter table sessoes_copiloto drop column if exists aquecido_em;
-- ===========================================================================


-- ===========================================================================
-- (a) A claim de "uma vez por sessão".
-- ===========================================================================
alter table sessoes_copiloto
  add column if not exists aquecido_em timestamptz;

comment on column sessoes_copiloto.aquecido_em is
  'Fase 10, correção de otimização (warm-up de cache, 0101). NULL = ainda não '
  'aqueceu. Carimbado por server/copiloto/warmup.ts via UPDATE condicional '
  '(where aquecido_em is null) no primeiro segmento registrado da sessão — '
  'claim atômica de "uma vez por sessão", duas abas não disparam dois '
  'warm-ups. A chamada de IA do warm-up é DESCARTADA (nunca vira '
  'copiloto_sugestoes); este carimbo é só a prova de que já rodou.';


-- ===========================================================================
-- (b) Interruptor — NASCE LIGADO (é otimização, não risco).
-- ===========================================================================
insert into configuracoes (chave, valor, descricao) values
 ('copiloto_sessao.warmup_ativo', 'true'::jsonb,
  'Liga o warm-up de cache: 1 chamada de IA descartável no primeiro segmento '
  'da sessão, só para a PRIMEIRA sugestão real já ler cache quente (medido: '
  '1ª chamada da sessão escreve cache em ~9,6s > timeout de 8s; as seguintes '
  'leem cache em ~5,6s). NASCE TRUE — é otimização, não risco. Desligar: '
  'copiloto_sessao.warmup_ativo=false em Admin (ou UPDATE direto). Custo '
  'declarado: ~US$0,013/sessão, ~4% do teto_ia_sessao (30). Contado no mesmo '
  'orçamento do ciclo automático — nunca fura o teto para aquecer cache.')
on conflict (chave) do nothing;
