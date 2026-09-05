-- 0066_croqui_narrativa.sql
-- ARQUITETURA-FASE-5.md §5.3, §6.1, §6.3 e §12 — Onda 2, agente M4.
--
-- Quatro coisas, TODAS ADITIVAS. Nenhum DELETE, nenhum DROP, nenhum UPDATE em
-- valor de linha de cliente, nenhuma alíquota semeada (B30 intacto):
--
--   (a) `configuracoes['croqui.uf_domicilio_vantajoso']` — a UF de domicílio
--       fiscal vantajoso do modelo de 2 células. `src/server/motor-croqui/
--       servico.ts:138` já lê esta chave; ela nunca foi criada (pendência que
--       o M1 deixou em aberto). Nasce `null`: sem UF cadastrada, o ITCMD da
--       2ª célula fica `ausente` NOMEANDO a falta — que é o comportamento
--       certo. Semear "MG" ou qualquer outra seria escolher planejamento
--       tributário por migration.
--
--   (b) `configuracoes['croqui.mapa_rubricas']` — o mapa que transforma uma
--       rubrica digitada do Cenário Patrimonial em override de célula do
--       motor (`servico.ts:172`). Nasce `{}` DE PROPÓSITO — ver o BLOQUEIO no
--       fim deste cabeçalho: com a chave atual (só o nome da rubrica) o mapa
--       não consegue distinguir o `itcmd` do cenário de inventário do `itcmd`
--       do cenário de doação, e um mapa errado sobrescreveria número certo em
--       silêncio. Vazio = mecanismo pronto, nenhum override aplicado.
--
--   (c) Prompt `agente_croqui_narrativa` v1, **ativo = false**. É o Agente do
--       Croqui v3: a IA deixa de calcular e passa a narrar o que o motor já
--       sabe. Ativar é UPDATE (via `ativar_prompt_versao`), sem deploy.
--
--   (d) Depreciações POR COMENTÁRIO (§12: "nada é apagado do banco"):
--       `cenarios_patrimoniais`, `cenario_rubricas` e `vw_cenarios_totais`
--       deixam de ser a porta de entrada do croqui e viram gaveta de
--       override; a v2 do `agente_croqui_analise` fica marcada como
--       inativável por tamanho de gramática.
--
-- ===========================================================================
-- TETO DE GRAMÁTICA — LEIA ANTES DE ATIVAR O PROMPT DE (c)
-- (CONTINUAR-AQUI.md §0 item 1; brain/04 - Tecnico/Custo da IA.md)
-- O provedor compila o JSON Schema estrito do lado dele e recusa com
-- `400 The compiled grammar is too large`. Medido em 04/09/2026 (briefing):
-- 3.905 bytes compila, 4.428 não. Isso NÃO aparece em tsc/eslint/build.
--
-- Bytes medidos nesta entrega, com
--   Buffer.byteLength(JSON.stringify(paraJsonSchemaEstrito(schema)))
--   (05/09/2026, `npx tsx scripts/medir-schema-narrativa.ts`):
--     croqui v1 (produção hoje) .......... 4.133 bytes
--     croqui v2 (0059, inativa) .......... 4.959 bytes
--     croqui v3 narrativa (esta) ......... 2.048 bytes  ✓ 47,6% abaixo do teto
--   A queda de 4.959 → 2.048 é o efeito do motor: sem número na saída, o
--   schema perde `historia`, `familia`, `patrimonio`, `empresas`, `objetivos`,
--   `riscos`, `croqui[]`, `disc`, `peso_na_decisao` e `categoria`.
--
-- RESULTADO DA SONDA DE REDE (colar aqui ANTES do UPDATE de ativação — regra
-- de publicação do §4.6 da Fase 4). Não rodou nesta rodada: não há
-- `OPENROUTER_API_KEY` no ambiente local (mesmo caso da 0059). A sonda também
-- ainda não conhece esta chave — ver PENDÊNCIA 2 no fim do arquivo.
--   POST /api/admin/sonda-schema {"chave":"croqui_narrativa"}
--     → sonda AAAA-MM-DD · croqui_narrativa · ____ bytes · ____________
--
-- ===========================================================================
-- ROTEIRO DE VERIFICAÇÃO (rodar como service_role, na ordem)
--
--   0. PRÉ — nada colide:
--      select chave from configuracoes
--       where chave in ('croqui.uf_domicilio_vantajoso','croqui.mapa_rubricas');
--      → 0 linhas (se vier linha, o `on conflict do nothing` preserva a sua;
--        confira o valor antes de seguir).
--      select versao, ativo from prompts_versoes where chave = 'agente_croqui_narrativa';
--      → 0 linhas.
--
--   1. Depois de aplicar:
--      select chave, valor from configuracoes
--       where chave in ('croqui.uf_domicilio_vantajoso','croqui.mapa_rubricas');
--      → 'croqui.mapa_rubricas' = {} · 'croqui.uf_domicilio_vantajoso' = null
--
--   2. select chave, versao, ativo, modelo_padrao, effort,
--             length(corpo_sistema) as corpo,
--             octet_length(esquema_saida::text) as esquema
--        from prompts_versoes where chave = 'agente_croqui_narrativa';
--      → 1 linha · versao 1 · ativo FALSE · anthropic/claude-sonnet-5 · medium
--
--   3. O ativo do croqui NÃO mudou (esta migration não ativa nada):
--      select chave, versao from prompts_versoes where ativo;
--      → `agente_croqui_analise` continua na versão que estava (1).
--
--   4. Reaplicar a migration inteira não duplica (idempotente):
--      → repetir 1 e 2; mesmas contagens.
--
--   5. Comentários de depreciação chegaram:
--      select obj_description('cenarios_patrimoniais'::regclass) is not null
--           , obj_description('vw_cenarios_totais'::regclass) is not null;
--      → t · t
--
-- REVERSÃO COMPLETA (nada aqui é destrutivo para dado de cliente):
--   delete from prompts_versoes where chave = 'agente_croqui_narrativa' and versao = 1;
--   delete from configuracoes
--    where chave in ('croqui.uf_domicilio_vantajoso','croqui.mapa_rubricas');
--   comment on table cenarios_patrimoniais is null;
--   comment on table cenario_rubricas is null;
--   comment on view  vw_cenarios_totais is null;
--   -- (o comentário anterior destas três era nulo; conferido em 05/09/2026)
--
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- (a) e (b) — as duas configurações que o motor já lê e que não existiam
-- ---------------------------------------------------------------------------

