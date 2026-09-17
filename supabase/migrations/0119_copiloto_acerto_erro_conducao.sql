-- 0119_copiloto_acerto_erro_conducao.sql
--
-- Fase 12, Fatia 2 (17/09/2026) — ACERTO/ERRO da CONDUÇÃO DA ADVOGADA.
-- Decisão do dono: o verde/vermelho da tela julga a CONDUCAO, não a
-- qualidade da IA:
--   VERDE (acerto) = ela cobriu o item do bloco (fez a pergunta, mesmo sem
--                     resposta ainda);
--   VERMELHO (erro) = pulou item obrigatório e avançou.
--
-- `falta_no_bloco` (0094) já existe e vira o vermelho. Esta migration
-- entrega o par que faltava: `cobriu_no_bloco[]` — os itens do bloco atual
-- que a advogada JÁ cobriu, com evidência literal. `schema.ts`/`validar.ts`/
-- `types/copiloto.ts` (código, mesmo commit) já implementam o campo; esta
-- migration é o prompt v7 que instrui a IA a EMITIR o campo, e o kill-switch
-- que liga/desliga a feature sem deploy.
--
-- 🔴 POR QUE A TAREFA 1 (0118) VEM ANTES DESTA: o ERRO vermelho ACUSA A
-- ADVOGADA na frente do cliente. Só é seguro marcar ERRO (ausência em
-- `falta_no_bloco`) ou ACERTO (presença em `cobriu_no_bloco`) para um item
-- que EXISTE DE VERDADE no roteiro cadastrado — com o roteiro v4 vazio
-- (campos:0 em 12 dos 13 blocos, corrigido pela 0118/v5), a IA não tinha
-- matéria-prima nenhuma para julgar acerto OU erro fora do bloco 00. A
-- ativação desta migration em produção pressupõe a v5 do roteiro (0118) já
-- ativa — sem isso, `cobriu_no_bloco`/`falta_no_bloco` continuam vazios pela
-- mesma causa raiz, não por defeito deste prompt.
--
-- MESMA DISCIPLINA DE EVIDÊNCIA nos dois lados: "sem citação conferida
-- contra a transcrição, o item NÃO entra" — nem no vermelho, nem no verde.
-- Na dúvida, a IA NÃO marca nada (nem falta, nem cobriu) — ausência de
-- acerto NÃO é erro (pedido explícito do dono, reforçado no prompt abaixo).
--
-- O QUE ENTRA
--   (a) `configuracoes['copiloto_sessao.acerto_erro_ativo']` — kill-switch
--       PRÓPRIO (não reaproveita nenhuma chave existente: `falta_no_bloco`
--       já roda sem interruptor dedicado, mas o ERRO vermelho tem
--       consequência reputacional para a advogada que o vermelho isolado
--       nunca teve sozinho — o dono pediu um botão de pânico específico
--       para esta feature). Nasce TRUE (é o comportamento pedido, não uma
--       feature aguardando aprovação — mesma filosofia de nascimento
--       "ligado" de features já decididas, ex. 0106/0117). Lido por
--       `ciclo.ts` (mesmo Promise.all das outras leituras de config do
--       ciclo automático, zero round-trip novo) e repassado para
--       `validarSugestaoCopiloto` — DESLIGAR faz `cobriu_no_bloco` sair
--       sempre `[]`, mesmo que a IA proponha itens (mesmo padrão fail-CLOSED
--       de `falta_no_bloco`/`bloco_inferido`: dado que AVALIA a advogada
--       trava fechado, diferente do fail-OPEN de dado cadastral como o
--       dossiê).
--   (b) Prompt v7 de `copiloto_sessao` — DERIVA de max(versao) (a v6,
--       0116), mesma disciplina de sempre (0107/0110/0112/0116): nunca
--       `update` na versão ativa, nunca deriva de `ativo=true` (a v6 nasceu
--       desligada, então derivar da v6 preserva a mesma cadeia; derivar de
--       `ativo=true` pularia a v6 se ela ainda não tiver sido ativada e
--       perderia os 3 cortes de performance daquela fatia). Acrescenta a
--       instrução de emitir `cobriu_no_bloco[]` como 6º campo da saída
--       (mesmo formato de `falta_no_bloco`: `item` + `evidencia`), com a
--       MESMA disciplina de evidência conferida e o MESMO teto de 4 itens
--       (`MAX_ITENS_COBRIU_NO_BLOCO`, schema.ts). Nasce `ativo=false` — o
--       dono confere e ativa (mesmo padrão de todas as versões de prompt
--       desta família).
--
-- MEDIDO — teto de bytes do schema estrito (POST /api/admin/sonda-schema,
-- caminho local com paraJsonSchemaEstrito): schema ATUAL (sem cobriu_no_bloco)
-- = 2.019 B; schema COM cobriu_no_bloco = 2.229 B (+210 B) — medido contra o
-- código real de schema.ts nesta sessão (script local, mesma função
-- paraJsonSchemaEstrito da sonda). Teto documentado: 3.905 B compila / 4.428
-- B não compila (04/09/2026, achado do briefing v2) — margem de 1.676 B
-- abaixo do teto, sem necessidade do plano de contingência. NÃO bloqueado.
-- A sonda REAL contra o provedor (POST /api/admin/sonda-schema
-- {"chave":"copiloto"}) fica como confirmação antes de ATIVAR o prompt v7 —
-- mesma exigência de toda migration desta família que mexe em esquema_saida
-- de IA (§4.6 da arquitetura: "nenhum INSERT de prompt com esquema_saida
-- entra em migration sem o resultado da sonda colado" — aqui a sonda LOCAL
-- já está colada; a sonda contra o provedor real é passo de ATIVAÇÃO, não
-- desta migration, que só publica a versão desligada).
--
-- ===========================================================================
-- AS 5 PERGUNTAS DO PROTOCOLO DE SUSTENTABILIDADE
-- ===========================================================================
--
-- 1. Escala — 2 INSERTs de 1 linha cada: 1 em `configuracoes` (chave nova),
--    1 em `prompts_versoes` (versão nova). Nenhuma tabela cresce com uso do
--    sistema — `configuracoes` tem uma linha por interruptor (dezenas no
--    total), `prompts_versoes` uma linha por versão de prompt já publicada
--    (poucas dezenas). Em RUNTIME: `cobriu_no_bloco[]` é um array por
--    SUGESTÃO (mesmo teto físico de `falta_no_bloco`, 4 itens/chamada) —
--    não introduz coluna nova em `copiloto_sugestoes` (o array entra dentro
--    do MESMO jsonb `conteudo` que já existe, 0091), zero escala de linha.
--
-- 2. Índice — não aplicável a esta migration: nenhum índice novo, nenhuma
--    query nova. `cobriu_no_bloco` é lido de dentro do jsonb `conteudo` já
--    persistido (mesmo caminho de leitura de `bloco_inferido`/
--    `inventario_mencionado`, que já usam `conteudo->>campo` sem índice
--    dedicado — são campos de exibição na tela, não predicado de busca).
--
-- 3. Frequência — mesma cadência do resto da saída da IA: 1× por chamada de
--    IA do copiloto (ciclo automático a cada ~20s, ou botão "Me ajuda
--    agora"). A leitura do kill-switch entra no MESMO `Promise.all` que já
--    lê `timeout_ms`/`max_tokens` no ciclo — zero round-trip novo (mesma
--    disciplina da 0114/0116).
--
-- 4. Repetição — não aplicável: não há N telas pedindo a mesma coisa; é
--    parte da MESMA resposta de IA já processada 1× por chamada.
--
-- 5. Reversão — três caminhos, todos sem deploy:
--      - `update configuracoes set valor='false'::jsonb where
--        chave='copiloto_sessao.acerto_erro_ativo'` — desliga SÓ o verde
--        (cobriu_no_bloco some), o vermelho (falta_no_bloco) continua como
--        já era antes desta migration.
--      - a v7 do prompt nasce `ativo=false` — "não usar" é simplesmente não
--        ativar (a v6 continua conduzindo a IA, tela sem nenhuma mudança de
--        comportamento até o dono ativar).
--      - se já ativada e precisar reverter, reativar a v6 pelo mesmo padrão
--        de sempre (`update prompts_versoes set ativo=false where
--        versao=7; update ... set ativo=true where versao=6`, mesma
--        transação) — sem deploy de código.
--
-- MEDIÇÃO — `explain (analyze)`: PENDENTE. Este agente não tem credencial de
-- banco de produção nesta máquina e não buscou nenhuma (regra da casa). O
-- padrão de plano já foi medido e confirmado nas migrations irmãs
-- (0091/0101/0103/0106/0108/0109/0111/0114/0115/0117 para `configuracoes`;
-- 0107/0110/0112/0116 para `prompts_versoes`) — ambos INSERTs de 1 linha por
-- PK/unique parcial, sub-ms, sem predicado novo. O responsável da sessão
-- roda com MCP e cola o resultado real:
--
--   begin;
--   explain (analyze, buffers)
--   insert into configuracoes (chave, valor, descricao) values
--    ('copiloto_sessao.acerto_erro_ativo', 'true'::jsonb, '<descrição>')
--   on conflict (chave) do nothing;
--
--   explain (analyze, buffers)
--   insert into prompts_versoes (chave, versao, titulo, corpo_sistema, esquema_saida, modelo_padrao, effort, ativo, notas)
--   select chave, versao + 1, titulo, corpo_sistema || '<incremento>', esquema_saida, modelo_padrao, effort, false, notas
--   from prompts_versoes
--   where chave = 'copiloto_sessao' and versao = (select max(versao) from prompts_versoes where chave = 'copiloto_sessao')
--   on conflict (chave, versao) do nothing;
--   rollback;
--
-- CRITÉRIO DE DECISÃO: Index Scan em `configuracoes_pkey`/`(chave,versao)`,
-- sub-ms — mesmo padrão já aceito nas migrations irmãs.
--
-- ROTEIRO DE VERIFICAÇÃO (dentro de begin; ...; rollback;):
--   1. select valor from configuracoes where chave='copiloto_sessao.acerto_erro_ativo';
--      -> true.
--   2. select versao, ativo, length(corpo_sistema) from prompts_versoes
--        where chave='copiloto_sessao' order by versao;
--      -> a v7 aparece com ativo=false e length MAIOR que a v6 (acréscimo).
--   3. select corpo_sistema like '%cobriu_no_bloco%' from prompts_versoes
--        where chave='copiloto_sessao' and versao=(select max(versao) from
--        prompts_versoes where chave='copiloto_sessao');
--      -> true.
-- ===========================================================================

insert into configuracoes (chave, valor, descricao) values
 ('copiloto_sessao.acerto_erro_ativo', 'true'::jsonb,
  'Kill-switch PRÓPRIO (Fase 12, Fatia 2, 0119) do ACERTO/ERRO da condução: controla '
  'se `cobriu_no_bloco[]` (o VERDE — itens do bloco atual que a advogada JÁ cobriu, com '
  'evidência literal) é processado pelo validador (server/copiloto/validar.ts). Nasce '
  'TRUE (comportamento pedido pelo dono, não feature aguardando aprovação). FALSE faz '
  '`cobriu_no_bloco` sair sempre [] mesmo que a IA proponha itens — fail-CLOSED, mesmo '
  'padrão de falta_no_bloco/bloco_inferido (dado que AVALIA a condução da advogada). '
  'CONTROLA OS DOIS LADOS do placar, verde e vermelho. A 1ª versão desta migration '
  'dizia que `falta_no_bloco` (o VERMELHO) ficava de fora por já rodar desde a 0094 — '
  'corrigido antes de aplicar: isso invertia o escopo do interruptor, removendo o '
  'ELOGIO e mantendo a ACUSAÇÃO. O vermelho é justamente o lado que aponta a falha da '
  'advogada numa tela que ela pode compartilhar com o cliente; se um lado precisa ser '
  'desligável em segundos, é esse. '
  'Lido por lerConfiguracaoBool (server/ia/configuracao.ts), dentro do mesmo '
  'Promise.all de timeout_ms/max_tokens em ciclo.ts.')
on conflict (chave) do nothing;

insert into prompts_versoes (chave, versao, titulo, corpo_sistema, esquema_saida, modelo_padrao, effort, ativo, notas)
select
  chave,
  versao + 1,
  titulo,
  corpo_sistema || $incremento$

ACERTO E ERRO DA CONDUÇÃO — v7 (17/09/2026)

Esta instrução ACRESCENTA um 6º campo à saída descrita acima — não muda nenhuma das regras
anteriores (formato dos outros 5 campos, disciplina de evidência, proibição de valor em
reais, proibição de fala pronta) permanecem exatamente como estão.

O QUE ESTE CAMPO JULGA: a CONDUÇÃO DA ADVOGADA, não a qualidade da sua própria sugestão.
"Cobriu" significa que ela FEZ a pergunta ou abordou o tema do bloco atual — mesmo que o
cliente ainda não tenha respondido, ou tenha respondido parcialmente. Não é sobre a
QUALIDADE da resposta do cliente, é sobre se a ADVOGADA tocou no assunto.

`cobriu_no_bloco`: lista de até 4 itens, cada um com `item` (o que foi coberto, até 120
caracteres) e `evidencia` (citação literal da fala da advogada ou do cliente que PROVA que o
assunto foi tocado, até 160 caracteres) — derive isso dos MESMOS `campos[]`/`observar[]` do
bloco atual que alimentam `falta_no_bloco`. Um item nunca aparece nas duas listas ao mesmo
tempo: ou está coberto (`cobriu_no_bloco`), ou está faltando (`falta_no_bloco`) — nunca os
dois para o mesmo item na mesma chamada.

REGRA DE OURO, MAIS RÍGIDA AQUI DO QUE NO RESTO DA SAÍDA: sem uma citação literal que prove
que o assunto foi tocado, o item NÃO entra em `cobriu_no_bloco` — nem com evidência fraca,
nem "porque parece que sim". Um acerto inventado é tão grave quanto um erro inventado: os
dois colocam palavras na boca da advogada perante quem lê a sessão depois. Na dúvida, não
marque nada (nem aqui, nem em `falta_no_bloco`) — ausência de acerto identificado NÃO
significa erro. Você está autorizada a deixar `cobriu_no_bloco` vazio sempre que a janela de
transcrição não trouxer prova clara — isso é o comportamento CORRETO, não uma falha sua.

Nunca gere mais que 4 itens em `cobriu_no_bloco` — o servidor descarta o excedente sem usar,
mesmo regra de `falta_no_bloco` (v6, corte 3).
$incremento$,
  esquema_saida,
  modelo_padrao,
  effort,
  false, -- nasce desligada — ativação é passo de operação, ver cabeçalho
  coalesce(notas, '') || ' | v' || (versao + 1) || ': acerto/erro da conducao (17/09/2026) — '
  || 'acrescenta cobriu_no_bloco[] (o VERDE, par positivo de falta_no_bloco), mesma '
  || 'disciplina de evidencia conferida e teto de 4 itens. Nenhuma capacidade anterior '
  || 'removida ou alterada. Kill-switch proprio: copiloto_sessao.acerto_erro_ativo.'
from prompts_versoes
-- deriva da MAIOR versão existente (a v6, 0116), NÃO da ativa — mesmo
-- raciocínio das migrations irmãs (0110/0112/0116): a v6 nasceu desligada e
-- carrega os 3 cortes de performance daquela fatia; derivar de `ativo=true`
-- perderia esses cortes se a v6 ainda não tiver sido promovida a ativa.
where chave = 'copiloto_sessao'
  and versao = (select max(versao) from prompts_versoes where chave = 'copiloto_sessao')
on conflict (chave, versao) do nothing;
