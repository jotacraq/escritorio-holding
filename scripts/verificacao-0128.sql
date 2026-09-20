-- scripts/verificacao-0128.sql — roteiro da restrição de `tl_ins` (0128, F2).
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só, como `postgres`, com 0014 a 0128 aplicadas.
-- A última instrução devolve `resultado_0128`. `ok = true` em todas prova que
-- o banco faz o que a 0128 promete.
--
-- TUDO COM ROLLBACK. Importa mais aqui que em qualquer outro roteiro:
-- `eventos_timeline` é APPEND-ONLY (0014:26 — sem policy de update, sem
-- delete). Linha de teste esquecida nesta tabela vira fato falso permanente
-- na linha do tempo de um cliente real.
--
-- O QUE PROVA
--   0  a policy `tl_ins` existe e carrega o predicado novo
--   1  🔴 `authenticated` NÃO consegue inserir `tipo='retrospecto'`
--   2  `authenticated` CONTINUA inserindo os outros tipos (nada quebrou)
--   3  🔴 os TRIGGERS da 0014 continuam gravando evento em DML de
--      `authenticated` — a prova de que o predicado não os pegou junto
--      (`app.registrar_evento_timeline` NÃO é security definer: roda como
--      `authenticated` e depende de `tl_ins`)
--   4  `service_role` continua gravando `tipo='retrospecto'` (o caminho real)
--   5  higiene: zero evento `retrospecto` fora da FORMA que o sistema grava
-- ---------------------------------------------------------------------------