insert into configuracoes (chave, valor, descricao) values
  ('croqui.uf_domicilio_vantajoso', 'null'::jsonb,
   'UF de domicílio fiscal vantajoso usada pelo modelo de 2 células (sigla, ex.: "MG"). NULL = não escolhida: o ITCMD da 2ª célula nasce ausente nomeando a falta, nunca zero. Decisão de planejamento tributário do escritório — não pode ser semeada por migration.'),
  ('croqui.mapa_rubricas', '{}'::jsonb,
   'Mapa rubrica do Cenário Patrimonial -> célula do motor: {"<rubrica>":{"tabela":"celula_3","linha":"itcmd","coluna":"valor"}}. VAZIO até a chave passar a carregar o cenário ("<cenario>.<rubrica>"): hoje o mesmo nome de rubrica existe em inventário, doação e nas três células, e um mapa por nome sobrescreveria a célula errada em silêncio. Vazio = nenhum override aplicado; o Cenário Patrimonial continua funcionando como está.')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------------
-- (c) Agente do Croqui v3 — narrativa. INATIVO.
-- ---------------------------------------------------------------------------
-- `modelo_padrao` = sonnet, não opus: narrar tabela pronta é tarefa de modelo
-- proporcional (§6.3). NÃO usar um slug mais barato ainda sem antes semear
-- `modelos_ia_precos` — sem preço, `execucoes_ia` grava custo nulo e a
-- medição de "o roteamento valeu a pena" fica cega, que é justamente o que a
-- decisão de §6.3 quer provar.
--
-- `effort` = medium: a decisão difícil (arquitetura, economia, o que é
-- ausente) já foi tomada pelo motor. Alto aqui é gastar raciocínio para
-- reescrever texto.

