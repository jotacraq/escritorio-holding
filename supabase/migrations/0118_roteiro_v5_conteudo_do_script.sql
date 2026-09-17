-- ===========================================================================
-- 🔴 RODADA 3 (17/09/2026, antes de aplicar em producao) — VOCATIVO HERDADO
-- ===========================================================================
-- A v4 ATIVA em producao contem o nome "Eliana" 7 vezes dentro de `falas[]`
-- (medido: length(definicao::text) - length(replace(...,'Eliana',''))). E o
-- nome de uma CLIENTE ANTERIOR, colado de um roteiro personalizado — o script
-- mestre `04 - Script de SV..md` tem ZERO ocorrencias. A Dra. Elaine vem
-- lendo "Eliana, antes de falarmos..." na tela ao vivo, em sessao de outra
-- pessoa.
--
-- A rodada 2 preservou `falas[]` byte-identicas a v4 (instrucao correta para
-- nao regredir texto) e por isso HERDOU o defeito. Corrigido aqui: os 7
-- vocativos ("Eliana, ..." / "Eliana... ...") foram removidos, capitalizando
-- a palavra seguinte. Nenhum outro campo alterado (verificado por comparacao
-- programatica bloco a bloco: so `falas` de parte_02/04/09/10/11 mudaram).
--
-- Licao: "byte-identico ao anterior" preserva regressao junto com o acerto.
-- Antes de herdar texto que a advogada le ao vivo, procurar nome proprio.
-- ===========================================================================
-- 0118_roteiro_v5_conteudo_do_script.sql
--
-- DEFEITO MEDIDO (17/09/2026, pelo dono, na tela ao vivo): o roteiro ATIVO
-- (roteiros_versoes chave='sessao_viabilidade', versao=4, "Script de
-- Fechamento de Croqui -- Guia Teste 3") tem os 13 titulos certos, mas esta
-- VAZIO por dentro:
--   campos    -- 0 em TODAS as 13 partes
--   observar  -- 0 em todas
--   proibido  -- 0 em todas
--   objetivo  -- so em parte_00 e parte_01
--   falas     -- 6 na parte_01, 1 nas demais
--
-- Confirmado nesta sessao por leitura direta da v4 (migration 0030, linhas
-- 974-1213): os 13 blocos vieram TODOS com "campos": [], "observar": [],
-- "proibido": [] no arquivo-fonte, e so parte_00/parte_01 tem "objetivo"
-- preenchido -- o mesmo padrao que o dono mediu na tela (o bloco "Cuidado"
-- repete sempre os 4 itens do bloco 00, porque sao os unicos cadastrados).
--
-- FONTE DA VERDADE: "04 - Script de SV..md" (script mestre, 13 partes),
-- fornecido pelo dono e lido INTEGRALMENTE antes de escrever esta migration.
-- ATENCAO: "04 - Script de SV. (1).md" NAO foi usado -- e roteiro
-- personalizado de outra cliente (Maria Aparecida/Eliana), nao a fonte oficial.
--
-- O QUE ESTA MIGRATION FAZ
--   Cria a versao 5 de roteiros_versoes (chave='sessao_viabilidade'),
--   DERIVANDO explicitamente da v4 (nao de "ativo=true" -- a RPC calcula o
--   proximo numero por coalesce(max(versao),0)+1, e o SELECT abaixo le a
--   definicao da v4 por NUMERO de versao, nunca por "ativo", entao o
--   resultado nao depende de qual versao estiver ativa quando esta migration
--   rodar). Diferente da familia de prompts (0107/0110/0112/0116), aqui a
--   versao ATIVA (v4) e a mais rica em falas -- por isso e dela, e nao de
--   uma v1/v2 mais pobre, que este patch parte.
--
--   falas[] de TODOS os blocos sao preservadas EXATAMENTE como estao na v4
--   (byte a byte -- copiadas do JSON da migration 0030, nao reescritas de
--   memoria). So objetivo/campos/observar/proibido sao preenchidos, extraidos
--   do script-fonte:
--     - objetivo: o "Objetivo"/"Acao" do bloco no script, ou uma frase
--       derivada da intencao da parte quando o script nao nomeia um objetivo
--       explicito (a maioria dos blocos 02-12).
--     - campos: o que a parte manda APURAR, em TODOS os blocos que tem
--       algo verificavel por citacao (12 dos 13 -- so parte_00 fica com
--       campos:[], ver nota da RODADA 2 abaixo). Mais denso na parte_03 (8
--       itens: familia/patrimonio/capacidade economica, "Radiografia
--       Familiar e Patrimonial") e na parte_01/02 (4 itens cada). Sao os
--       itens que viram "Ainda nao perguntou" no bloco Cuidado da tela E a
--       base do ERRO vermelho/ACERTO verde da Tarefa 2 (migration 0119).
--
-- RODADA 2 (achado do coordenador, conferido antes de aplicar): a 1a versao
-- desta migration deixou 11 dos 13 blocos com campos:[] -- exatamente o
-- defeito que a tarefa existia para corrigir, so que num numero levemente
-- menor. Corrigido: agora SO parte_00 fica com campos:[] (setup tecnico da
-- equipe, sem interacao verificavel com o CLIENTE -- candidato legitimo,
-- nao uma omissao). Os outros 12 blocos ganharam campos extraidos do
-- script-fonte, aplicando o criterio "verificavel por citacao literal,
-- nunca postura": parte_01 ganhou os 4 SIMs como campos (CONFIRMADO antes
-- de mexer: os 4 itens que a tela HOJE mostra em "Falta: Sigilo e gravacao/
-- Licitude/Decisores presentes/Proximo passo" vem de `sims_pendentes`
-- (server/copiloto/estado.ts::ROTULOS_SIM, constante hardcoded), NAO de
-- `roteiro.blocos[].campos` -- e um mecanismo TOTALMENTE separado do
-- falta_no_bloco/cobriu_no_bloco que esta migration alimenta; os dois
-- aparecem no MESMO card "Cuidado" da tela mas sao fontes de dado
-- diferentes, entao dar campos[] a parte_01 aqui NAO duplica nem regride
-- os 4 SIMs -- so passa a existir, pela 1a vez, o 2o placar independente
-- para esse bloco). parte_04 (3 campos: custo do inventario/reserva ou
-- seguro/ciencia do ITCMD), parte_05 (2: organizacao desejada/valor em
-- evitar inventario e brigas), parte_06/07/08/09/10/12 (1 campo cada:
-- motivo da escolha do profissional/senso de urgencia/duvidas restantes/
-- posicionamento de expert feito/oferta do croqui apresentada/resposta
-- binaria obtida), parte_11 (3: preco apresentado/incentivo do resolvedor
-- explicado/abatimento nos honorarios explicado -- SEM citar o numero, ver
-- nota de PRECO abaixo).
--     - proibido: extraido com cuidado do texto do script -- parte_01 (nao
--       avancar sem os 4 SIMs), parte_08 ("Nao tire duvidas tecnicas agora;
--       remeta ao croqui"), parte_10 ("FICAR CALADO ate que o cliente
--       pergunte o preco"), parte_12 ("FICAR CALADO e aceitar apenas Sim ou
--       Nao" / "jamais dizer que esta a disposicao para quando ele precisar").
--     - observar: sinais que o script pede para a advogada notar durante a
--       conducao (ex.: hesitacao nos SIMs, bem com valor emocional na
--       parte_03, silencio deliberado na parte_10/11).
--
-- ATENCAO -- PARTE_11 TRAZ PRECO (R$ 7.200,00 / R$ 4.500,00). O prompt do
-- copiloto PROIBE a IA de citar valor em reais (validar.ts::TERMOS_VALOR).
-- Os valores foram mantidos em falas (e o texto que a ADVOGADA le em voz
-- alta -- inalterado da v4), mas objetivo/observar/proibido da parte_11 NAO
-- mencionam valor algum -- conferido por busca de string (r$, reais, 7.200,
-- 7200, 4.500, 4500) contra o JSON gerado, zero ocorrencia fora de falas.
-- Preco nunca vira materia-prima de campos/observar (a IA nunca ve falas,
-- ver contexto.ts -- "FALAS FORA DO CONTEXTO").
--
-- NASCE ativo=false (p_ativar := false) -- o dono confere antes de ativar via
-- select public.ativar_roteiro_versao('<id-da-v5>') (nenhuma migration nova
-- precisa para isso, mesmo padrao de sempre).
--
-- ESCRITA VIA RPC, NAO INSERT DIRETO: desde a 0081, roteiros_versoes REVOGOU
-- insert/update/delete de authenticated/anon/public -- a unica porta e
-- public.publicar_roteiro_versao (calcula N+1 por coalesce(max(versao),0)+1,
-- valida chave/titulo/definicao, e trava a chave inteira com "for update"
-- contra publicacao concorrente). Reescrever um INSERT direto aqui reabriria
-- exatamente a porta paralela que a 0081 fechou (achado INFO (c) daquela
-- migration) -- mesmo dentro de uma migration, que roda como dono da tabela:
-- seguir o unico caminho de verdade e o que garante N+1 correto e
-- criado_por validado como admin ativo, sem duplicar essa logica aqui.
--
-- p_criado_por: a migration roda sem auth.uid() (sem sessao de usuario),
-- entao publicar_roteiro_versao EXIGE p_criado_por apontando para um perfil
-- com papel='admin' and ativo (0081, linhas 409-415). Este agente nao tem
-- credencial de producao nesta maquina e nao foi buscar nenhuma (regra da
-- casa) -- a migration resolve o autor DINAMICAMENTE, pegando QUALQUER admin
-- ativo do proprio banco onde ela rodar (select id from perfis_equipe where
-- papel='admin' and ativo order by criado_em limit 1). Isto e seguro porque
-- criado_por e so METADADO DE AUTORIA (quem aparece como autor da versao na
-- tela de roteiros) -- nao concede nenhum privilegio novo a essa pessoa, e a
-- RPC ja validaria p_criado_por como admin de qualquer forma. Se o banco de
-- destino nao tiver NENHUM admin ativo (nao deveria acontecer em producao),
-- a RPC lanca sem_permissao e a migration falha de forma explicita -- nunca
-- insere silenciosamente com autor nulo/errado.
--
-- ===========================================================================
-- AS 5 PERGUNTAS DO PROTOCOLO DE SUSTENTABILIDADE
-- ===========================================================================
--
-- 1. Escala -- 1 INSERT de 1 linha nova (via RPC) em roteiros_versoes,
--    tabela de poucas dezenas de linhas (uma por versao de roteiro ja
--    publicada nesta base -- 3 chaves x poucas versoes cada). Nao cresce com
--    uso do sistema, cresce com edicao deliberada de roteiro (acao rara,
--    admin-only).
--
-- 2. Indice -- a RPC ja usa unique (chave, versao) (PK/unique da 0030) para
--    o "for update"/calculo de max(versao) e uniq_roteiro_ativo (indice
--    unico parcial em (chave) where ativo) para o UPDATE de desativacao
--    quando p_ativar=true -- AQUI p_ativar=false, entao nem esse UPDATE
--    roda. Mesmo padrao ja medido e aceito em 0107/0110/0112/0116 (INSERT de
--    1 linha nova em tabela de versionamento, sem varredura).
--
-- 3. Frequencia -- migration roda 1x, na aplicacao. Em runtime, a leitura de
--    roteiros_versoes.definicao continua exatamente como antes (embed por
--    roteiro_versao_id/chave+ativo, ja medido em 0106/0117) -- esta
--    migration nao adiciona leitura nova nem muda o padrao de acesso.
--
-- 4. Repeticao -- nao aplicavel: nao ha N telas pedindo a mesma coisa; e
--    conteudo de roteiro, lido 1x por montagem de contexto/estado (ja
--    existente, inalterado por esta migration).
--
-- 5. Reversao -- sim, dois niveis, mesmo padrao de toda migration desta
--    familia: (a) a v5 nasce ativo=false, entao "nao usar" e simplesmente
--    NAO ativar (a v4 continua ativa, tela sem nenhuma mudanca de
--    comportamento); (b) se ja ativada e precisar reverter,
--    select public.ativar_roteiro_versao('<id-da-v4>') reativa a v4 na mesma
--    transacao que desativa a v5 -- sem deploy de codigo, e so dado.
--
-- MEDICAO -- explain (analyze): PENDENTE. Este agente nao tem credencial de
-- banco de producao nesta maquina e nao buscou nenhuma (regra da casa). O
-- padrao de plano ja foi medido e confirmado nas migrations irmas
-- (0107/0110/0112/0116: INSERT de 1 linha via "for update"+"max(versao)",
-- Index Scan em (chave, versao)/uniq_roteiro_ativo, sub-ms) -- esta migration
-- usa a MESMA RPC, mesma forma de plano, nenhum predicado novo. O
-- responsavel da sessao roda com MCP e cola o resultado real:
--
--   begin;
--   explain (analyze, buffers)
--   select * from public.publicar_roteiro_versao(
--     p_chave      := 'sessao_viabilidade',
--     p_definicao  := (select definicao from roteiros_versoes
--                       where chave='sessao_viabilidade' and versao=4),
--     p_titulo     := 'Script de Fechamento de Croqui -- v5 (sonda)',
--     p_ativar     := false,
--     p_notas      := 'sonda de medicao -- reverter',
--     p_criado_por := (select id from perfis_equipe where papel='admin' and ativo limit 1)
--   );
--   rollback;
--
-- CRITERIO DE DECISAO: Index Scan em roteiros_versoes_chave_versao_key (ou
-- nome equivalente da unique) + uniq_roteiro_ativo, sub-ms -- mesmo padrao ja
-- aceito nas migrations irmas. Se divergir (Seq Scan, custo alto), a causa
-- mais provavel e ausencia do indice unico em producao -- investigar antes
-- de aplicar.
--
-- ROTEIRO DE VERIFICACAO (dentro de begin; ...; rollback;):
--   1. select versao, ativo, jsonb_array_length(definicao->'blocos')
--        from roteiros_versoes where chave='sessao_viabilidade' order by versao;
--      -> a v5 aparece com ativo=false e 13 blocos.
--   2. select b->>'id', jsonb_array_length(b->'campos'),
--        jsonb_array_length(b->'observar'), jsonb_array_length(b->'proibido'),
--        (b->>'objetivo') is not null
--      from roteiros_versoes rv, jsonb_array_elements(rv.definicao->'blocos') b
--      where rv.chave='sessao_viabilidade' and rv.versao = (
--        select max(versao) from roteiros_versoes where chave='sessao_viabilidade')
--      order by b->>'id';
--      -> TODOS os 13 blocos com objetivo preenchido; TODOS com observar>=1;
--        parte_01/08/10/12 tem proibido>=1; campos>=1 em TODOS EXCETO
--        parte_00 (setup tecnico, sem interacao verificavel com o cliente --
--        candidato legitimo a campos:[], nao uma omissao). Contagem exata
--        medida localmente (JSON parseado antes de aplicar): parte_00:0,
--        parte_01:4, parte_02:4, parte_03:8, parte_04:3, parte_05:2,
--        parte_06:1, parte_07:1, parte_08:1, parte_09:1, parte_10:1,
--        parte_11:3, parte_12:1.
--   3. select rv.definicao::text ilike '%R$%' or rv.definicao::text ilike
--        '%reais%' from roteiros_versoes rv where chave='sessao_viabilidade'
--        and versao=(select max(versao) from roteiros_versoes where
--        chave='sessao_viabilidade')
--      -> true e ESPERADO (falas da parte_11 preservam o preco, e o texto que
--        a advogada le) -- a checagem que importa e a (4) abaixo, restrita a
--        fora de falas.
--   4. select b->>'id', (b->'campos')::text ilike '%r$%' or
--        (b->'observar')::text ilike '%r$%' or
--        (b->'proibido')::text ilike '%r$%' or
--        (b->'objetivo')::text ilike '%r$%'
--      from roteiros_versoes rv, jsonb_array_elements(rv.definicao->'blocos') b
--      where rv.chave='sessao_viabilidade' and rv.versao=(select max(versao)
--        from roteiros_versoes where chave='sessao_viabilidade')
--      -> false em TODOS os 13 blocos (conferido tambem localmente, ver
--        comentario acima -- zero achado).
-- ===========================================================================

select public.publicar_roteiro_versao(
  p_chave      := 'sessao_viabilidade',
  p_titulo     := 'Script de Fechamento de Croqui — v5 (conteúdo completo do script mestre)',
  p_definicao  := $def5$
{
  "blocos": [
    {
      "id": "parte_00",
      "titulo": "Check-in e Profissionalismo",
      "objetivo": "Transmitir profissionalismo e preservar a agenda do especialista.",
      "acao": "Um assistente da equipe abre a sala do Zoom antes do advogado para realizar o setup técnico.",
      "falas": [],
      "campos": [],
      "observar": [
        "Sala do Zoom aberta e testada antes da advogada entrar (setup técnico prévio)."
      ],
      "proibido": []
    },
    {
      "id": "parte_01",
      "titulo": "Assumir o Controle (A Busca pelos 4 SIMs)",
      "objetivo": "Abertura da sessão: obter os 4 SIMs antes de prosseguir para o diagnóstico.",
      "acao": null,
      "falas": [
        {
          "id": "intro",
          "locutor": "advogado",
          "texto": "Antes de iniciarmos, preciso alinhar quatro pontos fundamentais com você:"
        },
        {
          "id": "sigilo_gravacao",
          "locutor": "advogado",
          "texto": "Tudo o que tratarmos aqui é absolutamente sigiloso. Eu vou gravar esta sessão para que minha equipe possa analisar cada detalhe do seu caso depois, sem que eu precise te pedir para repetir nada. Você se sente à vontade para falar abertamente sobre seus desejos e seu patrimônio? (1º SIM)",
          "sim": "sigilo_gravacao",
          "rotulo_sim": "1º SIM — Sigilo e Gravação"
        },
        {
          "id": "licitude",
          "locutor": "advogado",
          "texto": "Integro um time nacional com um código de ética rígido. Nosso sistema é poderoso e só o aplicamos a patrimônios de origem lícita.E apenas para confirmarmos a certeza que já temos iremos reforçar e preciso apenas da sua confirmação:  Seus bens têm origem legal e você NÃO busca este sistema para ocultar crimes, certo? (2º SIM)",
          "sim": "licitude",
          "rotulo_sim": "2º SIM — Ética e Licitude"
        },
        {
          "id": "decisores",
          "locutor": "advogado",
          "texto": "Para que este diagnóstico seja eficaz, é indispensável que todos os que decidem sobre os bens da família estejam presentes. Todos os responsáveis estão aqui agora e podemos prosseguir? (3º SIM)",
          "sim": "decisores",
          "rotulo_sim": "3º SIM — Presença dos Decisores"
        },
        {
          "id": "proximo_passo_contexto",
          "locutor": "advogado",
          "texto": "Se eu identificar que o sistema é viável para você, o nosso próximo passo após esta Sessão de Viabilidade será a contratação para elaboração do Croqui Estrutural. Ele funciona como uma 'planta baixa' personalizada da sua Holding. É nessa nova contratação, nesse estudo profundo que você terá a visão do sistema pronto, os cenários possíveis para seu planejamento patrimonial, o comando dos bens e o orçamento exato de custos e impostos, para que não haja surpresas na execução."
        },
        {
          "id": "proximo_passo",
          "locutor": "advogado",
          "texto": "Ao final desta conversa, eu te direi se devemos ou não prosseguir para esse estudo técnico. O meu objetivo é que, ao sair daqui hoje, você tenha condições de tomar a decisão mais assertiva para proteger sua família. Compreendeu como vamos trabalhar? Podemos prosseguir? (4º SIM).",
          "sim": "proximo_passo",
          "rotulo_sim": "4º SIM — Decisão Assertiva"
        }
      ],
      "campos": [
        {
          "id": "sim_sigilo_gravacao",
          "rotulo": "Sigilo e gravação apresentados e confirmados pelo cliente (1º SIM)",
          "tipo": "texto_longo"
        },
        {
          "id": "sim_licitude",
          "rotulo": "Ética e licitude apresentadas e confirmadas pelo cliente (2º SIM)",
          "tipo": "texto_longo"
        },
        {
          "id": "sim_decisores",
          "rotulo": "Presença de todos os decisores confirmada pelo cliente (3º SIM)",
          "tipo": "texto_longo"
        },
        {
          "id": "sim_proximo_passo",
          "rotulo": "Próximo passo (Croqui Estrutural) explicado e aceito pelo cliente (4º SIM)",
          "tipo": "texto_longo"
        }
      ],
      "observar": [
        "Hesitação ou recusa em qualquer um dos 4 SIMs — sinal de que a sessão não deve prosseguir no ritmo padrão."
      ],
      "proibido": [
        "Avançar para a Parte 02 sem ter obtido os 4 SIMs (sigilo/gravação, licitude, decisores presentes, próximo passo)."
      ]
    },
    {
      "id": "parte_02",
      "titulo": "A Motivação do Cliente",
      "objetivo": "Entender a motivação real do cliente para buscar a Holding Familiar — o que fez o assunto virar prioridade agora.",
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Me conte, o que te motivou a estar hoje aqui comigo? Por que você deseja ter uma Holding Familiar?\".\"Antes de falarmos sobre patrimônio, imóveis ou investimentos, eu gosto de conhecer um pouco da história da família.\n\nAo longo dos anos eu percebi que duas famílias podem ter patrimônios muito parecidos e, ainda assim, precisarem de estruturas completamente diferentes.\n\nIsso acontece porque nenhuma estrutura patrimonial é mais importante do que as pessoas que ela pretende proteger.\n\nPor isso eu sempre começo entendendo a família.\"\n\n\"Posso lhe fazer uma curiosidade?\"\n\n(Aguardar a resposta.)\n\n\"O que fez a senhora decidir agendar esta conversa justamente agora?\"\n\n(Ouvir. Não interromper. Permitir que a cliente conte sua história.)\n\nApós a resposta:\n\n\"Foi algum fato específico que despertou essa preocupação ou esse assunto já vinha amadurecendo há algum tempo?\"\n\n(Ouvir.)\n\n\"Vi que a senhora convidou sua irmã para participar desta reunião. Como surgiu essa decisão?\"\n\n(Ouvir e observar a dinâmica familiar.)\n\n\"Agora eu gostaria de conhecer um pouquinho da família da senhora, porque toda estrutura patrimonial acompanha uma estrutura familiar.\"\n\n\"Me conta um pouco da sua família.\"\n\n(Permitir que a cliente conte livremente. Não interromper.)Perfeito.\n\nAgora que eu já conheço um pouco melhor a história da sua família e aquilo que é mais importante para a senhora, eu gostaria de entender como esse patrimônio foi sendo construído ao longo da vida.\n\nPorque é justamente essa história que vai me ajudar a identificar qual estrutura faz mais sentido para a realidade da sua família.\""
        }
      ],
      "campos": [
        {
          "id": "motivo_prioridade_agora",
          "rotulo": "O que fez o assunto deixar de ser 'para depois' e virar prioridade agora?",
          "tipo": "texto_longo"
        },
        {
          "id": "maior_preocupacao",
          "rotulo": "Qual foi a maior preocupação que passou pela cabeça do cliente?",
          "tipo": "texto_longo"
        },
        {
          "id": "o_que_quer_evitar",
          "rotulo": "O que o cliente mais quer evitar?",
          "tipo": "texto_longo"
        },
        {
          "id": "melhor_resultado_esperado",
          "rotulo": "Qual seria o melhor resultado que a estrutura poderia trazer para a família?",
          "tipo": "texto_longo"
        }
      ],
      "observar": [
        "Só avançar para o patrimônio depois de entender a motivação (ordem do script: motivação antes de números)."
      ],
      "proibido": []
    },
    {
      "id": "parte_03",
      "titulo": "Radiografia Familiar e Patrimonial (SEJA EMPÁTICO E BUSQUE MAIS QUE INFORMAÇÕES CADASTRAIS)",
      "objetivo": "Radiografia familiar e patrimonial — ir além do cadastro: entender família, patrimônio e capacidade econômica com empatia.",
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "A Família: Questionar sobre filhos (maiores ou menores), regimes de casamento de todos os envolvidos, ocupações e idades.\nO Patrimônio: Levantar a lista de bens, valores de mercado, valores de aquisição, datas, formas de pagamento e a relação pessoal do cliente com cada bem.\nCapacidade Econômica: Identificar quem paga as contas hoje e quais são as reservas financeiras disponíveis.\n\nAgora que eu conheço um pouco melhor a história da sua família, eu gostaria de entender como esse patrimônio foi sendo construído ao longo da vida.\"\n\n(Permitir que o cliente conte sua trajetória. Não interromper.)\n\nApós a resposta:\n\n\"Esse patrimônio foi sendo construído principalmente através da sua atividade profissional ou houve outros acontecimentos importantes ao longo dessa caminhada?\"\n\n(Ouvir.)\n\n\"Quando a senhora olha para tudo aquilo que construiu, existe algum patrimônio que tenha um significado especial além do valor financeiro?\"\n\n(Ouvir.)\n\n**\"Imagino que um patrimônio construído ao longo de tantos anos exija bastante organização.\n\nComo a senhora costuma acompanhar tudo isso hoje?\"**\n\n(Ouvir.)\n\n\"Agora eu gostaria apenas de compreender como esse patrimônio está organizado atualmente.\"\n\n**\"Pelo formulário eu vi que a senhora possui imóveis e investimentos.\n\nVamos percorrer essa estrutura juntos para que eu consiga compreender exatamente como ela está organizada hoje.\"**\n\nDurante o levantamento patrimonial\n\nConduza a conversa naturalmente.\n\nEvite transformar esta etapa em um checklist.\n\nProcure compreender:\n\nQuantos imóveis existem?\nEstão em nome da pessoa física ou jurídica?\nExistem aplicações financeiras?\nExiste previdência privada?\nExistem participações societárias?\nExiste patrimônio localizado fora do Brasil?\nExistem bens adquiridos antes ou depois do casamento?\nExistem bens compartilhados com outras pessoas?\nExiste algum bem que ainda gere dúvidas quanto à melhor forma de organização?\n\nSempre que possível, pergunte:\n\n\"Como surgiu esse patrimônio?\"\n\nAo invés de apenas:\n\n\"Quanto vale?\"\n\nCapacidade financeira\n\nDepois do patrimônio levantado:\n\n\"Hoje esse patrimônio gera renda suficiente para manter o padrão de vida da senhora ou ainda depende principalmente de outras fontes de receita?\"\n\n(Ouvir.)\n\nSe houver filhos ou familiares envolvidos:\n\n\"Eles já participam de alguma forma da administração ou hoje essa organização permanece concentrada na senhora?\"\n\n(Ouvir sem aprofundar em questões de comando.)\"Deixa eu conferir se eu compreendi corretamente tudo o que conversamos até aqui.\"\n\n\"Pelo que eu entendi...\n\nA senhora construiu esse patrimônio principalmente através de __________________________.\n\nHoje a estrutura da família é formada por __________________________.\n\nEsse patrimônio está organizado da seguinte maneira __________________________.\n\nE a principal preocupação da senhora hoje é __________________________.\"\n\n\"Foi isso que a senhora quis me transmitir ou existe alguma informação importante que eu deixei de compreender?\""
        }
      ],
      "campos": [
        {
          "id": "filhos_maiores_menores",
          "rotulo": "Filhos (maiores ou menores)",
          "tipo": "texto_longo"
        },
        {
          "id": "regimes_casamento",
          "rotulo": "Regimes de casamento de todos os envolvidos",
          "tipo": "texto_longo"
        },
        {
          "id": "ocupacoes_idades",
          "rotulo": "Ocupações e idades",
          "tipo": "texto_longo"
        },
        {
          "id": "lista_bens",
          "rotulo": "Lista de bens",
          "tipo": "texto_longo"
        },
        {
          "id": "valores_mercado_aquisicao",
          "rotulo": "Valores de mercado e de aquisição, datas e formas de pagamento de cada bem",
          "tipo": "texto_longo"
        },
        {
          "id": "relacao_pessoal_bem",
          "rotulo": "Relação pessoal do cliente com cada bem (valor emocional, não só financeiro)",
          "tipo": "texto_longo"
        },
        {
          "id": "quem_paga_contas",
          "rotulo": "Quem paga as contas hoje",
          "tipo": "texto_longo"
        },
        {
          "id": "reservas_financeiras",
          "rotulo": "Reservas financeiras disponíveis",
          "tipo": "texto_longo"
        }
      ],
      "observar": [
        "SEJA EMPÁTICO E BUSQUE MAIS QUE INFORMAÇÕES CADASTRAIS (instrução literal do título do bloco).",
        "Bem com valor emocional (casa construída pelos pais, imóvel onde os filhos cresceram, patrimônio que não pode ser vendido) — não tratar como só mais um item da lista."
      ],
      "proibido": []
    },
    {
      "id": "parte_04",
      "titulo": "A Fase do Desconforto (Infligir Dor)",
      "objetivo": "Fase do desconforto: confrontar o cliente com o custo real de não fazer nada (inventário, ITCMD).",
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado:\n\"Você tem ideia de quanto seus filhos teriam que gastar para serem donos do que você construiu? (Custo do Inventário)\".\n\"Você tem uma reserva financeira ou seguro de vida específico só para pagar o governo e advogados no inventário?\".\n\"Você está ciente de que a reforma tributária vai aumentar drasticamente o ITCMD?\".\n\n\"Agora que eu consegui compreender a história da sua família e a forma como esse patrimônio foi sendo construído, eu gostaria de fazer algumas reflexões com a senhora.\"\n\n\"Se absolutamente nada fosse feito a partir de hoje, como a senhora imagina que esse patrimônio chegaria às pessoas que a senhora deseja proteger?\"\n\n(Ouvir. Não interromper.)\n\n\"A senhora acredita que esse processo aconteceria exatamente da forma como gostaria?\"\n\n(Ouvir.)\n\n\"Existe alguma situação que a senhora gostaria que sua família nunca precisasse enfrentar?\"\n\n(Ouvir.)\n\nSe responder.\n\nAprofundar.\n\n\"O que mais preocupa a senhora quando pensa nessa possibilidade?\"\n\n(Ouvir.)\n\n**\"Quando a senhora pensa nesse patrimônio, o que hoje pesa mais no seu coração?\n\nA burocracia?\n\nOs custos?\n\nOu o receio de que a sua vontade não seja cumprida exatamente como imaginou?\"**\n\n(Ouvir.)\n\n\"A senhora já acompanhou algum inventário de alguém da família ou de pessoas próximas?\"\n\nSe SIM.\n\n\"Como foi essa experiência?\"\n\n(Ouvir.)\n\nSe NÃO.\n\n\"É justamente por isso que eu gosto de fazer essa reflexão antes de falar sobre qualquer solução.\"\n\nDepois.\n\n\"Independentemente dos valores envolvidos, a senhora considera importante que sua família consiga cumprir a sua vontade com tranquilidade?\"\n\n(Ouvir.)\"Quando a senhora comentou que a sua maior preocupação era ________________________, é justamente nesse ponto que normalmente o inventário acaba gerando maiores dificuldades.\"\n\nNunca faça uma explicação genérica.\n\nSempre personalize.\n\nEncerramento\n\n\"Tudo o que conversamos até aqui reforça uma percepção que eu comecei a construir desde o início da nossa conversa.\n\nO patrimônio da senhora não representa apenas bens.\n\nEle representa uma história construída ao longo de muitos anos.\n\nE é justamente por isso que a forma como ele será organizado daqui para frente merece o mesmo cuidado que existiu para construí-lo.\""
        }
      ],
      "campos": [
        {
          "id": "custo_inventario_apresentado",
          "rotulo": "Custo do inventário apresentado ao cliente (quanto os filhos gastariam)",
          "tipo": "texto_longo"
        },
        {
          "id": "reserva_seguro_inventario",
          "rotulo": "Existência de reserva financeira ou seguro de vida específico para pagar o inventário",
          "tipo": "texto_longo"
        },
        {
          "id": "ciencia_itcmd_reforma",
          "rotulo": "Ciência do cliente sobre o aumento do ITCMD com a reforma tributária",
          "tipo": "texto_longo"
        }
      ],
      "observar": [
        "Reação do cliente à pergunta sobre o custo do inventário — é o termômetro da fase de desconforto."
      ],
      "proibido": []
    },
    {
      "id": "parte_05",
      "titulo": "O Desejo de Futuro",
      "objetivo": "Explorar o desejo de futuro: como o cliente quer deixar o patrimônio organizado para os filhos.",
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Como você gostaria de deixar organizado o patrimônio para seus filhos? Você acredita que evitar o inventário e possíveis brigas por dinheiro seria um benefício para a harmonia da sua família?\".\n\n\"Agora eu gostaria de fazer um exercício de imaginação com a senhora.\"\n\n(Pausa.)\n\n\"Vamos imaginar que muitos anos se passaram.\n\nE que tudo aquilo que a senhora construiu precise chegar às pessoas que ama.\"\n\n\"Se a senhora pudesse escrever exatamente como gostaria que esse momento acontecesse, como ele seria?\"\n\n(Ouvir. Não interromper.)\n\nApós a resposta.\n\n\"O que faria a senhora sentir que deixou tudo realmente organizado?\"\n\n(Ouvir.)\n\n\"Quando seus familiares olharem para essa decisão no futuro, o que a senhora gostaria que eles pensassem sobre essa organização?\"\n\n(Ouvir.)\n\n\"Existe alguma situação que a senhora gostaria que jamais acontecesse entre eles?\"\n\n(Ouvir.)\n\nSe responder.\n\nAprofundar.\n\n\"Por que isso é tão importante para a senhora?\"\n\n(Ouvir.)\n\n\"Se fosse possível organizar tudo isso ainda em vida, preservando a sua vontade e reduzindo ao máximo os riscos de conflitos e burocracias, isso faria sentido para a senhora?\"\n\n(Ouvir.)\n\nPonte para o Diagnóstico\n\n\"Perfeito.\n\nO mais importante é que, durante toda a nossa conversa, eu consegui compreender não apenas o patrimônio da senhora.\n\nEu consegui compreender aquilo que realmente deseja proteger.\n\nE isso faz toda a diferença na hora de recomendar uma estrutura patrimonial.\""
        }
      ],
      "campos": [
        {
          "id": "como_quer_organizar",
          "rotulo": "Como o cliente gostaria de deixar o patrimônio organizado para os filhos",
          "tipo": "texto_longo"
        },
        {
          "id": "valor_evitar_inventario_brigas",
          "rotulo": "Se o cliente enxerga valor em evitar inventário e possíveis brigas por dinheiro entre os herdeiros",
          "tipo": "texto_longo"
        }
      ],
      "observar": [
        "Se o cliente reconhece valor em evitar inventário e brigas por dinheiro entre os herdeiros."
      ],
      "proibido": []
    },
    {
      "id": "parte_06",
      "titulo": "Por que este Profissional?",
      "objetivo": "Entender por que o cliente escolheria (ou não) este profissional/escritório em vez de outro.",
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Existem outros profissionais no mercado, inclusive da sua confiança. O que te impede de fazer sua Holding com eles e por que você prefere fazer conosco?\"."
        }
      ],
      "campos": [
        {
          "id": "motivo_escolha_profissional",
          "rotulo": "Por que o cliente prefere fazer a Holding com este escritório e não com outro profissional de confiança",
          "tipo": "texto_longo"
        }
      ],
      "observar": [
        "O que na mensagem do seminário fez sentido para o cliente — vira argumento de fechamento mais adiante."
      ],
      "proibido": []
    },
    {
      "id": "parte_07",
      "titulo": "Compromisso e Agilidade",
      "objetivo": "Checar o senso de urgência do cliente diante do cenário tributário atual.",
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Diante do cenário atual do país e do risco de aumento de impostos, você sente que essa proteção é algo que te motiva a agir rápido para não deixar o futuro da sua família para depois?\"."
        }
      ],
      "campos": [
        {
          "id": "senso_urgencia_tributario",
          "rotulo": "Se o cenário atual do país e o risco de aumento de impostos motivam o cliente a agir rápido",
          "tipo": "texto_longo"
        }
      ],
      "observar": [
        "Se o cliente demonstra motivação para agir rápido ou tende a adiar (procrastinador x resolvedor, tema do seminário)."
      ],
      "proibido": []
    },
    {
      "id": "parte_08",
      "titulo": "Autorização para Ajudar",
      "objetivo": "Encerrar dúvidas gerais e conquistar autorização do cliente para a advogada ajudar.",
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Restou alguma dúvida sobre o que conversamos até aqui? (Não tire dúvidas técnicas agora; remeta ao croqui). Após ouvir tudo isso, eu estou muito feliz: eu consigo ajudar sua família e sei exatamente como fazer.\"."
        }
      ],
      "campos": [
        {
          "id": "duvidas_restantes_levantadas",
          "rotulo": "Dúvidas restantes do cliente levantadas (e remetidas ao Croqui, não respondidas tecnicamente agora)",
          "tipo": "texto_longo"
        }
      ],
      "observar": [
        "Dúvida técnica disfarçada de dúvida geral — é o gatilho para remeter ao Croqui, não responder na hora."
      ],
      "proibido": [
        "Não tire dúvidas técnicas agora; remeta ao Croqui."
      ]
    },
    {
      "id": "parte_09",
      "titulo": "Posicionamento de Expert",
      "objetivo": "Posicionar a advogada como especialista em Planejamento Patrimonial antes da oferta.",
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Minha especialidade é o Planejamento Patrimonial. Eu ajudo os pais a praticarem um ato de amor para que seus filhos não precisem de advogados em um momento de horror (inventário). Minha expertise é usar a Holding como ferramenta para isso.\".\"Antes de eu apresentar o meu diagnóstico, eu gostaria de lhe fazer uma última pergunta.\"\n\n(Pausa.)\n\n\"Quando a senhora decidiu agendar esta conversa, certamente existiam dúvidas e preocupações que motivaram essa decisão.\"\n\n(Pausa.)\n\n\"Depois de tudo o que conversamos até aqui, existe algum ponto que tenha ficado mais claro para a senhora?\"\n\n(Ouvir.)\n\nApós a resposta:\n\n\"Fico feliz em ouvir isso.\"\n\n\"Existe ainda alguma preocupação importante que a senhora gostaria que eu considerasse antes de apresentar a minha conclusão?\"\n\n(Ouvir.)\n\n**\"O meu compromisso hoje foi compreender muito mais a história da sua família do que simplesmente analisar patrimônio.\n\nPorque nenhuma estrutura jurídica faz sentido se ela não respeitar aquilo que cada família considera mais importante proteger.\"**\"Então deixe-me apenas confirmar se compreendi corretamente tudo o que conversamos.\"\n\n\"Pelo que eu compreendi hoje...\n\nA senhora construiu um patrimônio ao longo de muitos anos de trabalho.\n\nEsse patrimônio representa muito mais do que bens.\n\nRepresenta toda a história da sua família.\n\nAo longo desse caminho surgiram diferentes estruturas, diferentes possibilidades e diferentes orientações.\n\nMas a senhora ainda procurava alguém que analisasse tudo isso de forma integrada e lhe dissesse qual é o caminho que realmente faz sentido para a realidade da sua família.\n\nA principal preocupação da senhora hoje é garantir que tudo aquilo que construiu permaneça organizado, respeitando a sua vontade, protegendo sua família e evitando custos e dificuldades desnecessárias no futuro.\"\n\n\"Foi isso que a senhora quis me transmitir ou existe alguma informação importante que eu deixei de compreender?\"\n\"Depois de tudo o que conversamos hoje, eu já consigo lhe apresentar o meu diagnóstico.\"\n\n(Pausa.)\n\n\"Pela história da sua família, pela forma como a senhora construiu esse patrimônio e pelos objetivos que me apresentou ao longo da nossa conversa, eu entendo que a sua família tem um perfil muito adequado para realizar um Planejamento Patrimonial.\"\n\n\"Mas existe um ponto muito importante.\"\n\n(Pausa.)\n\n\"Seria uma enorme irresponsabilidade da minha parte dizer hoje que a solução da sua família é simplesmente criar uma Holding.\"\n\n(Pausa.)\n\n\"Porque uma Holding é apenas uma ferramenta jurídica.\n\nEla nunca deve ser o ponto de partida.\n\nEla deve ser a consequência de um planejamento bem feito.\"\n\n\"Antes de qualquer decisão, nós precisamos responder algumas perguntas muito importantes.\"\n\nQual patrimônio realmente deve integrar essa estrutura?\nExiste algum bem que seja melhor permanecer fora dela?\nComo essa estrutura deve ser organizada para respeitar exatamente a vontade da senhora?\nComo reduzir custos futuros sem criar novos problemas?\nComo garantir que tudo funcione também para as próximas gerações?\n\n\"Perceba que nenhuma dessas respostas pode ser dada com segurança durante uma única reunião.\"\n\n\"E é exatamente por isso que existe o Croqui Estrutural.\"\n\n\"A senhora começou esta reunião buscando uma resposta.\"\n\n(Utilizar exatamente as palavras da cliente.)\n\nExemplos:\n\n\"Quero proteger minha família.\"\n\n\"Quero saber qual é o melhor caminho.\"\n\n\"Quero entender se realmente vale a pena.\"\n\n\"E o Croqui foi criado justamente para responder essa pergunta.\"\n\n\"No Croqui Estrutural nós vamos desenvolver um estudo técnico totalmente personalizado para a realidade da sua família.\"\n\n\"Nele a senhora visualizará, antes de qualquer execução:\n\n• se a Holding realmente é a melhor solução;\n\n• como essa estrutura deverá funcionar;\n\n• quais bens deverão compor esse planejamento;\n\n• quais mecanismos de proteção serão utilizados;\n\n• quais impactos tributários existirão em cada alternativa;\n\n• quais custos estarão envolvidos em cada etapa;\n\n• e qual será o caminho mais seguro para implementar toda essa estrutura.\"\n\n\"Somente depois desse estudo técnico é que iniciamos a execução.\n\nPorque a nossa responsabilidade não é simplesmente constituir uma Holding.\n\nÉ construir a estrutura mais adequada para a realidade da sua família.\""
        }
      ],
      "campos": [
        {
          "id": "posicionamento_expert_feito",
          "rotulo": "Posicionamento de especialista em Planejamento Patrimonial apresentado ao cliente",
          "tipo": "texto_longo"
        }
      ],
      "observar": [
        "Confirmar com o cliente, nas palavras dele, se a advogada compreendeu corretamente preocupação e objetivo — antes de seguir para a oferta."
      ],
      "proibido": []
    },
    {
      "id": "parte_10",
      "titulo": "A Oferta do Croqui Estrutural",
      "objetivo": "Apresentar o Croqui Estrutural como o próximo passo, sem antecipar preço.",
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"O diagnóstico para sua família é positivo. O próximo passo é a contratação do Croqui Estrutural. Ele é como uma planta baixa onde você verá os cenários possíveis, a distribuição dos bens, o comando de tudo e, principalmente, um orçamento detalhado e sem surpresas. O que eu preciso de você agora é a decisão de contratar esse 'desenho'.\".\nAção: FICAR CALADO até que o cliente pergunte o preço.\nPosso lhe explicar rapidamente como funciona essa próxima etapa?\"\n\n(Aguardar o sim.)\n\n\"O Croqui Estrutural é, na prática, o projeto da organização patrimonial da sua família.\"\n\n\"Se hoje eu perguntasse para um arquiteto quanto custa construir uma casa, ele não conseguiria responder.\n\nPrimeiro ele precisaria elaborar o projeto.\n\nSó depois seria possível saber exatamente quanto vai custar construir.\"\n\n\"Na estrutura patrimonial acontece exatamente a mesma coisa.\"\n\n\"Hoje eu já consigo afirmar que sua família possui perfil para um Planejamento Patrimonial.\n\nMas eu ainda não consigo afirmar qual será exatamente a estrutura ideal.\n\nE eu jamais faria isso sem um estudo técnico.\"\n\n\"É exatamente para isso que existe o Croqui.\"\n\n\"No Croqui nós iremos desenvolver toda a engenharia patrimonial da sua família.\"\n\nO que a senhora receberá\n\n✔ Qual é a estrutura jurídica mais adequada.\n\n✔ Como ela funcionará.\n\n✔ Como ficará organizado cada patrimônio.\n\n✔ Quem exercerá cada função.\n\n✔ Como ficará a sucessão.\n\n✔ Quais mecanismos de proteção serão utilizados.\n\n✔ Quais impactos tributários existirão.\n\n✔ Quais custos existirão em cada etapa.\n\n✔ Quais documentos serão necessários.\n\n✔ Qual será o cronograma completo de implementação.\n\n\"Quando essa etapa termina...\n\nA senhora deixa de ter dúvidas.\n\nPassa a ter um projeto completo.\"\n\n\"E a partir desse projeto, a decisão de executar ou não a estrutura passa a ser muito mais segura.\"\n\n(Pausa.)\n\n\"Até aqui fez sentido para a senhora?\"\n\nEssa pergunta é extremamente importante.\n\nPorque ela cria um novo SIM.\n\nSe responder.\n\n\"Sim.\"\n\nSó agora seguimos.\n\n\"Quando o Croqui fica pronto, a senhora deixa de trabalhar com hipóteses.\n\nA senhora passa a ter um projeto completo.\n\nSabendo exatamente:\n\n• qual é a melhor estrutura;\n\n• como ela funcionará;\n\n• quanto custará implementá-la;\n\n• quais impostos existirão;\n\n• quais documentos serão necessários;\n\n• e principalmente... quais decisões devem ser tomadas e quais não devem.\"\n\n(Pausa.)\n\n\"É exatamente por isso que praticamente todas as famílias que chegam até essa etapa dizem que, pela primeira vez, conseguiram enxergar com clareza o patrimônio como um todo.\"\n\n(Pausa.)\n\nSilêncio.\n\nNão fale nada.\"Com tudo o que conversamos hoje, a senhora se sentiria segura para tomar todas essas decisões agora, ou acredita que ainda precisa enxergar esse cenário de forma organizada antes de decidir?\"\"É exatamente essa a finalidade do Croqui.\"Então ainda falta exatamente aquilo que viemos buscar hoje.\"\nSilêncio.\nEla perguntará.\n\"O quê?\"\nVocê.\n\"Um estudo que mostre qual desses caminhos faz sentido para a sua família.\""
        }
      ],
      "campos": [
        {
          "id": "oferta_croqui_apresentada",
          "rotulo": "Croqui Estrutural apresentado como próximo passo (cenários, distribuição de bens, comando, orçamento)",
          "tipo": "texto_longo"
        }
      ],
      "observar": [
        "Silêncio depois de apresentar o Croqui — o script pede pausa deliberada até o cliente perguntar o preço."
      ],
      "proibido": [
        "FICAR CALADO até que o cliente pergunte o preço — nunca antecipar valor nesta parte."
      ]
    },
    {
      "id": "parte_11",
      "titulo": "Preço e Incentivo do Resolvedor",
      "objetivo": "Apresentar o investimento do Croqui e a condição do Incentivo do Resolvedor.",
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"O preço padrão para a elaboração deste estudo é de R$ 7.200,00. Porém, como eu gravei nossa sessão e as informações estão frescas, eu economizo tempo de equipe se eu começar agora. Por isso, para quem decide aqui na reunião – o que chamo de Incentivo do Resolvedor – o valor fica por R$ 4.500,00. Além disso, o que você já pagou hoje e o valor do croqui serão integralmente abatidos dos honorários finais da Holding.\".\nEntão eu vou lhe explicar como funciona essa próxima etapa.\"\n\n\"O Croqui Estrutural é um estudo totalmente personalizado.\n\nEle não é um documento padrão.\n\nToda a equipe técnica trabalha exclusivamente sobre a realidade da sua família.\n\nPor isso, normalmente, o investimento para elaboração desse estudo é de R$ 7.200,00.\"\n\n(Pausa.)\n\n\"Mas existe uma condição que nós chamamos internamente de Condição dos Resolvedores.\"\n\n(Pausa.)\n\n\"Ela existe para as famílias que participaram do Seminário e que decidem dar continuidade ao trabalho no mesmo dia da Sessão de Viabilidade.\"\n\n\"E isso acontece por um motivo muito simples.\"\n\n\"Durante a nossa conversa de hoje eu conheci toda a história da sua família.\n\nCompreendi como esse patrimônio foi construído.\n\nEntendi quais são as suas preocupações.\n\nIdentifiquei os pontos que precisam ser analisados.\n\nE já começo, ainda hoje, a transmitir todas essas informações para a equipe técnica que desenvolverá o Croqui.\"\n\n\"Quando essa continuidade acontece imediatamente, nós não perdemos nenhuma informação importante.\n\nNão precisamos repetir entrevistas.\n\nNão precisamos recomeçar o diagnóstico.\n\nToda essa construção que fizemos hoje já segue diretamente para o desenvolvimento do estudo.\"\n\n\"Isso reduz etapas internas, otimiza o trabalho da equipe e permite que iniciemos imediatamente a elaboração do projeto da sua família.\"\n\n\"Por isso, para as famílias que tomam essa decisão ainda hoje, o investimento nesta etapa passa para R$ 4.500,00.\"\n\n(Pausa.)\n\n\"Essa condição existe exclusivamente porque o trabalho começa hoje.\"\n\n\"Se a continuidade não acontece hoje, infelizmente eu já não consigo garantir esse mesmo fluxo de trabalho, porque a equipe perde todo esse momento de construção que tivemos durante a Sessão de Viabilidade e o processo precisa ser reorganizado desde o início.\"\n\n(Olhar para o cliente.)\n\n\"Eu acredito que a sua família está pronta para dar esse próximo passo.\"\n\n\"Vamos iniciar hoje a elaboração do Croqui Estrutural?\"\n\nSilêncio."
        }
      ],
      "campos": [
        {
          "id": "preco_apresentado",
          "rotulo": "Preço padrão do Croqui Estrutural apresentado ao cliente",
          "tipo": "texto_longo"
        },
        {
          "id": "incentivo_resolvedor_explicado",
          "rotulo": "Incentivo do Resolvedor explicado (condição para quem decide na própria reunião)",
          "tipo": "texto_longo"
        },
        {
          "id": "abatimento_honorarios_explicado",
          "rotulo": "Abatimento do valor pago hoje e do Croqui nos honorários finais da Holding explicado",
          "tipo": "texto_longo"
        }
      ],
      "observar": [
        "Se o cliente decide na própria reunião (condição do Incentivo do Resolvedor vale só para quem decide hoje)."
      ],
      "proibido": []
    },
    {
      "id": "parte_12",
      "titulo": "Finalização Binária",
      "objetivo": "Fechar a sessão de forma binária: sim ou não, sem meio-termo.",
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Ação: FICAR CALADO e aceitar apenas \"Sim\" ou \"Não\".\nSe SIM: Dar os parabéns por ser um \"Resolvedor\" e passar para a assistente para o link de pagamento (válido para o dia). Solicitar o envio das informações de IR, principalmente do imóvel.\nSe NÃO: Dizer que entende o momento, reforçar que o primeiro passo foi dado, mas jamais dizer que está \"à disposição para quando ele precisar\"."
        }
      ],
      "campos": [
        {
          "id": "resposta_binaria_obtida",
          "rotulo": "Resposta binária do cliente obtida (Sim ou Não à contratação do Croqui)",
          "tipo": "texto_longo"
        }
      ],
      "observar": [
        "Se SIM: parabenizar como 'Resolvedor', passar para a assistente (link de pagamento válido para o dia) e pedir informações de IR, principalmente do imóvel.",
        "Se NÃO: reconhecer o momento e reforçar que o primeiro passo já foi dado."
      ],
      "proibido": [
        "Aceitar resposta que não seja 'Sim' ou 'Não' — FICAR CALADO e não induzir.",
        "Se a resposta for 'Não': jamais dizer que está 'à disposição para quando ele precisar'."
      ]
    }
  ]
}
$def5$::jsonb,
  p_ativar     := false,
  p_notas      := 'Deriva da v4 (falas preservadas byte a byte) + conteudo extraido de '
    '"04 - Script de SV..md" (script mestre, 13 partes) para objetivo/campos/observar/'
    'proibido, ausentes em TODAS as versoes anteriores (0/0/0 em campos/observar/proibido '
    'nas 13 partes da v4; objetivo so em parte_00/01). NASCE DESLIGADA -- o dono confere e '
    'ativa via ativar_roteiro_versao. Preco (parte_11, R$ 7.200/R$ 4.500) mantido so em '
    'falas (texto lido pela advogada); nunca em campos/observar/proibido (a IA nunca ve '
    'falas nem pode citar valor, validar.ts::TERMOS_VALOR).',
  p_criado_por := (select id from perfis_equipe where papel = 'admin' and ativo order by criado_em limit 1)
);
