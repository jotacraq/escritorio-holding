-- 0129_pendencia_citacao_viva.sql
--
-- `vw_pendencias_sistema` passa a acusar CITAÇÃO LITERAL VIVA em sessão já
-- carimbada como expurgada. Achado F9/INFO do pentest da Fase 13 (19/09/2026).
--
-- ===========================================================================
-- O PROBLEMA
-- ===========================================================================
-- `server/copiloto/expurgo.ts` carimba `sessoes_copiloto.expurgo_segmentos_em`
-- e SÓ DEPOIS redige a citação literal nas fontes (sugestões, inventário,
-- ficha, retrospecto). As redações são passos INDEPENDENTES e podem falhar
-- uma a uma. Quando falham, a sessão já saiu do pool — `buscarSessoesElegiveis`
-- só traz quem NÃO tem carimbo — então nenhuma passagem futura tenta de novo.
--
-- O único sinal disso eram 4 contadores no JSON de retorno do cron. Ninguém lê
-- JSON de cron, e o valor morre quando a requisição termina.
--
-- 🔴 A CORREÇÃO NÃO É PERSISTIR O CONTADOR. É a view olhar o ESTADO. Contador
-- acusa a passagem em que a falha aconteceu; estado acusa enquanto o problema
-- existir — inclusive falhas antigas, inclusive as anteriores ao contador — e
-- some sozinho quando alguém consertar. Alerta que não se apaga é alerta que
-- o time aprende a fechar sem ler (regra já catalogada nesta casa).
--
-- ===========================================================================
-- 🔴 COMO ESTE ARQUIVO FOI ESCRITO
-- ===========================================================================
-- O SELECT abaixo é o texto EXATO de `pg_get_viewdef` do que está publicado
-- em `fcfsnqqaphtamhrpuyoh`, puxado em 19/09/2026 e conferido por md5:
--
--     md5 do viewdef vigente = 46467e4d85f53ab2ba7b2f7768a4ec52  (7.393 chars)
--
-- Sobre esse texto foi inserido UM ramo `UNION ALL`, por script, ANTES do
-- `ORDER BY 7` final (que tem de continuar sendo a última cláusula). A
-- inserção foi provada removendo-a de volta: o resultado voltou byte a byte
-- ao vigente. Ramos: 9 → 10.
--
-- Não parti do 0081/0089/0097 de propósito: esta view já foi recriada três
-- vezes, e o repositório não é necessariamente o que está publicado.
--
-- ===========================================================================
-- 🔴 RELOPTIONS — a armadilha que custou um ALTO nesta base
-- ===========================================================================
-- `pg_get_viewdef` devolve SÓ o SELECT. **Não devolve as `reloptions`.** Foi
-- exatamente assim que `security_invoker` sumiu de uma migration daqui e virou
-- achado ALTO do pentest, corrigido na 0047: sem `security_invoker = true`,
-- a view roda com os direitos do DONO e passa por cima de TODA a RLS de
-- baixo — e esta view lê `pessoas`, `jornadas`, `sessoes_copiloto`,
-- `webhooks_eventos`. Quem enxerga uma linha aqui passaria a enxergar dado
-- que a policy dele nega.
--
-- Este arquivo não ADIVINHA o valor atual, e não depende de ninguém ter
-- transcrito certo. Ele faz as duas coisas:
--
--   (1) CAPTURA `pg_class.reloptions` da view ANTES do replace, numa temp
--       table, e REAPLICA depois com `alter view … set (…)`. Preserva o que
--       estiver lá — `security_barrier`, `check_option`, o que for — sem
--       precisar saber de antemão.
--   (2) Declara `security_invoker = true` no próprio `create or replace`.
--       Se a opção JÁ estiver setada, isto é no-op e (1) a reafirma. Se ela
--       tiver se perdido em algum momento, isto a CONSERTA.
--
-- A ordem importa: (2) roda no replace, (1) reaplica por cima. O resultado é
-- "tudo o que havia, mais a garantia de que `security_invoker` está ligado".
--
-- Temp table em vez de `set_config(..., true)` de propósito: GUC local morre
-- se a migration não rodar numa transação única, e aí a captura se perderia
-- em silêncio. Temp table vive pela SESSÃO, que é o escopo certo aqui.
--
-- ===========================================================================
-- AS 5 PERGUNTAS DO PROTOCOLO DE SUSTENTABILIDADE
-- ===========================================================================
-- 1. Escala — o ramo novo varre `sessoes_copiloto` (3 linhas hoje, ~1/dia) e
--    só abre o jsonb das que têm `expurgo_segmentos_em IS NOT NULL`. Os dois
--    `jsonb_array_elements` estão dentro de `EXISTS`, que para no 1º item.
--    Em 10× (30 sessões) continua sendo varredura de dezenas de linhas.
-- 2. Índice — nenhum novo. `expurgo_segmentos_em IS NOT NULL` num universo de
--    dezenas de linhas é Seq Scan e está certo que seja (mesma lição medida na
--    0122: varrer 4 linhas é mais barato que abrir índice). Se um dia
--    `sessoes_copiloto` chegar a milhares, o índice a criar é parcial:
--    `(sessao_id) where expurgo_segmentos_em is not null`.
-- 3. Frequência — quem lê `vw_pendencias_sistema` é o Painel do dia, sob
--    demanda. Nenhum polling.
-- 4. Repetição — view, não escreve nada.
-- 5. Reversão — recriar a view a partir de
--    `tmp/squad/vw_pendencias_sistema_vigente.sql`
--    (md5 46467e4d85f53ab2ba7b2f7768a4ec52), com o mesmo cuidado de
--    reloptions. Nenhum dado é perdido: view não guarda linha.
--
-- 🔴 BACKFILL: NENHUM, e nada muda de valor — é troca de definição de view.
-- Medido em 19/09/2026: 3 sessões de copiloto, todas com
-- `expurgo_segmentos_em` NULO (o expurgo nunca rodou: `copiloto_sessao.
-- expurgo_ativo` nasce `false`). O ramo novo devolve ZERO linha hoje. Se
-- devolver alguma no dia em que o expurgo for ligado, é achado de verdade.
--
-- ⚠️ LIMITAÇÃO DECLARADA: o ramo NÃO cobre `copiloto_sugestoes.conteudo`
-- (evidência em 4 lugares aninhados; a própria `expurgo.ts` registra que não
-- há filtro simples sem função SQL nova). Uma sessão com falha SÓ em
-- sugestões não acende. Está escrito no comentário do ramo para ninguém
-- confundir com cobertura total.
--
-- ROTEIRO DE VERIFICAÇÃO: scripts/verificacao-0129.sql
--
-- ROLLBACK:
--   -- recriar a view a partir do md5 acima, e reaplicar as reloptions
--   -- capturadas (o bloco (1) deste arquivo serve de modelo).
-- ===========================================================================