insert into prompts_versoes (chave, versao, titulo, corpo_sistema, esquema_saida, modelo_padrao, effort, ativo, notas)
values (
  'agente_croqui_narrativa',
  1,
  'Agente do Croqui — Narrativa v3 (a IA narra; o motor calcula)',
  $prompt$Você é o Agente do Croqui do Sistema de Inteligência para Conversão em Holding
Familiar (SIC-HF), do escritório da Dra. Elaine Montenegro.

Você atua DEPOIS da Sessão de Viabilidade, com o Croqui Estrutural já contratado.
Não confunda com o Briefing Estratégico, que atua antes da sessão.

O QUE MUDOU, E É A REGRA MAIS IMPORTANTE DESTA VERSÃO
Você NÃO calcula. Um motor determinístico já produziu todas as tabelas do croqui
(família, patrimônio, inventário hoje e após a reforma, doação, 1/2/3 células,
operacional, aluguéis, comparativo, ITBI, payback, horas, honorários, deduções,
pagamento, acompanhamento), com procedência célula a célula e versão gravada.
Elas chegam prontas no contexto.

Seu trabalho é a CONDUÇÃO: como apresentar cada tabela, que pergunta fazer, que
objeção esperar, como fechar.

PROIBIÇÕES ABSOLUTAS
1. Não recalcule, não some, não arredonde, não estime, não converta nenhum número.
   Se precisar citar um valor, copie exatamente como está na tabela.
2. "—" significa que o parâmetro NÃO está cadastrado. É proibido inventar,
   aproximar ou dizer "aproximadamente zero" no lugar dele. Fale da ausência:
   "falta a alíquota de ITCMD desta UF para fechar esta linha". Toda célula
   ausente que você mencionar tem de aparecer também em `lacunas`.
3. Números em divergência (duas versões no material do escritório) não se
   escolhem. Trate como ponto a validar com a Dra. Elaine.
4. Nada genérico. Toda afirmação presa a evidência do contexto — tabela,
   briefing ou relatório da sessão. Sem evidência, diga que não há.
5. Não invente dado da família, do patrimônio ou da empresa. O que não está no
   contexto não existe.

COMO ESCREVER
- `como_apresentar`: uma entrada por tabela que a advogada vai mostrar, na
  ordem. Cada texto é a fala de condução daquele slide, em até 3 frases, na
  segunda pessoa ("mostre primeiro o total, depois pergunte…"). É nota de
  apresentador, não legenda de slide.
- `arquitetura`: recomende 1, 2 ou 3 células — ou `ponto_a_validar` quando o
  contexto não sustenta a escolha. `justificativa` prende a recomendação aos
  números das tabelas e ao perfil da família. Os 9 `criterios` são obrigatórios
  e respondidos um a um; critério sem evidência recebe resposta dizendo isso.
- `perguntas`: perguntas de validação para fazer na reunião, cada uma com o
  motivo (o que a resposta muda na estrutura).
- `objecoes`: a objeção provável na linguagem do cliente, e a resposta
  recomendada — sempre ancorada em número da tabela ou em risco concreto.
- `fechamento`: como conduzir a decisão ao final, sem pressão e sem promessa
  que o croqui não sustenta.
- `grau_confianca`: 0 a 100. Contexto ralo ou muitas células ausentes derruba
  o grau — dizer 90 com meia tabela ausente é o erro mais caro que você pode
  cometer aqui.
- `lacunas`: tudo o que você NÃO pôde afirmar, incluindo cada parâmetro
  ausente que trava uma tabela.

TOM
A Sessão de Viabilidade é diagnóstico, não venda; o Croqui é prescrição
técnica, não produto. Escreva como um técnico sênior preparando outro técnico
para uma conversa difícil com uma família — não como material de marketing.$prompt$,
  '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"como_apresentar":{"type":"array","items":{"type":"object","properties":{"tabela":{"type":"string","enum":["composicao_familiar","formacao_patrimonial","inventario_atual","levantamento_inventario","inventario_reforma","doacao","celula_1","celula_2","celula_3","operacional_pj","payback","operacional_locacao","comparativo_geral","itbi","horas_por_ato","honorarios","deducoes","pagamento","membership"]},"texto":{"type":"string"}},"required":["tabela","texto"],"additionalProperties":false}},"arquitetura":{"type":"object","properties":{"recomendacao":{"type":"string","enum":["celula_1","celula_2","celula_3","ponto_a_validar"]},"justificativa":{"type":"string"},"criterios":{"minItems":9,"maxItems":9,"type":"array","items":{"type":"object","properties":{"criterio":{"type":"string","enum":["quantidade_de_nucleos_familiares","empresa_operacional_relevante","imoveis_de_renda","patrimonio_pessoal_relevante","concentracao_em_empresa","niveis_diferentes_de_participacao_dos_herdeiros","fundador_deseja_permanecer_no_controle","necessidade_de_separar_patrimonio_gestao_e_destino","beneficio_justifica_a_complexidade"]},"resposta":{"type":"string"}},"required":["criterio","resposta"],"additionalProperties":false}}},"required":["recomendacao","justificativa","criterios"],"additionalProperties":false},"perguntas":{"type":"array","items":{"type":"object","properties":{"pergunta":{"type":"string"},"motivo":{"type":"string"}},"required":["pergunta","motivo"],"additionalProperties":false}},"objecoes":{"type":"array","items":{"type":"object","properties":{"objecao":{"type":"string"},"resposta_recomendada":{"type":"string"}},"required":["objecao","resposta_recomendada"],"additionalProperties":false}},"fechamento":{"type":"string"},"grau_confianca":{"type":"integer"},"lacunas":{"type":"array","items":{"type":"string"}}},"required":["como_apresentar","arquitetura","perguntas","objecoes","fechamento","grau_confianca","lacunas"],"additionalProperties":false}'::jsonb,
  'anthropic/claude-sonnet-5',
  'medium',
  false,
  'Fase 5 §6.1. Contrato em src/server/ia/schema-croqui-narrativa.ts. Gramática 2.048 bytes (medida em 05/09/2026 por scripts/medir-schema-narrativa.ts) — 47,6% abaixo do teto conhecido de 3.905. INATIVO: ativar só depois da bancada e com o resultado da sonda de rede colado no cabeçalho desta migration. Modelo sonnet por roteamento de tarefa (§6.3): narrar tabela pronta não pede o modelo forte; trocar por slug mais barato exige semear modelos_ia_precos antes.'
)
on conflict (chave, versao) do nothing;

