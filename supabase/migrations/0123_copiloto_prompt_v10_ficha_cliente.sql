-- 0123_copiloto_prompt_v10_ficha_cliente.sql
--
-- 18/09/2026 — prompt do copiloto: FICHA DO CLIENTE (migration 0122) precisa
-- de TRÊS instruções novas na IA. A economia de raciocínio do prompt já está
-- na versão anterior (0121/v9) — esta migration NÃO repete nem reescreve
-- nada do que já existe, só ACRESCENTA.
--
-- 🔴 CORRIGIDO (achado do Fable, 2ª rodada): este arquivo divergia da v10 já
-- aplicada em produção — a instrução (iii) abaixo foi acrescentada ao corpo
-- do prompt em produção por achado do `security-pentester` (papel do falante
-- na Ficha/Inventário) DEPOIS deste arquivo ter sido escrito, e o arquivo
-- nunca foi atualizado para bater. Corrigido aqui para o arquivo refletir
-- exatamente o que está em `prompts_versoes` (chave `copiloto_sessao`,
-- versão 10) — mesma fonte usada para conferir, nunca reescrita de memória.
--
-- (i) `observacao` RESTRITA AO CONTRATO — proibir navegação explicitamente,
--     com o motivo escrito no próprio texto da instrução (não só no
--     comentário desta migration, para o modelo entender O PORQUÊ, não só
--     A REGRA): medido na sessão real que motivou o pedido do dono, 74% das
--     `observacao` geradas eram sobre navegação ("a conversa já avançou
--     para o próximo bloco...", "ainda estamos no bloco de patrimônio..."),
--     que `desvio_sugerido` JÁ entrega de forma estruturada (com
--     `bloco_id`/`motivo`/`confianca`, nunca texto livre). Na tela NOVA
--     (Ficha do cliente ocupando o espaço que antes era da aba de
--     observações soltas), esse tipo de `observacao` perde o ÚLTIMO
--     consumidor que ainda a lia — sem esta proibição, a IA continuaria
--     gastando o campo com um conteúdo que não tem mais onde aparecer.
--
-- (ii) `ficha_cliente[]` — instrução de COMO preencher o campo estruturado
--      novo (`server/copiloto/schema.ts::ItemFichaClienteSchema`, já existe
--      no schema estrito desde que este agente o acrescentou nesta mesma
--      entrega — 0123 é só o texto que ENSINA a IA a usá-lo, mesma separação
--      de responsabilidade de toda migration desta família: schema é
--      código, instrução é prompt): evidência literal OBRIGATÓRIA (mesma
--      disciplina de TODOS os campos com evidência deste contrato), teto de
--      2 itens por chamada, as 4 categorias fechadas (dor/objeção/desejo/
--      fato_decisor) com um exemplo de CADA uma tirado da sessão real que
--      motivou o pedido ("eu vou perder qualidade de vida" = dor; "imposto
--      de renda é 30 por 100" = objeção; "40 40 10 e 10" = desejo — partilha
--      pretendida entre herdeiros).
--
-- (iii) SÓ O DECISOR ENTRA NA FICHA E NO INVENTÁRIO — achado do
--       `security-pentester` em produção: sem esta regra, uma fala do
--       acompanhante ou até da própria advogada (quando `papeis_de_fala`
--       identifica o falante) poderia virar item de Ficha/Inventário como se
--       fosse relato do decisor sobre a própria vida/patrimônio. Usa a MESMA
--       nomenclatura de papel já resolvida por `participantes.ts`/
--       `entrada-bot.ts` (`advogada`/`decisor_N`/`acompanhante_N`/
--       `participante`) — nenhum conceito novo, só uma restrição de USO
--       sobre um dado que a IA já recebe na janela de transcrição quando
--       `copiloto_sessao.papeis_de_fala` está ligado (0103). Fail-OPEN
--       quando o papel do falante não é conhecido (mesmo critério dos
--       demais campos deste contrato: ausência de papel não é motivo para
--       deixar de registrar um fato com evidência literal clara).
--
-- MESMO PADRÃO DA 0107/0110/0112/0116/0119/0121 (regra da casa, sem
-- exceção): NUNCA `update` na versão ativa. Cria a versão nova por
-- `INSERT ... SELECT`, DERIVANDO do `max(versao)` — NÃO de `ativo = true`.
-- Isso vale mesmo que a versão mais recente publicada não tenha migration
-- própria neste repositório (aplicada direto em produção por uma sessão
-- anterior — mesmo precedente já registrado em 0105/0119/0121: "aplicada em
-- produção via apply_migration"). 🔴 CORRIGIDO (achado do Fable, 2ª rodada):
-- a versão ATIVA medida em produção é a v7, não a v8 — a v8 (0119) e a v9
-- (0121, memória do copiloto) estão aplicadas mas INATIVAS. Inofensivo para
-- a DERIVAÇÃO desta migration, que usa `max(versao)` (pega a v9, a cadeia
-- real de capacidades acumuladas, incluindo memória) independentemente de
-- qual versão está `ativo=true` no momento em que esta migration roda — o
-- erro era só na descrição do estado, não na lógica.
--
-- Nasce `ativo=false` — o dono confere e ativa (mesmo padrão de toda versão
-- de prompt desta família). NENHUMA capacidade anterior é removida ou
-- alterada — só ACRESCENTA as duas instruções acima.
--
-- ===========================================================================
-- AS 5 PERGUNTAS DO PROTOCOLO DE SUSTENTABILIDADE
-- ===========================================================================
--
-- 1. Escala — 1 INSERT de 1 linha em `prompts_versoes` (versão nova).
--    `corpo_sistema` cresce por um trecho de texto fixo (não escala com
--    uso, mesma natureza da 0121).
--
-- 2. Índice — não aplicável: nenhum índice novo, nenhuma query nova. A
--    versão ativa continua lida por `(chave, ativo)` (índice existente
--    desde a 0009/0042).
--
-- 3. Frequência — mesma cadência do resto do prompt: 1× por chamada de IA
--    do copiloto. Nenhuma leitura nova de configuração — o prompt ativo já
--    é lido pelo caminho existente de `executarIaCopiloto`.
--
-- 4. Repetição — não aplicável: não há N telas pedindo a mesma coisa.
--
-- 5. Reversão — sem deploy:
--      - a versão nasce `ativo=false` — "não usar" é simplesmente não
--        ativar (a versão anterior continua conduzindo a IA).
--      - se já ativada e precisar reverter: reativar a versão anterior pelo
--        mesmo padrão de sempre (`update prompts_versoes set ativo=false
--        where versao=<nova>; update ... set ativo=true where
--        versao=<anterior>`, mesma transação).
--      - o kill-switch de EXIBIÇÃO da Ficha (`copiloto_sessao.
--        ficha_cliente`, 0122) é independente: mesmo com este prompt
--        ativo, desligar aquela chave só afeta o que a TELA mostra — o
--        acumulador (`server/copiloto/ficha.ts`) continua recebendo e
--        gravando os itens que a IA propuser, a instrução do prompt nunca
--        vira erro por causa disso.
--      - CONTINGÊNCIA (decisão do dono): se a bancada reprovar o campo
--        `ficha_cliente` da IA, a instrução (ii) desta migration fica
--        simplesmente SEM EFEITO — `server/copiloto/ficha.ts` já está
--        desenhado para trocar de fonte (`converterDeObservacao`, deriva de
--        `observacao.evidencia`) sem exigir nenhuma migration de prompt
--        nova: a troca de fonte é 1 linha em `ciclo.ts`/`sugestao/route.ts`,
--        nunca uma reversão desta migration.
--
-- MEDIÇÃO — teto de bytes do SCHEMA ESTRITO da IA: NÃO SE APLICA a esta
-- migration da MESMA forma que não se aplicou à 0121 — o schema estrito
-- (`esquema_saida`) já tem `ficha_cliente[]` desde que este agente
-- acrescentou o campo ao Zod (`server/copiloto/schema.ts`), e essa mudança
-- de FORMA é responsabilidade do código, não desta migration. Esta migration
-- só muda o TEXTO de `corpo_sistema`, sem tocar `esquema_saida` — mesma
-- distinção já registrada na 0121.
--
-- MEDIÇÃO — `explain (analyze)`: PENDENTE, mesma ressalva de toda migration
-- desta família (este agente não tem credencial de banco de produção nesta
-- máquina). Mesmo padrão de plano já medido em 0107/0110/0112/0116/0119/0121:
-- um INSERT de 1 linha sobre `(chave, versao)` (unique da 0009), sub-ms.
--
-- ROTEIRO DE VERIFICAÇÃO (dentro de begin; ...; rollback;) — 🔴 CONFERE E
-- REGISTRA DE QUAL VERSÃO A NOVA DERIVOU (há 3 versões inativas empilhadas
-- nesta base — v8 ativa, v9/0121 inativa aplicada por MCP, e agora esta v10
-- — uma derivação errada seria SILENCIOSA sem este passo):
--
--   1. select versao, ativo, length(corpo_sistema) from prompts_versoes
--        where chave='copiloto_sessao' order by versao;
--      -> REGISTRAR aqui, na hora de rodar, TODAS as linhas devolvidas
--         (versão, ativo, tamanho) — a versão nova aparece com ativo=false
--         e length MAIOR que a versão de que derivou (acréscimo real, não
--         truncamento).
--
--   2. select versao from prompts_versoes
--        where chave='copiloto_sessao'
--        order by versao desc limit 2;
--      -> a MAIOR versão (a nova, criada por esta migration) tem
--         `versao = <2ª maior> + 1` — prova de que derivou do `max(versao)`
--         real do banco no momento da aplicação, não de um número fixado
--         de antemão no texto desta migration.
--
--   3. select corpo_sistema like '%FICHA DO CLIENTE%'
--        and corpo_sistema like '%ficha_cliente%'
--        and corpo_sistema like '%objecao%' and corpo_sistema like '%dor%'
--        and corpo_sistema like '%desejo%' and corpo_sistema like '%fato_decisor%'
--        and corpo_sistema like '%NÃO É NAVEGAÇÃO%'
--        and corpo_sistema like '%SÓ O DECISOR ENTRA NA FICHA E NO INVENTÁRIO%'
--      from prompts_versoes where chave='copiloto_sessao'
--        and versao = (select max(versao) from prompts_versoes where chave='copiloto_sessao');
--      -> true.
--
--   4. DIFERENÇA BATENDO COM O ACRÉSCIMO ESPERADO (acréscimo silencioso
--      errado seria, por exemplo, derivar da v8 ativa em vez da v9 — a nova
--      versão perderia a instrução de memória da 0121 sem ninguém notar):
--      select length(novo.corpo_sistema) - length(anterior.corpo_sistema) as bytes_acrescentados
--        from prompts_versoes novo, prompts_versoes anterior
--       where novo.chave = 'copiloto_sessao' and anterior.chave = 'copiloto_sessao'
--         and novo.versao = (select max(versao) from prompts_versoes where chave='copiloto_sessao')
--         and anterior.versao = novo.versao - 1;
--      -> bytes_acrescentados aproximadamente igual ao tamanho do bloco
--         `$incremento$` abaixo (na faixa de ~3.800-4.100 caracteres — 3
--         instruções, não 2; corrigido nesta rodada junto com a 3ª
--         instrução que faltava no arquivo) — um número muito menor
--         indicaria derivação da versão ERRADA (uma anterior à 0121, sem a
--         instrução de memória por baixo) ou a ausência da instrução (iii).
-- ===========================================================================

insert into prompts_versoes (chave, versao, titulo, corpo_sistema, esquema_saida, modelo_padrao, effort, ativo, notas)
select
  chave,
  versao + 1,
  titulo,
  corpo_sistema || $incremento$

FICHA DO CLIENTE — 18/09/2026

A tela da advogada agora tem um painel chamado "Ficha do cliente": o retrato humano do decisor,
acumulado ao longo desta sessão. Três instruções novas para você, nesta ordem de leitura:

1. "observacao" NÃO É NAVEGAÇÃO. Pare de usar o campo "observacao" para comentar em que ponto
   da conversa vocês estão ("a conversa já avançou para o próximo bloco...", "ainda estamos
   discutindo o bloco de patrimônio..."). Esse tipo de comentário sobre ANDAMENTO já é entregue
   de forma estruturada pelo campo "desvio_sugerido" (bloco_id + motivo + confiança) — não
   precisa e não deve ser repetido em texto livre em "observacao". Uma sessão real mostrou que
   74% das observações geradas eram exatamente esse tipo de comentário sobre navegação, e a tela
   que exibia esse texto solto não existe mais: ninguém vai ler "observacao" se ela só falar de
   em que bloco a conversa está. Use "observacao" só para um FATO, HIPÓTESE, INFERÊNCIA ou
   RECOMENDAÇÃO sobre o CONTEÚDO da conversa (o que foi dito, não onde a conversa está).

2. "ficha_cliente": até 2 itens NOVOS por chamada, cada um com "categoria" (uma das quatro:
   "dor", "objecao", "desejo", "fato_decisor"), "texto" (um resumo curto do fato) e "evidencia"
   (a citação LITERAL da fala que comprova o item — OBRIGATÓRIA, exatamente como nos outros
   campos deste contrato: sem uma frase real dita pelo cliente que sustente o item, não o
   inclua). Guia rápido de categoria, com exemplos reais de sessões anteriores:
     - "dor": o que está incomodando ou pesando na vida da pessoa hoje. Exemplo real:
       "eu vou perder qualidade de vida".
     - "objecao": uma resistência, dúvida ou ressalva sobre o processo, custo ou método.
       Exemplo real: "imposto de renda é 30 por 100" (dito como objeção ao ganho da holding).
     - "desejo": o que a pessoa quer para o futuro, para a família ou para o patrimônio.
       Exemplo real: "40 40 10 e 10" (a partilha que o decisor pretende entre os herdeiros).
     - "fato_decisor": um fato estável sobre quem decide ou como a família decide (papel,
       autoridade, relação entre os decisores) — não confundir com "dor"/"desejo"/"objecao".
   NÃO force um item a cada chamada: a maioria das janelas de fala não traz nada novo para a
   Ficha, e "ficha_cliente": [] é a resposta correta nesse caso, do mesmo jeito que
   "proxima_pergunta": null já é a resposta correta quando não há nada mais a perguntar.

3. SÓ O DECISOR ENTRA NA FICHA E NO INVENTÁRIO. Quando a janela de transcrição vier com papel de
   falante identificado (advogada/decisor_N/acompanhante_N/participante), só considere para
   "ficha_cliente" e para "inventario_mencionado" o que foi dito por um "decisor_N" — nunca uma
   fala de "advogada", "acompanhante_N" ou "participante" (o cliente sem confirmação de papel).
   O acompanhante pode confirmar ou repetir o que o decisor disse, mas o FATO relevante para a
   Ficha e o Inventário é sempre o que o DECISOR relatou sobre a própria vida, dor, objeção,
   desejo ou patrimônio — não o que outra pessoa na sala disse sobre ele. Quando a janela não
   trouxer papel de falante nenhum (identificação de papéis desligada, ou fala sem falante
   resolvido), aplique o mesmo critério que já vale hoje para os outros campos deste contrato:
   sem confiança de quem disse o quê, não é motivo para deixar de registrar um fato com evidência
   literal clara — a restrição desta instrução só se aplica quando o papel do falante É conhecido
   e É outro que não o decisor.

Nenhuma das regras anteriores desta saída (formato dos outros campos, disciplina de evidência,
proibição de valor em reais, proibição de fala pronta, teto de itens em falta_no_bloco/
cobriu_no_bloco/inventario_mencionado, uso da memória em resumo_acumulado) muda com esta
instrução.
$incremento$,
  esquema_saida,
  modelo_padrao,
  effort,
  false, -- nasce desligada — ativação é passo de operação, ver cabeçalho
  coalesce(notas, '') || ' | v' || (versao + 1) || ': FICHA DO CLIENTE (18/09/2026) — '
  || 'proibicao explicita de observacao sobre navegacao (74% das observacoes medidas eram '
  || 'disso, ja coberto por desvio_sugerido), instrucao de preenchimento de ficha_cliente[] '
  || '(evidencia literal obrigatoria, teto 2 itens/chamada, 4 categorias: dor/objecao/desejo/'
  || 'fato_decisor), e regra de papel do falante (so o decisor entra na Ficha e no Inventario '
  || '— achado do security-pentester em producao). Nao muda esquema_saida nesta migration '
  || '(campo ja adicionado ao Zod pelo codigo desta mesma entrega). Kill-switch da EXIBICAO: '
  || 'copiloto_sessao.ficha_cliente (0122) — desligado nao impede o ACUMULADOR de gravar.'
from prompts_versoes
-- deriva da MAIOR versão existente, NÃO da ativa — mesmo raciocínio das
-- migrations irmãs (0110/0112/0116/0119/0121): a versão mais recente pode
-- ter nascido desligada e carregar capacidades que `ativo=true` ainda não
-- tem (dossiê, inventário, performance, acerto/erro, memória) — derivar da
-- ativa perderia essas capacidades se a versão mais recente ainda não
-- tiver sido promovida.
where chave = 'copiloto_sessao'
  and versao = (select max(versao) from prompts_versoes where chave = 'copiloto_sessao')
on conflict (chave, versao) do nothing;