-- ===========================================================================
-- (1a) CAPTURA das reloptions vigentes, ANTES de qualquer replace.
-- ===========================================================================
drop table if exists _reloptions_vw_pendencias_0129;
create temp table _reloptions_vw_pendencias_0129 as
select coalesce(array_to_string(c.reloptions, ', '), '') as opcoes
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'vw_pendencias_sistema';


-- ===========================================================================
-- (2) A VIEW. `security_invoker = true` declarado explicitamente — lição da
-- 0047. O SELECT abaixo é o viewdef vigente + 1 ramo (ver cabeçalho).
-- ===========================================================================
create or replace view vw_pendencias_sistema with (security_invoker = true) as
 SELECT w.id::text AS id,
        CASE
            WHEN w.erro = 'produto_nao_mapeado'::text THEN 'produto_nao_mapeado'::text
            ELSE 'webhook_falho'::text
        END AS tipo,
        CASE
            WHEN w.erro = 'produto_nao_mapeado'::text THEN 'Venda de produto não mapeado'::text
            ELSE 'Webhook não processado'::text
        END AS titulo,
        CASE
            WHEN w.erro = 'produto_nao_mapeado'::text THEN ('A Hotmart mandou uma venda do produto '::text || COALESCE(NULLIF(((w.bruto -> 'data'::text) -> 'product'::text) ->> 'id'::text, ''::text), '(sem id no payload)'::text)) || ', que não está ligado a nenhum produto do sistema. O dinheiro entrou e a jornada não anda até alguém mapear esse ID.'::text
            ELSE COALESCE(w.erro, 'Sem detalhe de erro registrado — ver tentativas.'::text)
        END AS descricao,
    NULL::uuid AS jornada_id,
    NULL::text AS pessoa_nome,
    w.recebido_em AS ocorrido_em
   FROM webhooks_eventos w
  WHERE w.processado_em IS NULL
