-- 0127_anonimizar_copiloto.sql
--
-- A FAMÍLIA DO COPILOTO ENTRA NA ANONIMIZAÇÃO DO TITULAR (LGPD art. 18).
-- Achado F1 do `security-pentester` na Fase 13 (19/09/2026), severidade ALTA.
-- Escopo ampliado por decisão do João no mesmo dia: não só a tabela nova da
-- 0125 — as QUATRO tabelas do copiloto.
--
-- ===========================================================================
-- O FURO
-- ===========================================================================
-- `public.anonimizar_titular` (0080, recriada na 0081) apaga o rastro do
-- titular em 36 tabelas. As tabelas do copiloto nasceram na 0091 e depois —
-- ou seja, DEPOIS da última vez que essa função e a LISTA MESTRA
-- `INVENTARIO_TITULAR` (`src/server/lgpd/inventario.ts`) foram alinhadas.
-- Nenhuma das quatro estava em nenhum dos dois lugares.
--
-- MEDIDO no corpo VIGENTE em produção, antes desta migration: 13.968
-- caracteres, 36 tabelas, e `ilike '%copiloto%'` = **false**. O achado se
-- confirma contra o que está PUBLICADO, não só contra o arquivo da 0080.
--
-- Consequência prática: um titular que exercesse o art. 18 continuaria com a
-- fala bruta da Sessão de Viabilidade em `sessoes_copiloto_segmentos`, a
-- citação literal de dor/objeção/desejo em `sessoes_copiloto.ficha_acumulada`
-- e em `copiloto_sugestoes.conteudo`, e o Retrospecto inteiro em
-- `copiloto_retrospectos.conteudo` — tudo vivo, depois de o escritório
-- declarar por escrito que encerrou o tratamento.
--
-- ===========================================================================
-- 🔴 COMO ESTE ARQUIVO FOI ESCRITO — leia antes de editar
-- ===========================================================================
-- O corpo abaixo NÃO foi transcrito, nem copiado do 0080/0081. Ele é o texto
-- EXATO de `pg_get_functiondef` do que está publicado em
-- `fcfsnqqaphtamhrpuyoh`, puxado em 19/09/2026 e conferido por md5:
--
--     md5 do corpo vigente = 21f38cc529421627433aab8e1655d258  (13.968 chars)
--
-- Sobre esse texto foi feita UMA inserção, por script, e a inserção foi
-- provada removendo-a de volta: o resultado voltou byte a byte ao vigente.
-- Contagem de chaves de `v_contagem`: 35 → 39, **zero perdida**.
--
-- Isto é a armadilha catalogada desta casa ("recriar função SQL parte do
-- corpo VIGENTE", e o precedente da própria 0081, que copiou o corpo inteiro
-- da 0080 em vez de reescrevê-lo). O repositório NÃO é necessariamente o que
-- está publicado; partir do arquivo antigo teria significado reverter em
-- silêncio qualquer correção aplicada direto no banco desde então.
--
-- 🔴 E é `public.anonimizar_titular`, NÃO `app.anonimizar_titular`. O
-- relatório do pentest escreveu `app.` — não existe nada com esse nome nesse
-- schema (conferido em `pg_proc`). Recriar em `app` produziria uma função
-- NOVA que ninguém chama, enquanto a real seguiria sem tocar o copiloto: o
-- furo aberto, com a migration "aplicada" e verde. O passo 0 de
-- `scripts/verificacao-0127.sql` transforma isso em teste permanente.
--
-- ===========================================================================
-- O QUE FOI INSERIDO, E ONDE
-- ===========================================================================
-- Quatro blocos, no padrão idêntico ao das outras 36 tabelas
-- (`update … where …;` + `get diagnostics v_n = row_count; v_contagem := …`),
-- logo DEPOIS do bloco de `agendamentos` — que é o último escopado por
-- `v_sessoes` antes de a função voltar aos escopos de jornada. Escopo das
-- quatro: `v_sessoes`, o array já materializado no topo da função.
--
-- Cada campo recebe o valor VAZIO que o DEFAULT da coluna declara, nunca
-- `null` onde a coluna é `not null`. Conferido coluna a coluna no schema:
--   `participantes`        jsonb not null default '[]'   (0091:79)
--   `resumo_acumulado`     jsonb not null default '{}'   (0091:84)
--   `ficha_acumulada`      jsonb not null default '[]'   (0122)
--   `dossie_cliente`       jsonb NULLABLE                (0109:83)
--   `inventario_acumulado` jsonb NULLABLE                (0111:79)
--
-- 🔴 A EXCEÇÃO QUE QUASE VIROU BUG: `sessoes_copiloto_segmentos.texto` é
-- `not null check (length(trim(texto)) > 0)` (0091:122) — zerar com `''`
-- seria RECUSADO pelo CHECK, e a anonimização inteira levantaria 23514 no
-- meio, deixando o titular meio anonimizado. Vai o mesmo `v_marcador` que já
-- carimba `pessoas.nome`.
--
-- ===========================================================================
-- CONSENTIMENTO REVOGADO — nota de contexto (achado F3, decisão do João)
-- ===========================================================================
-- Na mesma auditoria, o pentester apontou que o Retrospecto é gravado mesmo
-- com consentimento/decisão jurídica revogados — diferente de
-- `copiloto_sugestoes`, que a 0093 bloqueia por trigger. O dono (Marcio)
-- decidiu em 19/09/2026 **não travar**: o critério da 0093 é "este dado SAI
-- para um subprocessador?", e a v1 do Retrospecto é `origem='derivado'`, com
-- ZERO chamada de IA — nada sai, e bloquear não apagaria a fala, que
-- continuaria nas outras tabelas.
--
-- 🔴 A ressalva do pentester fica registrada porque ele tem razão no ponto: o
-- critério de LGPD é MAIS ESTRITO que o da 0093 (alcança tratamento interno,
-- não só transferência). É decisão de PRODUTO com risco assumido pelo dono,
-- não veredito jurídico, e não foi validada por advogado nesta data. **Se
-- `origem` virar `'ia'` um dia, a pergunta reabre** e a trava tem de existir
-- ANTES de a chamada ser ligada. Texto completo no docblock de
-- `src/server/copiloto/retrospecto.ts`.
--
-- Esta migration é justamente o que torna aquele risco aceitável: o titular
-- que exerce o art. 18 passa a ver (via `INVENTARIO_TITULAR`) e a apagar
-- (via esta função) o Retrospecto junto com o resto.
--
-- ===========================================================================
-- AS 5 PERGUNTAS DO PROTOCOLO DE SUSTENTABILIDADE
-- ===========================================================================
-- 1. Escala — 4 UPDATEs a mais por anonimização, todos por
--    `sessao_id = any (v_sessoes)`. Uma anonimização é um ato raro (hoje: 0
--    executadas) e já fazia 37 statements de DML; passa a 41.
-- 2. Índice — `sessoes_copiloto` é PK por `sessao_id`; as outras três têm
--    `sessao_id` indexado desde a 0091
--    (`idx_copiloto_sugestoes_polling`, `unique (sessao_id, ordem)`) e a 0125
--    (PK). `= any (array)` usa esses índices. Nenhum índice novo.
-- 3. Frequência — sob demanda, por pedido de titular. Nunca em laço.
-- 4. Repetição — a guarda de idempotência da própria função (já anonimizada
--    → retorna a linha existente) continua no topo, intocada. Passo 5 do
--    roteiro prova.
-- 5. Reversão — 🔴 A FUNÇÃO reverte (recriar a partir do md5 acima); **o
--    EFEITO não**. Anonimização é irreversível por definição. É por isso que
--    `scripts/verificacao-0127.sql` roda o ciclo inteiro dentro de
--    `DO … RAISE EXCEPTION 'rollback_proposital'` e é condição de aplicação.
--
-- 🔴 BACKFILL: NENHUM, e nada muda de valor ao aplicar. Esta migration
-- substitui uma DEFINIÇÃO de função; não roda UPDATE nenhum. Medido: 0 linhas
-- em `titulares_solicitacoes` com `tipo='anonimizacao'` — nenhum titular já
-- anonimizado ficou com o copiloto vivo, porque nenhum foi anonimizado ainda.
-- Se algum tivesse sido, o backfill seria um ato MANUAL e auditado, nunca
-- default de migration: reanonimizar por script mexeria em linha de gente.
--
-- ROTEIRO DE VERIFICAÇÃO (obrigatório ANTES de aplicar): scripts/verificacao-0127.sql
--
-- ROLLBACK: recriar a função a partir de
--   tmp/squad/anonimizar_titular_vigente.sql (md5 21f38cc529421627433aab8e1655d258).
--   NÃO existe rollback do efeito de uma anonimização já executada.
-- ===========================================================================