-- ---------------------------------------------------------------------------
-- (d) Depreciações por comentário — nada sai do banco
-- ---------------------------------------------------------------------------

comment on table cenarios_patrimoniais is
  'DEPRECADA COMO PORTA DE ENTRADA (Fase 5 §5.2, 05/09/2026). O croqui passa a nascer do motor determinístico (croqui_calculos, 0063), que calcula as 19 tabelas a partir de patrimonio_itens + parametros_metodo. Esta tabela continua VÁLIDA e em uso como gaveta de override: rubrica digitada aqui entra no motor como célula `digitado` quando configuracoes[''croqui.mapa_rubricas''] a mapear. Nada foi apagado e nada deve ser.';

comment on table cenario_rubricas is
  'DEPRECADA COMO PORTA DE ENTRADA (Fase 5 §5.2). Ver o comentário de cenarios_patrimoniais. A procedência (digitado/calculado/ausente) desta tabela é a MESMA do motor, de propósito: override gravado aqui vira célula `digitado` sem tradução.';

comment on view vw_cenarios_totais is
  'DEPRECADA COMO FONTE DO CROQUI (Fase 5 §5.2). O total do croqui passa a sair de croqui_calculos.resultado (motor determinístico, procedência por célula). A view continua servindo a tela do Cenário Patrimonial e a regra "parcela ausente não vira total" que o motor reimplementa em TypeScript.';

update prompts_versoes
   set notas = coalesce(notas || ' ', '') ||
     '[DEPRECADO em 05/09/2026, Fase 5 §6.1] Substituído pelo agente_croqui_narrativa v1: o motor calcula, a IA narra. Esta v2 nunca foi ativada — gramática de 4.959 bytes, acima do teto de 3.905 do provedor. Mantida como registro; não ativar.'
 where chave = 'agente_croqui_analise'
   and versao = 2
   and coalesce(notas, '') not like '%[DEPRECADO em 05/09/2026%';

-- ===========================================================================
-- PENDÊNCIAS REGISTRADAS (não são trabalho desta migration)
--
-- 1. BLOQUEIO — `croqui.mapa_rubricas` só pode ser preenchido depois que
--    `lerOverrides` (src/server/motor-croqui/servico.ts:169) passar a
--    selecionar `cenarios_patrimoniais.cenario` e a chave do mapa virar
--    "<cenario>.<rubrica>". Hoje a query casa só por nome de rubrica: o
--    `itcmd` do cenário de doação e o do cenário de inventário são a mesma
--    chave, e o override cairia na célula errada. É uma linha no `select` do
--    M1 + a chave composta no mapa. Enquanto não for feito, o mapa fica {} e
--    NENHUM override é aplicado — que é o estado seguro.
--
-- 2. A sonda `POST /api/admin/sonda-schema` não conhece a chave
--    'croqui_narrativa' (o CHAVES dela está em src/app/api/admin/
--    sonda-schema/route.ts, fora da fronteira do M4). Uma linha:
--      croqui_narrativa: { schema: CroquiNarrativaSchema, descricao: '...' }
--    Até lá, a medição local (scripts/medir-schema-narrativa.ts) usa a mesma
--    fórmula e roda sem chave de API — mas só a sonda prova que COMPILA.
--
-- 3. `configuracoes['croqui.horas_por_ato']` continua VAZIA (semeada assim
--    pela 0062). Sem os 21 atos × 50/47/35 h, T15 e T16 nascem ausentes e,
--    em cascata, T7/T8/T9 ficam sem honorário — nenhum croqui fecha. É
--    cadastro em Admin -> Parâmetros, não migration: os valores são do
--    escritório e mudam sem deploy.
-- ===========================================================================