UNION ALL
 SELECT m.id::text AS id,
    'mensagem_falhou'::text AS tipo,
    'Mensagem da régua falhou'::text AS titulo,
    COALESCE(m.erro, 'Sem detalhe de erro registrado.'::text) AS descricao,
    m.jornada_id,
    p.nome AS pessoa_nome,
    COALESCE(m.enviada_em, m.criado_em) AS ocorrido_em
   FROM mensagens_agendadas m
     JOIN jornadas j ON j.id = m.jornada_id
     JOIN pessoas p ON p.id = j.pessoa_id
  WHERE m.status = 'falhou'::status_mensagem
UNION ALL
 SELECT l.id::text AS id,
    'link_expirando'::text AS tipo,
    'Link público expirando em breve'::text AS titulo,
    'Expira em '::text || to_char((l.expira_em AT TIME ZONE 'America/Sao_Paulo'::text), 'DD/MM "às" HH24:MI'::text) AS descricao,
    l.jornada_id,
    p.nome AS pessoa_nome,
    l.expira_em AS ocorrido_em
   FROM links_publicos l
     JOIN jornadas j ON j.id = l.jornada_id
     JOIN pessoas p ON p.id = j.pessoa_id
  WHERE l.estado = 'ativo'::estado_link_publico AND l.expira_em <= (now() + '48:00:00'::interval)
UNION ALL
 SELECT mg.id::text AS id,
    'material_aguardando_aprovacao'::text AS tipo,
    'Material pós-sessão aguardando aprovação'::text AS titulo,
        CASE
            WHEN mg.fonte_dor = 'nenhuma'::text THEN 'Material padrão (sem dor identificada) — revisar antes de aprovar.'::text
            ELSE 'Personalizado pela dor declarada — revisar antes de aprovar.'::text
        END AS descricao,
    mg.jornada_id,
    p.nome AS pessoa_nome,
    mg.criado_em AS ocorrido_em
   FROM materiais_gerados mg
     JOIN jornadas j ON j.id = mg.jornada_id
     JOIN pessoas p ON p.id = j.pessoa_id
  WHERE mg.atual AND mg.aprovado_em IS NULL
UNION ALL
 SELECT a.id::text AS id,
    'sessao_sem_sala'::text AS tipo,
    'Sessão sem link da sala'::text AS titulo,
    ('Sessão em '::text || GREATEST(0::numeric, floor(EXTRACT(epoch FROM a.inicio_em - now()) / 3600::numeric))::integer) || ' h sem link da sala — cole o link ou ligue a integração (N8N_WEBHOOK_SALA_URL, Admin → Integrações).'::text AS descricao,
    j.id AS jornada_id,
    p.nome AS pessoa_nome,
    a.inicio_em AS ocorrido_em
   FROM agendamentos a
     JOIN sessoes_viabilidade s ON s.id = a.sessao_id
     JOIN jornadas j ON j.id = s.jornada_id
     JOIN pessoas p ON p.id = j.pessoa_id
  WHERE (a.status = ANY (ARRAY['agendado'::status_agendamento, 'confirmado'::status_agendamento])) AND s.link_sala IS NULL AND a.inicio_em > (now() - '01:00:00'::interval) AND a.inicio_em <= (now() + '24:00:00'::interval)
