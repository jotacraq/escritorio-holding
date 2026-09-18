-- scripts/verificacao-0122.sql — roteiro da FICHA DO CLIENTE (0122):
-- sessoes_copiloto.ficha_acumulada + 5 chaves de configuracoes.
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- `postgres`, com 0091 a 0122 APLICADAS. A última instrução devolve
-- `resultado_0122` (ordem, passo, ok, detalhe). `ok = true` em todas prova
-- que o banco faz o que a 0122 promete.
--
-- TUDO COM ROLLBACK, mesmo padrão de `verificacao-0120.sql`: cada bloco que
-- escreve vive num sub-`begin … exception … end` terminado em `raise
-- exception 'rollback_proposital'`, e o INSERT no resultado acontece FORA
-- dele.
--
-- O QUE ESTE ROTEIRO PROVA
--   0  a coluna existe, NOT NULL, default '[]'::jsonb
--   1  o CHECK de tamanho existe, é VALID (não ficou pendurado em NOT VALID)
--   2  linha nova nasce com ficha_acumulada = '[]' (nunca NULL)
--   3  CHECK recusa array grande (> 4096 bytes) — prova que o backstop existe de verdade
--   4  as 5 chaves de configuração existem com o valor de nascença
--   5  reaplicar a migration inteira não duplica chave nem falha no add column/constraint
--   6  `explain (analyze, buffers)` do SELECT de `montarEstadoCopiloto` — A MEDIR
-- ---------------------------------------------------------------------------

