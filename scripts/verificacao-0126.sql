-- scripts/verificacao-0126.sql — roteiro do EVENTO DE TIMELINE DO RETROSPECTO
-- (0126): índice único parcial `uniq_timeline_retrospecto_sessao`.
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- `postgres`, com 0014 a 0126 APLICADAS. A última instrução devolve
-- `resultado_0126` (ordem, passo, ok, detalhe). `ok = true` em TODAS prova
-- que o banco faz o que a 0126 promete.
--
-- TUDO COM ROLLBACK: todo bloco que ESCREVE vive num sub-`begin … exception
-- … end` terminado em `raise exception 'rollback_proposital'`, e o INSERT no
-- resultado acontece FORA dele. NENHUMA linha sobrevive a este roteiro —
-- importa aqui mais que nos outros, porque `eventos_timeline` é APPEND-ONLY
-- (0014:26: sem update, sem delete): lixo deixado nesta tabela vira fato
-- falso permanente na linha do tempo de um cliente real.
--
-- 🔴 POR QUE ESTE ROTEIRO EXISTE: o teste de unidade
-- (`retrospecto.test.ts`, bloco "evento de timeline") simula o `23505` num
-- banco de mentira — prova que o CÓDIGO trata o duplicado como sucesso, não
-- que o BANCO recusa o duplicado. Quem garante "1 evento por sessão" é o
-- índice, e índice não aparece em build verde.
--
-- O QUE ESTE ROTEIRO PROVA
--   0  o índice existe, é UNIQUE e é PARCIAL (`where tipo = 'retrospecto'`)
--   1  a expressão indexada é `dados->>'sessao_id'` (e não `jornada_id`)
--   2  🔴 2 eventos da MESMA sessão → o 2º é RECUSADO com 23505
--   3  2 eventos de sessões DIFERENTES na MESMA jornada → os dois passam
--      (o índice é por SESSÃO; não pode barrar a 2ª sessão de uma jornada)
--   4  o índice NÃO atrapalha os outros tipos: 2 eventos `tipo='transcricao'`
--      na mesma jornada continuam permitidos (o parcial só morde o retrospecto)
--   5  `service_role` consegue INSERT (grant + RLS) — o caminho real do
--      encerramento usa `criarClienteAdmin()`
--   6  contrato do FRONT: existe evento com `tipo = 'retrospecto'` e ele é o
--      que `lib/pasta/derivar.ts:66` procura (`some(e => e.tipo === ...)`)
--   7  higiene: ZERO duplicata de retrospecto já gravada na tabela
-- ---------------------------------------------------------------------------

