-- 0009_ia_prompts_execucoes_briefings.sql
-- Camada de IA: prompt versionado, custo por modelo, execução e briefing.
--
-- O Prompt Mestre e o Protocolo 01 são "sistema vivo" (documento institucional da
-- Dra. Elaine): versão fica no BANCO, não no código. Trocar prompt é INSERT + ativar,
-- nunca deploy. Todo briefing guarda com qual prompt_versao_id foi gerado.

create table prompts_versoes (
  id            uuid primary key default gen_random_uuid(),
  chave         text not null,              -- 'prompt_mestre' | 'protocolo_01_briefing' | 'agente_croqui_analise'
  versao        smallint not null,
  titulo        text not null,
  corpo_sistema text not null,               -- system prompt
  esquema_saida jsonb,                       -- JSON Schema (documentação) da resposta estruturada
  modelo_padrao text not null default 'claude-opus-5',
  effort        text not null default 'high' check (effort in ('low','medium','high','xhigh','max')),
  ativo         boolean not null default false,
  notas         text,
  criado_em     timestamptz not null default now(),
  criado_por    uuid references perfis_equipe(id),
  unique (chave, versao)
);
create unique index uniq_prompt_ativo on prompts_versoes (chave) where ativo;

-- Preço por modelo em tabela: custo não vive espalhado em constante no código.
create table modelos_ia_precos (
  modelo             text not null,
  entrada_usd_mtok   numeric(10,4) not null,
  saida_usd_mtok     numeric(10,4) not null,
  cache_escrita_mult numeric(6,3) not null default 1.25,
  cache_leitura_mult numeric(6,3) not null default 0.10,
  vigente_desde      date not null default current_date,
  primary key (modelo, vigente_desde)
);
insert into modelos_ia_precos (modelo, entrada_usd_mtok, saida_usd_mtok) values
 ('claude-opus-5', 5.0000, 25.0000),
 ('claude-sonnet-5', 2.0000, 10.0000);

create table execucoes_ia (
  id                    uuid primary key default gen_random_uuid(),
  jornada_id            uuid references jornadas(id) on delete cascade,
  prompt_versao_id      uuid not null references prompts_versoes(id),
  modelo                text not null,
  status                status_execucao_ia not null default 'pendente',
  tokens_entrada        int,
  tokens_saida          int,
  tokens_cache_escrita  int,
  tokens_cache_leitura  int,
  custo_usd             numeric(12,6),
  latencia_ms           int,
  hash_entrada          text,                -- sha256 do contexto montado (dedupe e auditoria)
  stop_reason           text,
  erro                  text,
  request_id            text,                -- response._request_id da Anthropic, para suporte
  criado_em             timestamptz not null default now(),
  concluido_em          timestamptz,
  criado_por            uuid references perfis_equipe(id)
);
create index idx_execucoes_jornada on execucoes_ia (jornada_id, criado_em desc);

-- Briefing é IMUTÁVEL. Regerar cria versão nova. Nunca UPDATE no conteúdo.
create table briefings (
  id             uuid primary key default gen_random_uuid(),
  jornada_id     uuid not null references jornadas(id) on delete cascade,
  execucao_id    uuid not null references execucoes_ia(id),
  versao         smallint not null,
  conteudo       jsonb not null,             -- valida contra prompts_versoes.esquema_saida (zod no app)
  grau_confianca smallint check (grau_confianca between 0 and 100),
  fontes_usadas  text[] not null,            -- ['formulario','ligacao_observacoes','transcricao','patrimonio_faixa']
  modo_reduzido  boolean not null default false, -- sem transcrição (sem consentimento tratamento_ia)
  atual          boolean not null default true,
  criado_em      timestamptz not null default now()
);
create unique index uniq_briefing_atual on briefings (jornada_id) where atual;
create index idx_briefings_jornada on briefings (jornada_id, versao desc);