drop table if exists resultado_0122;
create temp table resultado_0122 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r122(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0122 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;


-- ===========================================================================
-- 0 · A coluna existe, NOT NULL, default '[]'::jsonb.
-- ===========================================================================
do $$
declare
  v_not_null boolean;
  v_default text;
  v_tipo text;
begin
  select (not is_nullable::boolean = 'YES'::boolean) is not null and is_nullable = 'NO',
         column_default, data_type
    into v_not_null, v_default, v_tipo
    from information_schema.columns
   where table_schema = 'public' and table_name = 'sessoes_copiloto' and column_name = 'ficha_acumulada';

  perform pg_temp.r122('0 · sessoes_copiloto.ficha_acumulada existe, NOT NULL, tipo jsonb, default ''[]''',
    coalesce(v_not_null, false) and v_tipo = 'jsonb' and v_default like '%''[]''%',
    'not_null=' || coalesce(v_not_null::text,'?') || ' tipo=' || coalesce(v_tipo,'AUSENTE') || ' default=' || coalesce(v_default,'AUSENTE'));
end $$;


-- ===========================================================================
-- 1 · O CHECK de tamanho existe e é VALID (não ficou NOT VALID pendurado).
-- ===========================================================================
do $$
declare
  v_valido boolean;
  v_def text;
begin
  select convalidated, pg_get_constraintdef(oid)
    into v_valido, v_def
    from pg_constraint
   where conname = 'sessoes_copiloto_ficha_acumulada_tamanho';

  perform pg_temp.r122('1 · CHECK sessoes_copiloto_ficha_acumulada_tamanho existe e está VALID',
    coalesce(v_valido, false) and v_def ilike '%pg_column_size%4096%',
    'valido=' || coalesce(v_valido::text,'AUSENTE') || ' def=' || coalesce(v_def,'AUSENTE'));
end $$;


-- ===========================================================================
-- 2 · Sessão nova nasce com ficha_acumulada = '[]' (nunca NULL).
-- ASSUME: uma sessão real existe para satisfazer a FK de `sessao_id` (criada
-- aqui, não um uuid solto — mesma lição de `verificacao-0120.sql`).
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_sessao uuid;
  v_ficha jsonb;
  v_ok boolean;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificação 0122 A', 'verif0122a@example.com', '+5511921970010', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_sessao;
    insert into sessoes_copiloto (sessao_id) values (v_sessao); -- default '[]'::jsonb (0122)

    select ficha_acumulada into v_ficha from sessoes_copiloto where sessao_id = v_sessao;

    v_ok := v_ficha is not null and v_ficha = '[]'::jsonb;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r122('2 · sessão nova nasce com ficha_acumulada=''[]''', false, 'exceção: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r122('2 · sessão nova nasce com ficha_acumulada=''[]'' (nunca NULL)', coalesce(v_ok, false),
    'ficha_acumulada=' || coalesce(v_ficha::text, 'NULL'));
end $$;


-- ===========================================================================
-- 3 · CHECK recusa array grande (> 4096 bytes) — backstop de verdade, não só
-- decorativo (mesma prova de honestidade dos CHECKs desta base, catalogada
-- na regra "CHECK reescrito de memória apaga valor em silêncio").
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_sessao uuid;
  v_grande jsonb := '[]'::jsonb;
  v_recusou boolean := false;
  i int;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificação 0122 B', 'verif0122b@example.com', '+5511921970011', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_sessao;

    -- ~80 itens de ~120 bytes cada (evidência+texto no teto de produto) —
    -- estoura de sobra os 4096 bytes do CHECK.
    for i in 1..80 loop
      v_grande := v_grande || jsonb_build_array(jsonb_build_object(
        'categoria', 'objecao',
        'texto', repeat('x', 90),
        'evidencia', repeat('y', 120)
      ));
    end loop;

    begin
      insert into sessoes_copiloto (sessao_id, ficha_acumulada) values (v_sessao, v_grande);
    exception when check_violation then
      v_recusou := true;
    end;

    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r122('3 · CHECK recusa array > 4096 bytes', false, 'exceção inesperada: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r122('3 · CHECK recusa INSERT com ficha_acumulada > 4096 bytes (backstop real)',
    v_recusou, 'recusou=' || v_recusou);
end $$;


-- ===========================================================================
-- 4 · As 5 chaves de configuração existem com o valor de nascença.
-- ===========================================================================
do $$
declare
  v_erros text := '';
  v_valor jsonb;
begin
  select valor into v_valor from configuracoes where chave = 'copiloto_sessao.ficha_cliente';
  if v_valor is distinct from 'false'::jsonb then v_erros := v_erros || 'ficha_cliente(=' || coalesce(v_valor::text,'AUSENTE') || ') '; end if;

  select valor into v_valor from configuracoes where chave = 'copiloto_sessao.ficha_teto_fixos';
  if v_valor is distinct from 'null'::jsonb then v_erros := v_erros || 'ficha_teto_fixos(=' || coalesce(v_valor::text,'AUSENTE') || ') '; end if;

  select valor into v_valor from configuracoes where chave = 'copiloto_sessao.rodape_transcricao';
  if v_valor is distinct from 'true'::jsonb then v_erros := v_erros || 'rodape_transcricao(=' || coalesce(v_valor::text,'AUSENTE') || ') '; end if;

  select valor into v_valor from configuracoes where chave = 'copiloto_sessao.silencio_atencao_s';
  if v_valor is distinct from '12'::jsonb then v_erros := v_erros || 'silencio_atencao_s(=' || coalesce(v_valor::text,'AUSENTE') || ') '; end if;

  select valor into v_valor from configuracoes where chave = 'copiloto_sessao.silencio_alerta_s';
  if v_valor is distinct from '25'::jsonb then v_erros := v_erros || 'silencio_alerta_s(=' || coalesce(v_valor::text,'AUSENTE') || ') '; end if;

  perform pg_temp.r122('4 · as 5 chaves nascem com o valor esperado', v_erros = '',
    case when v_erros = '' then 'ok' else 'ACHADOS: ' || v_erros end);
end $$;


-- ===========================================================================
-- 5 · Reaplicar a migration inteira não duplica chave nem falha (idempotência
-- do `add column if not exists` / `on conflict (chave) do nothing`).
-- ===========================================================================
do $$
declare
  v_qtd_antes int;
  v_qtd_depois int;
begin
  select count(*) into v_qtd_antes from configuracoes where chave like 'copiloto_sessao.ficha%' or chave like 'copiloto_sessao.rodape%' or chave like 'copiloto_sessao.silencio%';

  begin
    alter table sessoes_copiloto add column if not exists ficha_acumulada jsonb not null default '[]'::jsonb;
    insert into configuracoes (chave, valor, descricao) values
      ('copiloto_sessao.ficha_cliente', 'false'::jsonb, 'reaplicação idempotente (verificação)'),
      ('copiloto_sessao.ficha_teto_fixos', 'null'::jsonb, 'reaplicação idempotente (verificação)'),
      ('copiloto_sessao.rodape_transcricao', 'true'::jsonb, 'reaplicação idempotente (verificação)'),
      ('copiloto_sessao.silencio_atencao_s', '12'::jsonb, 'reaplicação idempotente (verificação)'),
      ('copiloto_sessao.silencio_alerta_s', '25'::jsonb, 'reaplicação idempotente (verificação)')
    on conflict (chave) do nothing;
  exception when others then
    perform pg_temp.r122('5 · reaplicar a migration é idempotente', false, 'exceção: ' || sqlerrm);
    return;
  end;

  select count(*) into v_qtd_depois from configuracoes where chave like 'copiloto_sessao.ficha%' or chave like 'copiloto_sessao.rodape%' or chave like 'copiloto_sessao.silencio%';

  perform pg_temp.r122('5 · reaplicar a migration não duplica chave nem falha no add column',
    v_qtd_antes = v_qtd_depois, 'antes=' || v_qtd_antes || ' depois=' || v_qtd_depois);
end $$;


-- ===========================================================================
-- 6 · `explain (analyze, buffers)` do SELECT de `montarEstadoCopiloto`
-- (server/copiloto/estado.ts) — A MEDIR contra o banco real, ANTES e DEPOIS
-- de acrescentar `ficha_acumulada` ao embed. Sem `.env` nesta máquina não há
-- como rodar (mesmo aviso de honestidade de 0096/0105/0111/0119/0120/0121).
-- Comando exato para colar no MCP/SQL Editor com uma sessão real populada:
--
--   -- ANTES (sem ficha_acumulada no select):
--   begin;
--   explain (analyze, buffers)
--   select sv.id, sv.roteiro_versao_id, sv.sims, sc.estado, sc.gravacao_externa_id,
--          sc.participantes, sc.expurgo_segmentos_em, sc.inventario_acumulado, sc.resumo_acumulado
--     from sessoes_viabilidade sv
--     left join sessoes_copiloto sc on sc.sessao_id = sv.id
--    where sv.id = '<uuid de uma sessao real>'::uuid;
--   rollback;
--
--   -- DEPOIS (com ficha_acumulada no select):
--   begin;
--   explain (analyze, buffers)
--   select sv.id, sv.roteiro_versao_id, sv.sims, sc.estado, sc.gravacao_externa_id,
--          sc.participantes, sc.expurgo_segmentos_em, sc.inventario_acumulado, sc.resumo_acumulado,
--          sc.ficha_acumulada
--     from sessoes_viabilidade sv
--     left join sessoes_copiloto sc on sc.sessao_id = sv.id
--    where sv.id = '<mesmo uuid>'::uuid;
--   rollback;
--
-- CRITÉRIO DE DECISÃO: os dois planos usam `Index Scan using
-- sessoes_viabilidade_pkey` (o embed do PostgREST vira este mesmo tipo de
-- join por FK) — mesmos `Buffers: shared hit`, sem `Seq Scan`, sem leitura
-- de TOAST nova (`Buffers: ... read` a mais no DEPOIS seria o sinal de
-- alerta). A diferença esperada é só no `width` estimado da linha.
-- ===========================================================================
do $$
begin
  perform pg_temp.r122('6 · explain (analyze) ANTES/DEPOIS do SELECT de montarEstadoCopiloto', false,
    'A MEDIR — sem banco nesta máquina. Comando exato no comentário acima deste bloco.');
end $$;


select * from resultado_0122 order by ordem;
