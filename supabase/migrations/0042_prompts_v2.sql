-- 0042_prompts_v2.sql
-- ARQUITETURA-FASE-3.md §1 — Onda 1, agente A (backend-ia).
--
-- Três coisas, todas ADITIVAS:
--
-- (a) v2 do prompt `protocolo_01_briefing` — L3 (enums onde o método já
--     enumera: `processo_decisorio.*`, `nivel_autoridade` e
--     `decisores_presentes_na_sessao`, exigidos pelo POP 03 e ausentes do
--     schema até aqui; `estrategia_sessao.ritmo`). NENHUMA linha do texto do
--     Protocolo 01 (v1) é removida ou reescrita — só um parágrafo novo no
--     final, instruindo o formato dos campos estruturados. O bloco de
--     orçamento de escrita (L2, §1.4) NÃO mora aqui: fica em código
--     (`src/server/ia/orcamento-escrita.ts`), anexado em runtime e
--     controlado por `ia.orcamento_escrita_ativo` — é o que permite ligar/
--     desligar sem `UPDATE prompts_versoes`.
--
--     Nasce INATIVA (`ativo=false`). Só é promovida (`UPDATE ... SET ativo`)
--     depois que `scripts/bancada-ia.ts` medir, contra o baseline da v1, que
--     o gate do §1.9 passa (custo cai; cobertura de evidência e ancoragem
--     dentro da variância do baseline; grau de confiança não cai) — BLOQUEIO
--     B22. A v1 nunca é apagada: é o rollback.
--
-- (b) Chaves novas em `configuracoes` — todas "VALOR INICIAL, não vem do
--     método" (nenhum POP diz o peso de completude nem o limiar mínimo):
--     `ia.completude_pesos`, `ia.completude_minima_briefing` (porta de
--     completude, L4, §1.7) e `ia.orcamento_escrita_ativo` (L2, §1.4).
--
-- (c) `registrar_briefing` ganha 2 parâmetros opcionais (com default),
--     `p_completude_entrada` e `p_verificacao`, para persistir o score da
--     porta de completude e o resultado da verificação de fidelidade (§1.8).
--     DROP explícito da assinatura antiga ANTES do CREATE — armadilha 6 desta
--     base: `create or replace function` com parâmetro novo cria SOBRECARGA,
--     não substitui, e a chamada existente (6 args nomeados via PostgREST)
--     ficaria ambígua entre as duas. Só `briefing.ts` e `demonstracao.ts`
--     chamam esta função (conferido no código) — os dois são fronteira deste
--     agente, e o de demonstração continua funcionando sem alteração (os 2
--     novos parâmetros nascem `null` por default).
--
-- Reversão: `UPDATE prompts_versoes SET ativo = (versao = 1) WHERE chave =
-- 'protocolo_01_briefing'` + `DELETE FROM configuracoes WHERE chave LIKE
-- 'ia.completude%' OR chave = 'ia.orcamento_escrita_ativo'` + recriar
-- `registrar_briefing` na assinatura antiga (texto preservado no comentário
-- acima). Nenhum DELETE em dado de cliente; nenhuma linha de `briefings`
-- existente é tocada.

