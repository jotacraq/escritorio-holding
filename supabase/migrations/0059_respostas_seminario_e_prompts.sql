-- 0059_respostas_seminario_e_prompts.sql
-- ARQUITETURA-FASE-4.md §4.4, §4.6, §5 — Onda 1, agente E (backend-ia-briefing-croqui).
--
-- Quatro coisas, todas ADITIVAS (nenhum DELETE; nenhum UPDATE em valor de
-- linha de cliente; nenhuma pessoa muda de faixa, papel, etapa ou desfecho):
--
-- (a) `respostas_seminario` — o que a pessoa respondeu nas pesquisas do
--     seminário, por pessoa × edição × pergunta. Importável via `importacoes` (colunas marcadas "Pergunta do seminário:
--     <cabeçalho>", enviadas no campo `perguntas_seminario` do multipart —
--     contrato de src/types/importacao.ts: `PerguntasSeminario = string[]`).
--     NUNCA sobrescreve resposta já existente (`on conflict do nothing`);
--     `origem_dado` carimbado da edição.
--     Sem UPDATE/DELETE: é histórico. É a fonte nova nº 1 do Briefing
--     "modelo do Juliano" (`src/server/ia/contexto-briefing.ts`, `seminario`).
--
-- (b) `importacoes` ganha `perguntas_seminario` (jsonb string[], a lista de
--     cabeçalhos marcados) e `respostas_seminario` (int, quantas respostas a
--     confirmação gravou — volta em GET /api/importacoes/[id]).
--     `confirmar_importacao` (0035) passa a gravar `respostas_seminario` por
--     linha, lendo essa lista e `importacoes_linhas.dados->'bruto'->><cabeçalho>`.
--     MESMA assinatura (uuid) → `create or replace` substitui de verdade
--     (armadilha 6 só morde quando a assinatura muda). Nada muda para quem
--     já importou: lista nula/vazia = comportamento idêntico.
--
-- (c) `patrimonio_itens.origem_valor` — procedência de `valor_mercado`
--     ('digitado' | 'transcricao' | 'documento'), NULL para tudo que já existe
--     (nasce vazio, B28). É a coluna que o botão "usar como valor de mercado
--     deste bem" (Ficha, agente H — a partir de `patrimonio[].valor_declarado`
--     da análise v2) carimba com 'transcricao'. Sem backfill.
--
-- (d) Prompts NOVOS, os dois `ativo = false`:
--       • `protocolo_01_briefing` v3 — todas as fontes (seminário, CNPJ público,
--         ligação por IA) + seção `linguagem_do_cliente` ("como ele fala").
--       • `agente_croqui_analise` v2 — 13 slides tipados + `arquitetura.alocacao`
--         + `patrimonio[].valor_declarado` + regra de ECONOMIA como diferença
--         entre totais digitados pela advogada (a IA nunca inventa alíquota, B26).
--     Versões antigas ficam intactas (são o rollback). O código é bi-versão
--     (`schemaBriefingParaVersao`, `schemaVersaoDoPrompt`): a versão ATIVA
--     decide o schema exigido — por isso ativar é só UPDATE, sem deploy, e por
--     isso NÃO ativar aqui é seguro: produção continua na v1/v2 medida.
--
-- ===========================================================================
-- TETO DE GRAMÁTICA — LEIA ANTES DE ATIVAR QUALQUER PROMPT ABAIXO
-- (CONTINUAR-AQUI.md §0 item 1; brain/04 - Tecnico/Custo da IA.md)
-- O provedor compila o JSON Schema estrito do lado dele e recusa com
-- `400 The compiled grammar is too large`. Medido em 04/09/2026 (briefing):
-- 3.905 bytes compila, 4.428 não. Isso NÃO aparece em tsc/eslint/build.
--
-- Bytes medidos nesta entrega, com
--   Buffer.byteLength(JSON.stringify(paraJsonSchemaEstrito(schema)))  (04/09/2026):
--   briefing v2 (produção hoje) ........ 3.813 bytes  (compilou em 04/09)
--   briefing v3 (esta migration) ....... 3.877 bytes  ✓ ≤ 3.900 — abaixo do teto conhecido
--   croqui v1 (produção hoje) .......... 4.133 bytes  (nunca medido pela sonda — ver roteiro)
--   croqui v2 (esta migration) ......... 4.959 bytes  (acima do teto do BRIEFING; o croqui
--                                                      tem o próprio teto — só a sonda diz)
--
-- RESULTADO DA SONDA (colar aqui ANTES de rodar qualquer UPDATE de ativação —
-- regra de publicação do §4.6; sem OPENROUTER_API_KEY local, não rodou nesta
-- rodada):
--   POST /api/admin/sonda-schema {"chave":"briefing_v3"}  → sonda AAAA-MM-DD · briefing_v3 · ____ bytes · ____________
--   POST /api/admin/sonda-schema {"chave":"croqui_v2"}    → sonda AAAA-MM-DD · croqui_v2 · ____ bytes · ____________
--   POST /api/admin/sonda-schema {"chave":"croqui_v1"}    → sonda AAAA-MM-DD · croqui_v1 · ____ bytes · ____________
--   (a resposta traz `para_colar` já neste formato; `cheio_sem_min_max_items`
--    diz se é o `.length()` dos arrays que o provedor recusa)
--
-- ATIVAÇÃO (só depois da sonda "compilou" + bancada aprovada — comandos
-- deixados em comentário de propósito; NENHUM roda nesta migration):
--   -- briefing v3 (ou: npx tsx scripts/bancada-ia.ts --variantes=baseline,v3_fontes --promover=v3_fontes)
--   -- update prompts_versoes set ativo = false where chave = 'protocolo_01_briefing' and versao <> 3;
--   -- update prompts_versoes set ativo = true  where chave = 'protocolo_01_briefing' and versao = 3;
--   -- croqui v2
--   -- update prompts_versoes set ativo = false where chave = 'agente_croqui_analise' and versao <> 2;
--   -- update prompts_versoes set ativo = true  where chave = 'agente_croqui_analise' and versao = 2;
--   Reversão de qualquer um: `update prompts_versoes set ativo = (versao = <anterior>) where chave = '<chave>'`.
--
-- CUSTO (§5.3, a confirmar na bancada — nenhuma chamada nova; a mesma
-- execução recebe contexto maior e escreve uma seção a mais). Tetos de
-- entrada em contexto-briefing.ts: 12 respostas × 400 chars, 5 empresas,
-- resumo IA 1.500 chars, transcrição IA 6.000 chars (só com tratamento_ia).
-- Preço de `anthropic/claude-sonnet-5` (modelos_ia_precos, 0040): US$ 2/Mtok
-- entrada, US$ 10/Mtok saída. Caso típico (seminário + 1-2 empresas, sem
-- transcrição IA): +~1.700 tokens de entrada ≈ +US$ 0,0034; saída
-- `linguagem_do_cliente` ~150 tokens ≈ +US$ 0,0015 → de US$ 0,0397 (low,
-- medido 04/09) para ≈ US$ 0,045. Pior caso (transcrição IA consentida no
-- teto de 6.000 chars, +~1.500 tokens): ≈ US$ 0,048 — acima da meta; se a
-- bancada confirmar, baixar LIGACAO_IA_MAX_CHARS_TRANSCRICAO para 4.000.
-- Bytes de contexto antes/depois: `npx tsx scripts/bancada-ia.ts --so-bytes`
-- (zero IA) — colar o resultado por fixture aqui:
--   fixture pobre: ____ → ____ bytes (____%) · media: ____ → ____ (____%) · rica: ____ → ____ (____%)
-- ===========================================================================