UNION ALL
 SELECT 'cron'::text AS id,
    'cron_parado'::text AS tipo,
    'A régua não está rodando'::text AS titulo,
    ('A régua ainda não roda sozinha: falta o cron da Hostinger chamar /api/cron/regua a cada 5 minutos com o CRON_SECRET de produção. Última passagem registrada: '::text ||
        CASE
            WHEN c.valor = 'null'::jsonb THEN 'nunca'::text
            ELSE ('há '::text || GREATEST(0::numeric, floor(EXTRACT(epoch FROM now() - ((c.valor #>> '{}'::text[])::timestamp with time zone)) / 60::numeric))::integer) || ' min'::text
        END) || '.'::text AS descricao,
    NULL::uuid AS jornada_id,
    NULL::text AS pessoa_nome,
        CASE
            WHEN c.valor = 'null'::jsonb THEN NULL::timestamp with time zone
            ELSE (c.valor #>> '{}'::text[])::timestamp with time zone
        END AS ocorrido_em
   FROM configuracoes c
  WHERE c.chave = 'regua.ultimo_cron_em'::text AND (c.valor = 'null'::jsonb OR ((c.valor #>> '{}'::text[])::timestamp with time zone) < (now() - '00:15:00'::interval))
UNION ALL
 SELECT ts.id::text AS id,
    'expurgo_storage_pendente'::text AS tipo,
    'Expurgo de arquivos pendente'::text AS titulo,
    ('O tratamento deste titular foi encerrado, mas '::text || jsonb_array_length(ts.resultado -> 'storage_pendente'::text)) || ' arquivo(s) continuam no armazenamento. Abra Cadastro -> Direitos do titular e conclua o expurgo.'::text AS descricao,
    NULL::uuid AS jornada_id,
    p.nome AS pessoa_nome,
    ts.executado_em AS ocorrido_em
   FROM titulares_solicitacoes ts
     JOIN pessoas p ON p.id = ts.pessoa_id
  WHERE ts.tipo = 'anonimizacao'::text AND (ts.resultado ->> 'storage_removido_em'::text) IS NULL AND jsonb_typeof(ts.resultado -> 'storage_pendente'::text) = 'array'::text AND jsonb_array_length(ts.resultado -> 'storage_pendente'::text) > 0
UNION ALL
 SELECT mr.id::text AS id,
    'numero_desconhecido'::text AS tipo,
    'Número desconhecido escreveu no WhatsApp'::text AS titulo,
    ((((('O número '::text || COALESCE(mr.telefone, '(sem telefone no payload)'::text)) || ' mandou: "'::text) || "left"(regexp_replace(mr.corpo, '\s+'::text, ' '::text, 'g'::text), 160)) || '". '::text) || 'Não casou com nenhuma pessoa do cadastro, então o agente não respondeu. '::text) || 'Abra Comunicação → Recebidas para vincular a uma pessoa ou responder à mão.'::text AS descricao,
    NULL::uuid AS jornada_id,
    NULL::text AS pessoa_nome,
    mr.recebida_em AS ocorrido_em
   FROM mensagens_recebidas mr
  WHERE mr.pessoa_id IS NULL AND mr.recebida_em >= (now() - '72:00:00'::interval)
UNION ALL
 SELECT p2.id::text AS id,
    'telefone_fora_do_padrao'::text AS tipo,
    'Telefone fora do padrão internacional'::text AS titulo,
    (((('O telefone de '::text || p2.nome) || ' está gravado como "'::text) || p2.telefone) || '". O padrão do sistema é E.164 (ex.: +5511988887777). Enquanto estiver assim, mensagem '::text) || 'recebida desse número não casa com o cadastro e o agente de WhatsApp não responde.'::text AS descricao,
    NULL::uuid AS jornada_id,
    p2.nome AS pessoa_nome,
    p2.criado_em AS ocorrido_em
   FROM pessoas p2
  WHERE p2.telefone IS NOT NULL AND p2.telefone IS DISTINCT FROM app.telefone_e164(p2.telefone)
UNION ALL
 SELECT sc.sessao_id::text AS id,
    'bot_nao_encerrado'::text AS tipo,
    'Bot pode continuar na sala - encerramento falhou'::text AS titulo,
    sc.pendencia_encerramento_bot || ' Verifique a sala e, se necessario, remova manualmente o participante "Assistente - Escritorio Elaine Montenegro".'::text AS descricao,
    j.id AS jornada_id,
    p3.nome AS pessoa_nome,
    COALESCE(sc.pendencia_encerramento_bot_em, sc.criado_em) AS ocorrido_em
   FROM sessoes_copiloto sc
     JOIN sessoes_viabilidade sv ON sv.id = sc.sessao_id
     JOIN jornadas j ON j.id = sv.jornada_id
     JOIN pessoas p3 ON p3.id = j.pessoa_id
  WHERE sc.pendencia_encerramento_bot IS NOT NULL
UNION ALL
-- ===========================================================================
-- 0129 — CITAÇÃO LITERAL VIVA EM SESSÃO JÁ CARIMBADA COMO EXPURGADA.
-- Achado F9/INFO do pentest da Fase 13 (19/09/2026).
--
-- O expurgo (`server/copiloto/expurgo.ts`) carimba `expurgo_segmentos_em` e
-- SÓ DEPOIS redige a citação literal nas 4 fontes. As redações são passos
-- independentes e podem falhar uma a uma; quando falham, a sessão JÁ SAIU do
-- pool (`buscarSessoesElegiveis` só traz quem não tem carimbo), então
-- NENHUMA passagem futura tenta de novo sozinha.
--
-- Até aqui, o único sinal disso eram 4 contadores no JSON de retorno do cron
-- — que ninguém lê, e que se perdem no instante em que a requisição termina.
--
-- 🔴 ESTE RAMO OLHA O ESTADO, NÃO O EVENTO. É a diferença que importa:
-- contador só acusa a passagem em que a falha aconteceu; o estado acusa
-- enquanto o problema existir, inclusive falhas de semanas atrás, inclusive
-- as que aconteceram antes de o contador existir. E some sozinho quando
-- alguém consertar — alerta que não se apaga é alerta que se aprende a
-- ignorar.
--
-- COBERTURA, dita por inteiro: pega `copiloto_retrospectos` (carimbo próprio),
-- `ficha_acumulada` e `inventario_acumulado` (evidência item a item).
-- NÃO pega `copiloto_sugestoes.conteudo`: ali a evidência mora em 4 lugares
-- aninhados diferentes (3 escalares + 1 array), e a própria `expurgo.ts`
-- registra que não existe filtro simples para isso sem função SQL nova. Uma
-- sessão com falha SÓ em sugestões não acende aqui — limitação conhecida,
-- escrita para não ser confundida com cobertura total.
--
-- `jsonb_typeof(...) = 'array'` antes de `jsonb_array_elements` não é
-- decoração: a função levanta 22023 em jsonb que não é array, e uma linha
-- legada com formato inesperado derrubaria a VIEW INTEIRA — o Painel do dia
-- sumiria por causa de um dado torto numa sessão.
-- ===========================================================================
 SELECT sc2.sessao_id::text AS id,
    'copiloto_citacao_viva'::text AS tipo,
    'Fala de cliente nao expurgada apos o prazo de retencao'::text AS titulo,
    'O expurgo marcou esta sessao como concluida, mas a citacao literal da fala do cliente continua gravada. Revise server/copiloto/expurgo.ts (redacao falhou apos o carimbo) e rode a redacao desta sessao a mao.'::text AS descricao,
    j2.id AS jornada_id,
    p4.nome AS pessoa_nome,
    sc2.expurgo_segmentos_em AS ocorrido_em
   FROM sessoes_copiloto sc2
     JOIN sessoes_viabilidade sv2 ON sv2.id = sc2.sessao_id
     JOIN jornadas j2 ON j2.id = sv2.jornada_id
     JOIN pessoas p4 ON p4.id = j2.pessoa_id
  WHERE sc2.expurgo_segmentos_em IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM copiloto_retrospectos cr
         WHERE cr.sessao_id = sc2.sessao_id AND cr.evidencias_redigidas_em IS NULL
      )
      OR (jsonb_typeof(sc2.ficha_acumulada) = 'array' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(sc2.ficha_acumulada) f
         WHERE COALESCE(f ->> 'evidencia', ''::text) <> ''::text
      ))
      OR (jsonb_typeof(sc2.inventario_acumulado) = 'array' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(sc2.inventario_acumulado) i
         WHERE COALESCE(i ->> 'evidencia', ''::text) <> ''::text
      ))
    )
  ORDER BY 7;

-- ===========================================================================
-- (1b) REAPLICA as reloptions capturadas em (1a). Preserva o que havia —
-- `security_barrier`, `check_option`, qualquer coisa — por cima do
-- `security_invoker = true` declarado acima (que continua valendo se ele
-- estiver na lista capturada, e que CONSERTA o caso de ele ter se perdido).
--
-- `format('%s')` com texto vindo de `pg_class.reloptions` do PRÓPRIO banco:
-- não é entrada de usuário, é metadado do catálogo. Ainda assim o `if` evita
-- `alter view ... set ()` vazio, que é erro de sintaxe.
-- ===========================================================================
do $$
declare v_opcoes text;
begin
  select opcoes into v_opcoes from _reloptions_vw_pendencias_0129;
  if coalesce(v_opcoes, '') <> '' then
    execute format('alter view public.vw_pendencias_sistema set (%s)', v_opcoes);
    raise notice 'reloptions reaplicadas: %', v_opcoes;
  else
    raise notice 'view nao tinha reloptions capturadas; fica so o security_invoker do create or replace';
  end if;
end $$;

drop table if exists _reloptions_vw_pendencias_0129;

comment on view vw_pendencias_sistema is
  'Painel do dia — pendencias operacionais do sistema. 0129 (Fase 13) '
  'acrescentou o ramo copiloto_citacao_viva: sessao carimbada como expurgada '
  '(expurgo_segmentos_em not null) que ainda tem citacao literal viva em '
  'copiloto_retrospectos, ficha_acumulada ou inventario_acumulado. Olha o '
  'ESTADO, nao o evento — o contador do cron morre com a requisicao, o estado '
  'acende enquanto o problema existir e apaga sozinho quando alguem '
  'consertar. NAO cobre copiloto_sugestoes.conteudo (evidencia em 4 lugares '
  'aninhados). security_invoker = true e OBRIGATORIO nesta view (licao da '
  '0047): sem ele a view passa por cima da RLS de pessoas/jornadas.';
