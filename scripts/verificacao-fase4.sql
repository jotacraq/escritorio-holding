-- scripts/verificacao-fase4.sql — roteiro ponta a ponta da Fase 4 (agente K)
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP do Supabase `execute_sql`, SQL Editor ou psql -f)
-- contra o banco remoto fcfsnqqaphtamhrpuyoh, como `postgres`. A última
-- instrução devolve a tabela `resultado_verificacao (ordem, passo, ok, detalhe)`.
--
-- GARANTIA "SEM LINHA NOVA": cada passo roda dentro de um sub-bloco PL/pgSQL
-- que termina com `raise exception 'rollback_proposital'` — TODA escrita do
-- passo (fixture, RPC, contadores de rate limit, timeline, mensagens) é
-- desfeita pelo Postgres; só as variáveis do bloco sobrevivem e são gravadas
-- na tabela TEMPORÁRIA de resultado (`on commit drop`). Nenhum `begin/commit`
-- explícito: o protocolo simples roda o arquivo inteiro como uma transação e
-- o `select` final é a última instrução (é a que o MCP devolve).
--
-- EFEITO COLATERAL CONHECIDO (passo d.2): `reivindicar_mensagens_pendentes`
-- usa `for update skip locked`; se o cron de produção rodar no MESMO instante,
-- ele pula uma mensagem nessa passagem e a pega na seguinte (5 min). O lock
-- é desfeito pelo rollback do sub-bloco; `p_limite = 1` limita a 1 linha.
--
-- DEPENDÊNCIAS: 0050–0059 aplicadas. O passo (g) detecta a 0060 pela coluna
-- `rubricas_faltantes` e reporta `ok=false` com "0060 não aplicada" se faltar.
-- Nunca usa `pg_get_viewdef`. Idempotente: pode rodar quantas vezes quiser.
-- ---------------------------------------------------------------------------

drop table if exists resultado_verificacao;
create temp table resultado_verificacao (
  ordem   serial primary key,
  passo   text not null,
  ok      boolean not null,
  detalhe text
) on commit drop;

