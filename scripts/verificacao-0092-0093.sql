-- scripts/verificacao-0092-0093.sql — roteiro da Fase 10, Fatia 2 (o gate:
-- decisão jurídica + consentimento do titular).
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- `postgres`, com 0091, 0092, 0093, 0094 E 0095 aplicadas. A última instrução
-- devolve `resultado_0092_0093` (ordem, passo, ok, detalhe). `ok = true` em
-- todas prova que o banco faz o que as migrations prometem.
--
-- TUDO COM ROLLBACK, mesmo padrão de `verificacao-0091.sql`: cada bloco que
-- escreve vive num sub-`begin … exception … end` terminado em
-- `raise exception 'rollback_proposital'`, e o INSERT no resultado acontece
-- FORA dele — releitura cuidadosa de que TODO bloco sobrevive à primeira
-- execução (achado do Fable no 0091: 2 passos da mesma classe não sobreviviam).
--
-- ARMADILHA ESPECÍFICA DESTE ROTEIRO (por isso corrigida ANTES da entrega, não
-- depois): `uniq_decisao_juridica_ativa` (0048:96) é um índice ÚNICO PARCIAL —
-- no máximo UMA decisão ATIVA por escopo em TODO o banco, não só dentro deste
-- roteiro. Se a Dra. Elaine já tiver aprovado B65 em produção (uma linha
-- ativa real de escopo 'sessao.copiloto_ao_vivo'), qualquer bloco abaixo que
-- tentasse INSERIR uma 2ª decisão ativa do mesmo escopo estouraria
-- `unique_violation` — não por a trava estar quebrada, mas por já existir uma
-- decisão real. Os blocos 1, 5 e 6 por isso REVOGAM temporariamente (dentro
-- do próprio rollback controlado) qualquer decisão ativa pré-existente do
-- escopo, e a restauram implicitamente ao dar `rollback_proposital` — nenhuma
-- decisão real do escritório é alterada de fato.
--
-- ONDE O GATE VIVE — CORRIGIDO após achado do `fable-orchestrator` (errata do
-- arquiteto, §6.2.2): DOIS lugares, não um. A rota
-- (`POST /api/sessoes/[id]/copiloto/sugestao`, `server/copiloto/gate.ts`)
-- confere decisão jurídica + consentimento ANTES de montar contexto e ANTES
-- de chamar o provedor de IA — essa é a trava PRIMÁRIA, porque é o ENVIO ao
-- provedor que move o dado para fora, não o INSERT. A trigger deste roteiro
-- (0093) CONTINUA existindo como BACKSTOP: se algum caminho futuro chegar ao
-- INSERT sem passar pelo gate da rota (agente novo, script de correção, RPC
-- direta com service_role), o banco ainda recusa. "Trava de dado que só vale
-- depois do envio não é trava, é registro" — o erro original deste desenho
-- era o backstop ser a ÚNICA camada, não ele existir.
--
-- POR QUE ESTE ROTEIRO É SQL, NÃO `scripts/simular-copiloto.ts` (§12 do
-- plano lista o nome como "permitido", não como entrega obrigatória): os
-- simuladores existentes (`simular-chatwoot.ts`) atacam rota de WEBHOOK
-- (segredo compartilhado, sem sessão). A rota nova
-- (`POST /api/sessoes/[id]/copiloto/sugestao`) exige `exigirVePatrimonio()` —
-- sessão Supabase Auth real de admin/advogada — e não há, em nenhum script
-- deste projeto, precedente de autenticar como usuário de sessão por fora do
-- navegador. Inventar essa via só para este script seria escopo novo não
-- pedido. Este roteiro prova o BACKSTOP (banco), sem precisar da camada
-- HTTP por cima; `src/app/api/.../route.test.ts` (vitest, Supabase mockado)
-- prova o GATE PRIMÁRIO da rota — inclusive que, sem decisão/consentimento,
-- ZERO linha nova aparece em `execucoes_ia` (não só o status HTTP: um 409
-- sozinho não distingue "barrou antes" de "barrou depois do vazamento").
--
-- O QUE ESTE ROTEIRO PROVA (§6.2.1 do plano — os 3 testes do aceite do
-- BACKSTOP no banco):
--   0  enum tipo_consentimento tem o valor 'copiloto_sessao_ao_vivo' (0092)
--   1  decisoes_juridicas.escopo aceita 'sessao.copiloto_ao_vivo' (0093-a)
--   2  (a) SEM decisão nem consentimento: INSERT origem='manual' em
--        sessoes_copiloto_segmentos PASSA — é o teste de regressão que
--        protege a Fatia 1 (o campo de digitar continua funcionando)
--   3  (b) nas MESMAS condições: INSERT origem='bot' é RECUSADO PELO BANCO
--   4  (c) nas MESMAS condições: INSERT em copiloto_sugestoes é RECUSADO
--        PELO BANCO
--   5  COM decisão jurídica ativa MAS SEM consentimento: origem='bot' ainda
--        é recusado (a segunda trava, isolada)
--   6  COM decisão jurídica ativa E COM consentimento: origem='bot' e
--        copiloto_sugestoes PASSAM (as duas travas cedem juntas)
--   7  UPDATE de gravacao_externa_id em sessoes_copiloto (pedir o bot) exige
--        as mesmas duas travas
--   8  prompt 'copiloto_sessao' (0094) existe e nasce ativo=false
--   9  `explain (analyze)` do INSERT/checagem da trigger — A MEDIR (sem
--        banco nesta máquina; comando exato no comentário do bloco)
--  10  `explain (analyze)` da janela de transcrição do contexto de IA
--        (server/copiloto/contexto.ts) — A MEDIR, idem
--  11  copiloto_sugestoes.desfecho (0095) só vai de NULL para um valor, uma
--        vez — 2ª tentativa de gravar é RECUSADA PELO BANCO
-- ---------------------------------------------------------------------------

