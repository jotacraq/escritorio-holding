-- scripts/verificacao-fatia4-copiloto-bot.sql — roteiro da Fase 10, Fatia 4
-- (bot na sala, Recall.ai). docs/ARQUITETURA-FASE-10.md §4.2, §4.2.1, §4.2.2,
-- §6.2.2, §8, §12.
--
-- ORIGEM: a fatia NASCEU sem migration nova (`gravacao_externa_id` já
-- existia em 0091 — `text unique` — e as 3 triggers de trava jurídica já
-- existiam em 0093, incluindo `trg_copiloto_exige_decisao_bot_pedido` sobre
-- `gravacao_externa_id`); PARTES 1-3 abaixo são SÓ MEDIÇÃO sobre esse
-- estado. A migration **0097** (achado 4 do Fable — pendência de
-- encerramento do bot) entrou DEPOIS, na revisão de Solidificação — PARTE 4
-- é o roteiro dela, escrito ANTES de aplicá-la (achado C do Fable: a 0097
-- apontava para este §4 antes dele existir).
--
-- COMO RODAR o bloco SQL: uma chamada só por PARTE (MCP execute_sql / SQL
-- Editor / psql -f), como `postgres`. Sem `.env` nesta máquina — nada foi
-- rodado ainda; comando exato em cada parte para quem tiver acesso ao banco.
-- ===========================================================================


-- ===========================================================================
-- PARTE 1 — SQL: prova de índice do vínculo do webhook (§4.2/§6.2 do plano:
-- "vínculo pelo id do bot, nunca por sessao_id do corpo"). O caminho quente é
-- `entrada-bot.ts::resolverSessaoPorBotId`:
--   select sessao_id from sessoes_copiloto where gravacao_externa_id = $1
-- que roda a CADA evento de webhook (até ~180 vezes por sessão de 90min,
-- §2.1 do plano) — precisa ser Index Scan, nunca Seq Scan.
-- ===========================================================================

-- 1.1 — prova que o índice único existe (criado pela 0091, não por esta fatia):
select
  indexname,
  indexdef
from pg_indexes
where tablename = 'sessoes_copiloto'
  and indexdef ilike '%gravacao_externa_id%';
-- ESPERADO: 1 linha — o índice implícito do `unique` em `gravacao_externa_id`
-- (0091:71). Se vier 0 linhas, a migration 0091 não está aplicada neste banco.

-- 1.2 — `explain (analyze)` da query real — A MEDIR (sem .env nesta máquina;
-- comando exato para quem tiver acesso). Preencher `<algum-bot-id-real>` com
-- um valor existente (ou aceitar 0 linhas devolvidas, o que já prova
-- Index Scan mesmo sem casar):
--
--   explain (analyze, buffers)
--   select sessao_id from sessoes_copiloto where gravacao_externa_id = '<algum-bot-id-real>';
--
-- ESPERADO: "Index Scan using sessoes_copiloto_gravacao_externa_id_key" (ou
-- nome equivalente do índice unique), NUNCA "Seq Scan". Tempo esperado:
-- sub-milissegundo (tabela pequena, PK/unique lookup) — não afirmado aqui,
-- MEDIDO quando rodar.


-- ===========================================================================
-- PARTE 2 — ROTEIRO DE BANCADA (não SQL): os dois `A MEDIR` desta fatia,
-- registrados aqui para não sumirem em mensagem de chat. NENHUM dos dois foi
-- medido nesta entrega — a sonda de 11/09 (§4.2 do plano) cobriu SÓ a
-- CRIAÇÃO do bot (`POST /bot/`), não o formato de cada evento de webhook.
-- ===========================================================================