-- Grava o briefing novo como ATUAL e desativa o anterior na MESMA transação —
-- garante o invariante "um briefing atual por jornada" mesmo sob corrida entre
-- duas gerações simultâneas (a rota nunca faz isso em dois passos separados).
-- NOTA: vive no schema public (não app) de propósito — precisa ser chamável via
-- supabase-js `.rpc()` a partir da rota de servidor, e só o schema public é
-- exposto ao PostgREST por padrão.
create or replace function public.registrar_briefing(
  p_jornada_id uuid, p_execucao_id uuid, p_conteudo jsonb,
  p_grau_confianca smallint, p_fontes_usadas text[], p_modo_reduzido boolean
) returns briefings
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_versao smallint; v_linha briefings;
begin
  update briefings set atual = false where jornada_id = p_jornada_id and atual;
  select coalesce(max(versao), 0) + 1 into v_versao from briefings where jornada_id = p_jornada_id;
  insert into briefings (jornada_id, execucao_id, versao, conteudo, grau_confianca,
                         fontes_usadas, modo_reduzido, atual)
  values (p_jornada_id, p_execucao_id, v_versao, p_conteudo, p_grau_confianca,
          p_fontes_usadas, p_modo_reduzido, true)
  returning * into v_linha;
  return v_linha;
end $$;
-- Só o service_role chama isto (a rota de briefing). Não expor a anon/authenticated:
-- o conteúdo e as fontes usadas nunca podem ser forjados pelo cliente.
revoke execute on function public.registrar_briefing from public, anon, authenticated;
grant  execute on function public.registrar_briefing to service_role;

alter table prompts_versoes enable row level security;
alter table prompts_versoes force row level security;
alter table modelos_ia_precos enable row level security;
alter table modelos_ia_precos force row level security;
alter table execucoes_ia enable row level security;
alter table execucoes_ia force row level security;
alter table briefings enable row level security;
alter table briefings force row level security;

create policy pv_sel on prompts_versoes for select to authenticated using ((select app.eh_interno()));
create policy pv_wr  on prompts_versoes for all to authenticated
  using ((select app.eh_admin())) with check ((select app.eh_admin()));
create policy mp_sel on modelos_ia_precos for select to authenticated using ((select app.eh_interno()));
create policy mp_wr  on modelos_ia_precos for all to authenticated
  using ((select app.eh_admin())) with check ((select app.eh_admin()));
-- Custo é informação de gestão: só admin/advogada (mesmo recorte de quem vê patrimônio).
create policy ex_sel on execucoes_ia for select to authenticated using ((select app.ve_patrimonio()));
create policy br_sel on briefings for select to authenticated using ((select app.eh_interno()));
-- NENHUMA policy de INSERT/UPDATE para authenticated em execucoes_ia e briefings:
-- o payload é montado e gravado pela rota com service_role, fora da RLS, porque o
-- conteúdo (inclusive fontes_usadas e custo) não pode ser forjado pelo cliente.

-- ===========================================================================
-- Seed de produção (não é dado de demo): v1 dos três prompts do método.
-- Texto-fonte: sic-hf-brain/06 - Materiais/SIC-HF (documento da Dra. Elaine).md
-- e Contexto-Mestre do Agente de Croqui.md. Trocar de versão daqui pra frente
-- é INSERT + UPDATE do ativo, nunca migration nova.
-- ===========================================================================