create or replace function pg_temp.k_reg(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_verificacao (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;

-- Fixture: pessoa + jornada (origem_dado='exemplo') + pagamento aprovado de
-- Sessão de Viabilidade (nivel_pago = 1 pelo trigger da 0011). Criada DENTRO
-- do sub-bloco de cada passo → desfeita com ele.
create or replace function pg_temp.k_fixture()
returns table (pessoa_id uuid, jornada_id uuid, produto_sv_id uuid)
language plpgsql as $$
declare v_pessoa uuid; v_jornada uuid; v_produto uuid;
begin
  insert into pessoas (nome, email, telefone, cidade, uf, origem_dado)
  values ('K · verificação Fase 4 (exemplo)', 'k.verificacao.fase4@example.com', '+5500000000000', 'Belo Horizonte', 'MG', 'exemplo')
  returning id into v_pessoa;

  insert into jornadas (pessoa_id, origem, etapa, origem_dado)
  values (v_pessoa, 'outro', 'sessao_contratada', 'exemplo')
  returning id into v_jornada;

  select id into v_produto from produtos where tipo = 'sessao_viabilidade' order by ativo desc, criado_em limit 1;
  if v_produto is null then
    insert into produtos (tipo, nome, ativo) values ('sessao_viabilidade', 'K · Sessão de Viabilidade (verificação)', false)
    returning id into v_produto;
  end if;

  insert into pagamentos (jornada_id, pessoa_id, produto_id, origem, transacao_externa_id, status, valor, pago_em, bruto)
  values (v_jornada, v_pessoa, v_produto, 'verificacao_k', 'K-' || gen_random_uuid()::text, 'aprovado', 1, now(), '{"verificacao":"k"}'::jsonb);

  pessoa_id := v_pessoa; jornada_id := v_jornada; produto_sv_id := v_produto;
  return next;
end $$;

-- ===========================================================================
-- (0) sanidade: views com security_invoker e RPCs da Fase 4 presentes
-- ===========================================================================
do $$
declare v_falta text; v_views text;
begin
  select string_agg(relname || '=' || coalesce(array_to_string(reloptions, ','), 'SEM_OPCAO'), ' · ' order by relname)
    into v_views
    from pg_class
   where relname in ('vw_sessoes_do_dia', 'vw_jornada_kanban', 'vw_pendencias_sistema', 'vw_cenarios_totais');
  select string_agg(f, ', ') into v_falta
    from unnest(array['confirmar_presenca_publico', 'emitir_link_confirmacao_sistema', 'registrar_horario_ligacao_ia',
                      'emitir_link_agendamento_sistema', 'reivindicar_ligacoes_ia', 'registrar_link_sala',
                      'registrar_diagnostico_sv', 'registrar_pdf_material', 'resolver_pdf_material_publico',
                      'parametro_vigente', 'ativar_parametro_metodo', 'marcar_onboarding_visto']) f
   where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname = f);
  perform pg_temp.k_reg('0.views security_invoker',
    (select count(*) = 4 from pg_class where relname in ('vw_sessoes_do_dia','vw_jornada_kanban','vw_pendencias_sistema','vw_cenarios_totais')
        and 'security_invoker=true' = any (reloptions)),
    v_views);
  perform pg_temp.k_reg('0.rpcs da fase 4 existem', v_falta is null, coalesce('faltam: ' || v_falta, 'todas presentes'));
end $$;

-- ===========================================================================
-- (a) confirmar_presenca_publico idempotente + revogação do link ao remarcar
-- ===========================================================================
do $$
declare
  f record; v_sessao uuid; v_ag agendamentos%rowtype; v_ag2 agendamentos%rowtype;
  v_link links_publicos; v_link2 links_publicos; r1 jsonb; r2 jsonb;
  v_ok boolean := false; v_det text; v_d7 text; v_estado2 text;
begin
  begin
    select * into f from pg_temp.k_fixture();
    insert into sessoes_viabilidade (jornada_id) values (f.jornada_id) returning id into v_sessao;
    insert into agendamentos (sessao_id, inicio_em, fim_em, status, origem)
    values (v_sessao, date_trunc('hour', now()) + interval '10 days', date_trunc('hour', now()) + interval '10 days 1 hour', 'agendado', 'equipe')
    returning * into v_ag;

    v_link := public.emitir_link_confirmacao_sistema(v_ag.id, 'k-verif-conf-' || gen_random_uuid()::text, 'kverif');
    r1 := public.confirmar_presenca_publico(v_link.token_hash, null, 'verificacao-k');
    r2 := public.confirmar_presenca_publico(v_link.token_hash, null, 'verificacao-k');
    select * into v_ag from agendamentos where id = v_ag.id;
    select * into v_link from links_publicos where id = v_link.id;
    select coalesce(string_agg(m.status::text, ','), 'sem_d7') into v_d7
      from mensagens_agendadas m join mensagens_templates t on t.id = m.template_id
     where m.agendamento_id = v_ag.id and t.chave = 'confirmacao_d7';

    -- revogação: agendamento 2 com link ativo; remarcar mata o link
    insert into agendamentos (sessao_id, inicio_em, fim_em, status, origem)
    values (v_sessao, date_trunc('hour', now()) + interval '11 days', date_trunc('hour', now()) + interval '11 days 1 hour', 'agendado', 'equipe')
    returning * into v_ag2;
    v_link2 := public.emitir_link_confirmacao_sistema(v_ag2.id, 'k-verif-conf2-' || gen_random_uuid()::text, 'kverif');
    update agendamentos set status = 'remarcado' where id = v_ag2.id;
    select estado::text into v_estado2 from links_publicos where id = v_link2.id;

    v_ok := (r1 ->> 'ok')::boolean and (r2 ->> 'ok')::boolean
        and (r1 ->> 'confirmada_em') = (r2 ->> 'confirmada_em')
        and v_ag.presenca_confirmada_via = 'link' and v_ag.presenca_confirmada_em is not null
        and v_link.estado = 'usado' and v_link.usos = 1
        and not (r1 ? 'agendamento_id') and not (r1 ? 'jornada_id')
        and v_estado2 = 'revogado';
    v_det := format('r1=%s · r2 mesma confirmada_em=%s · via=%s · link usos=%s estado=%s · D-7 após confirmar=%s · link do remarcado=%s',
                    r1 ->> 'ok', (r1 ->> 'confirmada_em') = (r2 ->> 'confirmada_em'), v_ag.presenca_confirmada_via,
                    v_link.usos, v_link.estado, v_d7, v_estado2);
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then v_ok := false; v_det := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.k_reg('a.confirmar_presenca_publico idempotente + link revogado ao remarcar', v_ok, v_det);
end $$;

-- ===========================================================================
-- (b) app.confirmar_horario_da_sugestao recusa fora dos ofertados e consome o link
-- ===========================================================================
do $$
declare
  f record; v_link links_publicos; t1 timestamptz; t2 timestamptz;
  r_fora jsonb; r_ok jsonb; r_remarca jsonb; r_teto jsonb;
  v_usos int; v_estado text; v_etapa text; v_ag agendamentos%rowtype;
  v_ok boolean := false; v_det text;
begin
  begin
    select * into f from pg_temp.k_fixture();
    v_link := public.emitir_link_agendamento_sistema(f.jornada_id, 'k-verif-ag-' || gen_random_uuid()::text, 'kverif');
    t1 := date_trunc('hour', now()) + interval '3 days';
    t2 := date_trunc('hour', now()) + interval '4 days';
    insert into agendamentos_sugestoes (link_id, inicio_em, fim_em, posicao)
    values (v_link.id, t1, t1 + interval '1 hour', 1), (v_link.id, t2, t2 + interval '1 hour', 2);

    r_fora := app.confirmar_horario_da_sugestao(v_link, t1 + interval '30 minutes', 'cliente');
    r_ok   := app.confirmar_horario_da_sugestao(v_link, t1, 'cliente');
    select usos, estado::text into v_usos, v_estado from links_publicos where id = v_link.id;
    select etapa::text into v_etapa from jornadas where id = f.jornada_id;
    select * into v_ag from agendamentos where id = (r_ok ->> 'agendamento_id')::uuid;

    -- wrapper público: remarcação (usos 1 → 2) e depois teto
    r_remarca := public.escolher_horario_publico(v_link.token_hash, t2, null, 'verificacao-k');
    r_teto    := public.escolher_horario_publico(v_link.token_hash, t1, null, 'verificacao-k');
    select usos into v_usos from links_publicos where id = v_link.id;

    v_ok := (r_fora ->> 'erro') = 'horario_indisponivel'
        and (r_ok ->> 'ok')::boolean and v_estado = 'usado'
        and v_ag.status = 'confirmado' and v_ag.origem = 'cliente'
        and v_etapa = 'sessao_agendada'
        and (r_remarca ->> 'ok')::boolean and v_usos = 2
        and (r_teto ->> 'erro') = 'limite_remarcacoes';
    v_det := format('fora=%s · ok=%s (status=%s origem=%s) · link estado=%s · etapa=%s · remarcação=%s · usos final=%s · 3ª tentativa=%s',
                    r_fora ->> 'erro', r_ok ->> 'ok', v_ag.status, v_ag.origem, v_estado, v_etapa,
                    coalesce(r_remarca ->> 'ok', r_remarca ->> 'erro'), v_usos, r_teto ->> 'erro');
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then v_ok := false; v_det := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.k_reg('b.confirmar_horario_da_sugestao: recusa fora dos ofertados, consome link, teto de remarcação', v_ok, v_det);
end $$;

-- ===========================================================================
-- (c) registrar_horario_ligacao_ia → agendamento origem 'ia'
-- ===========================================================================
do $$
declare
  f record; v_link links_publicos; t1 timestamptz; t2 timestamptz; v_lig uuid;
  r_fora jsonb; r_ok jsonb; r_depois jsonb; v_ag agendamentos%rowtype; v_l ligacoes_ia%rowtype;
  v_ok boolean := false; v_det text;
begin
  begin
    select * into f from pg_temp.k_fixture();
    v_link := public.emitir_link_agendamento_sistema(f.jornada_id, 'k-verif-ia-' || gen_random_uuid()::text, 'kverif');
    t1 := date_trunc('hour', now()) + interval '5 days';
    t2 := date_trunc('hour', now()) + interval '6 days';
    insert into agendamentos_sugestoes (link_id, inicio_em, fim_em, posicao)
    values (v_link.id, t1, t1 + interval '1 hour', 1), (v_link.id, t2, t2 + interval '1 hour', 2);
    insert into ligacoes_ia (jornada_id, link_id, provedor, status, telefone, origem)
    values (f.jornada_id, v_link.id, 'manual', 'em_ligacao', '+5500000000000', 'equipe')
    returning id into v_lig;

    r_fora   := public.registrar_horario_ligacao_ia(v_lig, t2 + interval '5 minutes');
    r_ok     := public.registrar_horario_ligacao_ia(v_lig, t1);
    r_depois := public.registrar_horario_ligacao_ia(v_lig, t2);   -- já concluída: terminal
    select * into v_ag from agendamentos where id = (r_ok ->> 'agendamento_id')::uuid;
    select * into v_l from ligacoes_ia where id = v_lig;

    v_ok := (r_fora ->> 'erro') = 'horario_indisponivel'
        and (r_ok ->> 'ok')::boolean and v_ag.origem = 'ia' and v_ag.status = 'confirmado'
        and v_l.status = 'concluida' and v_l.resultado = 'agendou' and v_l.agendamento_id = v_ag.id
        and v_l.horario_escolhido = t1
        and (r_depois ->> 'erro') = 'ligacao_encerrada';
    v_det := format('fora=%s · ok=%s · agendamento origem=%s status=%s · ligação status=%s resultado=%s · após terminal=%s',
                    r_fora ->> 'erro', r_ok ->> 'ok', v_ag.origem, v_ag.status, v_l.status, v_l.resultado, r_depois ->> 'erro');
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then v_ok := false; v_det := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.k_reg('c.registrar_horario_ligacao_ia → agendamento origem ia', v_ok, v_det);
end $$;

-- ===========================================================================
-- (d) reivindicar_mensagens_pendentes: sem sobrecarga + hold de {{link_sala}}
-- ===========================================================================
do $$
declare
  v_n int; v_assin text;
  f record; v_sessao uuid; v_ag agendamentos%rowtype; v_msg uuid; v_corpo text;
  n_hold int; n_livre int; v_corpo_reivindicado text;
  v_ok boolean := false; v_det text;
begin
  select count(*), string_agg(pg_get_function_identity_arguments(p.oid), ' | ')
    into v_n, v_assin
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reivindicar_mensagens_pendentes';
  perform pg_temp.k_reg('d.1 reivindicar_mensagens_pendentes sem sobrecarga',
                        v_n = 1 and v_assin like '%canal_mensagem[]%',
                        format('pg_proc=%s · assinatura(s): %s', v_n, v_assin));

  begin
    select * into f from pg_temp.k_fixture();
    insert into sessoes_viabilidade (jornada_id) values (f.jornada_id) returning id into v_sessao;
    insert into agendamentos (sessao_id, inicio_em, fim_em, status, origem)
    values (v_sessao, date_trunc('hour', now()) + interval '10 days', date_trunc('hour', now()) + interval '10 days 1 hour', 'agendado', 'equipe')
    returning * into v_ag;

    select m.id, m.corpo_renderizado into v_msg, v_corpo
      from mensagens_agendadas m join mensagens_templates t on t.id = m.template_id
     where m.agendamento_id = v_ag.id and t.chave = 'dia_da_sessao' and m.canal = 'email';
    if v_msg is null then
      raise exception 'dia_da_sessao não enfileirada (template email ativo? pessoa com e-mail?)';
    end if;
    if v_corpo not like '%{{link_sala}}%' then
      raise exception 'placeholder {{link_sala}} já substituído no enfileiramento (bug 0013:75 voltou)';
    end if;

    -- torna a mensagem "vencida" e a primeira da fila; p_limite=1 → só ela (ou nenhuma)
    update mensagens_agendadas set agendada_para = timestamptz '2000-01-01' where id = v_msg;
    select count(*) into n_hold from public.reivindicar_mensagens_pendentes(1, array['email']::canal_mensagem[]) r where r.id = v_msg;

    update sessoes_viabilidade set link_sala = 'https://meet.example/k-verificacao' where id = v_sessao;
    select count(*), max(r.corpo_renderizado) into n_livre, v_corpo_reivindicado
      from public.reivindicar_mensagens_pendentes(1, array['email']::canal_mensagem[]) r where r.id = v_msg;

    v_ok := n_hold = 0 and n_livre = 1 and v_corpo_reivindicado like '%{{link_sala}}%';
    v_det := format('sem sala → reivindicada=%s (esperado 0) · com sala → reivindicada=%s (esperado 1) · placeholder preservado p/ resolução no envio=%s',
                    n_hold, n_livre, v_corpo_reivindicado like '%{{link_sala}}%');
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then v_ok := false; v_det := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.k_reg('d.2 hold de {{link_sala}} até a sessão ter link', v_ok, v_det);
end $$;

-- ===========================================================================
-- (e) tarefa enviar_link_croqui criada por trigger e idempotente
-- ===========================================================================
do $$
declare
  f record; v_sessao uuid; n1 int; n2 int; n3 int; v_produto uuid; v_tarefa tarefas%rowtype;
  v_ok boolean := false; v_det text;
begin
  begin
    select * into f from pg_temp.k_fixture();
    insert into sessoes_viabilidade (jornada_id) values (f.jornada_id) returning id into v_sessao;

    update sessoes_viabilidade set realizada_em = now(), resultado = 'fechou' where id = v_sessao;
    select count(*) into n1 from tarefas where jornada_id = f.jornada_id and tipo = 'enviar_link_croqui' and concluida_em is null;
    select * into v_tarefa from tarefas where jornada_id = f.jornada_id and tipo = 'enviar_link_croqui' limit 1;

    select id into v_produto from produtos where tipo = 'croqui_estrutural' limit 1;
    insert into ofertas (jornada_id, produto_id, valor_padrao, valor_ofertado, condicao, aceita)
    values (f.jornada_id, coalesce(v_produto, f.produto_sv_id), 7200, 7200, 'padrao', true);
    select count(*) into n2 from tarefas where jornada_id = f.jornada_id and tipo = 'enviar_link_croqui' and concluida_em is null;

    update sessoes_viabilidade set motivo_resultado = 'reexecução do trigger' where id = v_sessao;
    select count(*) into n3 from tarefas where jornada_id = f.jornada_id and tipo = 'enviar_link_croqui' and concluida_em is null;

    v_ok := n1 = 1 and n2 = 1 and n3 = 1 and v_tarefa.origem = 'sistema' and v_tarefa.vence_em is not null;
    v_det := format('após sessão fechou=%s · após oferta aceita=%s · após novo update=%s · origem=%s · vence_em=%s',
                    n1, n2, n3, v_tarefa.origem, v_tarefa.vence_em);
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then v_ok := false; v_det := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.k_reg('e.tarefa enviar_link_croqui por trigger, idempotente', v_ok, v_det);
end $$;

-- ===========================================================================
-- (f) ck_pdf_exige_aprovacao recusa pdf_caminho em rascunho
-- ===========================================================================
do $$
declare
  f record; v_modelo uuid; v_ok boolean := false; v_det text; v_id uuid;
begin
  begin
    select * into f from pg_temp.k_fixture();
    select id into v_modelo from materiais_modelos order by ativo desc, versao desc limit 1;
    begin
      insert into materiais_gerados (jornada_id, modelo_id, versao, fonte_dor, conteudo,
                                     pdf_caminho, pdf_bytes, pdf_sha256, pdf_gerado_em)
      values (f.jornada_id, v_modelo, 1, 'nenhuma', '{"titulo":"k","blocos":[]}'::jsonb,
              'materiais/k/verificacao.pdf', 1, 'k', now())
      returning id into v_id;
      v_ok := false; v_det := 'INSERT de rascunho com pdf_caminho passou — constraint ausente';
    exception when check_violation then
      v_ok := sqlerrm like '%ck_pdf_exige_aprovacao%';
      v_det := sqlstate || ' ' || sqlerrm;
    end;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then v_ok := false; v_det := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.k_reg('f.ck_pdf_exige_aprovacao: rascunho não tem pdf_caminho', v_ok, v_det);
end $$;

-- ===========================================================================
-- (g) cenário: calculado sem parametro_id → 23514; total null com rubrica
--     padrão não gravada (0060) e com ausente
-- ===========================================================================
do $$
declare
  f record; v_c uuid; tem_0060 boolean; v_padrao int;
  e_calc text; t1 record; t2 record; t3 record;
  v_ok boolean := false; v_det text;
begin
  select exists (select 1 from information_schema.columns where table_name = 'vw_cenarios_totais' and column_name = 'rubricas_faltantes') into tem_0060;
  select jsonb_array_length(valor) into v_padrao from configuracoes where chave = 'cenario.rubricas';
  begin
    select * into f from pg_temp.k_fixture();
    insert into cenarios_patrimoniais (jornada_id, cenario) values (f.jornada_id, 'inventario') returning id into v_c;

    begin
      insert into cenario_rubricas (cenario_id, rubrica, procedencia, base_calculo) values (v_c, 'itcmd', 'calculado', 1000000);
      e_calc := 'PASSOU (erro: calculado sem parâmetro aceito)';
    exception when check_violation then
      e_calc := sqlstate || ' ' || split_part(sqlerrm, ':', 1);
    end;

    insert into cenario_rubricas (cenario_id, rubrica, procedencia, valor) values (v_c, 'custas_cartorio', 'digitado', 15000);
    if tem_0060 then
      execute 'select total, rubricas_ausentes, rubricas_faltantes::text as faltantes from vw_cenarios_totais where cenario_id = $1' into t1 using v_c;
      -- completa as demais rubricas padrão com 1
      insert into cenario_rubricas (cenario_id, rubrica, procedencia, valor)
      select v_c, r, 'digitado', 1
        from jsonb_array_elements_text((select valor from configuracoes where chave = 'cenario.rubricas')) r
       where r <> 'custas_cartorio';
      execute 'select total, rubricas_ausentes, rubricas_faltantes::text as faltantes from vw_cenarios_totais where cenario_id = $1' into t2 using v_c;
      update cenario_rubricas set procedencia = 'ausente', valor = null where cenario_id = v_c and rubrica = 'itbi';
      execute 'select total, rubricas_ausentes, rubricas_faltantes::text as faltantes from vw_cenarios_totais where cenario_id = $1' into t3 using v_c;

      v_ok := e_calc like '23514%cenario_calculado_exige_parametro%'
          and t1.total is null and t1.rubricas_ausentes = v_padrao - 1 and t1.faltantes not like '%custas_cartorio%'
          and t2.total = 15000 + (v_padrao - 1) and t2.rubricas_ausentes = 0
          and t3.total is null and t3.faltantes = '{itbi}';
      v_det := format('calculado sem parâmetro → %s · 1 rubrica gravada: total=%s faltam=%s (%s) · todas: total=%s · itbi ausente: total=%s faltam=%s',
                      e_calc, t1.total, t1.rubricas_ausentes, t1.faltantes, t2.total, t3.total, t3.faltantes);
    else
      execute 'select total, rubricas_ausentes from vw_cenarios_totais where cenario_id = $1' into t1 using v_c;
      v_ok := false;
      v_det := format('0060 NÃO aplicada (vw_cenarios_totais sem rubricas_faltantes): com 1 rubrica gravada total=%s (a 0057 fecha total parcial — achado H). calculado sem parâmetro → %s',
                      t1.total, e_calc);
    end if;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then v_ok := false; v_det := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.k_reg('g.cenário: 23514 sem parâmetro · total null enquanto falta rubrica padrão/ausente (0060)', v_ok, v_det);
end $$;

-- ===========================================================================
-- (h) diagnóstico: bloco o_que_falta visível → 23514 (CHECK da tabela)
-- ===========================================================================
do $$
declare
  f record; e1 text; n_ok int; v_ok boolean := false; v_det text;
  bloco_ok constant jsonb := '[{"chave":"situacao_familiar","titulo":"Situação familiar","conteudo":"x","pontos":[],"fontes":[],"categoria":"fato_declarado","visivel_ao_cliente":true},
                             {"chave":"o_que_falta","titulo":"O que falta","conteudo":"y","pontos":[],"fontes":[],"categoria":"inferencia","visivel_ao_cliente":false}]'::jsonb;
  bloco_ruim constant jsonb := '[{"chave":"o_que_falta","titulo":"O que falta","conteudo":"y","pontos":[],"fontes":[],"categoria":"inferencia","visivel_ao_cliente":true}]'::jsonb;