-- ===========================================================================
-- (0) Rede de segurança — ARMADILHA 8 desta base ("o repo não é o banco
-- publicado"): esta sessão não teve `SUPABASE_SERVICE_ROLE_KEY` disponível
-- localmente para confirmar no banco se `execucoes_ia.effort`/`.variante` e
-- `briefings.completude_entrada`/`.verificacao` (relatadas como aplicadas via
-- uma migration `0041b` que não existe neste checkout) realmente existem.
-- `IF NOT EXISTS` torna isto idempotente nos dois cenários: no-op se já
-- existirem (onda 0 aplicada de verdade), ou fecha o buraco sozinho se não
-- existirem — sem isto, TODA chamada de `executarComAuditoria()` (briefing,
-- croqui-analise, material, ordenar-horarios) quebraria no INSERT.
-- ===========================================================================
alter table execucoes_ia add column if not exists effort text;
alter table execucoes_ia add column if not exists variante text;
alter table briefings add column if not exists completude_entrada smallint;
alter table briefings add column if not exists verificacao jsonb;

comment on column execucoes_ia.effort is
  'Effort efetivamente usado na chamada (pode divergir de prompts_versoes.effort quando a bancada usa effortOverride). NULL = execução anterior a esta coluna.';
comment on column execucoes_ia.variante is
  'Rótulo da variante medida pela bancada (scripts/bancada-ia.ts) — ex. "baseline", "effort_low", "prompt_v2". NULL em toda execução de produto real; nunca setável por rota HTTP.';
comment on column briefings.completude_entrada is
  'Score da porta de completude (L4, ARQUITETURA-FASE-3.md §1.7) no momento da geração — 0 a 100. NULL em modo demonstração (não passa pela porta) e em briefings gerados antes desta coluna existir.';
comment on column briefings.verificacao is
  'Resultado da verificação de fidelidade (§1.8): frases de fechamento localizadas/não-localizadas no material de entrada e cobertura de evidência. NULL em modo demonstração e em briefings anteriores a esta coluna.';

-- ===========================================================================
-- (a) v2 do protocolo_01_briefing — mesmo modelo/effort da v1 (BLOQUEIO B23:
-- não troco modelo por custo). Fica INATIVA até a bancada aprovar.
-- ===========================================================================
insert into prompts_versoes (chave, versao, titulo, corpo_sistema, esquema_saida, modelo_padrao, effort, ativo, notas)
values (
  'protocolo_01_briefing',
  2,
  'Protocolo 01 — Interpretação Estratégica do Cliente (Briefing Estratégico) — v2, campos estruturados',
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
informação do que recebeu.

CAMPOS ESTRUTURADOS (v2) — o Protocolo 01 já enumera estas opções (item 7 acima e
POP 03); responda com o valor exato de uma lista fechada, nunca com dissertação:

- processo_decisorio.velocidade: um destes exatamente — "rapida", "media", "lenta",
  "indefinida".
- processo_decisorio.necessidade_seguranca / necessidade_validacao /
  necessidade_detalhe: um destes exatamente, cada um — "alta", "media", "baixa",
  "indefinida".
- processo_decisorio.nivel_autoridade — exigido pelo POP 03, "nível de autoridade
  para decidir": um destes exatamente — "decide_sozinho", "decide_com_conjuge",
  "decide_com_socios", "nao_decide", "indefinido".
- processo_decisorio.decisores_presentes_na_sessao — exigido pelo POP 03: um destes
  exatamente — "sim", "nao", "indefinido".
- estrategia_sessao.ritmo: um destes exatamente — "lento", "moderado", "rapido".

Cada um destes campos tem um campo irmão "_nota" (ex.: "velocidade_nota") — uma
frase curta com a evidência observada que embasa a escolha, a MESMA evidência que
você usaria para escrever o parágrafo antigo, só que agora separada da categoria.
"indefinida"/"indefinido" é resposta honesta e válida quando não há evidência —
jamais escolha um valor plausível sem lastro só para preencher a categoria; isso
seria exatamente o que a REGRA DE OURO proíbe.$prompt$,
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
        "required": [
          "velocidade","velocidade_nota","necessidade_seguranca","necessidade_seguranca_nota",
          "necessidade_validacao","necessidade_validacao_nota","necessidade_detalhe","necessidade_detalhe_nota",
          "nivel_autoridade","nivel_autoridade_nota","decisores_presentes_na_sessao",
          "decisores_presentes_na_sessao_nota","decisores"
        ],
        "properties": {
          "velocidade": {"type": "string", "enum": ["rapida","media","lenta","indefinida"]},
          "velocidade_nota": {"type": "string"},
          "necessidade_seguranca": {"type": "string", "enum": ["alta","media","baixa","indefinida"]},
          "necessidade_seguranca_nota": {"type": "string"},
          "necessidade_validacao": {"type": "string", "enum": ["alta","media","baixa","indefinida"]},
          "necessidade_validacao_nota": {"type": "string"},
          "necessidade_detalhe": {"type": "string", "enum": ["alta","media","baixa","indefinida"]},
          "necessidade_detalhe_nota": {"type": "string"},
          "nivel_autoridade": {"type": "string", "enum": ["decide_sozinho","decide_com_conjuge","decide_com_socios","nao_decide","indefinido"]},
          "nivel_autoridade_nota": {"type": "string"},
          "decisores_presentes_na_sessao": {"type": "string", "enum": ["sim","nao","indefinido"]},
          "decisores_presentes_na_sessao_nota": {"type": "string"},
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
        "required": ["ritmo","ritmo_nota","mais_tempo_em","menos_tempo_em","momento_croqui","momento_investimento","tratamento_objecoes"],
        "properties": {
          "ritmo": {"type": "string", "enum": ["lento","moderado","rapido"]},
          "ritmo_nota": {"type": "string"},
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
  'anthropic/claude-sonnet-5',
  'high',
  false,
  'v2 (L3, ARQUITETURA-FASE-3.md §1.5): enums em processo_decisorio + novos ' ||
  'nivel_autoridade/decisores_presentes_na_sessao (POP 03, ausentes até aqui) + ' ||
  'estrategia_sessao.ritmo. Orçamento de escrita (L2) NÃO está neste texto: vive em ' ||
  'src/server/ia/orcamento-escrita.ts, anexado em runtime via ia.orcamento_escrita_ativo. ' ||
  'Nasce INATIVA — promover só depois do gate da bancada (§1.9, BLOQUEIO B22): ' ||
  'UPDATE prompts_versoes SET ativo = true WHERE chave = ''protocolo_01_briefing'' AND versao = 2; ' ||
  'UPDATE prompts_versoes SET ativo = false WHERE chave = ''protocolo_01_briefing'' AND versao = 1.'
)
on conflict (chave, versao) do nothing;

-- ===========================================================================
-- (b) Chaves novas em `configuracoes` — todas "VALOR INICIAL, não vem do
-- método" (BLOQUEIO B24). `on conflict do nothing`: migration idempotente se
-- reaplicada em dev; nunca sobrescreve um valor já ajustado em produção.
-- ===========================================================================
insert into configuracoes (chave, valor, descricao) values
 ('ia.completude_pesos',
  '{"formulario":25,"ligacao":20,"patrimonio":15,"frases":10,"decisorio":10,"familia":10,"transcricao":10}'::jsonb,
  'VALOR INICIAL, não vem do método (BLOQUEIO B24). Peso de cada sinal no score de completude do Briefing (0-100). Soma = 100.'),
 ('ia.completude_minima_briefing', '40'::jsonb,
  'VALOR INICIAL, não vem do método (BLOQUEIO B24). Score mínimo de completude para gerar o Briefing sem forcar_mesmo_assim. Calibrar em ~30 dias pela correlação completude_entrada × grau_confianca (vw_custo_ia_por_prompt).'),
 ('ia.orcamento_escrita_ativo', 'true'::jsonb,
  'Liga/desliga o bloco de orçamento de escrita (L2) anexado ao prompt do Briefing em runtime, sem deploy. Texto em src/server/ia/orcamento-escrita.ts.')
on conflict (chave) do nothing;

-- ===========================================================================
-- (c) `registrar_briefing` — DROP explícito da assinatura antiga antes do
-- CREATE (armadilha 6 desta base: parâmetro novo em `create or replace`
-- cria sobrecarga, não substitui). Novos parâmetros com DEFAULT null:
-- chamada existente de `demonstracao.ts` (6 args nomeados, sem os 2 novos)
-- continua válida sem alteração — modo demonstração não passa pela porta de
-- completude nem pela verificação de fidelidade, então null é o valor certo,
-- não um placeholder.
-- ===========================================================================
drop function if exists public.registrar_briefing(uuid, uuid, jsonb, smallint, text[], boolean);

-- `create or replace` (não `create`) por segurança: se a `0041b` ausente
-- deste checkout já tiver criado esta função com a assinatura de 8
-- parâmetros abaixo, isto substitui em vez de falhar com "already exists".
create or replace function public.registrar_briefing(
  p_jornada_id uuid, p_execucao_id uuid, p_conteudo jsonb,
  p_grau_confianca smallint, p_fontes_usadas text[], p_modo_reduzido boolean,
  p_completude_entrada smallint default null, p_verificacao jsonb default null
) returns briefings
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_versao smallint; v_linha briefings;
begin
  update briefings set atual = false where jornada_id = p_jornada_id and atual;
  select coalesce(max(versao), 0) + 1 into v_versao from briefings where jornada_id = p_jornada_id;
  insert into briefings (jornada_id, execucao_id, versao, conteudo, grau_confianca,
                         fontes_usadas, modo_reduzido, completude_entrada, verificacao, atual)
  values (p_jornada_id, p_execucao_id, v_versao, p_conteudo, p_grau_confianca,
          p_fontes_usadas, p_modo_reduzido, p_completude_entrada, p_verificacao, true)
  returning * into v_linha;
  return v_linha;
end $$;
-- Mesma regra da 0009: só o service_role chama isto (a rota de briefing).
-- Não expor a anon/authenticated — conteúdo, fontes, completude e verificação
-- nunca podem ser forjados pelo cliente.
revoke execute on function public.registrar_briefing from public, anon, authenticated;
grant  execute on function public.registrar_briefing to service_role;