drop table if exists resultado_0126;
create temp table resultado_0126 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r126(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0126 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;


-- ===========================================================================
-- 0 · O índice existe, é UNIQUE e é PARCIAL.
-- ===========================================================================
do $$
declare v_def text; v_unico boolean; v_parcial boolean;
begin
  select indexdef into v_def from pg_indexes
   where schemaname = 'public' and indexname = 'uniq_timeline_retrospecto_sessao';

  v_unico := coalesce(v_def,'') ilike 'CREATE UNIQUE INDEX%';
  v_parcial := coalesce(v_def,'') ilike '%WHERE (tipo = ''retrospecto''::text)%';

  perform pg_temp.r126('0 · uniq_timeline_retrospecto_sessao existe, e UNIQUE e e PARCIAL (where tipo=retrospecto)',
    coalesce(v_unico,false) and coalesce(v_parcial,false),
    coalesce(v_def, 'INDICE AUSENTE — a 0126 nao foi aplicada'));
end $$;


-- ===========================================================================
-- 1 · A expressão indexada é `dados->>'sessao_id'`. 🔴 Se alguém "simplificar"
-- para `jornada_id`, o índice passa a barrar a 2a SESSAO de uma mesma jornada
-- — um bug que só apareceria no dia em que um cliente fizesse duas sessoes.
-- ===========================================================================
do $$
declare v_def text;
begin
  select indexdef into v_def from pg_indexes
   where schemaname = 'public' and indexname = 'uniq_timeline_retrospecto_sessao';

  perform pg_temp.r126('1 · a chave do indice e dados->>''sessao_id'' (NAO jornada_id)',
    coalesce(v_def,'') ilike '%sessao_id%' and coalesce(v_def,'') not ilike '%(jornada_id)%',
    coalesce(v_def, 'AUSENTE'));
end $$;


-- ===========================================================================
-- 2 · 🔴 A PROVA PRINCIPAL — encerrar 2x gera 1 evento só.
-- Simula exatamente o que `registrarRetrospectoNaTimeline` faz: dois INSERTs
-- iguais, como aconteceria no retry de sessao em 'erro' ou na corrida entre
-- o clique e o ciclo automatico de `duracao_maxima_minutos`.
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_sessao uuid;
  v_linhas int;
  v_segundo_recusou boolean := false;
  v_sqlstate text;
  v_ok boolean;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificacao 0126 A', 'verif0126a@example.com', '+5511921970130', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_sessao;

    -- 1o encerramento: grava.
    insert into eventos_timeline (jornada_id, tipo, titulo, descricao, dados, ator_perfil_id, ator_tipo)
    values (v_j, 'retrospecto', 'Retrospecto da Sessao gerado', 'Cobertura do roteiro: 9 de 13 partes.',
            jsonb_build_object('sessao_id', v_sessao::text, 'blocos_com_atividade', 9, 'blocos_no_roteiro', 13),
            null, 'sistema');

    -- 2o encerramento da MESMA sessao: o banco tem de recusar.
    begin
      insert into eventos_timeline (jornada_id, tipo, titulo, descricao, dados, ator_perfil_id, ator_tipo)
      values (v_j, 'retrospecto', 'Retrospecto da Sessao gerado', 'Cobertura do roteiro: 9 de 13 partes.',
              jsonb_build_object('sessao_id', v_sessao::text, 'blocos_com_atividade', 9, 'blocos_no_roteiro', 13),
              null, 'sistema');
    exception when unique_violation then
      v_segundo_recusou := true;
      v_sqlstate := sqlstate;  -- tem de ser 23505: e o codigo que o TS trata como SUCESSO
    end;

    select count(*) into v_linhas from eventos_timeline
     where jornada_id = v_j and tipo = 'retrospecto';

    v_ok := v_segundo_recusou and v_linhas = 1 and v_sqlstate = '23505';
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r126('2 · encerrar 2x gera 1 evento de timeline so', false, 'excecao: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r126('2 · 🔴 ENCERRAR 2x → 1 EVENTO SO (2o INSERT recusado com 23505, que o codigo trata como sucesso)',
    coalesce(v_ok,false),
    'segundo_recusado=' || coalesce(v_segundo_recusou::text,'?') || ' sqlstate=' || coalesce(v_sqlstate,'NENHUM') ||
    ' linhas=' || coalesce(v_linhas::text,'?'));
end $$;


-- ===========================================================================
-- 3 · DUAS SESSOES da MESMA jornada → DOIS eventos. O indice e por SESSAO.
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_s1 uuid; v_s2 uuid;
  v_linhas int; v_ok boolean;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificacao 0126 B', 'verif0126b@example.com', '+5511921970131', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_s1;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_s2;

    insert into eventos_timeline (jornada_id, tipo, titulo, dados, ator_tipo)
    values (v_j, 'retrospecto', 'Retrospecto da Sessao gerado', jsonb_build_object('sessao_id', v_s1::text), 'sistema'),
           (v_j, 'retrospecto', 'Retrospecto da Sessao gerado', jsonb_build_object('sessao_id', v_s2::text), 'sistema');

    select count(*) into v_linhas from eventos_timeline where jornada_id = v_j and tipo = 'retrospecto';
    v_ok := v_linhas = 2;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      -- 23505 aqui significaria que o indice esta por jornada_id, nao por sessao.
      perform pg_temp.r126('3 · 2 sessoes da mesma jornada → 2 eventos', false, 'excecao: ' || sqlerrm ||
        ' (23505 aqui = indice esta por jornada_id, que e o bug que o passo 1 procura)');
      return;
    end if;
  end;
  perform pg_temp.r126('3 · 2 SESSOES da MESMA jornada → 2 eventos (o indice e por sessao, nao por jornada)',
    coalesce(v_ok,false), 'linhas=' || coalesce(v_linhas::text,'?'));
end $$;


-- ===========================================================================
-- 4 · O parcial so morde `retrospecto`. Outros tipos continuam podendo
-- repetir (a timeline e um HISTORICO: 2 transcricoes sao 2 fatos).
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_linhas int; v_ok boolean;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificacao 0126 C', 'verif0126c@example.com', '+5511921970132', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;

    insert into eventos_timeline (jornada_id, tipo, titulo, dados, ator_tipo)
    values (v_j, 'transcricao', 'Transcricao consolidada', '{}'::jsonb, 'sistema'),
           (v_j, 'transcricao', 'Transcricao consolidada', '{}'::jsonb, 'sistema');

    select count(*) into v_linhas from eventos_timeline where jornada_id = v_j and tipo = 'transcricao';
    v_ok := v_linhas = 2;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r126('4 · outros tipos continuam repetiveis', false, 'excecao: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r126('4 · o indice PARCIAL nao morde outros tipos (2 eventos transcricao continuam permitidos)',
    coalesce(v_ok,false), 'linhas=' || coalesce(v_linhas::text,'?'));
end $$;


-- ===========================================================================
-- 5 · `service_role` consegue INSERT em eventos_timeline — e o caminho real
-- do encerramento usa `criarClienteAdmin()` (service_role). Conferido por
-- sonda nao destrutiva em 19/09/2026 (INSERT com jornada inexistente
-- devolveu 23503, nao 42501); aqui vira prova formal do GRANT.
-- ===========================================================================
do $$
declare v_insert boolean; v_select boolean;
begin
  v_insert := has_table_privilege('service_role', 'public.eventos_timeline', 'INSERT');
  v_select := has_table_privilege('service_role', 'public.eventos_timeline', 'SELECT');
  perform pg_temp.r126('5 · service_role tem INSERT e SELECT em eventos_timeline (o encerramento grava com criarClienteAdmin)',
    v_insert and v_select, 'insert=' || v_insert::text || ' select=' || v_select::text);
end $$;


-- ===========================================================================
-- 6 · CONTRATO DO FRONTEND. `lib/pasta/derivar.ts:66` faz
-- `ficha.timeline.some(e => e.tipo === 'retrospecto')`. Este passo prova que
-- a string gravada casa EXATAMENTE — um typo aqui desligaria o item
-- `retrospecto_sv` da Pasta em silencio, que e o defeito original.
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_s uuid; v_encontrou boolean; v_ok boolean;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificacao 0126 D', 'verif0126d@example.com', '+5511921970133', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_s;

    insert into eventos_timeline (jornada_id, tipo, titulo, dados, ator_tipo)
    values (v_j, 'retrospecto', 'Retrospecto da Sessao gerado', jsonb_build_object('sessao_id', v_s::text), 'sistema');

    -- A MESMA pergunta que o front faz, em SQL.
    select exists (select 1 from eventos_timeline where jornada_id = v_j and tipo = 'retrospecto')
      into v_encontrou;
    v_ok := v_encontrou;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r126('6 · contrato do front (tipo=retrospecto)', false, 'excecao: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r126('6 · contrato do FRONT: existe evento com tipo=''retrospecto'' (derivar.ts:66 acha, item sai de ''falta'')',
    coalesce(v_ok,false), 'encontrou=' || coalesce(v_encontrou::text,'?'));
end $$;


-- ===========================================================================
-- 7 · HIGIENE — nenhuma duplicata ja gravada. Se este passo falhar, NAO
-- remova o indice para destravar deploy: apague as duplicatas mantendo a
-- MAIS ANTIGA (a que tem o `ocorrido_em` verdadeiro) e so entao recrie.
-- ===========================================================================
do $$
declare v_dups int; v_total int;
begin
  select count(*) into v_total from eventos_timeline where tipo = 'retrospecto';
  select count(*) into v_dups from (
    select dados->>'sessao_id' as s, count(*) as n
      from eventos_timeline where tipo = 'retrospecto'
     group by 1 having count(*) > 1
  ) x;
  perform pg_temp.r126('7 · ZERO duplicata de evento retrospecto na tabela',
    coalesce(v_dups,0) = 0,
    'eventos_retrospecto=' || coalesce(v_total::text,'?') || ' sessoes_com_duplicata=' || coalesce(v_dups::text,'?'));
end $$;


-- ===========================================================================
-- RESULTADO
-- ===========================================================================
select ordem, passo, ok, detalhe from resultado_0126 order by ordem;