begin
  begin
    select * into f from pg_temp.k_fixture();
    begin
      insert into diagnosticos_sv (jornada_id, versao, blocos) values (f.jornada_id, 1, bloco_ruim);
      e1 := 'PASSOU (o_que_falta visível aceito)';
    exception when check_violation then
      e1 := sqlstate || ' ' || sqlerrm;
    end;
    insert into diagnosticos_sv (jornada_id, versao, blocos) values (f.jornada_id, 2, bloco_ok);
    select count(*) into n_ok from diagnosticos_sv where jornada_id = f.jornada_id and atual;
    v_ok := e1 like '23514%' and n_ok = 1;
    v_det := format('o_que_falta visível → %s · blocos válidos gravam (atual=%s)', e1, n_ok);
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then v_ok := false; v_det := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.k_reg('h.diagnóstico: o_que_falta nunca visível ao cliente (B31)', v_ok, v_det);
end $$;

-- ===========================================================================
-- (i) respostas_seminario: on conflict do nothing nunca sobrescreve
-- ===========================================================================
do $$
declare
  f record; v_edicao uuid; n int; v_resp text; v_ok boolean := false; v_det text;
begin
  begin
    select * into f from pg_temp.k_fixture();
    select id into v_edicao from edicoes_seminario order by ativa desc, inicio_em desc limit 1;
    if v_edicao is null then
      insert into edicoes_seminario (codigo, nome, inicio_em, fim_em, ativa, origem_dado)
      values ('K-VERIF', 'K · verificação', current_date, current_date, false, 'exemplo') returning id into v_edicao;
    end if;
    insert into respostas_seminario (pessoa_id, edicao_id, pergunta, resposta, origem_dado)
    values (f.pessoa_id, v_edicao, 'Qual a sua maior preocupação?', 'primeira resposta', 'exemplo');
    insert into respostas_seminario (pessoa_id, edicao_id, pergunta, resposta, origem_dado)
    values (f.pessoa_id, v_edicao, 'Qual a sua maior preocupação?', 'segunda (não deve gravar)', 'exemplo')
    on conflict (pessoa_id, edicao_id, pergunta) do nothing;
    select count(*), max(resposta) into n, v_resp from respostas_seminario where pessoa_id = f.pessoa_id;
    v_ok := n = 1 and v_resp = 'primeira resposta';
    v_det := format('linhas=%s · resposta preservada=%s', n, v_resp);
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then v_ok := false; v_det := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.k_reg('i.respostas_seminario: on conflict do nothing', v_ok, v_det);
end $$;

