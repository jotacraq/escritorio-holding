-- scripts/verificacao-0064-0067.sql — roteiro das migrations do M2 da Fase 5
-- (0064 vw_automacoes_jornada · 0065 radar de documentos · 0067 execução).
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- postgres, com 0064, 0065 e 0067 APLICADAS. Cada passo é um sub-bloco que
-- termina em `raise exception 'rollback_proposital'` — NENHUMA escrita
-- sobrevive. Papéis simulados com set_config('request.jwt.claims') + set local
-- role authenticated (desfeito no rollback). A última instrução devolve
-- resultado_m2 (ordem, passo, ok, detalhe). ok = true significa que o banco
-- BLOQUEOU o que devia e LIBEROU o que devia. Idempotente.
--
-- Molde: scripts/verificacao-0061.sql.
-- ---------------------------------------------------------------------------

drop table if exists resultado_m2;
create temp table resultado_m2 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.m2_reg(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_m2 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;

-- Fixture: pessoa + jornada + sessão + agendamento + pagamento aprovado.
create or replace function pg_temp.m2_fixture()
returns table (pessoa_id uuid, jornada_id uuid, sessao_id uuid, agendamento_id uuid, perfil_id uuid)
language plpgsql as $$
declare v_pessoa uuid; v_jornada uuid; v_produto uuid; v_sessao uuid; v_ag uuid; v_perfil uuid; v_tag text := left(gen_random_uuid()::text, 8);
begin
  insert into pessoas (nome, email, telefone, cidade, uf, origem_dado)
  values ('Verificação M2 ' || v_tag, 'verifm2.' || v_tag || '@example.com', '+55000000' || lpad((random()*99999)::int::text, 5, '0'), 'Belo Horizonte', 'MG', 'exemplo')
  returning id into v_pessoa;
  insert into jornadas (pessoa_id, origem, etapa, origem_dado)
  values (v_pessoa, 'outro', 'sessao_agendada', 'exemplo') returning id into v_jornada;
  select id into v_produto from produtos where tipo = 'sessao_viabilidade' order by ativo desc, criado_em limit 1;
  if v_produto is null then
    insert into produtos (tipo, nome, ativo) values ('sessao_viabilidade', 'Verif M2 SV (exemplo)', false) returning id into v_produto;
  end if;
  insert into pagamentos (jornada_id, pessoa_id, produto_id, origem, transacao_externa_id, status, valor, pago_em, bruto)
  values (v_jornada, v_pessoa, v_produto, 'verificacao', 'VM2-' || gen_random_uuid()::text, 'aprovado', 1997, now(), '{"verificacao":true}'::jsonb);
  select id into v_perfil from perfis_equipe where papel in ('advogada','admin') and ativo order by (papel='advogada') desc limit 1;
  insert into sessoes_viabilidade (jornada_id, advogada_id) values (v_jornada, v_perfil) returning id into v_sessao;
  insert into agendamentos (sessao_id, inicio_em, fim_em, status, origem, advogada_id)
  values (v_sessao, now() + interval '10 days', now() + interval '10 days 1 hour', 'agendado', 'equipe', v_perfil)
  returning id into v_ag;
  return query select v_pessoa, v_jornada, v_sessao, v_ag, v_perfil;
end $$;

create or replace function pg_temp.m2_como(p_papel text) returns uuid
language plpgsql as $$
declare v_uid uuid;
begin
  select auth_user_id into v_uid from perfis_equipe
   where papel = p_papel::papel_equipe and ativo and auth_user_id is not null limit 1;
  if v_uid is null then
    select auth_user_id into v_uid from perfis_equipe where ativo and auth_user_id is not null limit 1;
    update perfis_equipe set papel = p_papel::papel_equipe where auth_user_id = v_uid;   -- só neste sub-bloco (rollback)
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  execute 'set local role authenticated';
  return v_uid;
end $$;

-- 1. 0064 — a view existe com security_invoker, devolve as 4 fontes e NÃO vaza valor.
do $$
declare f record; v_opts text; n_tipos int; n_valor int; ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.m2_fixture();
    insert into ligacoes_ia (jornada_id, provedor, status, telefone, resultado, encerrada_em)
    values (f.jornada_id, 'manual', 'concluida', '+5500000000000', 'agendou', now());
    select array_to_string(reloptions, ',') into v_opts from pg_class where relname = 'vw_automacoes_jornada';
    select count(distinct tipo) into n_tipos from vw_automacoes_jornada where jornada_id = f.jornada_id;
    select count(*) into n_valor from vw_automacoes_jornada
     where jornada_id = f.jornada_id and (resultado ~ '[0-9]{3}' or resultado ilike '%1997%');
    ok := coalesce(v_opts, '') like '%security_invoker=true%' and n_tipos >= 3 and n_valor = 0;
    det := format('reloptions=%s · tipos distintos=%s (esp. ≥3: mensagem/ligacao_ia/confirmacao/marco) · linhas com número no resultado=%s (esp. 0)', v_opts, n_tipos, n_valor);
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.m2_reg('1 0064 view com security_invoker, 4 fontes, sem valor de pagamento', ok, det);
end $$;

-- 2. 0064 — mensagem/ligação canceladas ficam de fora; ordem começa em 1.
do $$
declare f record; n_total int; n_ordem1 int; ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.m2_fixture();
    insert into ligacoes_ia (jornada_id, provedor, status, telefone) values (f.jornada_id, 'manual', 'cancelada', '+5500000000000');
    select count(*) into n_total from vw_automacoes_jornada where jornada_id = f.jornada_id and tipo = 'ligacao_ia';
    select count(*) into n_ordem1 from vw_automacoes_jornada where jornada_id = f.jornada_id and ordem = 1;
    ok := n_total = 0 and n_ordem1 = 1;
    det := format('ligações canceladas visíveis=%s (esp. 0) · linhas com ordem=1: %s (esp. 1)', n_total, n_ordem1);
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.m2_reg('2 0064 cancelada não aparece e a ordem é densa', ok, det);
end $$;

-- 3. 0065 — o CHECK novo é mais largo e nenhuma linha existente ficou fora.
do $$
declare n_fora int; v_def text; n_col int; ok boolean := false; det text;
begin
  begin
    select count(*) into n_fora from documentos
     where tipo not in ('imposto_renda','contrato_social','matricula_imovel','certidao_casamento',
                        'certidao_nascimento','crlv','extrato_investimento','balanco','comprovante_residencia','outro');
    select pg_get_constraintdef(oid) into v_def from pg_constraint
     where conrelid = 'documentos'::regclass and conname = 'ck_documentos_tipo';
    select count(*) into n_col from information_schema.columns
     where table_name = 'documentos' and column_name = 'item_ref';
    ok := n_fora = 0 and v_def is not null and n_col = 1;
    det := format('documentos fora do CHECK novo=%s (esp. 0) · item_ref existe=%s · %s', n_fora, n_col, left(coalesce(v_def, 'CHECK AUSENTE'), 200));
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.m2_reg('3 0065 documentos.tipo alargado sem perder linha', ok, det);
end $$;

-- 4. 0065 — RLS, carimbo de servidor, imutabilidade e ausência de DELETE.
do $$
declare f record; v_perfil uuid; e_rel text; e_dup text; e_chave text; e_conf_nulo text; e_del text; e_msg text;
        v_pedido uuid; v_pedido_em timestamptz; v_por uuid; v_conf_por uuid; n_tl int; ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.m2_fixture();
    perform pg_temp.m2_como('relacionamento');
    begin
      insert into documentos_pedidos (jornada_id, chave, tipo)
      values (f.jornada_id, 'coleta:imposto_renda:-', 'imposto_renda');
      e_rel := 'PASSOU';
    exception when others then e_rel := sqlstate; end;
    execute 'reset role';

    perform pg_temp.m2_como('advogada');
    select id into v_perfil from perfis_equipe where auth_user_id = auth.uid();
    insert into documentos_pedidos (jornada_id, chave, tipo, pedido_em, pedido_por)
    values (f.jornada_id, 'coleta:imposto_renda:-', 'imposto_renda', '2000-01-01', null)
    returning id, pedido_em, pedido_por into v_pedido, v_pedido_em, v_por;
    begin
      insert into documentos_pedidos (jornada_id, chave, tipo) values (f.jornada_id, 'coleta:imposto_renda:-', 'imposto_renda');
      e_dup := 'PASSOU';
    exception when others then e_dup := sqlstate; end;
    begin update documentos_pedidos set chave = 'x:y:-' where id = v_pedido; e_chave := 'PASSOU'; exception when others then e_chave := sqlstate; end;
    begin update documentos_pedidos set mensagem_id = gen_random_uuid() where id = v_pedido; e_msg := 'PASSOU'; exception when others then e_msg := sqlstate; end;
    update documentos_pedidos set conferido_em = '2000-01-01' where id = v_pedido;
    select conferido_por into v_conf_por from documentos_pedidos where id = v_pedido;
    begin update documentos_pedidos set conferido_em = null where id = v_pedido; e_conf_nulo := 'PASSOU'; exception when others then e_conf_nulo := sqlstate; end;
    begin delete from documentos_pedidos where id = v_pedido; e_del := 'PASSOU'; exception when others then e_del := sqlstate; end;
    select count(*) into n_tl from eventos_timeline where jornada_id = f.jornada_id and tipo = 'documento_pedido';
    execute 'reset role';

    ok := e_rel = '42501' and e_dup = '23505' and e_chave = '23514' and e_msg = '42501'
      and e_conf_nulo = '23514' and e_del = '42501'
      and v_pedido_em > now() - interval '1 minute' and v_por = v_perfil and v_conf_por = v_perfil and n_tl = 2;
    det := format('relacionamento insert→%s (esp. 42501) · duplicado→%s (23505) · trocar chave→%s (23514) · mensagem_id→%s (42501) · desconferir→%s (23514) · delete→%s (42501) · pedido_em carimbado=%s · pedido_por=perfil? %s · conferido_por=perfil? %s · eventos=%s (esp. 2)',
                 e_rel, e_dup, e_chave, e_msg, e_conf_nulo, e_del, v_pedido_em > now() - interval '1 minute', v_por = v_perfil, v_conf_por = v_perfil, n_tl);
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.m2_reg('4 0065 documentos_pedidos: RLS, carimbo, imutabilidade, sem DELETE', ok, det);
end $$;

-- 5. 0065 — a mensagem do pedido é idempotente por dia e só service_role chama.
do $$
declare f record; n1 int; n2 int; e_auth text; v_chave text; ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.m2_fixture();
    select public.enfileirar_pedido_documentos(f.jornada_id, 'https://exemplo.test/p/d/TOKEN') into n1;
    select public.enfileirar_pedido_documentos(f.jornada_id, 'https://exemplo.test/p/d/TOKEN') into n2;
    select chave_idempotencia into v_chave from mensagens_agendadas
     where jornada_id = f.jornada_id and chave_idempotencia like '%documentos_pedido%' limit 1;
    perform pg_temp.m2_como('advogada');
    begin perform public.enfileirar_pedido_documentos(f.jornada_id, 'https://exemplo.test/p/d/T'); e_auth := 'PASSOU'; exception when others then e_auth := sqlstate; end;
    execute 'reset role';
    ok := n1 >= 1 and n2 = 0 and e_auth = '42501'
      and v_chave like f.jornada_id::text || ':documentos_pedido:' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD') || ':%';
    det := format('1ª chamada=%s (esp. ≥1) · 2ª no mesmo dia=%s (esp. 0) · authenticated→%s (esp. 42501) · chave=%s', n1, n2, e_auth, v_chave);
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.m2_reg('5 0065 enfileirar_pedido_documentos idempotente por dia, só service_role', ok, det);
end $$;

-- 6. 0067 — o seed bate com o cronograma e as dependências são coerentes.
do $$
declare n_marcos int; n_contr int; n_exec int; n_par int; n_entrega int; n_ciclo int; n_frente int; ok boolean := false; det text;
begin
  begin
    select count(*) into n_marcos from execucao_marcos m join execucao_modelos o on o.id = m.modelo_id where o.chave = 'holding_3_celulas';
    select count(*) filter (where fase = 'contratacoes'), count(*) filter (where fase = 'executoria'),
           count(*) filter (where fase = 'paralela'),     count(*) filter (where fase = 'entrega')
      into n_contr, n_exec, n_par, n_entrega
      from execucao_marcos m join execucao_modelos o on o.id = m.modelo_id where o.chave = 'holding_3_celulas';
    select count(*) into n_ciclo from execucao_marcos m where exists (select 1 from unnest(m.depende_de) d where d = m.id);
    select count(*) into n_frente from execucao_marcos m, unnest(m.depende_de) d
      join execucao_marcos p on p.id = d where p.ordem >= m.ordem or p.modelo_id <> m.modelo_id;
    ok := n_marcos = 19 and n_contr = 4 and n_exec = 11 and n_par = 3 and n_entrega = 1 and n_ciclo = 0 and n_frente = 0;
    det := format('marcos=%s (esp. 19 = 15 da cadeia principal + 3 de ITBI + entrega) · contratações=%s executória=%s paralelas=%s entrega=%s · dependência de si=%s · dependência para a frente/outro modelo=%s',
                  n_marcos, n_contr, n_exec, n_par, n_entrega, n_ciclo, n_frente);
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.m2_reg('6 0067 seed do cronograma real e dependências coerentes', ok, det);
end $$;

-- 7. 0067 — instância por jornada: RLS, carimbo, imutabilidade, sem DELETE, timeline.
do $$
declare f record; v_marco uuid; v_perfil uuid; e_rel text; e_dup text; e_volta text; e_del text;
        v_em timestamptz; v_por uuid; n_tl int; n_prog int; ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.m2_fixture();
    select m.id into v_marco from execucao_marcos m join execucao_modelos o on o.id = m.modelo_id
     where o.chave = 'holding_3_celulas' order by m.ordem limit 1;

    perform pg_temp.m2_como('relacionamento');
    begin insert into execucao_jornada_marcos (jornada_id, marco_id) values (f.jornada_id, v_marco); e_rel := 'PASSOU';
    exception when others then e_rel := sqlstate; end;
    execute 'reset role';

    perform pg_temp.m2_como('advogada');
    select id into v_perfil from perfis_equipe where auth_user_id = auth.uid();
    insert into execucao_jornada_marcos (jornada_id, marco_id, concluido_em, concluido_por)
    values (f.jornada_id, v_marco, '2000-01-01', null);
    select concluido_em, concluido_por into v_em, v_por from execucao_jornada_marcos where jornada_id = f.jornada_id and marco_id = v_marco;
    begin insert into execucao_jornada_marcos (jornada_id, marco_id) values (f.jornada_id, v_marco); e_dup := 'PASSOU';
    exception when others then e_dup := sqlstate; end;
    begin update execucao_jornada_marcos set concluido_em = null where jornada_id = f.jornada_id and marco_id = v_marco; e_volta := 'PASSOU';
    exception when others then e_volta := sqlstate; end;
    begin delete from execucao_jornada_marcos where jornada_id = f.jornada_id; e_del := 'PASSOU';
    exception when others then e_del := sqlstate; end;
    select count(*) into n_tl from eventos_timeline where jornada_id = f.jornada_id and tipo = 'execucao';
    select count(*) into n_prog from execucao_jornada_marcos where jornada_id = f.jornada_id and concluido_em is not null;
    execute 'reset role';

    ok := e_rel = '42501' and e_dup = '23505' and e_volta = '23514' and e_del = '42501'
      and v_em > now() - interval '1 minute' and v_por = v_perfil and n_tl = 1 and n_prog = 1;
    det := format('relacionamento insert→%s (42501) · duplicado→%s (23505) · desmarcar→%s (23514) · delete→%s (42501) · concluido_em carimbado=%s · concluido_por=perfil? %s · timeline=%s · feitos=%s',
                  e_rel, e_dup, e_volta, e_del, v_em > now() - interval '1 minute', v_por = v_perfil, n_tl, n_prog);
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.m2_reg('7 0067 execucao_jornada_marcos: RLS, carimbo, imutabilidade, sem DELETE', ok, det);
end $$;

select ordem, passo, ok, detalhe from resultado_m2 order by ordem;