-- 2.1 — FORMATO REAL de `transcript.data` e `participant_events.join/.leave`.
--
--   O QUE FOI FEITO: `src/app/api/webhooks/copiloto/transcricao/route.ts`
--   segue o formato PÚBLICO ESTÁVEL documentado pelo Recall
--   (`{event, data: {bot: {id}, data: {...}}}`), com extração DEFENSIVA —
--   campo ausente ou de tipo inesperado nunca lança, cai em
--   `payload_invalido` (422) sem tocar o banco (Zod `.safeParse`, nunca
--   `.parse` cru).
--
--   COMO MEDIR: na primeira bancada com uma sala de teste real (Zoom/Meet
--   descartável) e `RECALL_API_KEY`/`COPILOTO_WEBHOOK_SECRET` configurados:
--     1. `POST /api/sessoes/[id]/copiloto/bot` numa sessão de teste;
--     2. falar na sala por ~30s;
--     3. capturar o corpo CRU que chega em
--        `POST /api/webhooks/copiloto/transcricao` (log temporário do
--        `corpoTexto` ANTES do Zod, ou um proxy tipo requestbin/ngrok);
--     4. comparar contra `TranscriptDataSchema`/`ParticipantEventSchema`
--        (route.ts) — se divergir, o schema é corrigido ali, não aqui.
--
--   CRITÉRIO DE PASSAGEM: pelo menos 1 `transcript.data` com texto não-vazio
--   vira segmento em `sessoes_copiloto_segmentos` (origem='bot'), e pelo
--   menos 1 `participant_events.join` aparece em
--   `sessoes_copiloto.participantes` — SEM nenhuma linha nova em
--   `webhooks_eventos.erro = 'payload_transcript_data_fora_do_formato_esperado'`
--   nem `'payload_participant_event_fora_do_formato_esperado'` (ver 2.3 abaixo).

-- 2.2 — CORRIGIDO após achado 1/2 do Fable (revisão de Solidificação): a
--   PRIMEIRA versão usava `start_timestamp × 1000` (ou `Date.now()` de
--   fallback) como a própria ORDEM — e `Date.now()` estoura `int4` por 833×
--   (ordem é `int not null`, 0091:119; medido: Date.now() ~1,79 bilhão×1000
--   contra teto de 2.147.483.647). TODA inserção pelo fallback falhava com
--   `22003`, e o fallback disparava numa classe LEGÍTIMA do schema
--   (`transcript` preenchido sem `words`, que `extrairTextoTranscript` até
--   PREFERE) — não era borda.
--
--   CORRIGIDO: `ordem` agora é `max(ordem)+1` POR SESSÃO, calculada no
--   INSERT (`entrada-bot.ts::registrarSegmentoDoBot`, mesmo padrão do
--   caminho manual em `segmentos/route.ts`) — nunca estoura `int4` numa
--   sessão de 90 min, e colisão de corrida é resolvida por RETENTATIVA
--   (recalcula, tenta de novo), nunca engolida como "já existia". A dedupe
--   REAL de reentrega continua sendo o livro-razão (hash sha256 do corpo).
--
--   O QUE AINDA É APROXIMAÇÃO: `start_timestamp`/`iniciado_ms` continua
--   sendo aproximação (o formato do timestamp do Recall — relativo à
--   gravação ou epoch — NÃO foi sondado): a coluna `iniciado_ms` guarda esse
--   dado para a TELA, mas NÃO é mais a fonte de ORDENAÇÃO — a ordem de
--   INSERÇÃO (chegada do webhook) é quem decide `ordem` agora. Resta medir
--   se a ORDEM DE CHEGADA do webhook bate com a ordem real de fala (o
--   Recall pode entregar HTTP requests fora de ordem por rede, mesmo que a
--   fala tenha saído em ordem).
--
--   COMO MEDIR: na mesma bancada do item 2.1, falar em sequência clara
--   ("um, dois, três, quatro") e conferir
--   `select ordem, texto, criado_em from sessoes_copiloto_segmentos
--    where sessao_id = '<sessao-de-teste>' order by ordem` — se o TEXTO não
--   sair na ordem falada, é sinal de que o Recall entrega fora de ordem por
--   rede; nesse caso, considerar usar `iniciado_ms` como critério de
--   ORDENAÇÃO NA LEITURA (`ORDER BY iniciado_ms`), mantendo `ordem` só como
--   chave de inserção monotônica — mudança de leitura, não de escrita.

-- 2.3 — pendências geradas por formato inesperado ficam em
--   `webhooks_eventos.erro`, consultável assim:
select
  origem,
  tipo_evento,
  erro,
  recebido_em