-- ===========================================================================
-- (a) respostas_seminario
-- ===========================================================================
create table if not exists respostas_seminario (
  id            uuid primary key default gen_random_uuid(),
  pessoa_id     uuid not null references pessoas(id) on delete cascade,
  edicao_id     uuid not null references edicoes_seminario(id) on delete restrict,
  pergunta      text not null check (length(pergunta) between 1 and 300),
  resposta      text not null check (length(resposta) between 1 and 2000),
  origem        text not null default 'importacao' check (origem in ('importacao','manual')),
  importacao_id uuid references importacoes(id) on delete set null,
  origem_dado   text not null default 'real' check (origem_dado in ('real','exemplo')),
  criado_em     timestamptz not null default now(),
  criado_por    uuid references perfis_equipe(id),
  unique (pessoa_id, edicao_id, pergunta)
);
create index if not exists idx_respostas_seminario_pessoa on respostas_seminario (pessoa_id, criado_em);
create index if not exists idx_respostas_seminario_edicao on respostas_seminario (edicao_id);

comment on table respostas_seminario is
  'Fase 4 §5 — respostas da pessoa às pesquisas do seminário (por pessoa × edição × '
  'pergunta). Fonte do Briefing (contexto-briefing.ts: seminario.respostas, até 12 × '
  '400 chars). Gravada por confirmar_importacao (cabeçalhos listados em '
  'importacoes.perguntas_seminario) ou à mão (origem=manual). Sem UPDATE/DELETE: histórico. '
  'Nunca sobrescreve: unique (pessoa, edição, pergunta) + on conflict do nothing.';
comment on column respostas_seminario.pergunta is
  'Texto EXATO do cabeçalho da coluna do CSV (é a pergunta como foi feita). Não normalizar — a unicidade é por este texto.';
comment on column respostas_seminario.origem_dado is
  'Carimbado da edição (edicoes_seminario.origem_dado) na confirmação da importação; exemplo nunca vira real.';

-- Colunas novas em `importacoes` (nascem vazias; nenhuma importação antiga muda).
alter table importacoes add column if not exists perguntas_seminario jsonb
  check (perguntas_seminario is null or jsonb_typeof(perguntas_seminario) = 'array');
alter table importacoes add column if not exists respostas_seminario int not null default 0
  check (respostas_seminario >= 0);
comment on column importacoes.perguntas_seminario is
  'Fase 4: cabeçalhos do CSV marcados como "Pergunta do seminário" (string[]). NULL = nenhuma (contrato antigo).';
comment on column importacoes.respostas_seminario is
  'Fase 4: quantas linhas de respostas_seminario a confirmação gravou de fato (on conflict do nothing não conta).';

alter table respostas_seminario enable row level security;
alter table respostas_seminario force row level security;

-- Leitura: qualquer papel interno (dado operacional; não é valor de patrimônio).
create policy rsem_sel on respostas_seminario for select to authenticated
  using ((select app.eh_interno()));
-- Escrita: os mesmos papéis que importam/abrem jornada (0035 imp_ins).
create policy rsem_ins on respostas_seminario for insert to authenticated
  with check ((select app.papel()) in ('admin','advogada','relacionamento'));
-- Sem policy de UPDATE nem DELETE: resposta importada é histórico (ver comment).

revoke all on respostas_seminario from public, anon;
grant select, insert on respostas_seminario to authenticated;
grant select, insert on respostas_seminario to service_role;

-- ===========================================================================
-- (c) patrimonio_itens.origem_valor — nasce NULL para tudo (B28: nada é
-- convertido; nenhum valor existente ganha procedência retroativa).
-- ===========================================================================
alter table patrimonio_itens add column if not exists origem_valor text
  check (origem_valor is null or origem_valor in ('digitado','transcricao','documento'));