drop table if exists resultado_0092_0093;
create temp table resultado_0092_0093 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r92(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0092_0093 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;


-- ===========================================================================
-- 0 · enum tipo_consentimento tem o valor novo (0092).
-- ===========================================================================
do $$
declare
  v_tem boolean;
begin
  select exists (
    select 1 from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'tipo_consentimento' and e.enumlabel = 'copiloto_sessao_ao_vivo'
  ) into v_tem;
  perform pg_temp.r92('0 · enum tipo_consentimento tem copiloto_sessao_ao_vivo', v_tem,
    case when v_tem then 'ok' else 'AUSENTE — 0092 não aplicada' end);
end $$;


-- ===========================================================================
-- 1 · decisoes_juridicas.escopo aceita o 2º valor (0093-a) e continua
-- recusando lixo.
-- ===========================================================================
do $$
declare
  v_admin uuid;
  v_aceitou_novo boolean := false;
  v_recusou_lixo boolean := false;
  v_ok boolean;
begin
  begin
    select id into v_admin from perfis_equipe where papel in ('admin', 'advogada') and ativo limit 1;
    if v_admin is null then
      perform pg_temp.r92('1 · decisoes_juridicas.escopo aceita sessao.copiloto_ao_vivo', false,
        'sem perfis_equipe admin/advogada ativo para testar — rode com dado de exemplo populado');
      return;
    end if;

    -- Revoga TEMPORARIAMENTE qualquer decisão ativa pré-existente deste
    -- escopo (ver ARMADILHA no comentário de topo do arquivo) — sem isso, se
    -- B65 já tiver sido aprovado em produção, o INSERT abaixo estoura
    -- unique_violation e o roteiro reporta falso-negativo. Desfeito pelo
    -- rollback_proposital junto com tudo o mais.
    update decisoes_juridicas set revogada_em = now(), revogada_por = v_admin
     where escopo = 'sessao.copiloto_ao_vivo' and revogada_em is null;

    insert into decisoes_juridicas (escopo, descricao, base_legal, subprocessador, decidido_por)
    values ('sessao.copiloto_ao_vivo', 'teste de verificação — revogar/rollback', 'teste', 'teste', v_admin);
    v_aceitou_novo := true;

    begin
      insert into decisoes_juridicas (escopo, descricao, base_legal, subprocessador, decidido_por)
      values ('escopo.inventado.lixo', 'x', 'x', 'x', v_admin);
    exception when check_violation then v_recusou_lixo := true;
    end;

    v_ok := v_aceitou_novo and v_recusou_lixo;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r92('1 · decisoes_juridicas.escopo aceita sessao.copiloto_ao_vivo', false, 'exceção: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r92('1 · escopo aceita sessao.copiloto_ao_vivo + CHECK recusa lixo', coalesce(v_ok, false),
    'aceitou_novo=' || v_aceitou_novo || ' recusou_lixo=' || v_recusou_lixo);
end $$;


-- ===========================================================================
-- 2-4 · O TESTE DO ACEITE (§6.2.1 do plano, por extenso): SEM decisão E SEM
-- consentimento —
--   (a) origem='manual' PASSA (protege a Fatia 1);
--   (b) origem='bot' é RECUSADO;
--   (c) copiloto_sugestoes é RECUSADO.
-- Uma sessão nova, sem NENHUMA decisão/consentimento para a pessoa dela.
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_sessao uuid;
  v_manual_passou boolean := false;
  v_bot_recusado boolean := false;
  v_sugestao_recusada boolean := false;
  v_bot_msg text := ''; v_sugestao_msg text := '';
  v_ok boolean;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificação 0093 A', 'verif0093a@example.com', '+5511921120000', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_sessao;

    -- (a) origem='manual' — SEM decisão, SEM consentimento — TEM que passar.
    begin
      insert into sessoes_copiloto_segmentos (sessao_id, ordem, texto, origem)
      values (v_sessao, 1, 'Trecho digitado pela advogada, sem bot.', 'manual');
      v_manual_passou := true;
    exception when others then
      v_manual_passou := false;
    end;

    -- (b) origem='bot' — mesma sessão, mesma ausência de trava — TEM que falhar.
    begin
      insert into sessoes_copiloto_segmentos (sessao_id, ordem, texto, origem)
      values (v_sessao, 2, 'Trecho vindo do bot.', 'bot');
    exception when others then
      v_bot_recusado := (sqlerrm like '%copiloto_ao_vivo_bloqueado%');
      v_bot_msg := sqlerrm;
    end;

    -- (c) copiloto_sugestoes — TEM que falhar (trigger incondicional).
    begin
      insert into copiloto_sugestoes (sessao_id, gatilho, conteudo)
      values (v_sessao, 'sob_demanda', '{}'::jsonb);
    exception when others then
      v_sugestao_recusada := (sqlerrm like '%copiloto_ao_vivo_bloqueado%');
      v_sugestao_msg := sqlerrm;
    end;

    v_ok := v_manual_passou and v_bot_recusado and v_sugestao_recusada;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r92('2-4 · (a) manual passa / (b) bot recusado / (c) sugestão recusada', false, 'exceção: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r92('2-4 · SEM decisão/consentimento: (a) manual PASSA, (b) bot RECUSADO, (c) sugestão RECUSADA',
    coalesce(v_ok, false),
    'manual_passou=' || v_manual_passou || ' bot_recusado=' || v_bot_recusado || ' (' || left(v_bot_msg, 200) ||
    ') sugestao_recusada=' || v_sugestao_recusada || ' (' || left(v_sugestao_msg, 200) || ')');
end $$;


-- ===========================================================================
-- 5 · COM decisão jurídica ativa, MAS SEM consentimento do titular — a 2ª
-- trava, isolada: origem='bot' AINDA é recusado (agora pelo motivo de
-- consentimento, não de decisão).
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_sessao uuid; v_admin uuid;
  v_bot_recusado boolean := false;
  v_msg text := '';
  v_ok boolean;
begin
  begin
    select id into v_admin from perfis_equipe where papel in ('admin', 'advogada') and ativo limit 1;
    if v_admin is null then
      perform pg_temp.r92('5 · com decisão mas sem consentimento: bot ainda recusado', false,
        'sem perfis_equipe admin/advogada ativo — rode com dado de exemplo populado');
      return;
    end if;

    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificação 0093 B', 'verif0093b@example.com', '+5511921120001', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_sessao;

    -- Revoga decisão ativa pré-existente do escopo antes de inserir a de
    -- teste (mesma armadilha do bloco 1 — ver comentário de topo do arquivo).
    update decisoes_juridicas set revogada_em = now(), revogada_por = v_admin
     where escopo = 'sessao.copiloto_ao_vivo' and revogada_em is null;

    insert into decisoes_juridicas (escopo, descricao, base_legal, subprocessador, decidido_por)
    values ('sessao.copiloto_ao_vivo', 'teste de verificação — revogar/rollback', 'teste', 'teste', v_admin);

    begin
      insert into sessoes_copiloto_segmentos (sessao_id, ordem, texto, origem)
      values (v_sessao, 1, 'Trecho vindo do bot.', 'bot');
    exception when others then
      v_bot_recusado := (sqlerrm like '%copiloto_ao_vivo_bloqueado%' and sqlerrm like '%consentimento%');
      v_msg := sqlerrm;
    end;

    v_ok := v_bot_recusado;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r92('5 · com decisão mas sem consentimento: bot ainda recusado', false, 'exceção: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r92('5 · com decisão ATIVA mas SEM consentimento: origem=bot ainda RECUSADO (2ª trava isolada)',
    coalesce(v_ok, false), 'bot_recusado_por_consentimento=' || v_bot_recusado || ' (' || left(v_msg, 200) || ')');
end $$;


-- ===========================================================================
-- 6 · COM decisão jurídica ativa E consentimento do titular — as DUAS travas
-- cedem juntas: origem='bot' e copiloto_sugestoes PASSAM.
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_sessao uuid; v_admin uuid;
  v_bot_passou boolean := false;
  v_sugestao_passou boolean := false;
  v_msg text := '';
  v_ok boolean;
begin
  begin
    select id into v_admin from perfis_equipe where papel in ('admin', 'advogada') and ativo limit 1;
    if v_admin is null then
      perform pg_temp.r92('6 · com decisão e consentimento: bot e sugestão PASSAM', false,
        'sem perfis_equipe admin/advogada ativo — rode com dado de exemplo populado');
      return;
    end if;

    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificação 0093 C', 'verif0093c@example.com', '+5511921120002', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_sessao;

    -- Revoga decisão ativa pré-existente do escopo antes de inserir a de
    -- teste (mesma armadilha do bloco 1 — ver comentário de topo do arquivo).
    update decisoes_juridicas set revogada_em = now(), revogada_por = v_admin
     where escopo = 'sessao.copiloto_ao_vivo' and revogada_em is null;

    insert into decisoes_juridicas (escopo, descricao, base_legal, subprocessador, decidido_por)
    values ('sessao.copiloto_ao_vivo', 'teste de verificação — revogar/rollback', 'teste', 'teste', v_admin);

    insert into consentimentos (pessoa_id, tipo, concedido, texto_apresentado, versao_texto, canal, registrado_por)
    values (v_p, 'copiloto_sessao_ao_vivo', true, 'texto de teste', 'teste-v1', 'sessao_zoom', v_admin);

    begin
      insert into sessoes_copiloto_segmentos (sessao_id, ordem, texto, origem)
      values (v_sessao, 1, 'Trecho vindo do bot.', 'bot');
      v_bot_passou := true;
    exception when others then
      v_msg := v_msg || 'bot: ' || sqlerrm || ' ';
    end;

    begin
      insert into copiloto_sugestoes (sessao_id, gatilho, conteudo)
      values (v_sessao, 'sob_demanda', '{}'::jsonb);
      v_sugestao_passou := true;
    exception when others then
      v_msg := v_msg || 'sugestao: ' || sqlerrm;
    end;

    v_ok := v_bot_passou and v_sugestao_passou;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r92('6 · com decisão e consentimento: bot e sugestão PASSAM', false, 'exceção: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r92('6 · com decisão ATIVA E consentimento CONCEDIDO: origem=bot e copiloto_sugestoes PASSAM',
    coalesce(v_ok, false), 'bot_passou=' || v_bot_passou || ' sugestao_passou=' || v_sugestao_passou || ' ' || v_msg);
end $$;


-- ===========================================================================
-- 7 · sessoes_copiloto.gravacao_externa_id (pedir o bot) exige as mesmas duas
-- travas — testado SEM decisão nem consentimento (deve recusar).
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_sessao uuid;
  v_recusado boolean := false;
  v_msg text := '';
  v_ok boolean;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificação 0093 D', 'verif0093d@example.com', '+5511921120003', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_sessao;

    begin
      insert into sessoes_copiloto (sessao_id, gravacao_externa_id)
      values (v_sessao, 'bot-externo-teste-0093');
    exception when others then
      v_recusado := (sqlerrm like '%copiloto_ao_vivo_bloqueado%');
      v_msg := sqlerrm;
    end;

    v_ok := v_recusado;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r92('7 · gravacao_externa_id exige as duas travas', false, 'exceção: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r92('7 · sessoes_copiloto.gravacao_externa_id (pedir bot) recusado sem decisão/consentimento',
    coalesce(v_ok, false), 'recusado=' || v_recusado || ' (' || left(v_msg, 200) || ')');
end $$;


-- ===========================================================================
-- 8 · prompt 'copiloto_sessao' (0094) existe e nasce ativo=false.
-- ===========================================================================
do $$
declare
  v_existe boolean; v_ativo boolean; v_modelo text; v_effort text;
begin
  select true, ativo, modelo_padrao, effort into v_existe, v_ativo, v_modelo, v_effort
    from prompts_versoes where chave = 'copiloto_sessao' and versao = 1;

  perform pg_temp.r92('8 · prompt copiloto_sessao existe e nasce ativo=false',
    coalesce(v_existe, false) and v_ativo is false and v_modelo = 'anthropic/claude-sonnet-5' and v_effort = 'low',
    'existe=' || coalesce(v_existe::text, 'false') || ' ativo=' || coalesce(v_ativo::text, 'AUSENTE') ||
    ' modelo=' || coalesce(v_modelo, 'AUSENTE') || ' effort=' || coalesce(v_effort, 'AUSENTE'));
end $$;


-- ===========================================================================
-- 9 · explain (analyze) do custo real da trigger — A MEDIR contra o banco
-- real. Sem `.env` nesta máquina não há como rodar. Comando exato:
--
--   explain (analyze, buffers)
--   insert into copiloto_sugestoes (sessao_id, gatilho, conteudo)
--   values ('<uuid de sessão com decisão+consentimento ativos>', 'sob_demanda', '{}'::jsonb);
--
-- Esperado: o custo extra da trigger é dominado por DOIS lookups pequenos
-- (`uniq_decisao_juridica_ativa`, índice parcial único; e
-- `idx_consent_pessoa_tipo`, 0005) — nenhum seq scan.
-- Colar a saída crua na entrega — não estimar.
-- ===========================================================================
do $$
begin
  -- `ok=false` de propósito (não é falha, é "não verificado nesta rodada") —
  -- mesma convenção do passo 7 de `verificacao-0091.sql`.
  perform pg_temp.r92('9 · explain (analyze) do INSERT sob a trigger de 0093', false,
    'A MEDIR — sem banco nesta máquina. Comando exato no comentário acima deste bloco.');
end $$;


-- ===========================================================================
-- 10 · explain (analyze) da janela de transcrição do contexto de IA
-- (server/copiloto/contexto.ts::buscarJanelaTranscricao) — A MEDIR. Comando
-- exato:
--
--   explain (analyze, buffers)
--   select falante, texto, criado_em
--     from sessoes_copiloto_segmentos
--    where sessao_id = '<uuid de sessão com segmentos>'
--      and criado_em >= now() - interval '90 seconds'
--    order by ordem
--    limit 40;
--
-- Esperado: "Index Scan using idx_copiloto_segmentos_polling" restringindo
-- por sessao_id (o `gte(criado_em)` vira filtro RESIDUAL dentro do Index
-- Scan — aceitável porque a cardinalidade por sessão é pequena, teto de
-- ~180 segmentos por sessão de 90 min, §2.1 do plano), NUNCA "Seq Scan".
-- ===========================================================================
do $$
begin
  perform pg_temp.r92('10 · explain (analyze) da janela de transcrição (contexto de IA)', false,
    'A MEDIR — sem banco nesta máquina. Comando exato no comentário acima deste bloco.');
end $$;


-- ===========================================================================
-- 11 · copiloto_sugestoes.desfecho (0095) é imutável: 1ª gravação passa, 2ª
-- gravação (tentando trocar o valor) é RECUSADA PELO BANCO — mesmo por
-- service_role/postgres, porque é trigger, não RLS.
--
-- CORRIGIDO (achado do fable-orchestrator, 2ª rodada): a trigger de 0093
-- (trg_copiloto_exige_decisao_sugestoes) é `before insert` INCONDICIONAL —
-- dispara para QUALQUER papel, `postgres` inclusive. Não existe bypass por
-- privilégio; é exatamente o que o passo 4 já prova (o mesmo INSERT, sem
-- decisão/consentimento, é RECUSADO). A versão anterior deste passo 11
-- inseria a sugestão sem decisão/consentimento e um comentário afirmava
-- "bypassa a trigger" — falso, e a prova do falso está no próprio arquivo
-- (passo 4 espera recusa para o mesmo INSERT). Resultado: o INSERT levantava
-- `copiloto_ao_vivo_bloqueado`, caía no handler externo, e o passo reportava
-- falso PARA SEMPRE — nunca chegava a testar a imutabilidade do desfecho.
--
-- A CORREÇÃO: monta o MESMO cenário do bloco 6 (decisão ativa + consentimento
-- concedido) ANTES do INSERT da sugestão, para o INSERT passar pela trigger
-- LEGITIMAMENTE — e o passo passa a testar o que promete (0095), não a
-- trigger de 0093 (que os passos 2-4 já cobrem).
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_sessao uuid; v_sugestao uuid; v_admin uuid;
  v_1a_gravou boolean := false;
  v_2a_recusada boolean := false;
  v_msg text := '';
  v_ok boolean;
begin
  begin
    select id into v_admin from perfis_equipe where papel in ('admin', 'advogada') and ativo limit 1;
    if v_admin is null then
      perform pg_temp.r92('11 · copiloto_sugestoes.desfecho imutável', false,
        'sem perfis_equipe admin/advogada ativo — rode com dado de exemplo populado');
      return;
    end if;

    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificação 0095 A', 'verif0095a@example.com', '+5511921120004', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_sessao;

    -- Revoga decisão ativa pré-existente do escopo antes de inserir a de
    -- teste (mesma armadilha do índice parcial único, catalogada no topo
    -- deste arquivo, e usada nos blocos 1/5/6).
    update decisoes_juridicas set revogada_em = now(), revogada_por = v_admin
     where escopo = 'sessao.copiloto_ao_vivo' and revogada_em is null;

    insert into decisoes_juridicas (escopo, descricao, base_legal, subprocessador, decidido_por)
    values ('sessao.copiloto_ao_vivo', 'teste de verificação — revogar/rollback', 'teste', 'teste', v_admin);

    insert into consentimentos (pessoa_id, tipo, concedido, texto_apresentado, versao_texto, canal, registrado_por)
    values (v_p, 'copiloto_sessao_ao_vivo', true, 'texto de teste', 'teste-v1', 'sessao_zoom', v_admin);

    -- Com decisão ativa + consentimento concedido, este INSERT passa pela
    -- trigger de 0093 LEGITIMAMENTE (mesmo cenário do bloco 6) — o objeto
    -- deste passo é o que acontece DEPOIS, com desfecho.
    insert into copiloto_sugestoes (sessao_id, gatilho, conteudo)
    values (v_sessao, 'sob_demanda', '{}'::jsonb) returning id into v_sugestao;

    begin
      update copiloto_sugestoes set desfecho = 'aceita', desfecho_em = now() where id = v_sugestao;
      v_1a_gravou := true;
    exception when others then
      v_msg := v_msg || '1a_gravacao_falhou: ' || sqlerrm || ' ';
    end;

    begin
      update copiloto_sugestoes set desfecho = 'ignorada', desfecho_em = now() where id = v_sugestao;
    exception when others then
      v_2a_recusada := (sqlerrm like '%desfecho_imutavel%');
      v_msg := v_msg || '2a_gravacao: ' || sqlerrm;
    end;

    v_ok := v_1a_gravou and v_2a_recusada;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r92('11 · copiloto_sugestoes.desfecho imutável', false, 'exceção: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r92('11 · desfecho: 1ª gravação passa, 2ª (troca) é RECUSADA PELO BANCO',
    coalesce(v_ok, false), '1a_gravou=' || v_1a_gravou || ' 2a_recusada=' || v_2a_recusada || ' ' || v_msg);
end $$;


select * from resultado_0092_0093 order by ordem;