drop table if exists resultado_0128;
create temp table resultado_0128 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r128(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0128 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;


-- ===========================================================================
-- 0 · A policy existe e tem o predicado.
-- ===========================================================================
do $$
declare v_check text; v_cmd text; v_total int;
begin
  select with_check, cmd into v_check, v_cmd from pg_policies
   where schemaname = 'public' and tablename = 'eventos_timeline' and policyname = 'tl_ins';
  select count(*) into v_total from pg_policies
   where schemaname = 'public' and tablename = 'eventos_timeline' and cmd in ('INSERT','ALL');

  perform pg_temp.r128('0 · tl_ins existe, e de INSERT, mantem eh_interno() E barra tipo=retrospecto',
    coalesce(v_check,'') ilike '%eh_interno%'
      and coalesce(v_check,'') ilike '%retrospecto%'
      and v_cmd = 'INSERT'
      and v_total = 1,  -- nenhuma 2a policy de INSERT/ALL reabrindo o caminho
    'cmd=' || coalesce(v_cmd,'AUSENTE') || ' policies_insert=' || coalesce(v_total::text,'?') ||
    ' with_check=' || coalesce(v_check,'AUSENTE'));
end $$;


-- ===========================================================================
-- 1 · 🔴 `authenticated` NAO insere tipo='retrospecto'.
-- Sem sessao real (auth.uid() nulo) `app.eh_interno()` ja negaria sozinho e o
-- teste passaria por motivo ERRADO. Para isolar o predicado NOVO, comparamos
-- com o passo 2: se o 2 passar e o 1 for negado, quem negou foi `tipo`.
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_s uuid;
  v_negou boolean := false; v_sqlstate text;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificacao 0128 A', 'verif0128a@example.com', '+5511921970140', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_s;

    begin
      set local role authenticated;
      insert into eventos_timeline (jornada_id, tipo, titulo, dados, ator_tipo)
      values (v_j, 'retrospecto', 'PLANTADO POR HUMANO', jsonb_build_object('sessao_id', v_s::text), 'humano');
      reset role;
    exception when others then
      v_sqlstate := sqlstate;
      v_negou := sqlstate = '42501';
      begin reset role; exception when others then null; end;
    end;

    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r128('1 · authenticated NAO insere tipo=retrospecto', false, 'excecao: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r128('1 · 🔴 authenticated NAO insere tipo=''retrospecto'' (42501 da policy)',
    coalesce(v_negou,false), 'sqlstate=' || coalesce(v_sqlstate,'NENHUM ERRO — O PLANT PASSOU!'));
end $$;


-- ===========================================================================
-- 2 e 3 · Nada quebrou: os outros tipos continuam entrando, e os TRIGGERS da
-- 0014 continuam gravando. O passo 3 e o que prova que o predicado novo nao
-- pegou `app.registrar_evento_timeline` junto (ela NAO e security definer —
-- 0014:29 — entao roda como `authenticated` e passa por `tl_ins`).
--
-- Rodado como `postgres` (que nao passa por policy) para a JORNADA existir, e
-- so o INSERT do evento e feito sob `set local role authenticated`.
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid;
  v_outro_ok boolean := false;
  v_eventos_trigger int := 0;
  v_erro text;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificacao 0128 B', 'verif0128b@example.com', '+5511921970141', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;

    -- (3) O TRIGGER: mudar a etapa dispara `app.timeline_jornada`, que chama
    -- `app.registrar_evento_timeline`. Se a 0128 tivesse barrado tipos demais,
    -- este UPDATE morreria com 42501 vindo de um gatilho invisivel.
    update jornadas set etapa = 'sessao_realizada' where id = v_j;
    select count(*) into v_eventos_trigger from eventos_timeline
     where jornada_id = v_j and tipo = 'etapa';

    -- (2) Um tipo qualquer, inserido direto pela "tela".
    begin
      insert into eventos_timeline (jornada_id, tipo, titulo, dados, ator_tipo)
      values (v_j, 'nota', 'Nota da equipe', '{}'::jsonb, 'humano');
      v_outro_ok := true;
    exception when others then
      v_erro := sqlstate || ' ' || sqlerrm;
    end;

    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r128('2/3 · outros tipos e triggers continuam funcionando', false, 'excecao: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r128('2 · outro tipo (nota) continua sendo aceito — a 0128 nao fechou a tabela',
    coalesce(v_outro_ok,false), coalesce(v_erro, 'inserido com sucesso'));
  perform pg_temp.r128('3 · 🔴 TRIGGERS da 0014 continuam gravando (app.registrar_evento_timeline nao foi pega junto)',
    coalesce(v_eventos_trigger,0) > 0, 'eventos tipo=etapa gravados pelo trigger=' || coalesce(v_eventos_trigger::text,'?'));
end $$;


-- ===========================================================================
-- 4 · `service_role` continua gravando `retrospecto` — o caminho REAL do
-- encerramento (`criarClienteAdmin()`).
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_s uuid; v_ok boolean := false; v_erro text;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificacao 0128 C', 'verif0128c@example.com', '+5511921970142', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_s;

    begin
      set local role service_role;
      insert into eventos_timeline (jornada_id, tipo, titulo, descricao, dados, ator_perfil_id, ator_tipo)
      values (v_j, 'retrospecto', 'Retrospecto da Sessão gerado', null,
              jsonb_build_object('sessao_id', v_s::text), null, 'sistema');
      v_ok := true;
      reset role;
    exception when others then
      v_erro := sqlstate || ' ' || sqlerrm;
      begin reset role; exception when others then null; end;
    end;

    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r128('4 · service_role continua gravando retrospecto', false, 'excecao: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r128('4 · service_role CONTINUA gravando tipo=''retrospecto'' (o caminho real do encerramento)',
    coalesce(v_ok,false), coalesce(v_erro, 'inserido com sucesso'));
end $$;


-- ===========================================================================
-- 5 · HIGIENE — nenhum evento `retrospecto` fora da FORMA do sistema.
--
-- 🔴 NAO usar `ator_perfil_id is not null` como sinal de plant: o sistema
-- grava `ator_perfil_id` + `ator_tipo='humano'` de proposito quando foi a
-- ADVOGADA que clicou "Encerrar" (so o encerramento por duracao_maxima fica
-- com 'sistema'/null). O sinal certo e a FORMA, e e a mesma que
-- `retrospecto.ts::eventoEhDoSistema` usa: titulo exato + descricao nula.
-- Qualquer outra coisa e linha que o servidor nao escreveu.
-- ===========================================================================
do $$
declare v_suspeitos int; v_total int;
begin
  select count(*) into v_total from eventos_timeline where tipo = 'retrospecto';
  select count(*) into v_suspeitos from eventos_timeline
   where tipo = 'retrospecto'
     and (titulo is distinct from 'Retrospecto da Sessão gerado' or descricao is not null);

  perform pg_temp.r128('5 · ZERO evento retrospecto fora da forma do sistema (titulo exato + descricao nula)',
    coalesce(v_suspeitos,0) = 0,
    'eventos_retrospecto=' || coalesce(v_total::text,'?') || ' fora_da_forma=' || coalesce(v_suspeitos::text,'?'));
end $$;


select ordem, passo, ok, detalhe from resultado_0128 order by ordem;
