-- scripts/verificacao-0129.sql — roteiro do ramo `copiloto_citacao_viva` em
-- `vw_pendencias_sistema` (0129, achado F9/INFO do pentest da Fase 13).
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só, como `postgres`, com 0014 a 0129 aplicadas.
-- A última instrução devolve `resultado_0129`.
--
-- TUDO COM ROLLBACK (`raise exception 'rollback_proposital'`).
--
-- O QUE PROVA
--   0  🔴 `security_invoker = true` está LIGADO na view (a lição da 0047 —
--      `pg_get_viewdef` não devolve reloptions, e já sumiu daqui uma vez)
--   1  a view não perdeu ramo: continua trazendo os tipos que já trazia
--   2  🔴 sessão carimbada COM citação viva no RETROSPECTO → acende
--   3  🔴 sessão carimbada COM citação viva na FICHA → acende
--   4  sessão carimbada e LIMPA → NÃO acende (nada de alarme falso)
--   5  sessão NÃO carimbada (expurgo nunca rodou) → NÃO acende
--   6  a descrição do alerta NÃO carrega citação literal
--   7  higiene: hoje, em produção, o ramo devolve zero
-- ---------------------------------------------------------------------------

drop table if exists resultado_0129;
create temp table resultado_0129 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r129(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0129 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;


-- ===========================================================================
-- 0 · 🔴 security_invoker. Sem ele a view roda com os direitos do DONO e
-- passa por cima da RLS de `pessoas`/`jornadas`/`sessoes_copiloto`. Foi
-- exatamente assim que a opcao sumiu antes (achado ALTO, corrigido na 0047):
-- `pg_get_viewdef` devolve so o SELECT, e quem recria a view a partir dele
-- sem repor as reloptions desliga a trava sem perceber.
-- ===========================================================================
do $$
declare v_opts text; v_invoker boolean;
begin
  select coalesce(array_to_string(c.reloptions, ', '), '') into v_opts
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'vw_pendencias_sistema';

  v_invoker := v_opts ilike '%security_invoker=true%' or v_opts ilike '%security_invoker=on%';

  perform pg_temp.r129('0 · 🔴 vw_pendencias_sistema tem security_invoker LIGADO (licao da 0047)',
    coalesce(v_invoker,false), 'reloptions=' || coalesce(nullif(v_opts,''), 'NENHUMA — TRAVA DESLIGADA'));
end $$;


-- ===========================================================================
-- 1 · A view nao perdeu ramo. Conferido pela lista de TIPOS que ela sabe
-- produzir (nao pela contagem de linhas, que depende do estado do banco).
-- ===========================================================================
do $$
declare v_def text; v_faltando text[] := '{}'; t text;
  v_tipos text[] := array['webhook_falho','produto_nao_mapeado','bot_nao_encerrado','copiloto_citacao_viva'];
begin
  select pg_get_viewdef('public.vw_pendencias_sistema'::regclass, true) into v_def;
  foreach t in array v_tipos loop
    if coalesce(v_def,'') not like '%' || t || '%' then v_faltando := v_faltando || t; end if;
  end loop;

  perform pg_temp.r129('1 · a view mantem os ramos antigos E ganhou copiloto_citacao_viva',
    array_length(v_faltando, 1) is null,
    'ramos_union=' || (length(v_def) - length(replace(v_def, 'UNION ALL', '')))/9 ||
    ' faltando=' || coalesce(array_to_string(v_faltando, ', '), 'nenhum'));
end $$;


-- ===========================================================================
-- 2 a 6 · O COMPORTAMENTO. Quatro sessoes fabricadas, uma por cenario.
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid;
  v_s_retro uuid; v_s_ficha uuid; v_s_limpa uuid; v_s_sem_carimbo uuid;
  v_marca text := 'MARCA-0129-citacao-literal-que-nao-pode-vazar';
  v_acende_retro int; v_acende_ficha int; v_acende_limpa int; v_acende_sem int;
  v_descricao text; v_desc_limpa boolean;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificacao 0129', 'verif0129@example.com', '+5511921970160', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_realizada', 'indicacao', 'exemplo') returning id into v_j;

    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_s_retro;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_s_ficha;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_s_limpa;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_s_sem_carimbo;

    -- (2) CARIMBADA, retrospecto ainda NAO redigido.
    insert into sessoes_copiloto (sessao_id, estado, expurgo_segmentos_em)
    values (v_s_retro, 'encerrado', now() - interval '1 day');
    insert into copiloto_retrospectos (sessao_id, jornada_id, blocos_com_atividade, blocos_no_roteiro, conteudo, evidencias_redigidas_em)
    values (v_s_retro, v_j, 4, 13,
            jsonb_build_object('versao', 1, 'observacoes_do_cliente',
              jsonb_build_array(jsonb_build_object('evidencia', v_marca))),
            null);   -- <- o buraco

    -- (3) CARIMBADA, ficha com evidencia viva.
    insert into sessoes_copiloto (sessao_id, estado, expurgo_segmentos_em, ficha_acumulada)
    values (v_s_ficha, 'encerrado', now() - interval '1 day',
            jsonb_build_array(jsonb_build_object('categoria','dor','texto','x','evidencia', v_marca)));

    -- (4) CARIMBADA e LIMPA: retrospecto redigido, ficha com evidencia ''.
    insert into sessoes_copiloto (sessao_id, estado, expurgo_segmentos_em, ficha_acumulada)
    values (v_s_limpa, 'encerrado', now() - interval '1 day',
            jsonb_build_array(jsonb_build_object('categoria','dor','texto','x','evidencia','')));
    insert into copiloto_retrospectos (sessao_id, jornada_id, blocos_com_atividade, blocos_no_roteiro, conteudo, evidencias_redigidas_em)
    values (v_s_limpa, v_j, 4, 13, '{}'::jsonb, now());

    -- (5) NAO CARIMBADA, com citacao viva: normal, o expurgo ainda nao passou.
    insert into sessoes_copiloto (sessao_id, estado, expurgo_segmentos_em, ficha_acumulada)
    values (v_s_sem_carimbo, 'encerrado', null,
            jsonb_build_array(jsonb_build_object('categoria','dor','texto','x','evidencia', v_marca)));

    select count(*) into v_acende_retro from vw_pendencias_sistema
     where tipo = 'copiloto_citacao_viva' and id = v_s_retro::text;
    select count(*) into v_acende_ficha from vw_pendencias_sistema
     where tipo = 'copiloto_citacao_viva' and id = v_s_ficha::text;
    select count(*) into v_acende_limpa from vw_pendencias_sistema
     where tipo = 'copiloto_citacao_viva' and id = v_s_limpa::text;
    select count(*) into v_acende_sem from vw_pendencias_sistema
     where tipo = 'copiloto_citacao_viva' and id = v_s_sem_carimbo::text;

    select descricao into v_descricao from vw_pendencias_sistema
     where tipo = 'copiloto_citacao_viva' and id = v_s_retro::text;
    v_desc_limpa := coalesce(v_descricao, '') not like '%MARCA-0129%';

    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r129('2-6 · comportamento do ramo', false, 'excecao: ' || sqlstate || ' ' || sqlerrm);
      return;
    end if;
  end;

  perform pg_temp.r129('2 · 🔴 carimbada + retrospecto NAO redigido → ACENDE',
    coalesce(v_acende_retro,0) = 1, 'linhas=' || coalesce(v_acende_retro::text,'?'));
  perform pg_temp.r129('3 · 🔴 carimbada + ficha com evidencia viva → ACENDE',
    coalesce(v_acende_ficha,0) = 1, 'linhas=' || coalesce(v_acende_ficha::text,'?'));
  perform pg_temp.r129('4 · carimbada e LIMPA → NAO acende (zero alarme falso)',
    coalesce(v_acende_limpa,1) = 0, 'linhas=' || coalesce(v_acende_limpa::text,'?'));
  perform pg_temp.r129('5 · NAO carimbada (expurgo nunca passou) → NAO acende',
    coalesce(v_acende_sem,1) = 0, 'linhas=' || coalesce(v_acende_sem::text,'?'));
  perform pg_temp.r129('6 · 🔴 a descricao do alerta NAO carrega citacao literal',
    coalesce(v_desc_limpa,false), 'descricao=' || left(coalesce(v_descricao,'NULA'), 200));
end $$;


-- ===========================================================================
-- 7 · HIGIENE — hoje o ramo tem de devolver ZERO em producao. Medido em
-- 19/09/2026: 3 sessoes de copiloto, todas com `expurgo_segmentos_em` NULO
-- (o expurgo nunca rodou; `copiloto_sessao.expurgo_ativo` nasce false).
-- Se este passo devolver > 0, NAO e falha do roteiro: e achado de verdade.
-- ===========================================================================
do $$
declare v_n int; v_carimbadas int;
begin
  select count(*) into v_n from vw_pendencias_sistema where tipo = 'copiloto_citacao_viva';
  select count(*) into v_carimbadas from sessoes_copiloto where expurgo_segmentos_em is not null;

  perform pg_temp.r129('7 · o ramo devolve ZERO hoje (nenhuma sessao carimbada ainda)',
    coalesce(v_n,0) = 0,
    'alertas=' || coalesce(v_n::text,'?') || ' sessoes_carimbadas=' || coalesce(v_carimbadas::text,'?') ||
    ' | se alertas > 0, NAO e bug do roteiro: e citacao literal viva de verdade');
end $$;


select ordem, passo, ok, detalhe from resultado_0129 order by ordem;