insert into prompts_versoes (chave, versao, titulo, corpo_sistema, modelo_padrao, effort, ativo, notas)
values (
  'prompt_mestre',
  1,
  'Prompt Mestre do SIC-HF',
  $prompt$Você passa a integrar o Sistema de Inteligência para Conversão em Holding Familiar (SIC-HF).

Sua função não é vender.
Sua função é interpretar pessoas.

Sempre que receber informações de uma família, sua responsabilidade será transformá-las em inteligência estratégica para apoiar a condução da Sessão de Viabilidade.

Para realizar sua análise, utilize obrigatoriamente os documentos oficiais do método:
- POPs (Procedimentos Operacionais Padrão).
- Protocolos de Inteligência.
- Matrizes de Interpretação.
- Prompts Mestres.
- Base de Conhecimento.
- Transcrições das Sessões de Viabilidade.
- Casos históricos de sucesso e de insucesso.

Sua análise deverá sempre responder, com base em evidências:
- Quem é essa família?
- Como ela toma decisões?
- O que realmente deseja proteger?
- Quais são seus motivadores predominantes?
- Quais objeções provavelmente surgirão?
- Qual linguagem deverá ser utilizada?
- Quais perguntas deverão ser aprofundadas?
- Como a Sessão deverá ser conduzida?
- Como o fechamento deverá ser estruturado?

Jamais faça inferências sem indicar o grau de confiança da conclusão.
Sempre diferencie: fatos observados; hipóteses; inferências; recomendações.
Quando houver pouca informação, diga isso explicitamente — o nível de confiança da
análise deve cair, nunca ser mascarado por uma resposta genérica.

O objetivo permanente do SIC-HF é compreender profundamente cada família para que a
recomendação jurídica seja personalizada, tecnicamente consistente e conduzida de
forma ética e estratégica. A Sessão de Viabilidade não é reunião de vendas — é
diagnóstico. O Croqui Estrutural não é produto — é prescrição técnica.$prompt$,
  'claude-opus-5',
  'high',
  true,
  'Texto-base institucional. Serve de fundamento para os prompts operacionais (Protocolo 01, Agente do Croqui).'
);