comment on column patrimonio_itens.origem_valor is
  'Procedência de valor_mercado: digitado (advogada), transcricao (botão "usar como '
  'valor de mercado" a partir de patrimonio[].valor_declarado da Análise v2 — ação '
  'humana, nunca automática), documento (IR/contrato). NULL = anterior a esta coluna '
  'ou sem procedência registrada. Nunca preenchido por backfill.';

-- ===========================================================================
-- (b) confirmar_importacao — mesma assinatura da 0035, corpo estendido:
-- depois de resolver pessoa_id da linha (nova, jornada nova OU já existente),
-- grava as respostas das colunas mapeadas como 'pergunta_seminario'.
-- `security invoker` mantido: quem confirma passa pela RLS de
-- respostas_seminario (rsem_ins), 2ª trava depois da checagem de papel.
-- ===========================================================================
create or replace function public.confirmar_importacao(p_importacao_id uuid)
returns importacoes
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_importacao importacoes;
  v_linha      importacoes_linhas;
  v_pessoa_id  uuid;
  v_jornada_id uuid;
  v_ref_numero int;
  v_pessoas_novas      int := 0;
  v_pessoas_existentes int := 0;
  v_jornadas_novas     int := 0;
  v_ignoradas          int := 0;
  v_com_erro           int := 0;
  v_ator uuid;
  -- Fase 4: cabeçalhos marcados como pergunta do seminário (a pergunta é o
  -- próprio cabeçalho); origem_dado vem da edição, nunca é adivinhado.
  v_colunas_pergunta text[];
  v_origem_dado_edicao text;
  v_coluna text;
  v_resposta text;
  v_respostas_gravadas int := 0;
  v_inseridas int;
