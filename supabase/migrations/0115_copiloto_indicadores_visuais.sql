-- 0115_copiloto_indicadores_visuais.sql
-- Fase 12, Fatia C (pedido do dono, 17/09): interruptor do realce visual do
-- card de insight NÃO LIDO no painel do copiloto ao vivo
-- (`src/components/sessao/PainelCopiloto.tsx::CardRecente`).
--
-- 100% ADITIVA — nenhuma tabela/coluna/view/função/policy é criada ou
-- alterada. Só INSERT de 1 linha nova em `configuracoes` (0091), mesmo
-- padrão de toda a família `copiloto_sessao.*` (interruptor é DADO, não
-- constante em TS — muda sem deploy, §2.5 do plano do copiloto).
--
-- Numerada 0115 de propósito: a 0114 está sendo escrita EM PARALELO pelo
-- backend-engineer (executar-ia.ts/timeout 20s) — arquivo isolado evita
-- colisão de numeração entre as duas fatias em voo ao mesmo tempo.
--
-- NASCE 'true': o realce (borda esquerda 2px + fade de 150ms de
-- background-color) é a dose mínima que revoga PARCIALMENTE B71 ("nada
-- pisca, nada toca, nada abre sozinho", docs/ARQUITETURA-FASE-10.md:1379) —
-- decisão já tomada pelo dono nesta mesma tarefa, não uma feature aguardando
-- aprovação. Existe como chave (não constante) para poder desligar sem
-- deploy se a Dra. Elaine achar o fade um estímulo indesejado ao vivo.
--
-- 🔴 Leitura: NÃO IMPLEMENTADA. A chave é gravada mas ninguém a lê — o
-- realce é incondicional. Achado do pentester em 17/09, mantido de
-- propósito: registrar a ausência é melhor que sugerir um interruptor
-- que não existe. Hoje só documenta a decisão — nenhuma rota/componente desta
-- fatia LÊ esta chave ainda (o componente aplica o realce incondicionalmente
-- quando `naoLida=true`). Ligar a leitura de verdade é trabalho futuro,
-- registrado aqui para não inventar um 2º caminho de ligar/desligar.
--
-- EXPLAIN (ANALYZE, BUFFERS) — não aplicável: é um único INSERT em tabela já
-- existente e já indexada por PK (`configuracoes.chave text primary key`,
-- 0027), mesma forma do INSERT de 10 linhas da 0091 (medido naquela
-- migration: Index Scan puro, sub-ms). `on conflict (chave) do nothing`
-- torna a migration idempotente.
--
-- REVERSÃO:
--   delete from configuracoes where chave = 'copiloto_sessao.realce_insight_novo';
-- ===========================================================================

insert into configuracoes (chave, valor, descricao) values
 ('copiloto_sessao.realce_insight_novo', 'true'::jsonb,
  'Liga o realce visual (borda esquerda 2px + fade de 150ms de background-color) do card de insight NÃO LIDO no painel do copiloto ao vivo (Fase 12, Fatia C, 17/09). Documenta a decisão — nenhuma rota/componente lê esta chave hoje; o componente aplica o realce incondicionalmente. 🔴 ATENÇÃO (achado do pentester, 17/09): mudar esta chave para false NÃO desliga nada — NÃO existe kill-switch funcional para o realce. Suspender o efeito hoje exige deploy. A chave fica como ponto de ligação para quando CardRecente passar a lê-la; até lá, não prometa reversão sem deploy.')
on conflict (chave) do nothing;