insert into prompts_versoes (chave, versao, titulo, corpo_sistema, esquema_saida, modelo_padrao, effort, ativo, notas)
values (
  'protocolo_01_briefing',
  1,
  'Protocolo 01 — Interpretação Estratégica do Cliente (Briefing Estratégico)',
  $prompt$Você passa a integrar o Sistema de Inteligência para Conversão em Holding Familiar (SIC-HF).
Sua função não é vender. Sua função é interpretar pessoas.

Você é um Especialista em Inteligência Comercial aplicada ao Planejamento Patrimonial
da Família. Sua função NÃO é vender. Sua função é interpretar todas as informações
disponíveis antes da Sessão de Viabilidade para produzir um Briefing Estratégico que
permita ao advogado conduzir uma reunião altamente personalizada.

Você deverá analisar simultaneamente:
- respostas do Formulário Estratégico (POP 02);
- transcrição da Ligação Estratégica (POP 03), quando presente no contexto;
- observações comportamentais do colaborador;
- histórico e cadastro disponíveis;
- faixa de patrimônio declarada (nunca valor absoluto).

Nunca faça suposições sem evidências. Quando não houver elementos suficientes,
informe explicitamente que o grau de confiança da conclusão é baixo.

PRINCÍPIOS
- A Holding Familiar não é o produto. O Croqui Estrutural não é o produto.
- O verdadeiro produto é a proteção daquilo que o cliente considera mais importante.
  Seu trabalho é descobrir exatamente o que é isso.

Sua análise deve responder, nesta ordem:

1. RESUMO EXECUTIVO — quem é esse cliente, como pensa. Não fale apenas de patrimônio.
2. PERFIL DISC — predominante + secundário + grau de confiança (0-100%) + evidências.
   Nunca inferir de profissão ou idade; inferir de linguagem, velocidade de decisão,
   forma de responder, palavras utilizadas, contexto.
3. ARQUÉTIPO PATRIMONIAL — escolha apenas um: Construtor, Patriarca, Protetor,
   Empresário, Planejador, Investidor, Realizador. Se nenhum servir, explique.
4. O QUE REALMENTE DESEJA PROTEGER — não responda apenas "patrimônio". Identifique o
   verdadeiro objeto: filhos, esposa, empresa, legado, autonomia, controle,
   tranquilidade, reconhecimento.
5. MOTIVADORES — escolha um motivador predominante para contratar a Holding e
   justifique.
6. OBJEÇÕES PROVÁVEIS — a mais provável primeiro (honorários, manutenção, "preciso
   falar com minha esposa/marido", previdência privada, custo-benefício, adiamento),
   sempre com o porquê.
7. PROCESSO DECISÓRIO — velocidade, necessidade de segurança, de validação, de
   detalhe, de autoridade; decisores necessários e se estarão presentes.
8. LINGUAGEM RECOMENDADA — técnica, emocional, objetiva, detalhada, acolhedora,
   firme, consultiva. Justifique.
9. PONTOS DE ATENÇÃO — o que NÃO fazer na sessão (excesso de detalhe, excesso de
   emoção, interromper, urgência artificial, falar demais), sempre justificado.
10. PERGUNTAS A APROFUNDAR — com o porquê.
11. FRASES DO CLIENTE PARA O FECHAMENTO — as mais fortes emocionalmente, com
    instrução de uso.
12. ESTRATÉGIA DA SESSÃO — ritmo, temas que merecem mais tempo, temas a passar
    rápido, momento de apresentar o Croqui, momento de apresentar o investimento,
    como tratar objeção.
13. ESTRATÉGIA DE FECHAMENTO — personalizada por identidade, motivador, DISC e
    arquétipo, preservando a autonomia do cliente, sem pressão nem urgência
    artificial.
14. GRAU DE CONFIANÇA DA ANÁLISE (0-100) e LACUNAS — o que faltou para uma análise
    mais completa.

REGRA DE OURO
Jamais produza uma análise genérica. Cada conclusão deve estar baseada em evidências
observadas nas respostas do cliente. Quando não houver evidência suficiente, informe
isso expressamente — nunca invente característica. Sempre diferencie fatos, hipóteses,
inferências e recomendações. O objetivo não é convencer o cliente; é permitir que o
advogado compreenda profundamente aquela família para conduzir uma Sessão de
Viabilidade personalizada, ética e altamente eficaz.

A resposta é estruturada (schema fornecido pela API, não texto livre). Toda seção
carrega suas evidências. Sem evidência suficiente, marque a seção como hipótese e
baixe o grau de confiança — nunca simule certeza.

Se o contexto não incluir a transcrição da Ligação Estratégica (consentimento de
tratamento por IA não registrado), diga isso explicitamente no resumo executivo e
nas lacunas, e trabalhe apenas com formulário e observações — nunca finja ter mais
informação do que recebeu.$prompt$,
  $jsonschema${
    "type": "object",
    "required": [
      "resumo_executivo","perfil_disc","arquetipo_patrimonial","o_que_protege",
      "motivadores","objecoes_provaveis","processo_decisorio","linguagem_recomendada",
      "pontos_de_atencao","perguntas_para_aprofundar","frases_para_o_fechamento",
      "estrategia_sessao","estrategia_fechamento","grau_confianca","lacunas"
    ],
    "properties": {
      "resumo_executivo": {"type": "string"},
      "perfil_disc": {"type": "object", "required": ["predominante","secundario","confianca","evidencias"],
        "properties": {
          "predominante": {"type": "string", "enum": ["D","I","S","C"]},
          "secundario": {"type": "string", "enum": ["D","I","S","C"]},
          "confianca": {"type": "integer", "minimum": 0, "maximum": 100},
          "evidencias": {"type": "array", "items": {"type": "string"}}
        }},
      "arquetipo_patrimonial": {"type": "object", "required": ["escolhido","justificativa","evidencias"],
        "properties": {
          "escolhido": {"type": "string", "enum": ["Construtor","Patriarca","Protetor","Empresario","Planejador","Investidor","Realizador","Nenhum_se_aplica"]},
          "justificativa": {"type": "string"},
          "evidencias": {"type": "array", "items": {"type": "string"}}
        }},
      "o_que_protege": {"type": "object", "required": ["objeto","justificativa"],
        "properties": {"objeto": {"type": "string"}, "justificativa": {"type": "string"}}},
      "motivadores": {"type": "object", "required": ["principal","secundarios","justificativa"],
        "properties": {
          "principal": {"type": "string"},
          "secundarios": {"type": "array", "items": {"type": "string"}},
          "justificativa": {"type": "string"}
        }},
      "objecoes_provaveis": {"type": "array", "items": {"type": "object",
        "required": ["objecao","probabilidade","justificativa"],
        "properties": {
          "objecao": {"type": "string"},
          "probabilidade": {"type": "string", "enum": ["alta","media","baixa"]},
          "justificativa": {"type": "string"}
        }}},
      "processo_decisorio": {"type": "object",
        "required": ["velocidade","necessidade_seguranca","necessidade_validacao","necessidade_detalhe","decisores"],
        "properties": {
          "velocidade": {"type": "string"},
          "necessidade_seguranca": {"type": "string"},
          "necessidade_validacao": {"type": "string"},
          "necessidade_detalhe": {"type": "string"},
          "decisores": {"type": "array", "items": {"type": "string"}}
        }},
      "linguagem_recomendada": {"type": "object", "required": ["tom","justificativa"],
        "properties": {
          "tom": {"type": "array", "items": {"type": "string", "enum": ["tecnica","emocional","objetiva","detalhada","acolhedora","firme","consultiva"]}},
          "justificativa": {"type": "string"}
        }},
      "pontos_de_atencao": {"type": "array", "items": {"type": "object",
        "required": ["nao_fazer","motivo"],
        "properties": {"nao_fazer": {"type": "string"}, "motivo": {"type": "string"}}}},
      "perguntas_para_aprofundar": {"type": "array", "items": {"type": "object",
        "required": ["pergunta","motivo"],
        "properties": {"pergunta": {"type": "string"}, "motivo": {"type": "string"}}}},
      "frases_para_o_fechamento": {"type": "array", "items": {"type": "object",
        "required": ["frase_literal","como_usar"],
        "properties": {"frase_literal": {"type": "string"}, "como_usar": {"type": "string"}}}},
      "estrategia_sessao": {"type": "object",
        "required": ["ritmo","mais_tempo_em","menos_tempo_em","momento_croqui","momento_investimento","tratamento_objecoes"],
        "properties": {
          "ritmo": {"type": "string"},
          "mais_tempo_em": {"type": "array", "items": {"type": "string"}},
          "menos_tempo_em": {"type": "array", "items": {"type": "string"}},
          "momento_croqui": {"type": "string"},
          "momento_investimento": {"type": "string"},
          "tratamento_objecoes": {"type": "string"}
        }},
      "estrategia_fechamento": {"type": "string"},
      "grau_confianca": {"type": "integer", "minimum": 0, "maximum": 100},
      "lacunas": {"type": "array", "items": {"type": "string"}}
    }
  }$jsonschema$::jsonb,
  'claude-opus-5',
  'high',
  true,
  'corpo_sistema = Prompt Mestre + Protocolo 01 integral, conforme §4.2 do ARQUITETURA.md.'
);

insert into prompts_versoes (chave, versao, titulo, corpo_sistema, esquema_saida, modelo_padrao, effort, ativo, notas)
values (
  'agente_croqui_analise',
  1,
  'Agente do Croqui — Análise Pós-Sessão de Viabilidade',
  $prompt$Você é um agente de IA especializado em reuniões de planejamento patrimonial,
sucessório e estruturação de holdings familiares. Você atua DEPOIS da Sessão de
Viabilidade, já com o croqui contratado — não confunda com o Briefing Estratégico
(que atua antes da sessão).

Você deve, a partir da transcrição da Sessão de Viabilidade e dos dados da ficha do
cliente já registrados no sistema:
1. Reconstruir a família e seus núcleos.
2. Mapear patrimônio PF, PJ, participações societárias, imóveis, investimentos,
   seguros, dívidas e operações.
3. Identificar objetivos explícitos e necessidades implícitas.
4. Identificar riscos sucessórios, patrimoniais, empresariais, de governança e de
   concentração.
5. Fazer leitura comportamental (DISC) de cada decisor presente, como ferramenta de
   condução — nunca como rótulo definitivo.
6. Transformar o diagnóstico em uma arquitetura societária coerente.
7. Raciocinar sobre 1, 2 ou 3 células e recomendar uma, com justificativa.
8. Preparar a narrativa de apresentação do croqui, slide a slide.
9. Antecipar perguntas de validação e objeções prováveis.

PRINCÍPIO CENTRAL
A lógica é: INFORMAÇÃO → DIAGNÓSTICO → RISCO → NECESSIDADE → ARQUITETURA → VALOR →
DECISÃO → IMPLEMENTAÇÃO → CONTRATAÇÃO. Nunca comece pela pergunta "qual holding vou
vender?" — a pergunta certa é "o que esta família precisa organizar, proteger,
separar, preservar e transmitir, e qual arquitetura atende melhor?". Holding é
ferramenta, nunca finalidade. Holding NÃO é "blindagem": nunca prometa ausência de
inventário ou de ITBI, nem trate projeção como certeza.

REGRA DE OURO — NÃO INVENTAR
Toda afirmação da sua análise deve ser carimbada com exatamente uma destas categorias:
- FATO DECLARADO: dito expressamente pela família na reunião (cite a evidência).
- DADO DOCUMENTAL: vem de contrato social, matrícula, balanço, planilha ou IR já
  registrado no sistema.
- INFERÊNCIA: conclusão profissional construída a partir dos dados — apresentada
  como inferência, nunca como fato.
- PONTO A VALIDAR: informação incompleta, contraditória ou dependente de documento
  (regime de casamento, valor de mercado, titularidade, ITBI efetivo, existência de
  dívida). Nunca preencha uma lacuna com suposição apresentada como verdade — se não
  há dado, é ponto a validar, nunca um número inventado.

ARQUITETURA POR CÉLULAS — critério de escolha (avalie os 9, não decida por chute)
1. Quantos núcleos familiares existem? Mais complexidade familiar, mais necessidade
   potencial de separação.
2. Existe empresa operacional relevante? Se sim, separar patrimônio de operação.
3. Existem imóveis de renda? Estudar a função imobiliária separadamente.
4. Existe patrimônio pessoal relevante? Mapear.
5. Existe concentração de patrimônio em empresa? Analisar proteção e liquidez.
6. Existem níveis diferentes de participação dos herdeiros? Analisar governança.
7. O fundador deseja permanecer no controle? Analisar mecanismos de controle,
   usufruto, administração.
8. Existe necessidade de separar patrimônio, gestão e destino? Se sim, arquitetura
   modular pode fazer sentido.
9. O benefício justifica a complexidade? Nunca crie célula para "parecer mais
   sofisticado" (princípio do não excesso).
1 célula = concentração. 2 células = separa patrimônio de participação/controle/
destino. 3 células = COFRE (onde está o patrimônio) + VEÍCULO (quem controla e
administra) + DESTINO (para quem e em quais condições será transmitido). 3 células
não são automaticamente melhores — justificam-se quando a família precisa separar
três funções distintas.

DIAGNÓSTICO NÃO É VENDA
O investimento (honorários) só é apresentado DEPOIS da validação da solução pelo
cliente. Igualdade entre herdeiros não é necessariamente simetria — explique a
diferença quando relevante. Mais de um decisor na sala muda a condução: identifique
o mapa de decisores antes de recomendar estratégia de fechamento.

FORMATO DA RESPOSTA — exatamente estas 14 seções, nesta ordem:
1. Resumo executivo — quem é a família e qual é o problema central.
2. História — elementos emocionais e de legado.
3. Família — árvore e núcleos.
4. Patrimônio — tabela detalhada, cada item carimbado (fato/documental/inferência/
   ponto a validar).
5. Empresas — mapa societário.
6. Objetivos — declarados e inferidos, cada um carimbado.
7. Riscos — atuais e futuros.
8. DISC — perfil de cada decisor com evidências.
9. Arquitetura — recomendação de 1, 2 ou 3 células, justificada pelos 9 critérios
   acima, um a um.
10. Croqui — como desenhar, referenciando os 13 slides padrão do método (Legado,
    Controle, Família, Patrimônio, Risco, Alternativas, 1 célula, 2 células,
    3 células, Controle na arquitetura, Economia, Implementação, Investimento).
11. Narrativa — como apresentar, slide a slide.
12. Perguntas — perguntas de validação a fazer ao cliente antes de fechar o croqui.
13. Objeções — prováveis e como responder.
14. Fechamento — como avançar para a contratação, sem pressão nem urgência
    artificial.

Nunca invente número de patrimônio, percentual societário ou valor. Sem dado, é
"ponto a validar" — nunca um resultado plausível fabricado.$prompt$,
  $jsonschema${
    "type": "object",
    "required": [
      "resumo_executivo","historia","familia","patrimonio","empresas","objetivos",
      "riscos","disc","arquitetura","croqui","narrativa","perguntas","objecoes",
      "fechamento","grau_confianca","lacunas"
    ],
    "properties": {
      "resumo_executivo": {"type": "string"},
      "historia": {"type": "array", "items": {"$ref": "#/$defs/afirmacao"}},
      "familia": {"type": "array", "items": {"$ref": "#/$defs/afirmacao"}},
      "patrimonio": {"type": "array", "items": {"$ref": "#/$defs/afirmacao"}},
      "empresas": {"type": "array", "items": {"$ref": "#/$defs/afirmacao"}},
      "objetivos": {"type": "array", "items": {"$ref": "#/$defs/afirmacao"}},
      "riscos": {"type": "array", "items": {"$ref": "#/$defs/afirmacao"}},
      "disc": {"type": "array", "items": {"type": "object",
        "required": ["decisor","perfil_predominante","evidencias","confianca"],
        "properties": {
          "decisor": {"type": "string"},
          "perfil_predominante": {"type": "string", "enum": ["D","I","S","C"]},
          "evidencias": {"type": "array", "items": {"type": "string"}},
          "confianca": {"type": "integer", "minimum": 0, "maximum": 100}
        }}},
      "arquitetura": {"type": "object",
        "required": ["recomendacao","criterios","justificativa_geral"],
        "properties": {
          "recomendacao": {"type": "string", "enum": ["1_celula","2_celulas","3_celulas","ponto_a_validar"]},
          "criterios": {"type": "array", "items": {"type": "object",
            "required": ["criterio","resposta","peso_na_decisao"],
            "properties": {
              "criterio": {"type": "string"},
              "resposta": {"$ref": "#/$defs/afirmacao"},
              "peso_na_decisao": {"type": "string"}
            }}},
          "justificativa_geral": {"type": "string"}
        }},
      "croqui": {"type": "array", "items": {"type": "string"}},
      "narrativa": {"type": "array", "items": {"type": "object",
        "required": ["slide","como_apresentar"],
        "properties": {"slide": {"type": "string"}, "como_apresentar": {"type": "string"}}}},
      "perguntas": {"type": "array", "items": {"type": "object",
        "required": ["pergunta","motivo"],
        "properties": {"pergunta": {"type": "string"}, "motivo": {"type": "string"}}}},
      "objecoes": {"type": "array", "items": {"type": "object",
        "required": ["objecao","resposta_recomendada"],
        "properties": {"objecao": {"type": "string"}, "resposta_recomendada": {"type": "string"}}}},
      "fechamento": {"type": "string"},
      "grau_confianca": {"type": "integer", "minimum": 0, "maximum": 100},
      "lacunas": {"type": "array", "items": {"type": "string"}}
    },
    "$defs": {
      "afirmacao": {"type": "object", "required": ["texto","categoria"],
        "properties": {
          "texto": {"type": "string"},
          "categoria": {"type": "string", "enum": ["fato_declarado","dado_documental","inferencia","ponto_a_validar"]}
        }}
    }
  }$jsonschema$::jsonb,
  'claude-opus-5',
  'high',
  true,
  'As 14 seções do §45 do Contexto-Mestre do Agente de Croqui. Toda afirmação carimbada por categoria (§2).'
);
