-- 0016_seed_dev.sql
-- SÓ AMBIENTE DE DEV. Toda linha de gente/jornada fictícia carrega origem_dado='exemplo' —
-- a UI carimba isso na tela para ninguém confundir com cliente real. Nomes são óbvios e
-- fictícios (nunca nome de cliente real das transcrições).
--
-- Escopo (B4): 1 edição, 6 pessoas/jornadas espalhadas nas etapas, 1 formulário respondido,
-- 1 ligação registrada, produtos, templates de mensagem, prompt v1.
--
-- NOTA para o agente de IA: `prompts_versoes` abaixo é um RASCUNHO de v1 só para o schema
-- não ficar vazio em dev. Substituir `corpo_sistema` pelo Prompt Mestre + Protocolo 01
-- integral (ver sic-hf-brain) antes de qualquer geração de briefing real.

do $$
declare
  v_edicao_id uuid;
  v_formulario_id uuid;
  v_pessoa_ana uuid;
  v_pessoa_carlos uuid;
  v_pessoa_fernanda uuid;
  v_pessoa_marcos uuid;
  v_pessoa_juliana uuid;
  v_pessoa_roberto uuid;
  v_jornada_marcos uuid;
  v_jornada_juliana uuid;
  v_sessao_marcos uuid;
  v_sessao_juliana uuid;