from webhooks_eventos
where origem = 'recall'
  and erro is not null
order by recebido_em desc
limit 50;
-- ESPERADO hoje (sem tráfego real ainda): 0 linhas. Depois da bancada do
-- item 2.1, qualquer linha aqui com erro = 'payload_..._fora_do_formato_esperado'
-- ou 'tipo_evento_desconhecido:...' é o sinal de que o schema precisa ajustar.


-- ===========================================================================
-- PARTE 3 — A MEDIR: a query COALESCIDA de `montarEstadoCopiloto`
-- (server/copiloto/estado.ts), estendida nesta correção para trazer
-- `bot`/`comparacao_decisores` no MESMO select que já rodava no polling de
-- 3s (achado do coordenador: "compararComDecisores não tem chamador... a
-- 4c está escrita e inerte" + "não faça leitura nova do briefing a cada
-- polling"). PROVADO SEM BANCO em `server/copiloto/estado.test.ts`
-- ("select() de sessoes_viabilidade é chamado 1 VEZ só" / "nenhuma chamada
-- a supabase.from('briefings')") — esta parte é o `explain` real que falta,
-- porque teste com mock prova CONTAGEM de chamadas, não CUSTO de cada uma.
-- ===========================================================================

-- 3.1 — a query real (contrato equivalente ao que o PostgREST gera para o
-- `.select(...)` de `montarEstadoCopiloto`). Preencher `<sessao-real>`:
--
--   explain (analyze, buffers)
--   select sv.id, sv.roteiro_versao_id, sv.sims,
--          j.pessoa_id,
--          sc.estado, sc.gravacao_externa_id, sc.participantes,
--          b.conteudo, b.atual
--     from sessoes_viabilidade sv
--     left join jornadas j on j.id = sv.jornada_id
--     left join briefings b on b.jornada_id = j.id
--     left join sessoes_copiloto sc on sc.sessao_id = sv.id
--    where sv.id = '<sessao-real>';
--
-- ESPERADO: 3 Index Scans/Nested Loops sobre chaves já indexadas —
-- `sessoes_viabilidade_pkey`, `jornadas` por FK, `idx_briefings_jornada`
-- (0009: `jornada_id, versao desc`) e `sessoes_copiloto_pkey` (`sessao_id`).
-- NENHUM Seq Scan em `briefings` — a cardinalidade por jornada é pequena
-- (comentário de topo de `estado.ts`), mas o índice existe e deve ser usado.
--
-- SE O PLANNER preferir Seq Scan em `briefings` (tabela pequena o bastante
-- para o otimizador achar mais barato que usar o índice): isso NÃO é
-- defeito — é a decisão correta do planner para tabela pequena. Só é
-- achado se `briefings` crescer (ex.: milhares de jornadas) e o Seq Scan
-- persistir; reavaliar nesse cenário, não antes.

-- 3.2 — contagem real de briefings por jornada, para confirmar a premissa
-- "o volume é pequeno, regeneração é ação manual e rara" (comentário de
-- `estado.ts`, não uma medição — esta query é a medição):
select
  jornada_id,
  count(*) as total_briefings
from briefings
group by jornada_id
order by total_briefings desc
limit 20;
-- Se alguma jornada aparecer aqui com dezenas/centenas de linhas, a decisão
-- de trazer TODO o array de briefings no embed (sem `limit`) precisa ser
-- revisitada — hoje é aceita porque não há teto medido que a contradiga.
--
-- NOTA DO FABLE (não bloqueante, revisão de Solidificação): "o embed carrega
-- o `conteudo` INTEIRO de todos os briefings da jornada, 1.800×/sessão, para
-- usar uma lista de nomes do atual. Se a medição 3.2 mostrar jornadas com
-- vários briefings, a alternativa é a 2ª query MINÚSCULA com `atual=true`
-- (precedente em `contexto.ts::buscarRecorteBriefing` — `select conteudo
-- from briefings where jornada_id=$1 and atual=true`, 1 linha, índice
-- `uniq_briefing_atual` parcial único, 0009)." QUE A MEDIÇÃO DECIDA: se 3.2
-- mostrar jornadas com muitos briefings, trocar `estado.ts::montarEstadoCopiloto`
-- para NÃO embutir `briefings` no select principal — voltar a 2 queries (a
-- coalescida sem briefings + a 2ª minúscula filtrada por `atual=true`,
-- mesmo padrão de `contexto.ts`) é mudança pequena e localizada.


-- ===========================================================================
-- PARTE 4 — MIGRATION 0097 (sessoes_copiloto.pendencia_encerramento_bot +
-- vw_pendencias_sistema estendida). Achado C do Fable (revisão de
-- Solidificação): a 0097 apontava para este §4 antes dele existir — "ponteiro
-- para o vazio, na migration mais delicada da fatia". Delicada porque a view
-- é recriada por `create or replace` a partir do TEXTO DO REPO (0089), não
-- do `pg_get_viewdef` do banco — a armadilha catalogada na Fase 9 (citada no
-- plano, §6.2): se o banco tiver uma versão da view DIFERENTE do repo
-- (alguém alterou direto em produção, ou uma migration posterior a 0089 que
-- não foi vista aqui), aplicar a 0097 APAGA EM SILÊNCIO qualquer cláusula
-- que só existisse no banco.
-- ===========================================================================

-- 4.1 — ANTES DE APLICAR A 0097: diff obrigatório do `pg_get_viewdef` REAL
-- do banco contra o texto que 0089 (e portanto 0097) presume. DIVERGÊNCIA
-- ENCONTRADA = PARAR, NÃO SEGUIR — investigar a divergência (provavelmente
-- uma migration entre 0089 e 0097 que também tocou a view e não foi
-- considerada) antes de aplicar 0097 por cima.
select pg_get_viewdef('vw_pendencias_sistema'::regclass, true);
-- COMO CONFERIR: colar a saída ao lado do texto de
-- `create or replace view vw_pendencias_sistema ...` em
-- `supabase/migrations/0089_link_sistema_sinais_e_pendencias.sql:211-368`
-- (é o texto que 0097 também usa como base). Tem de ser SEMANTICAMENTE
-- idêntico — mesmas 10 cláusulas `union all`, na mesma ordem, com os mesmos
-- predicados. Diferença de formatação (quebra de linha, espaço) do
-- `pg_get_viewdef` não conta como divergência; diferença de CLÁUSULA conta.

-- 4.2 — Contagem de cláusulas ANTES de aplicar — mais barato que ler o texto
-- inteiro: cada `union all` bruto na saída de `pg_get_viewdef` corresponde a
-- 1 fronteira entre cláusulas, então N cláusulas ⇒ N-1 ocorrências de
-- `UNION ALL` no texto. ESPERADO antes da 0097: 9 ocorrências (10 cláusulas).
select length(pg_get_viewdef('vw_pendencias_sistema'::regclass, true))
       - length(replace(upper(pg_get_viewdef('vw_pendencias_sistema'::regclass, true)), 'UNION ALL', ''))
       as caracteres_consumidos_por_union_all;
-- (heurística rápida, não substitui a leitura do 4.1 — só um alarme cedo:
-- se o número não bater com 9× o tamanho de 'UNION ALL', pare antes de ler)


-- ===========================================================================
-- 4.3 — DEPOIS DE APLICAR A 0097 (ou dentro de uma transação com rollback
-- proposital, para conferir sem tocar produção): prova de que as 11
-- cláusulas estão presentes — as 10 antigas SOBREVIVERAM + `bot_nao_encerrado`
-- ENTROU. Roteiro com rollback, mesmo padrão de `verificacao-0092-0093.sql`.
-- ===========================================================================
do $$
declare
  v_definicao text;
  v_tipos_esperados text[] := array[
    'produto_nao_mapeado', 'webhook_falho', 'mensagem_falhou', 'link_expirando',
    'material_aguardando_aprovacao', 'sessao_sem_sala', 'cron_parado',
    'expurgo_storage_pendente', 'numero_desconhecido', 'telefone_fora_do_padrao',
    'bot_nao_encerrado'
  ];
  v_tipo text;
  v_faltando text[] := array[]::text[];
begin
  v_definicao := pg_get_viewdef('vw_pendencias_sistema'::regclass, true);

  foreach v_tipo in array v_tipos_esperados loop
    if v_definicao not ilike '%' || quote_literal(v_tipo) || '%'
       and v_definicao not ilike '%''' || v_tipo || '''%' then
      v_faltando := array_append(v_faltando, v_tipo);
    end if;
  end loop;

  if array_length(v_faltando, 1) > 0 then
    raise exception 'CLAUSULAS FALTANDO NA VIEW APOS 0097: %', array_to_string(v_faltando, ', ');
  end if;

  raise notice 'OK: as 11 clausulas de tipo estao presentes em vw_pendencias_sistema.';
end $$;

-- 4.4 — prova de que uma linha com pendência REAL aparece na view — dentro
-- de uma transação com rollback proposital (nunca grava pendência de
-- mentira em produção). Requer 1 sessão de `sessoes_viabilidade` existente
-- (substituir `<sessao-existente>` por um id real do banco de teste).
begin;
  -- Marca uma pendência de teste numa sessão existente (cria a linha em
  -- sessoes_copiloto se não existir, via upsert — não mexe em outra coluna).
  insert into sessoes_copiloto (sessao_id, pendencia_encerramento_bot, pendencia_encerramento_bot_em)
  values ('<sessao-existente>', 'PENDENCIA DE TESTE — rollback proposital, nunca fica gravada', now())
  on conflict (sessao_id) do update set
    pendencia_encerramento_bot = excluded.pendencia_encerramento_bot,
    pendencia_encerramento_bot_em = excluded.pendencia_encerramento_bot_em;

  -- ESPERADO: 1 linha, tipo = 'bot_nao_encerrado', ocorrido_em = o `now()`
  -- do insert acima (não a criação da sessão — achado C corrigido).
  select tipo, titulo, ocorrido_em
    from vw_pendencias_sistema
   where id = '<sessao-existente>';

rollback; -- proposital — nenhuma pendência de teste fica gravada de verdade

-- 4.5 — prova de que a LIMPEZA funciona (achado B): depois de rodar o
-- caminho real (encerrar a sessão com sucesso, ou
-- `tentarNovamenteEncerrarBotPendente` via `POST .../copiloto/encerrar` numa
-- sessão já `'encerrado'` OU `'erro'` com pendência), a linha correspondente
-- DEIXA de aparecer aqui:
select sessao_id, estado, pendencia_encerramento_bot, pendencia_encerramento_bot_em
  from sessoes_copiloto
 where pendencia_encerramento_bot is not null;
-- ESPERADO em uso normal: poucas ou nenhuma linha — cada uma é uma sessão
-- com bot potencialmente ainda gravando na sala, que precisa de ação humana
-- (ou de uma nova tentativa de encerramento) para sumir daqui.
--
-- 🔴 CORRIGIDO (achado final do Fable — "o ciclo da pendência fechou para 1
-- dos 3 nascedouros"): antes desta correção, linhas com `estado='erro'`
-- (os 2 nascedouros de `bot/route.ts` — retenção infinita, falha ao
-- persistir vínculo) NUNCA SAÍAM DAQUI, mesmo depois de o humano remover o
-- bot da sala à mão — não existia `gravacao_externa_id` gravado junto (a
-- coluna que o retry precisa) nem um gate de retry que cobrisse `'erro'`.
-- A prova de que o ciclo fechou para os TRÊS nascedouros é ver uma linha
-- com `estado='erro'` e `pendencia_encerramento_bot` preenchida SUMIR desta
-- consulta depois de `POST /api/sessoes/[id]/copiloto/encerrar` — e o
-- `estado` da sessão, nesse caso, precisa ter virado `'encerrado'` (não
-- `'erro'` — é o fluxo COMPLETO, com consolidação, porque essas sessões
-- nunca passaram por ele):
select estado, encerrado_em, transcricao_id
  from sessoes_copiloto
 where sessao_id = '<sessao-que-estava-em-erro>';
-- ESPERADO: estado='encerrado', encerrado_em preenchido, transcricao_id
-- preenchido se havia segmento suficiente para consolidar.