CREATE OR REPLACE FUNCTION public.anonimizar_titular(p_pessoa_id uuid, p_motivo text, p_base_legal text, p_canal text, p_solicitado_em timestamp with time zone DEFAULT now(), p_executado_por uuid DEFAULT NULL::uuid)
 RETURNS titulares_solicitacoes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_autor      uuid;
  v_pessoa     pessoas%rowtype;
  v_linha      titulares_solicitacoes;
  v_marcador   text;
  v_jornadas   uuid[];
  v_sessoes    uuid[];
  v_croquis    uuid[];
  v_caminhos   text[];
  v_transacoes text[];
  v_email      text;
  v_contagem   jsonb := '{}'::jsonb;
  v_avisos     text[] := '{}';
  v_n          int;
begin
  if auth.uid() is not null then
    if not app.eh_admin() then
      raise exception 'sem_permissao: apenas admin encerra o tratamento de um titular' using errcode = '42501';
    end if;
    select id into v_autor from perfis_equipe where auth_user_id = auth.uid() and ativo;
  else
    if p_executado_por is null then
      raise exception 'autor_obrigatorio: sem sessão, p_executado_por é obrigatório' using errcode = '22004';
    end if;
    select id into v_autor from perfis_equipe where id = p_executado_por and ativo and papel = 'admin';
    if v_autor is null then
      raise exception 'sem_permissao: p_executado_por não é admin ativo' using errcode = '42501';
    end if;
  end if;
  select * into v_pessoa from pessoas where id = p_pessoa_id for update;
  if not found then
    raise exception 'pessoa_nao_encontrada: %', p_pessoa_id using errcode = 'P0002';
  end if;
  if v_pessoa.anonimizada_em is not null then
    select * into v_linha from titulares_solicitacoes
     where pessoa_id = p_pessoa_id and tipo = 'anonimizacao' limit 1;
    return v_linha;
  end if;
  if v_pessoa.origem_dado = 'exemplo' then
    raise exception 'origem_dado_exemplo: esta pessoa é dado de demonstração, não um titular real'
      using errcode = '22023';
  end if;
  if v_pessoa.auth_user_id is not null then
    raise exception 'titular_com_login: esta pessoa tem conta de acesso; trate auth.users antes'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from jornadas
     where pessoa_id = p_pessoa_id and etapa = 'holding_contratada' and desfecho = 'aberta'
  ) then
    raise exception 'holding_em_execucao: há holding contratada em execução para este titular'
      using errcode = '22023';
  end if;
  perform set_config('app.anonimizacao', 'on', true);
  v_marcador := 'Titular anonimizado ' || left(replace(p_pessoa_id::text, '-', ''), 8);
  v_email := nullif(trim(coalesce(v_pessoa.email, '')), '');
  if v_email is not null then
    v_email := replace(replace(replace(v_email, '\', '\\'), '%', '\%'), '_', '\_');
  end if;
  select coalesce(array_agg(id), '{}') into v_jornadas from jornadas where pessoa_id = p_pessoa_id;
  select coalesce(array_agg(id), '{}') into v_sessoes  from sessoes_viabilidade where jornada_id = any (v_jornadas);
  select coalesce(array_agg(id), '{}') into v_croquis  from croquis where jornada_id = any (v_jornadas);
  select coalesce(array_agg(caminho), '{}') into v_caminhos from documentos where pessoa_id = p_pessoa_id;
  select coalesce(array_agg(transacao_externa_id), '{}') into v_transacoes
    from pagamentos where pessoa_id = p_pessoa_id or jornada_id = any (v_jornadas);
  update pessoas set
    nome = v_marcador, email = null, telefone = null, cidade = null, uf = null,
    profissao = null, faixa_etaria = null, estado_civil = null, observacoes = null,
    ativo = false, anonimizada_em = now()
   where id = p_pessoa_id;
  v_contagem := v_contagem || jsonb_build_object('pessoas', 1);
  update familiares set
    nome = null, ocupacao = null, observacoes = null, regime_casamento = null,
    ano_casamento = null, idade = null, ativo = false
   where pessoa_id = p_pessoa_id;
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('familiares', v_n);
  update patrimonio_itens set
    descricao = 'removido', detalhes = '{}'::jsonb, destinacao = null,
    valor_historico = null, valor_mercado = null, valor_locacao_mensal = null,
    ano_aquisicao = null, ativo = false
   where pessoa_id = p_pessoa_id;
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('patrimonio_itens', v_n);
  update formularios_respostas set respostas = '{}'::jsonb where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('formularios_respostas', v_n);
  update respostas_seminario set resposta = 'removida' where pessoa_id = p_pessoa_id;
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('respostas_seminario', v_n);
  update ligacoes_estrategicas set
    respostas = '{}'::jsonb, expectativa_principal = null, preocupacao_principal = null,
    assunto_atencao_especial = null, objecoes_percebidas = null, pessoas_mencionadas = null,
    ritmo = null, estilo_resposta = null, sinais = null, frases_marcantes = null,
    processo_decisorio = null, decisores_presentes_na_sessao = null,
    transcricao = null, observacoes = null
   where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('ligacoes_estrategicas', v_n);
  update ligacoes_ia set
    transcricao = null, resumo = null, gravacao_url = null, telefone = 'removido',
    id_externo = null, erro = null,
    status = case when status in ('na_fila','discando') then 'cancelada' else status end
   where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('ligacoes_ia', v_n);
  if v_n > 0 then v_avisos := v_avisos || 'gravacao_e_transcricao_originais_vivem_na_vapi'; end if;
  update briefings set conteudo = '{}'::jsonb, verificacao = null where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('briefings', v_n);
  update execucoes_ia set hash_entrada = null, erro = null, request_id = null
   where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('execucoes_ia', v_n);
  update sessoes_viabilidade set link_sala = null, gravacao_url = null, motivo_resultado = null
   where id = any (v_sessoes);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('sessoes_viabilidade', v_n);
  update relatorios_sessao set
    quem_acompanha = null, motivacao_cliente = null, receita_familiar_mensal = null,
    ideia_custo_inventario = null, reserva_ou_seguro = null, preocupacao_predominante = null,
    como_deseja_organizar = null, motiva_evitar_inventario = null, interesse_imediato = null,
    relacao_filhos_terceiros = null, porque_nos_procurou = null, falta_planejamento_preocupa = null,
    resultado_sessao = null, consideracoes_apresentacao_croqui = null, tributos = '{}'::jsonb
   where sessao_id = any (v_sessoes);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('relatorios_sessao', v_n);
  update agendamentos set observacoes = null where sessao_id = any (v_sessoes);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('agendamentos', v_n);

  -- ===========================================================================
  -- FAMÍLIA DO COPILOTO (0127 — achado F1 do pentest da Fase 13, 19/09/2026).
  -- As 4 tabelas nasceram DEPOIS da 0081, que foi a última vez que esta função
  -- e `INVENTARIO_TITULAR` foram alinhadas — por isso nenhuma estava aqui.
  -- Escopo por `v_sessoes`, como `relatorios_sessao`/`agendamentos` acima.
  --
  -- Ordem: da fala BRUTA para o documento DERIVADO. Se algo falhar no meio,
  -- o que já saiu é sempre o insumo, nunca só a cópia.
  -- ===========================================================================

  -- (1) A FALA BRUTA. `texto` é `not null check (length(trim(texto)) > 0)`
  -- (0091:122) — `''` seria RECUSADO pelo CHECK. Vai o mesmo `v_marcador` que
  -- já carimba `pessoas.nome`, então a linha continua legível como "existiu
  -- uma fala aqui, e ela foi removida por anonimização". `falante` sai porque
  -- o provedor de áudio às vezes grava o NOME da pessoa na sala.
  update sessoes_copiloto_segmentos set texto = v_marcador, falante = null
   where sessao_id = any (v_sessoes);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('sessoes_copiloto_segmentos', v_n);

  -- (2) A SAÍDA DA IA sobre a fala. `conteudo` carrega `evidencia` — citação
  -- literal — em 4 lugares aninhados; zerar o jsonb inteiro é o mesmo
  -- tratamento de `briefings`/`croqui_analises`/`materiais_gerados` acima, e
  -- não depende de conhecer a forma interna do documento.
  update copiloto_sugestoes set conteudo = '{}'::jsonb
   where sessao_id = any (v_sessoes);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('copiloto_sugestoes', v_n);

  -- (3) O ESTADO ACUMULADO da sessão. Cinco campos com PII, cada um com o
  -- valor vazio que o DEFAULT da coluna declara (0091/0111/0120/0122) — nunca
  -- `null` onde a coluna é `not null`:
  --   `participantes`      nomes de quem estava na sala (0091:77)
  --   `dossie_cliente`     espelho de dado cadastral (0109)
  --   `inventario_acumulado` bens declarados em voz alta + `evidencia` (0111)
  --   `resumo_acumulado`   memória do que já foi perguntado (0120)
  --   `ficha_acumulada`    dor/objeção/desejo + `evidencia` literal (0122)
  -- `pendencia_encerramento_bot` é texto OPERACIONAL (id de bot, instrução
  -- para a equipe) — sem PII do titular; fica, porque apagá-lo esconderia uma
  -- pendência real de custo que alguém ainda precisa resolver.
  update sessoes_copiloto set
    participantes = '[]'::jsonb, dossie_cliente = null,
    inventario_acumulado = null, resumo_acumulado = '{}'::jsonb,
    ficha_acumulada = '[]'::jsonb
   where sessao_id = any (v_sessoes);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('sessoes_copiloto', v_n);

  -- (4) O RETROSPECTO (0125) — o documento congelado do fim da sessão, que
  -- COPIA a citação literal para dentro de si. `evidencias_redigidas_em`
  -- ganha carimbo no MESMO update: sem ele, `expurgo.ts::redigirRetrospectoDaSessao`
  -- continuaria achando que há citação a redigir numa linha já vazia, e o
  -- contador de falha de redação acenderia sem ter o que consertar.
  --
  -- ⚠️ `conteudo = '{}'` deixa a aba "Retrospecto" da Ficha 360 de um titular
  -- anonimizado sem corpo para renderizar — MESMA consequência que `briefings`
  -- e `croquis` já têm hoje, e pelo mesmo motivo. A tela de um titular
  -- anonimizado é um deserto por desenho.
  update copiloto_retrospectos set conteudo = '{}'::jsonb, evidencias_redigidas_em = now()
   where sessao_id = any (v_sessoes);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('copiloto_retrospectos', v_n);
  update diagnosticos_sv set blocos = '[]'::jsonb where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('diagnosticos_sv', v_n);
  update cenarios_patrimoniais set nota = null where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('cenarios_patrimoniais', v_n);
  update cenario_rubricas set nota = null
   where cenario_id in (select id from cenarios_patrimoniais where jornada_id = any (v_jornadas));
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('cenario_rubricas', v_n);
  update croquis set titulo = 'Croqui de titular anonimizado', conteudo = '{"slides":[]}'::jsonb
   where id = any (v_croquis);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('croquis', v_n);
  update croqui_analises set conteudo = '{}'::jsonb where croqui_id = any (v_croquis);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('croqui_analises', v_n);
  update croqui_narrativas set conteudo = '{}'::jsonb where croqui_id = any (v_croquis);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('croqui_narrativas', v_n);
  update croqui_calculos set entrada_snapshot = '{}'::jsonb, nota = null
   where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('croqui_calculos', v_n);
  update materiais_gerados set conteudo = '{}'::jsonb, dor_principal = null
   where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('materiais_gerados', v_n);
  update analises_transcricao set conteudo = '{}'::jsonb
   where transcricao_id in (select id from transcricoes where jornada_id = any (v_jornadas));
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('analises_transcricao', v_n);
  update transcricoes set conteudo = '', rotulo = 'Transcrição de titular anonimizado', consultor = null
   where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('transcricoes', v_n);
  update mensagens_agendadas set
    destinatario = 'removido', assunto_renderizado = null, corpo_renderizado = null,
    provedor_id = null, erro = null,
    status = case when status in ('pendente','enviando') then 'cancelada' else status end
   where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('mensagens_agendadas', v_n);
  update mensagens_recebidas set
    corpo = '', telefone = null, anexos = '[]'::jsonb, bruto = '{}'::jsonb
   where pessoa_id = p_pessoa_id or jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('mensagens_recebidas', v_n);
  update pagamentos set
    comprador_email = null, comprador_nome = null, comprador_telefone = null, bruto = '{}'::jsonb
   where pessoa_id = p_pessoa_id or jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('pagamentos', v_n);
  update webhooks_eventos set bruto = '{}'::jsonb
   where (array_length(v_transacoes, 1) is not null
          and exists (select 1 from unnest(v_transacoes) as t(transacao)
                       where bruto::text like '%' || t.transacao || '%'))
      or (v_email is not null and bruto::text ilike '%' || v_email || '%');
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('webhooks_eventos', v_n);
  update pesquisas_publicas set resumo = 'removido a pedido do titular', url = null
   where pessoa_id = p_pessoa_id or jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('pesquisas_publicas', v_n);
  update importacoes_linhas set dados = '{}'::jsonb, motivo = null where pessoa_id = p_pessoa_id;
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('importacoes_linhas', v_n);
  update documentos_pedidos set nota = null where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('documentos_pedidos', v_n);
  update links_publicos_acessos set ip_hash = null, user_agent = null
   where link_id in (select id from links_publicos where jornada_id = any (v_jornadas));
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('links_publicos_acessos', v_n);
  update links_publicos set estado = 'revogado', revogado_em = now()
   where jornada_id = any (v_jornadas) and estado = 'ativo';
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('links_publicos_revogados', v_n);
  update agendamentos_sugestoes set motivo_sugestao = null
   where link_id in (select id from links_publicos where jornada_id = any (v_jornadas));
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('agendamentos_sugestoes', v_n);
  update documentos set nome_arquivo = 'removido', sha256 = null where pessoa_id = p_pessoa_id;
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('documentos', v_n);
  update jornadas set
    faixa_patrimonio_declarada = null,
    motivo_desfecho = 'Tratamento encerrado a pedido do titular (LGPD art. 18)',
    desfecho = 'anonimizada'
   where pessoa_id = p_pessoa_id;
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('jornadas', v_n);
  update tarefas set descricao = null where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('tarefas', v_n);
  update eventos_timeline set descricao = null, dados = '{}'::jsonb where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('eventos_timeline', v_n);
  if array_length(v_caminhos, 1) is not null then
    v_avisos := v_avisos || 'arquivos_do_storage_pendentes_de_remocao';
  end if;
  insert into titulares_solicitacoes
    (pessoa_id, tipo, motivo, base_legal, canal_pedido, solicitado_em, executado_por, resultado)
  values (p_pessoa_id, 'anonimizacao', p_motivo, p_base_legal, p_canal, p_solicitado_em, v_autor,
          jsonb_build_object(
            'tabelas', v_contagem,
            'storage_pendente', to_jsonb(coalesce(v_caminhos, '{}')),
            'storage_removido_em', null,
            'avisos', to_jsonb(v_avisos)))
  returning * into v_linha;
  update pessoas set anonimizacao_id = v_linha.id where id = p_pessoa_id;
  perform set_config('app.anonimizacao', 'off', true);
  return v_linha;
end $function$;