-- ===========================================================================
-- (j) relacionamento não lê cenarios_patrimoniais (RLS ve_patrimonio)
--     — JWT simulado com set_config('request.jwt.claims') + set local role,
--     como os roteiros 0051 §7 / 0056 §7. Tudo dentro do sub-bloco: o
--     `set local` é desfeito junto com o rollback.
-- ===========================================================================
do $$
declare
  f record; v_c uuid; v_uid uuid; v_perfil_nome text; v_papel text;
  n_cen int; n_rub int; n_view int; e_ins text; n_adv int;
  v_ok boolean := false; v_det text;
begin
  begin
    select * into f from pg_temp.k_fixture();
    insert into cenarios_patrimoniais (jornada_id, cenario) values (f.jornada_id, 'inventario') returning id into v_c;
    insert into cenario_rubricas (cenario_id, rubrica, procedencia, valor) values (v_c, 'custas_cartorio', 'digitado', 1);

    select auth_user_id, nome into v_uid, v_perfil_nome
      from perfis_equipe where papel = 'relacionamento' and ativo and auth_user_id is not null limit 1;
    if v_uid is null then
      -- sem relacionamento com login: rebaixa um perfil qualquer SÓ neste sub-bloco (desfeito)
      select auth_user_id, nome into v_uid, v_perfil_nome
        from perfis_equipe where ativo and auth_user_id is not null limit 1;
      update perfis_equipe set papel = 'relacionamento' where auth_user_id = v_uid;
      v_perfil_nome := v_perfil_nome || ' (rebaixado só no teste)';
    end if;
    if v_uid is null then
      raise exception 'nenhum perfil com auth_user_id — impossível simular JWT';
    end if;

    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_uid::text, true);
    execute 'set local role authenticated';
    select app.papel()::text into v_papel;
    select count(*) into n_cen  from cenarios_patrimoniais where jornada_id = f.jornada_id;
    select count(*) into n_rub  from cenario_rubricas where cenario_id = v_c;
    select count(*) into n_view from vw_cenarios_totais where jornada_id = f.jornada_id;
    begin
      insert into cenarios_patrimoniais (jornada_id, cenario) values (f.jornada_id, 'doacao');
      e_ins := 'PASSOU (relacionamento inseriu cenário)';
    exception when others then
      e_ins := sqlstate;
    end;
    execute 'reset role';

    v_ok := v_papel = 'relacionamento' and n_cen = 0 and n_rub = 0 and n_view = 0 and e_ins = '42501';
    v_det := format('perfil=%s papel=%s · cenarios=%s rubricas=%s view=%s (esperado 0) · insert → %s (esperado 42501)',
                    v_perfil_nome, v_papel, n_cen, n_rub, n_view, e_ins);
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then v_ok := false; v_det := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.k_reg('j.relacionamento não lê nem grava cenarios_patrimoniais', v_ok, v_det);
end $$;

