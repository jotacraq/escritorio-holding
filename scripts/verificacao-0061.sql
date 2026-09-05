-- scripts/verificacao-0061.sql — roteiro da 0061 (hardening do pentest da Fase 4)
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- postgres, com a 0061 APLICADA. Cada passo é um sub-bloco que termina em
-- raise exception 'rollback_proposital' — NENHUMA escrita sobrevive. Papéis
-- simulados com set_config('request.jwt.claims') + set local role authenticated
-- (desfeito no rollback). A última instrução devolve resultado_0061
-- (ordem, passo, ok, detalhe). ok=true = o banco BLOQUEOU o que devia e
-- LIBEROU o que devia. Idempotente.
-- ---------------------------------------------------------------------------

drop table if exists resultado_0061;
create temp table resultado_0061 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r_reg(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0061 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;

-- Fixture: pessoa (uf MG) + jornada aberta (nivel_pago=1) + sessão + agendamento ativo.
-- E-mail único por chamada (a fixture do pentest colidia na 2ª pessoa).
create or replace function pg_temp.r_fixture(p_uf text default 'MG')
returns table (pessoa_id uuid, jornada_id uuid, sessao_id uuid, agendamento_id uuid, advogada_id uuid)
language plpgsql as $$
declare v_pessoa uuid; v_jornada uuid; v_produto uuid; v_sessao uuid; v_ag uuid; v_adv uuid; v_tag text := left(gen_random_uuid()::text, 8);
begin
  insert into pessoas (nome, email, telefone, cidade, uf, origem_dado)
  values ('Verificação 0061 ' || v_tag, 'verif0061.' || v_tag || '@example.com', '+55000000' || lpad((random()*99999)::int::text, 5, '0'), 'Belo Horizonte', p_uf, 'exemplo')
  returning id into v_pessoa;
  insert into jornadas (pessoa_id, origem, etapa, origem_dado)
  values (v_pessoa, 'outro', 'sessao_contratada', 'exemplo') returning id into v_jornada;
  select id into v_produto from produtos where tipo = 'sessao_viabilidade' order by ativo desc, criado_em limit 1;
  if v_produto is null then
    insert into produtos (tipo, nome, ativo) values ('sessao_viabilidade', 'Verif 0061 SV (exemplo)', false) returning id into v_produto;
  end if;
  insert into pagamentos (jornada_id, pessoa_id, produto_id, origem, transacao_externa_id, status, valor, pago_em, bruto)
  values (v_jornada, v_pessoa, v_produto, 'verificacao', 'V0061-' || gen_random_uuid()::text, 'aprovado', 1, now(), '{"verificacao":true}'::jsonb);
  select id into v_adv from perfis_equipe where papel in ('advogada','admin') and ativo order by (papel='advogada') desc limit 1;
  insert into sessoes_viabilidade (jornada_id, advogada_id) values (v_jornada, v_adv) returning id into v_sessao;
  insert into agendamentos (sessao_id, inicio_em, fim_em, status, origem, advogada_id)
  values (v_sessao, now() + interval '10 days', now() + interval '10 days 1 hour', 'agendado', 'equipe', v_adv)
  returning id into v_ag;
  return query select v_pessoa, v_jornada, v_sessao, v_ag, v_adv;
end $$;

-- JWT simulado. p_papel: relacionamento | advogada | admin | intruso. Devolve o auth_user_id usado.
create or replace function pg_temp.r_como(p_papel text) returns uuid
language plpgsql as $$
declare v_uid uuid;
begin
  if p_papel = 'intruso' then
    select u.id into v_uid from auth.users u
     where not exists (select 1 from perfis_equipe pe where pe.auth_user_id = u.id) limit 1;
    v_uid := coalesce(v_uid, gen_random_uuid());
  else
    select auth_user_id into v_uid from perfis_equipe
     where papel = p_papel::papel_equipe and ativo and auth_user_id is not null limit 1;
    if v_uid is null then
      select auth_user_id into v_uid from perfis_equipe where ativo and auth_user_id is not null limit 1;
      update perfis_equipe set papel = p_papel::papel_equipe where auth_user_id = v_uid;   -- só neste sub-bloco (rollback)
    end if;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  execute 'set local role authenticated';
  return v_uid;
end $$;

-- 1. link_sala: javascript:/http:// → 23514; https → ok. Constraint validada?
do $$
declare f record; e_js text; e_http text; e_https text; v_valid boolean; ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.r_fixture();
    select convalidated into v_valid from pg_constraint where conname = 'ck_link_sala_https';
    perform pg_temp.r_como('relacionamento');
    begin update sessoes_viabilidade set link_sala = 'javascript:alert(1)' where id = f.sessao_id; e_js := 'PASSOU'; exception when others then e_js := sqlstate; end;
    begin update sessoes_viabilidade set link_sala = 'http://meet.example/x' where id = f.sessao_id; e_http := 'PASSOU'; exception when others then e_http := sqlstate; end;
    begin update sessoes_viabilidade set link_sala = 'https://meet.example/x' where id = f.sessao_id; e_https := 'PASSOU'; exception when others then e_https := sqlstate; end;
    execute 'reset role';
    ok := e_js = '23514' and e_http = '23514' and e_https = 'PASSOU' and v_valid is not null;
    det := format('javascript:→%s http://→%s (esp. 23514) · https://→%s (esp. PASSOU) · ck_link_sala_https convalidated=%s (false = havia link antigo fora do padrão; validar à mão)', e_js, e_http, e_https, v_valid);
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.r_reg('1 link_sala só https (CHECK no banco)', ok, det);
end $$;

-- 2. n8n/ligacao: tentativa inválida NÃO ocupa o id — a válida substitui (mecanismo que livro-razao.ts executa).
do $$
declare v_id text := 'verif0061:' || gen_random_uuid()::text; n int; v_ok boolean; v_proc timestamptz; ok boolean := false; det text;
begin
  begin
    insert into webhooks_eventos (origem, evento_externo_id, tipo_evento, assinatura_valida, bruto, erro, processado_em)
    values ('n8n_ligacao', v_id, 'concluida', false, '{}'::jsonb, 'assinatura_invalida', now());
    -- 2º insert válido do mesmo id → 23505 (é por isso que a rota faz upsert ignoreDuplicates + substituição)
    update webhooks_eventos
       set assinatura_valida = true, bruto = '{"ok":1}'::jsonb, erro = null, processado_em = null
     where origem = 'n8n_ligacao' and evento_externo_id = v_id and assinatura_valida = false;
    get diagnostics n = row_count;
    select assinatura_valida, processado_em into v_ok, v_proc from webhooks_eventos where origem = 'n8n_ligacao' and evento_externo_id = v_id;
    ok := n = 1 and v_ok and v_proc is null;
    det := format('substituição da tentativa forjada: %s linha(s); assinatura_valida=%s processado_em=%s (esp. true/NULL → a rota segue para aplicarResultado, não devolve reentrega)', n, v_ok, v_proc);
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.r_reg('2 n8n/ligacao: id ocupado por tentativa inválida é substituído pela válida', ok, det);
end $$;

-- 3. mensagens_recebidas: grant estreito + trigger de coerência/carimbo + RPC continua.
do $$
declare fa record; fb record; v_msg uuid; v_uid uuid; v_perfil uuid; e_jor text; e_vpor text; e_pes text; e_inc text; e_rpc text;
        r record; r2 record; ok boolean := false; det text;
begin
  begin
    select * into fa from pg_temp.r_fixture();
    select * into fb from pg_temp.r_fixture();
    insert into mensagens_recebidas (conversa_externa_id, mensagem_externa_id, telefone, corpo, recebida_em, bruto)
    values ('v0061-conv', 'v0061-msg-' || gen_random_uuid()::text, '+5500000000009', 'oi', now(), '{}'::jsonb) returning id into v_msg;
    v_uid := pg_temp.r_como('relacionamento');
    begin update mensagens_recebidas set jornada_id = fa.jornada_id where id = v_msg; e_jor := 'PASSOU'; exception when others then e_jor := sqlstate; end;
    begin update mensagens_recebidas set vinculada_por = fa.advogada_id where id = v_msg; e_vpor := 'PASSOU'; exception when others then e_vpor := sqlstate; end;
    begin update mensagens_recebidas set pessoa_id = fa.pessoa_id where id = v_msg; e_pes := 'PASSOU'; exception when others then e_pes := sqlstate; end;
    execute 'reset role';
    select id into v_perfil from perfis_equipe where auth_user_id = v_uid and ativo limit 1;
    select pessoa_id, jornada_id, vinculada_por, vinculada_em into r from mensagens_recebidas where id = v_msg;
    -- postgres/service_role: jornada de OUTRA pessoa → 23514
    begin update mensagens_recebidas set pessoa_id = fa.pessoa_id, jornada_id = fb.jornada_id where id = v_msg; e_inc := 'PASSOU'; exception when others then e_inc := sqlstate; end;
    -- RPC (como relacionamento) continua: vincula à pessoa B, jornada derivada = B
    perform pg_temp.r_como('relacionamento');
    begin select (public.vincular_mensagem_recebida(v_msg, fb.pessoa_id)).jornada_id into r2; e_rpc := 'PASSOU'; exception when others then e_rpc := sqlstate; end;
    execute 'reset role';
    ok := e_jor = '42501' and e_vpor = '42501' and e_pes = 'PASSOU'
      and r.jornada_id = fa.jornada_id and r.vinculada_por = v_perfil and r.vinculada_em > now() - interval '1 minute'
      and e_inc = '23514' and e_rpc = 'PASSOU' and r2.jornada_id = fb.jornada_id;
    det := format('jornada_id direto→%s vinculada_por direto→%s (esp. 42501) · pessoa_id direto→%s (esp. PASSOU) jornada derivada=%s carimbo perfil=%s em≈now=%s · jornada de outra pessoa→%s (esp. 23514) · RPC→%s jornada=B:%s',
                  e_jor, e_vpor, e_pes, r.jornada_id = fa.jornada_id, r.vinculada_por = v_perfil, r.vinculada_em > now() - interval '1 minute', e_inc, e_rpc, r2.jornada_id = fb.jornada_id);
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.r_reg('3 mensagens_recebidas: vínculo coerente e carimbo do servidor', ok, det);
end $$;

-- 4. cenario_rubricas: parâmetro inativo → 23514; outra UF → 23514; UF do cliente e ativo → calcula.
do $$
declare f record; p_inat uuid; p_sp uuid; p_mg uuid; v_cen uuid; e_inat text; e_sp text; e_mg text; v_aliq numeric; v_val numeric; ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.r_fixture('MG');
    insert into parametros_metodo (chave, valor, unidade, uf, base_legal, ativo) values ('itcmd.teste_0061', 8, 'percentual', 'SP', 'verificação 0061', false) returning id into p_inat;
    insert into parametros_metodo (chave, valor, unidade, uf, base_legal, ativo) values ('itcmd.teste_0061', 8, 'percentual', 'SP', 'verificação 0061', true)  returning id into p_sp;
    insert into parametros_metodo (chave, valor, unidade, uf, base_legal, ativo) values ('itcmd.teste_0061', 8, 'percentual', 'MG', 'verificação 0061', true)  returning id into p_mg;
    perform pg_temp.r_como('advogada');
    insert into cenarios_patrimoniais (jornada_id, cenario) values (f.jornada_id, 'inventario') returning id into v_cen;
    begin insert into cenario_rubricas (cenario_id, rubrica, procedencia, base_calculo, parametro_id) values (v_cen, 'itcmd', 'calculado', 1000, p_inat); e_inat := 'PASSOU'; exception when others then e_inat := sqlstate || ' ' || split_part(sqlerrm, ':', 1); end;
    begin insert into cenario_rubricas (cenario_id, rubrica, procedencia, base_calculo, parametro_id) values (v_cen, 'itcmd', 'calculado', 1000, p_sp);   e_sp := 'PASSOU'; exception when others then e_sp := sqlstate || ' ' || split_part(sqlerrm, ':', 1); end;
    begin
      insert into cenario_rubricas (cenario_id, rubrica, procedencia, base_calculo, parametro_id) values (v_cen, 'itcmd', 'calculado', 1000, p_mg)
      returning aliquota, valor into v_aliq, v_val;
      e_mg := 'PASSOU';
    exception when others then e_mg := sqlstate || ' ' || split_part(sqlerrm, ':', 1); end;
    execute 'reset role';
    ok := e_inat = '23514 parametro_inativo' and e_sp = '23514 parametro_jurisdicao_incoerente' and e_mg = 'PASSOU' and v_aliq = 8 and v_val = 80;
    det := format('inativo→%s · SP p/ cliente MG→%s · MG ativo→%s aliquota=%s valor=%s (esp. 8 / 80)', e_inat, e_sp, e_mg, v_aliq, v_val);
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.r_reg('4 cenario_rubricas: só parâmetro ativo e da UF do cliente', ok, det);
end $$;

-- 5. Gates nunca NULL: intruso (auth sem perfil) → false/false/false, 42501 nas RPCs, 0 linhas.
do $$
declare f record; p_id uuid; g_vp boolean; g_adm boolean; g_int boolean; e_diag text; e_par text; n int; ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.r_fixture();
    insert into parametros_metodo (chave, valor, unidade, uf, base_legal, ativo) values ('itcmd.teste_0061', 8, 'percentual', 'SP', 'verificação 0061', false) returning id into p_id;
    perform pg_temp.r_como('intruso');
    select app.ve_patrimonio(), app.eh_admin(), app.eh_interno() into g_vp, g_adm, g_int;
    begin perform public.registrar_diagnostico_sv(f.jornada_id, null, '[]'::jsonb); e_diag := 'PASSOU'; exception when others then e_diag := sqlstate; end;
    begin perform public.ativar_parametro_metodo(p_id); e_par := 'PASSOU'; exception when others then e_par := sqlstate; end;
    execute 'reset role';
    select count(*) into n from diagnosticos_sv where jornada_id = f.jornada_id;
    ok := g_vp is false and g_adm is false and g_int is false and e_diag = '42501' and e_par = '42501' and n = 0;
    det := format('ve_patrimonio=%s eh_admin=%s eh_interno=%s (esp. false, nunca NULL) · registrar_diagnostico_sv→%s ativar_parametro_metodo→%s (esp. 42501) · diagnosticos gravados=%s (esp. 0)',
                  g_vp, g_adm, g_int, e_diag, e_par, n);
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.r_reg('5 ALTO gates de papel: intruso → false/42501/0 linhas', ok, det);
end $$;

-- 6. Presença: data do cliente ignorada (carimbo now()); depois imutável.
do $$
declare f record; e1 text; e2 text; v_em timestamptz; ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.r_fixture();
    perform pg_temp.r_como('relacionamento');
    begin update agendamentos set presenca_confirmada_em = '2000-01-01', presenca_confirmada_via = 'equipe' where id = f.agendamento_id; e1 := 'PASSOU'; exception when others then e1 := sqlstate; end;
    begin update agendamentos set presenca_confirmada_em = '2001-01-01', presenca_confirmada_via = 'equipe' where id = f.agendamento_id; e2 := 'PASSOU'; exception when others then e2 := sqlstate; end;
    execute 'reset role';
    select presenca_confirmada_em into v_em from agendamentos where id = f.agendamento_id;
    ok := e1 = 'PASSOU' and v_em > now() - interval '1 minute' and e2 = '23514';
    det := format('1ª confirmação com 2000-01-01→%s gravado=%s (esp. ≈ now) · 2ª alteração→%s (esp. 23514 presenca_imutavel)', e1, v_em, e2);
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.r_reg('6 presenca_confirmada_em é carimbo do servidor', ok, det);
end $$;

-- 7. diagnosticos_sv: atual imutável fora da RPC; aprovado_* carimbo do próprio perfil; RPC troca versão.
do $$
declare f record; v_uid uuid; v_perfil uuid; v_outro uuid; v1 diagnosticos_sv; v2 diagnosticos_sv; e_atual text; e_aprov text; e_v2 text;
        r record; n_atual int; v_blocos jsonb; ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.r_fixture();
    v_blocos := '[{"chave":"situacao_familiar","titulo":"t","conteudo":"c","pontos":[],"fontes":[],"categoria":"fato_declarado","visivel_ao_cliente":false}]'::jsonb;
    v_uid := pg_temp.r_como('advogada');
    v1 := public.registrar_diagnostico_sv(f.jornada_id, null, v_blocos);
    execute 'reset role';
    select id into v_perfil from perfis_equipe where auth_user_id = v_uid and ativo limit 1;
    select id into v_outro from perfis_equipe where id <> v_perfil and ativo limit 1;
    perform pg_temp.r_como('advogada');
    begin update diagnosticos_sv set atual = false where id = v1.id; e_atual := 'PASSOU'; exception when others then e_atual := sqlstate || ' ' || split_part(sqlerrm, ':', 1); end;
    begin update diagnosticos_sv set aprovado_por = v_outro, aprovado_em = '2000-01-01' where id = v1.id; e_aprov := 'PASSOU'; exception when others then e_aprov := sqlstate; end;
    begin v2 := public.registrar_diagnostico_sv(f.jornada_id, null, v_blocos); e_v2 := 'PASSOU'; exception when others then e_v2 := sqlstate || ' ' || split_part(sqlerrm, ':', 1); end;
    execute 'reset role';
    select aprovado_por, aprovado_em, atual into r from diagnosticos_sv where id = v1.id;
    select count(*) into n_atual from diagnosticos_sv where jornada_id = f.jornada_id and atual;
    ok := e_atual = '23514 diagnostico_atual_imutavel' and e_aprov = 'PASSOU'
      and r.aprovado_por = v_perfil and r.aprovado_em > now() - interval '1 minute'
      and e_v2 = 'PASSOU' and v2.atual and r.atual is false and n_atual = 1;
    det := format('atual=false direto→%s · aprovado_por de outro→%s gravou próprio perfil=%s em≈now=%s · RPC v2→%s (v2.atual=%s, v1.atual=%s, atuais=%s esp. 1)',
                  e_atual, e_aprov, r.aprovado_por = v_perfil, r.aprovado_em > now() - interval '1 minute', e_v2, v2.atual, r.atual, n_atual);
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.r_reg('7 diagnosticos_sv: atual só pela RPC; aprovação carimbada', ok, det);
end $$;

-- 8. Residual: nada da fixture sobreviveu.
do $$
declare n1 int; n2 int; n3 int;
begin
  select count(*) into n1 from pessoas where email like 'verif0061.%@example.com';
  select count(*) into n2 from parametros_metodo where chave = 'itcmd.teste_0061';
  select count(*) into n3 from webhooks_eventos where evento_externo_id like 'verif0061:%';
  perform pg_temp.r_reg('8 residual: 0 linhas de fixture', n1 = 0 and n2 = 0 and n3 = 0,
    format('pessoas=%s parametros=%s webhooks=%s (esp. 0/0/0)', n1, n2, n3));
end $$;

select ordem, passo, ok, detalhe from resultado_0061 order by ordem;