begin
  if (select app.papel()) not in ('admin','advogada','relacionamento') then
    raise exception 'sem_permissao_para_confirmar_importacao' using errcode = '42501';
  end if;

  select id into v_ator from perfis_equipe where auth_user_id = auth.uid() and ativo;

  select * into v_importacao from importacoes where id = p_importacao_id for update;
  if not found then
    raise exception 'importacao_nao_encontrada' using errcode = 'P0002';
  end if;
  if v_importacao.status <> 'previa' then
    raise exception 'importacao_ja_processada: status atual e %', v_importacao.status
      using errcode = 'check_violation';
  end if;

  select coalesce(array_agg(p.valor order by p.ordem), '{}'::text[])
    into v_colunas_pergunta
    from jsonb_array_elements_text(coalesce(v_importacao.perguntas_seminario, '[]'::jsonb))
         with ordinality as p(valor, ordem)
   where btrim(p.valor) <> '';

  select origem_dado into v_origem_dado_edicao
    from edicoes_seminario where id = v_importacao.edicao_id;

  for v_linha in
    select * from importacoes_linhas where importacao_id = p_importacao_id order by numero
  loop
    v_pessoa_id := null;

    if v_linha.resultado = 'erro' then
      v_com_erro := v_com_erro + 1;

    elsif v_linha.resultado = 'ignorada_jornada_aberta' then
      -- Zero escrita, de propósito: o invariante `uniq_jornada_aberta_por_pessoa`
      -- (0004) impede abrir outra jornada. `pessoa_id`/`jornada_id` já vieram
      -- preenchidos da prévia (informativo) e não são tocados aqui.
      -- Respostas do seminário TAMBÉM não: a linha foi ignorada inteira — se a
      -- pessoa respondeu de novo noutra edição, a tela deve registrar à mão.
      v_ignoradas := v_ignoradas + 1;

    elsif v_linha.resultado = 'pessoa_existente' then
      v_pessoas_existentes := v_pessoas_existentes + 1;
      -- Duplicata dentro do PRÓPRIO arquivo: a linha original (numero menor,
      -- já processada nesta mesma passada ascendente) só ganhou pessoa/jornada
      -- reais agora, na confirmação — a prévia não podia saber o id. Resolve
      -- por referência de linha, não por dado repetido em SQL.
      if v_linha.pessoa_id is null and v_linha.motivo like 'duplicata_da_linha:%' then
        v_ref_numero := substring(v_linha.motivo from 'duplicata_da_linha:(\d+)')::int;
        select pessoa_id, jornada_id into v_pessoa_id, v_jornada_id
          from importacoes_linhas
         where importacao_id = p_importacao_id and numero = v_ref_numero;
        update importacoes_linhas set pessoa_id = v_pessoa_id, jornada_id = v_jornada_id
         where id = v_linha.id;
      else
        -- `pessoa_id` já veio preenchido da prévia (identidade já existia no
        -- banco antes desta importação) — já está linkado; só as respostas
        -- do seminário desta linha ainda podem entrar (abaixo, sem sobrescrever).
        v_pessoa_id := v_linha.pessoa_id;
      end if;

    else -- 'pessoa_nova' ou 'jornada_nova': os dois únicos casos que escrevem pessoa/jornada.
      begin
        if v_linha.resultado = 'pessoa_nova' then
          insert into pessoas (
            nome, email, telefone, cidade, uf, profissao, faixa_etaria,
            estado_civil, observacoes, criado_por
          ) values (
            v_linha.dados #>> '{normalizado,nome}',
            nullif(v_linha.dados #>> '{normalizado,email}', ''),
            nullif(v_linha.dados #>> '{normalizado,telefone}', ''),
            nullif(v_linha.dados #>> '{normalizado,cidade}', ''),
            nullif(v_linha.dados #>> '{normalizado,uf}', ''),
            nullif(v_linha.dados #>> '{normalizado,profissao}', ''),
            nullif(v_linha.dados #>> '{normalizado,faixa_etaria}', ''),
            nullif(v_linha.dados #>> '{normalizado,estado_civil}', ''),
            nullif(v_linha.dados #>> '{normalizado,observacoes}', ''),
            v_ator
          )
          returning id into v_pessoa_id;
          v_pessoas_novas := v_pessoas_novas + 1;
        else
          -- 'jornada_nova': identidade já resolvida contra o banco na prévia.
          v_pessoa_id := v_linha.pessoa_id;
        end if;

        insert into jornadas (pessoa_id, edicao_id, origem, trilha, criado_por)
        values (v_pessoa_id, v_importacao.edicao_id, 'seminario', 'seminario', v_ator)
        returning id into v_jornada_id;
        v_jornadas_novas := v_jornadas_novas + 1;

        insert into participacoes_seminario (pessoa_id, edicao_id, origem, dias_assistidos)
        values (
          v_pessoa_id, v_importacao.edicao_id, 'seminario',
          nullif(v_linha.dados #>> '{normalizado,dias_assistidos}', '')::smallint
        )
        on conflict (pessoa_id, edicao_id) do nothing;

        update importacoes_linhas set pessoa_id = v_pessoa_id, jornada_id = v_jornada_id
         where id = v_linha.id;

        perform app.registrar_evento_timeline(v_jornada_id, 'importacao',
          'Jornada criada por importação de leads',
          'Arquivo "' || v_importacao.arquivo_nome || '", linha ' || v_linha.numero,
          jsonb_build_object('importacao_id', p_importacao_id, 'linha_numero', v_linha.numero));

      exception when others then
        -- Não aborta a importação inteira por causa de UMA linha (ex.: corrida
        -- rara em que outra escrita já criou a mesma pessoa entre a prévia e
        -- a confirmação). O BEGIN/EXCEPTION aqui é um SAVEPOINT implícito:
        -- desfaz só as escritas desta linha, mantém as anteriores da mesma
        -- transação.
        v_com_erro := v_com_erro + 1;
        v_pessoa_id := null; -- linha falhou: nenhuma resposta entra em nome dela
        update importacoes_linhas
           set resultado = 'erro',
               motivo = coalesce(v_linha.motivo || ' | ', '') || 'falha_na_confirmacao: ' || sqlerrm
         where id = v_linha.id;
      end;
    end if;

    -- Fase 4 — respostas do seminário desta linha. Só com pessoa resolvida e
    -- só para as colunas mapeadas como pergunta; célula vazia não vira linha;
    -- resposta já existente para (pessoa, edição, pergunta) NUNCA é
    -- sobrescrita. Falha aqui (ex.: texto além do CHECK) não derruba a
    -- pessoa/jornada já gravadas: SAVEPOINT próprio, aviso no motivo.
    if v_pessoa_id is not null and coalesce(array_length(v_colunas_pergunta, 1), 0) > 0 then
      begin
        foreach v_coluna in array v_colunas_pergunta loop
          v_resposta := nullif(btrim(v_linha.dados #>> array['bruto', v_coluna]), '');
          if v_resposta is null then
            continue;
          end if;
          insert into respostas_seminario
            (pessoa_id, edicao_id, pergunta, resposta, origem, importacao_id, origem_dado, criado_por)
          values
            (v_pessoa_id, v_importacao.edicao_id, left(v_coluna, 300), left(v_resposta, 2000),
             'importacao', p_importacao_id, coalesce(v_origem_dado_edicao, 'real'), v_ator)
          on conflict (pessoa_id, edicao_id, pergunta) do nothing;
          get diagnostics v_inseridas = row_count;
          v_respostas_gravadas := v_respostas_gravadas + v_inseridas;
        end loop;
      exception when others then
        update importacoes_linhas
           set motivo = coalesce(motivo || ' | ', '') || 'respostas_seminario_nao_gravadas: ' || sqlerrm
         where id = v_linha.id;
      end;
    end if;
  end loop;

  update importacoes
     set status = 'confirmada',
         confirmada_em = now(),
         confirmada_por = v_ator,
         pessoas_novas = v_pessoas_novas,
         pessoas_existentes = v_pessoas_existentes,
         jornadas_novas = v_jornadas_novas,
         ignoradas = v_ignoradas,
         com_erro = v_com_erro,
         respostas_seminario = v_respostas_gravadas
   where id = p_importacao_id
   returning * into v_importacao;

  return v_importacao;
end $$;

revoke execute on function public.confirmar_importacao(uuid) from public, anon;
grant  execute on function public.confirmar_importacao(uuid) to authenticated;

comment on function public.confirmar_importacao(uuid) is
  'Fase 2 da importação de leads (0035): grava de verdade em pessoas/jornadas/'
  'participacoes_seminario a partir da prévia já calculada. Idempotente contra '
  're-chamada acidental — status <> ''previa'' recusa com erro, nunca reprocessa. '
  'Fase 4 (0059): também grava respostas_seminario para os cabeçalhos listados em '
  'importacoes.perguntas_seminario, sem nunca sobrescrever resposta existente, e '
  'carimba importacoes.respostas_seminario com a contagem gravada.';

-- ===========================================================================
-- (d.1) protocolo_01_briefing v3 — INATIVA. Texto = v2 (0042) + fontes da
-- Fase 4 + seção 15 "COMO ELE FALA" + correção da instrução dos campos
-- estruturados (evidencias em lista, como o schema de produção já exige).
-- `effort = 'low'`: o ponto de operação promovido em 04/09 (§0 item 3).
-- `esquema_saida` = exatamente o JSON Schema estrito que o código envia
-- (paraJsonSchemaEstrito(BriefingSchema), 3.877 bytes) — documentação.
-- ===========================================================================
insert into prompts_versoes (chave, versao, titulo, corpo_sistema, esquema_saida, modelo_padrao, effort, ativo, notas)
values (
  'protocolo_01_briefing',
  3,
  'Protocolo 01 — Briefing Estratégico — v3, todas as fontes (seminário, CNPJ público, ligação IA) + como ele fala',
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
- faixa de patrimônio declarada (nunca valor absoluto);
- respostas que a pessoa deu às pesquisas do SEMINÁRIO (`seminario.respostas`) e
  quantos dias assistiu (`seminario.dias_assistidos`), quando presentes;
- cadastro PÚBLICO da(s) empresa(s) ligada(s) à ficha (`empresas`: razão social,
  atividade, faixa de capital, quantidade de sócios; nomes de sócios só quando o
  contexto os trouxer) — é contexto de negócio, nunca julgamento sobre terceiros;
- resumo e, quando presente, transcrição da LIGAÇÃO POR ASSISTENTE VIRTUAL de
  agendamento (`ligacao_ia`), na mesma condição da transcrição humana.

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

Para esses campos não existe campo "_nota": a evidência vai na lista
processo_decisorio.evidencias — UMA frase curta por categoria acima (velocidade,
segurança, validação, detalhe, autoridade, presença dos decisores), na mesma ordem,
com a evidência observada que embasa a escolha. "indefinida"/"indefinido" é resposta
honesta e válida quando não há evidência — jamais escolha um valor plausível sem
lastro só para preencher a categoria; isso seria exatamente o que a REGRA DE OURO
proíbe.

FONTES DA FASE 4 (v3) — como usar cada uma
- seminario.respostas: são respostas escritas pela própria pessoa, antes de qualquer
  contato da equipe. Valem como evidência de motivação, dor e vocabulário — cite-as
  literalmente quando embasarem uma conclusão. Não trate ausência de resposta como
  desinteresse. dias_assistidos (0 a 3) é sinal de engajamento, não de patrimônio.
- empresas: dado cadastral público. Use para contextualizar a atividade e o porte
  (faixa de capital) — nunca para afirmar faturamento, lucro, valor da empresa ou
  qualquer número que não esteja no contexto. Se `socios` não vier, não especule
  sobre quem são os sócios.
- ligacao_ia: `resumo` é síntese produzida por assistente virtual (trate como
  observação de segunda mão, confiança menor que a transcrição); `transcricao`,
  quando presente, é fala literal do cliente e serve para frases de fechamento e
  para a seção 15. `transcricao_truncada: true` significa que só parte chegou —
  registre isso nas lacunas.
- Se `seminario`, `empresas` ou `ligacao_ia` vierem nulos/vazios, diga nas lacunas
  que essas fontes não existiam — nunca finja tê-las lido.

15. COMO ELE FALA — linguagem_do_cliente (v3)
Além das 14 seções, entregue a forma como o cliente se expressa, para a advogada
espelhar a linguagem dele na sessão. Preencha o campo linguagem_do_cliente como
UMA string de EXATAMENTE três linhas, nesta ordem e com estes prefixos:
PALAVRAS: <até 8 palavras ou termos que ele repete, literais, separados por ponto e vírgula>
EXPRESSÕES: <até 5 frases curtas exatamente como ele as disse, separadas por ponto e vírgula>
REGISTRO: <uma frase: formal ou coloquial, técnico ou prático, direto ou narrativo>
Só entra palavra ou expressão que esteja LITERALMENTE no material recebido
(formulário, ligação, transcrições, respostas do seminário) — nunca parafraseie,
nunca "melhore" a frase. Cada expressão será conferida automaticamente contra o
material; expressão que não existir lá conta contra a análise. Sem material
suficiente, deixe a lista vazia (ex.: "EXPRESSÕES: ") em vez de inventar.$prompt$,
  $jsonschema${"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"resumo_executivo":{"type":"string"},"perfil_disc":{"type":"object","properties":{"predominante":{"type":"string","enum":["D","I","S","C"]},"secundario":{"type":"string","enum":["D","I","S","C"]},"confianca":{"type":"integer"},"evidencias":{"type":"array","items":{"type":"string"}}},"required":["predominante","secundario","confianca","evidencias"],"additionalProperties":false},"arquetipo_patrimonial":{"type":"object","properties":{"escolhido":{"type":"string"},"justificativa":{"type":"string"},"evidencias":{"type":"array","items":{"type":"string"}}},"required":["escolhido","justificativa","evidencias"],"additionalProperties":false},"o_que_protege":{"type":"object","properties":{"objeto":{"type":"string"},"justificativa":{"type":"string"}},"required":["objeto","justificativa"],"additionalProperties":false},"motivadores":{"type":"object","properties":{"principal":{"type":"string"},"secundarios":{"type":"array","items":{"type":"string"}},"justificativa":{"type":"string"}},"required":["principal","secundarios","justificativa"],"additionalProperties":false},"objecoes_provaveis":{"type":"array","items":{"type":"object","properties":{"objecao":{"type":"string"},"probabilidade":{"type":"string","enum":["alta","media","baixa"]},"justificativa":{"type":"string"}},"required":["objecao","probabilidade","justificativa"],"additionalProperties":false}},"processo_decisorio":{"type":"object","properties":{"velocidade":{"type":"string"},"necessidade_seguranca":{"type":"string"},"necessidade_validacao":{"type":"string"},"necessidade_detalhe":{"type":"string"},"nivel_autoridade":{"type":"string"},"decisores_presentes_na_sessao":{"type":"string"},"decisores":{"type":"array","items":{"type":"string"}},"evidencias":{"type":"array","items":{"type":"string"}}},"required":["velocidade","necessidade_seguranca","necessidade_validacao","necessidade_detalhe","nivel_autoridade","decisores_presentes_na_sessao","decisores","evidencias"],"additionalProperties":false},"linguagem_recomendada":{"type":"object","properties":{"tom":{"type":"array","items":{"type":"string"}},"justificativa":{"type":"string"}},"required":["tom","justificativa"],"additionalProperties":false},"pontos_de_atencao":{"type":"array","items":{"type":"object","properties":{"nao_fazer":{"type":"string"},"motivo":{"type":"string"}},"required":["nao_fazer","motivo"],"additionalProperties":false}},"perguntas_para_aprofundar":{"type":"array","items":{"type":"object","properties":{"pergunta":{"type":"string"},"motivo":{"type":"string"}},"required":["pergunta","motivo"],"additionalProperties":false}},"frases_para_o_fechamento":{"type":"array","items":{"type":"object","properties":{"frase_literal":{"type":"string"},"como_usar":{"type":"string"}},"required":["frase_literal","como_usar"],"additionalProperties":false}},"estrategia_sessao":{"type":"object","properties":{"ritmo":{"type":"string"},"mais_tempo_em":{"type":"array","items":{"type":"string"}},"menos_tempo_em":{"type":"array","items":{"type":"string"}},"momento_croqui":{"type":"string"},"momento_investimento":{"type":"string"},"tratamento_objecoes":{"type":"string"}},"required":["ritmo","mais_tempo_em","menos_tempo_em","momento_croqui","momento_investimento","tratamento_objecoes"],"additionalProperties":false},"estrategia_fechamento":{"type":"string"},"grau_confianca":{"type":"integer"},"lacunas":{"type":"array","items":{"type":"string"}},"linguagem_do_cliente":{"type":"string"}},"required":["resumo_executivo","perfil_disc","arquetipo_patrimonial","o_que_protege","motivadores","objecoes_provaveis","processo_decisorio","linguagem_recomendada","pontos_de_atencao","perguntas_para_aprofundar","frases_para_o_fechamento","estrategia_sessao","estrategia_fechamento","grau_confianca","lacunas","linguagem_do_cliente"],"additionalProperties":false}$jsonschema$::jsonb,
  'anthropic/claude-sonnet-5',
  'low',
  false,
  'v3 (ARQUITETURA-FASE-4.md §5): contexto ganha seminario/empresas/ligacao_ia (contexto-briefing.ts) ' ||
  'e a saída ganha linguagem_do_cliente (string de 3 linhas — objeto com arrays estoura o teto de gramática: ' ||
  'medido 4.146 bytes; esta forma mede 3.877). Orçamento de escrita (L2) continua em código. ' ||
  'Nasce INATIVA. Ativar SÓ com sonda "compilou" (POST /api/admin/sonda-schema {"chave":"briefing_v3"}) ' ||
  'e bancada aprovada (npx tsx scripts/bancada-ia.ts --variantes=baseline,v3_fontes --promover=v3_fontes). ' ||
  'Ativação manual: UPDATE prompts_versoes SET ativo = false WHERE chave = ''protocolo_01_briefing'' AND versao <> 3; ' ||
  'UPDATE prompts_versoes SET ativo = true WHERE chave = ''protocolo_01_briefing'' AND versao = 3. ' ||
  'Reversão: UPDATE prompts_versoes SET ativo = (versao = <anterior>) WHERE chave = ''protocolo_01_briefing''.'
)
on conflict (chave, versao) do nothing;

-- ===========================================================================
-- (d.2) agente_croqui_analise v2 — INATIVA. Texto = v1 (0009) + formato v2
-- (13 slides tipados, narrativa dentro do slide) + NÚMEROS E VALORES
-- (valor_declarado, alocacao, economia só como diferença de totais digitados).
-- `high` mantido (v1 nunca foi medida — B22: não trocar effort por analogia).
-- `esquema_saida` = paraJsonSchemaEstrito(CroquiAnaliseV2Schema), 4.959 bytes.
-- ===========================================================================
insert into prompts_versoes (chave, versao, titulo, corpo_sistema, esquema_saida, modelo_padrao, effort, ativo, notas)
values (
  'agente_croqui_analise',
  2,
  'Agente do Croqui — Análise Pós-SV — v2, 13 slides tipados + alocação + valor declarado',
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

FORMATO DA RESPOSTA (v2) — exatamente estas seções, nesta ordem:
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
10. Croqui — EXATAMENTE 13 objetos, um por slide, na ordem do método, com o campo
    `tipo` igual a um destes valores literais: legado, controle, familia, patrimonio,
    risco, alternativas, celula_1, celula_2, celula_3, controle_arquitetura,
    economia, implementacao, investimento. Cada slide traz: `conteudo` (o que o
    cliente lê — até 600 caracteres), `pontos` (até 4 bullets de até 120
    caracteres), `como_apresentar` (nota para quem apresenta — até 300 caracteres;
    é a antiga "Narrativa", agora dentro do slide), `categoria` (o carimbo da
    REGRA DE OURO que vale para o conteúdo daquele slide) e `fontes` (até 3
    referências curtas de onde saiu: trecho da transcrição, campo da ficha,
    documento). Slide sem material suficiente: conteudo com a mensagem-padrão do
    método e categoria ponto_a_validar — nunca conteúdo inventado.
11. (Narrativa saiu desta versão — mora em `como_apresentar` de cada slide.)
12. Perguntas — perguntas de validação a fazer ao cliente antes de fechar o croqui.
13. Objeções — prováveis e como responder.
14. Fechamento — como avançar para a contratação, sem pressão nem urgência
    artificial.

Nunca invente número de patrimônio, percentual societário ou valor. Sem dado, é
"ponto a validar" — nunca um resultado plausível fabricado.

NÚMEROS E VALORES (v2) — leia antes de escrever qualquer cifra
- patrimonio[].valor_declarado: número SOMENTE quando o cliente disse um valor para
  aquele bem na transcrição ("a fazenda vale uns dois milhões" → 2000000). Sem
  número dito, `null`. É extração de fato declarado — nunca estimativa, nunca
  valor de mercado que você acha razoável. Escreva o número puro (sem R$, sem
  pontos, sem "mil"/"milhões").
- arquitetura.alocacao: para cada bem ou participação relevante, em qual célula
  ele fica na arquitetura recomendada — `celula` é um destes valores literais:
  unica (1 célula), cofre, veiculo, destino (2 ou 3 células); `item` descreve o bem;
  `categoria` carimba a alocação (inferência, na maioria dos casos). Só aloque o
  que apareceu no material.
- ECONOMIA (slide `economia`): o contexto pode trazer `cenario` — TOTAIS por cenário
  (`inventario`, `holding_1_celula`, `holding_2_celulas`, `holding_3_celulas`)
  DIGITADOS pela advogada. A única conta permitida é a DIFERENÇA entre o total de
  `inventario` e o total do cenário da arquitetura recomendada, e só quando os dois
  totais vierem preenchidos (não nulos). Se qualquer um for null ou `cenario` não
  vier, o slide `economia` fica com categoria ponto_a_validar e o conteúdo diz que
  os valores serão preenchidos no Cenário Patrimonial — sem cifra. Você NUNCA
  calcula ITCMD, ITBI, custas ou honorários, nunca escolhe alíquota, nunca
  projeta economia a partir de percentual: alíquota e base são decisão da
  advogada, registradas no sistema, não sua.$prompt$,
  $jsonschema${"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"resumo_executivo":{"type":"string"},"historia":{"type":"array","items":{"type":"object","properties":{"texto":{"type":"string"},"categoria":{"type":"string","enum":["fato_declarado","dado_documental","inferencia","ponto_a_validar"]}},"required":["texto","categoria"],"additionalProperties":false}},"familia":{"type":"array","items":{"type":"object","properties":{"texto":{"type":"string"},"categoria":{"type":"string","enum":["fato_declarado","dado_documental","inferencia","ponto_a_validar"]}},"required":["texto","categoria"],"additionalProperties":false}},"patrimonio":{"type":"array","items":{"type":"object","properties":{"texto":{"type":"string"},"categoria":{"type":"string","enum":["fato_declarado","dado_documental","inferencia","ponto_a_validar"]},"valor_declarado":{"type":["number","null"]}},"required":["texto","categoria","valor_declarado"],"additionalProperties":false}},"empresas":{"type":"array","items":{"type":"object","properties":{"texto":{"type":"string"},"categoria":{"type":"string","enum":["fato_declarado","dado_documental","inferencia","ponto_a_validar"]}},"required":["texto","categoria"],"additionalProperties":false}},"objetivos":{"type":"array","items":{"type":"object","properties":{"texto":{"type":"string"},"categoria":{"type":"string","enum":["fato_declarado","dado_documental","inferencia","ponto_a_validar"]}},"required":["texto","categoria"],"additionalProperties":false}},"riscos":{"type":"array","items":{"type":"object","properties":{"texto":{"type":"string"},"categoria":{"type":"string","enum":["fato_declarado","dado_documental","inferencia","ponto_a_validar"]}},"required":["texto","categoria"],"additionalProperties":false}},"disc":{"type":"array","items":{"type":"object","properties":{"decisor":{"type":"string"},"perfil_predominante":{"type":"string","enum":["D","I","S","C"]},"evidencias":{"type":"array","items":{"type":"string"}},"confianca":{"type":"integer"}},"required":["decisor","perfil_predominante","evidencias","confianca"],"additionalProperties":false}},"arquitetura":{"type":"object","properties":{"recomendacao":{"type":"string","enum":["1_celula","2_celulas","3_celulas","ponto_a_validar"]},"criterios":{"minItems":9,"maxItems":9,"type":"array","items":{"type":"object","properties":{"criterio":{"type":"string","enum":["quantidade_de_nucleos_familiares","empresa_operacional_relevante","imoveis_de_renda","patrimonio_pessoal_relevante","concentracao_em_empresa","niveis_diferentes_de_participacao_dos_herdeiros","fundador_deseja_permanecer_no_controle","necessidade_de_separar_patrimonio_gestao_e_destino","beneficio_justifica_a_complexidade"]},"resposta":{"type":"object","properties":{"texto":{"type":"string"},"categoria":{"type":"string","enum":["fato_declarado","dado_documental","inferencia","ponto_a_validar"]}},"required":["texto","categoria"],"additionalProperties":false},"peso_na_decisao":{"type":"string"}},"required":["criterio","resposta","peso_na_decisao"],"additionalProperties":false}},"justificativa_geral":{"type":"string"},"alocacao":{"type":"array","items":{"type":"object","properties":{"celula":{"type":"string","enum":["unica","cofre","veiculo","destino"]},"item":{"type":"string"},"categoria":{"type":"string","enum":["fato_declarado","dado_documental","inferencia","ponto_a_validar"]}},"required":["celula","item","categoria"],"additionalProperties":false}}},"required":["recomendacao","criterios","justificativa_geral","alocacao"],"additionalProperties":false},"croqui":{"minItems":13,"maxItems":13,"type":"array","items":{"type":"object","properties":{"tipo":{"type":"string","enum":["legado","controle","familia","patrimonio","risco","alternativas","celula_1","celula_2","celula_3","controle_arquitetura","economia","implementacao","investimento"]},"conteudo":{"type":"string"},"pontos":{"type":"array","items":{"type":"string"}},"como_apresentar":{"type":"string"},"categoria":{"type":"string","enum":["fato_declarado","dado_documental","inferencia","ponto_a_validar"]},"fontes":{"type":"array","items":{"type":"string"}}},"required":["tipo","conteudo","pontos","como_apresentar","categoria","fontes"],"additionalProperties":false}},"perguntas":{"type":"array","items":{"type":"object","properties":{"pergunta":{"type":"string"},"motivo":{"type":"string"}},"required":["pergunta","motivo"],"additionalProperties":false}},"objecoes":{"type":"array","items":{"type":"object","properties":{"objecao":{"type":"string"},"resposta_recomendada":{"type":"string"}},"required":["objecao","resposta_recomendada"],"additionalProperties":false}},"fechamento":{"type":"string"},"grau_confianca":{"type":"integer"},"lacunas":{"type":"array","items":{"type":"string"}}},"required":["resumo_executivo","historia","familia","patrimonio","empresas","objetivos","riscos","disc","arquitetura","croqui","perguntas","objecoes","fechamento","grau_confianca","lacunas"],"additionalProperties":false}$jsonschema$::jsonb,
  'anthropic/claude-sonnet-5',
  'high',
  false,
  'v2 (ARQUITETURA-FASE-3.md §3.2 + FASE-4 §4.4): croqui = 13 objetos tipados (gerarSlidesDaAnalise liga ' ||
  'sozinho via schema_versao=2), arquitetura.alocacao (diagrama Cofre/Veículo/Destino), ' ||
  'patrimonio[].valor_declarado (fato declarado; vira valor_mercado só por botão humano, origem_valor=transcricao), ' ||
  'economia = diferença entre totais de vw_cenarios_totais digitados pela advogada — nunca alíquota inventada (B26). ' ||
  'Schema estrito mede 4.959 bytes: ACIMA do teto medido para o briefing (4.428 recusado). Nasce INATIVA. ' ||
  'Ativar SÓ com sonda "compilou" (POST /api/admin/sonda-schema {"chave":"croqui_v2"}); se não compilar, ' ||
  'os candidatos a corte são os enums tipo (13) e criterio (9) → string com lista no prompt, e o .length() dos arrays. ' ||
  'Ativação: UPDATE prompts_versoes SET ativo = false WHERE chave = ''agente_croqui_analise'' AND versao <> 2; ' ||
  'UPDATE prompts_versoes SET ativo = true WHERE chave = ''agente_croqui_analise'' AND versao = 2. ' ||
  'Reversão: UPDATE prompts_versoes SET ativo = (versao = 1) WHERE chave = ''agente_croqui_analise''.'
)
on conflict (chave, versao) do nothing;

-- ===========================================================================
-- VERIFICAÇÃO OBRIGATÓRIA (rodar depois de aplicar; nada aqui é presumido):
--   1. select chave, versao, ativo, effort, length(corpo_sistema), pg_column_size(esquema_saida)
--        from prompts_versoes where (chave, versao) in (('protocolo_01_briefing',3),('agente_croqui_analise',2));
--      -- esperado: 2 linhas, ambas ativo = false. E:
--      select chave, count(*) filter (where ativo) from prompts_versoes group by 1;
--      -- esperado: exatamente 1 ativa por chave (a mesma de antes desta migration).
--   2. select polcmd, polname from pg_policy p join pg_class c on c.oid = p.polrelid
--        where c.relname = 'respostas_seminario';
--      -- esperado: só 'r' (rsem_sel) e 'a' (rsem_ins); nenhuma '*'/'w'/'d'.
--   3. Como `intruso` (perfil sem papel interno): select * from respostas_seminario → 0 linhas;
--      insert → 42501. Como `relacionamento`: insert com origem='manual' passa;
--      update/delete → 42501 (sem policy).
--   4. Importação com pergunta: CSV com colunas "Nome","E-mail","Qual sua maior preocupação?";
--      mapa_colunas {"Nome":"nome","E-mail":"email"} + perguntas_seminario ["Qual sua maior preocupação?"];
--      POST /api/importacoes → prévia com importacoes.perguntas_seminario preenchido; confirmar →
--      em respostas_seminario existe 1 linha por pessoa com pergunta = 'Qual sua maior preocupação?'
--      e origem_dado = origem_dado da edição; importacoes.respostas_seminario = nº de pessoas com célula
--      preenchida; GET /api/importacoes/[id] devolve os dois campos.
--      Confirmar a MESMA lista de novo noutra importação (mesma edição) → pessoa_existente,
--      a resposta antiga permanece (on conflict do nothing) mesmo que a célula tenha mudado, e
--      respostas_seminario = 0 nessa segunda importação. Célula vazia → nenhuma linha.
--      Sem `perguntas_seminario` → comportamento idêntico à 0035 (coluna fica NULL, contagem 0).
--      Coluna ao mesmo tempo em mapa_colunas e em perguntas_seminario → 422 pergunta_coluna_tambem_cadastral.
--   5. alter table: select column_name from information_schema.columns
--        where table_name='patrimonio_itens' and column_name='origem_valor';  -- 1 linha
--      select count(*) from patrimonio_itens where origem_valor is not null;  -- 0 (nenhum backfill)
--   6. Briefing continua saindo com o prompt ATIVO (v1/v2) — o schema exigido é
--      BriefingV2Schema (schemaBriefingParaVersao). Só depois da sonda + bancada:
--      ativar v3 e gerar 1 briefing real; `briefings.conteudo->>'linguagem_do_cliente'`
--      começa com 'PALAVRAS:' e `verificacao->'expressoes_cliente'` existe.
--   7. explain (analyze, buffers) select pergunta, resposta from respostas_seminario
--        where pessoa_id = '<uuid>' order by criado_em limit 12;
--      -- esperado: Index Scan em idx_respostas_seminario_pessoa, sem Seq Scan.
--
-- REVERSÃO: `drop table respostas_seminario`; `alter table patrimonio_itens drop
-- column origem_valor`; `alter table importacoes drop column perguntas_seminario,
-- drop column respostas_seminario`; recriar `confirmar_importacao` pelo texto da 0035;
-- `delete from prompts_versoes where (chave,versao) in (('protocolo_01_briefing',3),('agente_croqui_analise',2))`
-- só se NUNCA tiverem sido ativadas (senão `UPDATE ativo = (versao = <anterior>)` e
-- deixar a linha — versões antigas nunca são apagadas, e execucoes_ia referencia).
-- ===========================================================================