-- ===========================================================================
-- (k) explain (analyze, buffers) das views: sem Seq Scan em tabela grande
--     (> 1 000 linhas estimadas). Tabelas pequenas (perfis_equipe, edicoes,
--     configuracoes) podem ser varridas — é o plano certo para elas.
-- ===========================================================================
do $$
declare
  v_plan json; v_seq text; v_ms numeric; v_ok boolean; q text; nome text;
begin
  for nome, q in
    select * from (values
      ('k.1 vw_jornada_kanban where desfecho=''aberta''', 'select * from vw_jornada_kanban where desfecho = ''aberta'''),
      ('k.2 vw_sessoes_do_dia', 'select * from vw_sessoes_do_dia'),
      ('k.3 vw_cenarios_totais por jornada', 'select * from vw_cenarios_totais where jornada_id = (select id from jornadas order by criado_em desc limit 1)')
    ) t(nome, q)
  loop
    begin
      execute 'explain (analyze, buffers, format json) ' || q into v_plan;
      v_ms := (v_plan::jsonb -> 0 ->> 'Execution Time')::numeric;
      select string_agg(format('%s(~%s linhas)', n ->> 'Relation Name', c.reltuples::bigint), ', ')
        into v_seq
        from jsonb_path_query(v_plan::jsonb, '$.** ? (@."Node Type" == "Seq Scan")') n
        join pg_class c on c.relname = n ->> 'Relation Name'
        join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = 'public'
       where c.reltuples > 1000;
      v_ok := v_seq is null;
      perform pg_temp.k_reg(nome, v_ok,
        format('%s ms · Seq Scan em tabela grande: %s', round(v_ms, 2), coalesce(v_seq, 'nenhum')));
    exception when others then
      perform pg_temp.k_reg(nome, false, sqlstate || ' ' || sqlerrm);
    end;
  end loop;
end $$;

-- ===========================================================================
-- (l) nada ficou para trás: fixtures deste script nunca existem fora dos sub-blocos
-- ===========================================================================
do $$
declare n_p int; n_j int; n_pg int;
begin
  select count(*) into n_p  from pessoas where email = 'k.verificacao.fase4@example.com';
  select count(*) into n_j  from jornadas j join pessoas p on p.id = j.pessoa_id where p.email = 'k.verificacao.fase4@example.com';
  select count(*) into n_pg from pagamentos where origem = 'verificacao_k';
  perform pg_temp.k_reg('l.sem linha nova (pessoa/jornada/pagamento de verificação)', n_p = 0 and n_j = 0 and n_pg = 0,
                        format('pessoas=%s jornadas=%s pagamentos=%s (esperado 0/0/0)', n_p, n_j, n_pg));
end $$;

drop function if exists pg_temp.k_fixture();
drop function if exists pg_temp.k_reg(text, boolean, text);

select ordem, passo, ok, detalhe from resultado_verificacao order by ordem;