begin

  ------------------------------------------------------------------
  -- Edição do seminário
  ------------------------------------------------------------------
  insert into edicoes_seminario (codigo, nome, inicio_em, fim_em, ativa, origem_dado)
  values ('SEM-2026-06', 'Seminário Junho/2026', date '2026-06-08', date '2026-06-10', true, 'exemplo')
  returning id into v_edicao_id;

  ------------------------------------------------------------------
  -- 6 pessoas fictícias
  ------------------------------------------------------------------
  insert into pessoas (nome, email, telefone, cidade, uf, profissao, faixa_etaria, estado_civil, origem_dado)
  values ('Ana Beatriz Souza (exemplo)', 'ana.beatriz.exemplo@example.com', '+5511900000001',
          'São Paulo', 'SP', 'Dentista', '35-44', 'casada', 'exemplo')
  returning id into v_pessoa_ana;

  insert into pessoas (nome, email, telefone, cidade, uf, profissao, faixa_etaria, estado_civil, origem_dado)
  values ('Carlos Eduardo Lima (exemplo)', 'carlos.eduardo.exemplo@example.com', '+5511900000002',
          'Campinas', 'SP', 'Empresário', '45-54', 'casado', 'exemplo')
  returning id into v_pessoa_carlos;

  insert into pessoas (nome, email, telefone, cidade, uf, profissao, faixa_etaria, estado_civil, origem_dado)
  values ('Fernanda Ribeiro Prado (exemplo)', 'fernanda.ribeiro.exemplo@example.com', '+5521900000003',
          'Rio de Janeiro', 'RJ', 'Médica', '45-54', 'divorciada', 'exemplo')
  returning id into v_pessoa_fernanda;

  insert into pessoas (nome, email, telefone, cidade, uf, profissao, faixa_etaria, estado_civil, origem_dado)
  values ('Marcos Antônio Ferreira (exemplo)', 'marcos.antonio.exemplo@example.com', '+5531900000004',
          'Belo Horizonte', 'MG', 'Engenheiro civil', '55-64', 'casado', 'exemplo')
  returning id into v_pessoa_marcos;

  insert into pessoas (nome, email, telefone, cidade, uf, profissao, faixa_etaria, estado_civil, origem_dado)
  values ('Juliana Camargo Dias (exemplo)', 'juliana.camargo.exemplo@example.com', '+5541900000005',
          'Curitiba', 'PR', 'Empresária', '35-44', 'casada', 'exemplo')
  returning id into v_pessoa_juliana;

  insert into pessoas (nome, email, telefone, cidade, uf, profissao, faixa_etaria, estado_civil, origem_dado)
  values ('Roberto Carlos Nascimento (exemplo)', 'roberto.carlos.exemplo@example.com', '+5551900000006',
          'Porto Alegre', 'RS', 'Investidor', '65-74', 'viuvo', 'exemplo')
  returning id into v_pessoa_roberto;

  ------------------------------------------------------------------
  -- Participações no seminário (evento, não atributo)
  ------------------------------------------------------------------
  insert into participacoes_seminario (pessoa_id, edicao_id, origem, dias_assistidos)
  values
    (v_pessoa_ana,      v_edicao_id, 'seminario', 3),
    (v_pessoa_carlos,   v_edicao_id, 'seminario', 3),
    (v_pessoa_fernanda, v_edicao_id, 'seminario', 2),
    (v_pessoa_marcos,   v_edicao_id, 'seminario', 3),
    (v_pessoa_juliana,  v_edicao_id, 'seminario', 3),
    (v_pessoa_roberto,  v_edicao_id, 'seminario', 3);

  ------------------------------------------------------------------
  -- 6 jornadas espalhadas pelas etapas da esteira
  -- (INSERT não passa pelo trigger de transição — só UPDATE valida — então dá para
  -- semear diretamente em qualquer etapa, mantendo nivel_pago e desfecho coerentes.)
  ------------------------------------------------------------------

  -- 1) Captado — acabou de sair do seminário, sem qualificação ainda.
  insert into jornadas (pessoa_id, edicao_id, origem, trilha, etapa, desfecho, nivel_pago, origem_dado)
  values (v_pessoa_ana, v_edicao_id, 'seminario', 'seminario', 'captado', 'aberta', 0, 'exemplo');

  -- 2) Qualificado (MQL) — declarou patrimônio acima do corte.
  insert into jornadas (pessoa_id, edicao_id, origem, trilha, etapa, desfecho, nivel_pago,
                        faixa_patrimonio_declarada, responsavel_id, origem_dado)
  values (v_pessoa_carlos, v_edicao_id, 'seminario', 'seminario', 'qualificado', 'aberta', 0,
          'Acima de R$ 2 milhões', null, 'exemplo');

  -- 3) Sessão paga — comprou a Sessão de Viabilidade, ainda sem data marcada.
  insert into jornadas (pessoa_id, edicao_id, origem, trilha, etapa, desfecho, nivel_pago,
                        faixa_patrimonio_declarada, origem_dado)
  values (v_pessoa_fernanda, v_edicao_id, 'seminario', 'seminario', 'sessao_contratada', 'aberta', 1,
          'Entre R$ 1 milhão e R$ 2 milhões', 'exemplo');

  -- 4) Sessão agendada — tem slot confirmado (ver sessão + agendamento abaixo).
  insert into jornadas (pessoa_id, edicao_id, origem, trilha, etapa, desfecho, nivel_pago,
                        faixa_patrimonio_declarada, origem_dado)
  values (v_pessoa_marcos, v_edicao_id, 'seminario', 'seminario', 'sessao_agendada', 'aberta', 1,
          'Entre R$ 1 milhão e R$ 2 milhões', 'exemplo')
  returning id into v_jornada_marcos;

  -- 5) Sessão realizada — tem formulário e ligação (ver blocos abaixo).
  insert into jornadas (pessoa_id, edicao_id, origem, trilha, etapa, desfecho, nivel_pago,
                        faixa_patrimonio_declarada, origem_dado)
  values (v_pessoa_juliana, v_edicao_id, 'seminario', 'seminario', 'sessao_realizada', 'aberta', 1,
          'Entre R$ 500 mil e R$ 1 milhão', 'exemplo')
  returning id into v_jornada_juliana;

  -- 6) Holding contratada — fechou o ciclo inteiro.
  insert into jornadas (pessoa_id, edicao_id, origem, trilha, etapa, desfecho, motivo_desfecho,
                        nivel_pago, faixa_patrimonio_declarada, origem_dado)
  values (v_pessoa_roberto, v_edicao_id, 'seminario', 'seminario', 'holding_contratada', 'ganha',
          'Holding contratada', 3, 'Acima de R$ 5 milhões', 'exemplo');

  ------------------------------------------------------------------
  -- Sessão de Viabilidade + agendamento (jornada 4 — sessão agendada)
  ------------------------------------------------------------------
  insert into sessoes_viabilidade (jornada_id, link_sala)
  values (v_jornada_marcos, 'https://zoom.us/j/exemplo-marcos')
  returning id into v_sessao_marcos;

  insert into agendamentos (sessao_id, inicio_em, fim_em, status, origem)
  values (v_sessao_marcos,
          date_trunc('day', now()) + interval '7 days' + interval '10 hours',
          date_trunc('day', now()) + interval '7 days' + interval '11 hours',
          'confirmado', 'equipe');

  ------------------------------------------------------------------
  -- Sessão de Viabilidade já realizada (jornada 5 — Juliana)
  ------------------------------------------------------------------
  insert into sessoes_viabilidade (jornada_id, link_sala, realizada_em, resultado)
  values (v_jornada_juliana, 'https://zoom.us/j/exemplo-juliana', now() - interval '3 days', 'fechou')
  returning id into v_sessao_juliana;

  insert into agendamentos (sessao_id, inicio_em, fim_em, status, origem)
  values (v_sessao_juliana, now() - interval '3 days', now() - interval '3 days' + interval '1 hour',
          'realizado', 'equipe');

  ------------------------------------------------------------------
  -- Formulário Estratégico (POP 02) — definição v2 + 1 resposta (Juliana)
  ------------------------------------------------------------------
  insert into formularios (chave, versao, definicao, ativo)
  values ('estrategico', 2, jsonb_build_array(
    jsonb_build_object('id','p1','bloco','Identificação','tipo','texto','rotulo','Qual seu nome completo?'),
    jsonb_build_object('id','p2','bloco','Identificação','tipo','texto','rotulo','Qual sua cidade e estado?'),
    jsonb_build_object('id','p3','bloco','Identificação','tipo','texto','rotulo','Qual sua profissão?'),
    jsonb_build_object('id','p4','bloco','Identificação','tipo','unica','rotulo','Qual sua faixa etária?',
      'opcoes', jsonb_build_array('Até 34','35-44','45-54','55-64','65-74','75+')),
    jsonb_build_object('id','p5','bloco','Identificação','tipo','unica','rotulo','Qual seu estado civil?',
      'opcoes', jsonb_build_array('solteiro','casado','divorciado','viuvo','uniao_estavel')),
    jsonb_build_object('id','p6','bloco','Família','tipo','numero','rotulo','Quantos filhos você tem?'),
    jsonb_build_object('id','p7','bloco','Família','tipo','sim_nao','rotulo','Todos os filhos são maiores de idade?'),
    jsonb_build_object('id','p8','bloco','Família','tipo','sim_nao','rotulo','Há algum dependente financeiro na família?'),
    jsonb_build_object('id','p9','bloco','Patrimônio','tipo','unica','rotulo','Qual sua faixa de patrimônio estimado?',
      'opcoes', jsonb_build_array('Até R$ 500 mil','Entre R$ 500 mil e R$ 1 milhão',
        'Entre R$ 1 milhão e R$ 2 milhões','Acima de R$ 2 milhões')),
    jsonb_build_object('id','p10','bloco','Patrimônio','tipo','multipla','rotulo','Que tipos de bens você possui?',
      'opcoes', jsonb_build_array('Imóveis','Veículos','Investimentos','Previdência','Empresa','Outro')),
    jsonb_build_object('id','p11','bloco','Patrimônio','tipo','numero','rotulo','Quantos imóveis você possui?',
      'condicional', jsonb_build_object('depende_de','p10','contem','Imóveis')),
    jsonb_build_object('id','p12','bloco','Motivação','tipo','texto_longo','rotulo','O que te motivou a buscar o planejamento sucessório?'),
    jsonb_build_object('id','p13','bloco','Motivação','tipo','texto_longo','rotulo','Qual sua maior preocupação em relação à sua família e ao seu patrimônio?'),
    jsonb_build_object('id','p14','bloco','Processo decisório','tipo','unica','rotulo','Quem participa das decisões financeiras importantes na sua família?',
      'opcoes', jsonb_build_array('Decido sozinho(a)','Decidimos em conjunto','Meu cônjuge decide','Outro')),
    jsonb_build_object('id','p15','bloco','Processo decisório','tipo','sim_nao','rotulo','Você já conversou com sua família sobre sucessão patrimonial?'),
    jsonb_build_object('id','p16','bloco','Expectativa','tipo','texto_longo','rotulo','O que você espera obter com a Sessão de Viabilidade?'),
    jsonb_build_object('id','p17','bloco','Expectativa','tipo','sim_nao','rotulo','Você já possui algum planejamento sucessório em andamento?')
  ), true)
  returning id into v_formulario_id;

  insert into formularios_respostas (jornada_id, formulario_id, respostas, origem, origem_dado)
  values (v_jornada_juliana, v_formulario_id, jsonb_build_object(
    'p1','Juliana Camargo Dias (exemplo)','p2','Curitiba/PR','p3','Empresária',
    'p4','35-44','p5','casada','p6',2,'p7',false,'p8',true,
    'p9','Entre R$ 500 mil e R$ 1 milhão','p10', jsonb_build_array('Imóveis','Empresa'),
    'p11',2,
    'p12','Quero proteger a empresa da família e evitar inventário demorado.',
    'p13','Que os filhos brigem pela empresa depois que eu faltar.',
    'p14','Decidimos em conjunto','p15',true,
    'p16','Entender se a holding resolve o problema da sucessão da empresa.',
    'p17',false
  ), 'sistema', 'exemplo');

  ------------------------------------------------------------------
  -- Ligação Estratégica (POP 03) — 1 registro (Juliana)
  ------------------------------------------------------------------
  insert into ligacoes_estrategicas (
    jornada_id, pop, duracao_segundos,
    respostas, expectativa_principal, preocupacao_principal, assunto_atencao_especial,
    objecoes_percebidas, pessoas_mencionadas,
    ritmo, estilo_resposta, sinais, frases_marcantes,
    processo_decisorio, decisores_presentes_na_sessao, observacoes, origem_dado
  ) values (
    v_jornada_juliana, '03', 240,
    jsonb_build_object(
      'expectativa','Entender como proteger a empresa da família',
      'preocupacao','Briga entre os filhos pela empresa',
      'processo_decisorio','Decide em conjunto com o marido'
    ),
    'Entender como estruturar a holding para a empresa da família',
    'Conflito futuro entre os filhos pela sociedade',
    'Mencionou que o marido só decide se "os números fizerem sentido"',
    array['Vai achar caro sem entender o retorno tributário'],
    array['marido (sócio da empresa)','dois filhos, ambos maiores'],
    'moderado', 'objetiva', array['procura_numeros','demonstra_cautela'],
    array['Eu não quero que meus filhos brigem depois que eu não estiver mais aqui.'],
    'decisor_conjunto', true,
    'Cliente organizada, chegou com perguntas escritas. Ligação feita conforme roteiro do POP 03.',
    'exemplo'
  );

  ------------------------------------------------------------------
  -- Consentimentos mínimos para a jornada da Juliana (para o briefing não nascer
  -- em modo reduzido por padrão neste exemplo).
  ------------------------------------------------------------------
  insert into consentimentos (pessoa_id, tipo, concedido, texto_apresentado, versao_texto, canal)
  values
    (v_pessoa_juliana, 'gravacao_sessao', true,
     'Você autoriza a gravação desta sessão para que minha equipe possa analisar o seu caso?',
     '4-sims-v1', 'sessao_zoom'),
    (v_pessoa_juliana, 'comunicacao_email', true,
     'Você autoriza o envio de e-mails sobre sua Sessão de Viabilidade?', '4-sims-v1', 'formulario'),
    (v_pessoa_juliana, 'comunicacao_whatsapp', true,
     'Você autoriza o envio de mensagens de WhatsApp sobre sua Sessão de Viabilidade?', '4-sims-v1', 'formulario');
  -- NOTA: 'tratamento_ia' fica de fora de propósito — é o BLOQUEIO B3 do plano
  -- (autorização para tratamento por IA de terceiro ainda não decidida pela Dra. Elaine).
  -- Isso faz o seed exercitar o caminho real: briefing desta jornada nasce em modo reduzido.

end $$;

------------------------------------------------------------------
-- Produtos (Hotmart) — B7 ainda não tem os hotmart_produto_id reais.
------------------------------------------------------------------
insert into produtos (tipo, nome, ativo) values
  ('sessao_viabilidade', 'Sessão de Viabilidade', true),
  ('croqui_estrutural', 'Croqui Estrutural', true),
  ('holding', 'Constituição da Holding Familiar', true)
on conflict do nothing;

------------------------------------------------------------------
-- REMOVIDO na aplicacao (orquestrador, 03/09/2026): os templates da regua ja sao
-- semeados com o texto real em 0013_regua_mensagens.sql, e os prompts v1 reais em
-- 0009_ia_prompts_execucoes_briefings.sql. Manter rascunho aqui so criaria conflito
-- silencioso (on conflict do nothing) e a ilusao de que existe um segundo dono do
-- mesmo dado. Este arquivo agora reflete exatamente o que foi aplicado no banco.
------------------------------------------------------------------
