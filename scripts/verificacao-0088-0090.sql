-- scripts/verificacao-0088-0090.sql — roteiro da Fase 9 (agente de WhatsApp).
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- `postgres`, com 0088, 0089 e 0090 APLICADAS. A última instrução devolve
-- `resultado_0090` (ordem, passo, ok, detalhe). `ok = true` em todas significa
-- que o banco faz o que as três migrations prometem.
--
-- TUDO COM ROLLBACK, mesmo padrão do `verificacao-0086.sql`: cada bloco que
-- escreve vive dentro de um sub-`begin … exception … end` terminado em
-- `raise 'rollback_proposital'`, e o INSERT no resultado acontece FORA dele —
-- em PL/pgSQL o bloco EXCEPTION é uma subtransação, então gravar o resultado
-- lá dentro o desfaria junto com a fixture. O passo 11 mede DEPOIS e tem de
-- bater com o passo 0.
--
-- O QUE ESTE ROTEIRO PROVA
--   0  PRÉ-CHECK da view + medição ANTES (não escreve nada)
--   1  app.telefone_e164 = a regra do TS, caso a caso (inclui a linha real
--      gravada sem `+`, que é a origem do CONFLITO C1)
--   2  casar_pessoa_por_telefone: 1 (casa), 0 (desconhecido), N (ambíguo)
--   3  emitir_link_sistema: emite, REVOGA o anterior na mesma transação,
--      recusa tipo não suportado, jornada fechada e autor inválido
--   4  privilégios das 3 funções novas (anon/authenticated fora; service_role dentro)
--   5  RLS e grants das 2 tabelas novas (authenticated só SELECT)
--   6  a claim: o unique (mensagem_recebida_id) impede a segunda resposta
--   7  as 2 pendências novas aparecem na view, e a view continua sem escrita
--   8  configuracoes: 7 chaves e `agente_whatsapp.ativo = false`
--   9  prompt 0090 existe e nasce `ativo = false`
--  10  sinais_agente_whatsapp devolve o contrato de Sinais e NÃO vaza PII
--  11  medição DEPOIS (tem de bater com o passo 0)
--
-- O QUE NÃO DÁ PARA VERIFICAR AQUI: que o agente responde no WhatsApp de
-- verdade. Isso é `scripts/simular-chatwoot.ts` + vitest, no relatório do agente.
-- ---------------------------------------------------------------------------

drop table if exists resultado_0090;
create temp table resultado_0090 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r90(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0090 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;


-- ===========================================================================
-- 0 · PRÉ-CHECK da view + medição ANTES
-- ===========================================================================
do $$
declare
  v_def text;
  v_faltam text := '';
  v_tipo text;
  v_esperados text[] := array['produto_nao_mapeado','mensagem_falhou','link_expirando',
                              'material_aguardando_aprovacao','sessao_sem_sala','cron_parado',
                              'expurgo_storage_pendente','numero_desconhecido','telefone_fora_do_padrao'];
  v_pessoas int; v_jornadas int; v_links int; v_msgs int; v_tarefas int; v_exec int;
begin
  v_def := pg_get_viewdef('vw_pendencias_sistema'::regclass, true);
  foreach v_tipo in array v_esperados loop
    if position(v_tipo in v_def) = 0 then v_faltam := v_faltam || v_tipo || ' '; end if;
  end loop;

  select count(*) into v_pessoas  from pessoas;
  select count(*) into v_jornadas from jornadas;
  select count(*) into v_links    from links_publicos;
  select count(*) into v_msgs     from mensagens_recebidas;
  select count(*) into v_tarefas  from tarefas;
  select count(*) into v_exec     from execucoes_ia;

  perform pg_temp.r90('0 · pré-check da view + medição ANTES', v_faltam = '',
    case when v_faltam = '' then 'a view VIGENTE tem os 9 tipos esperados. ' else 'FALTAM NA VIEW: ' || v_faltam || ' — PARE. ' end ||
    'pessoas=' || v_pessoas || ' jornadas=' || v_jornadas || ' links=' || v_links ||
    ' mensagens_recebidas=' || v_msgs || ' tarefas=' || v_tarefas || ' execucoes_ia=' || v_exec);
end $$;


-- ===========================================================================
-- 1 · app.telefone_e164 — a MESMA regra do TS, caso a caso.
--     O caso `11988887777` é o que importa: é o formato em que a única pessoa
--     `origem_dado='real'` está gravada (medido em 07/09/2026).
-- ===========================================================================
do $$
declare
  v_casos text[][] := array[
    array['11988887777',      '+5511988887777'],
    array['+55 11 98888-7777','+5511988887777'],
    array['5511988887777',    '+5511988887777'],
    array['(11) 3888-7777',   '+551138887777'],
    array['+5500900000001',   '+5500900000001'],
    array['123',              null],
    array['',                 null],
    array['abc',              null]
  ];
  v_i int; v_obtido text; v_esperado text; v_erros text := ''; v_ok boolean := true;
begin
  for v_i in 1 .. array_length(v_casos, 1) loop
    v_esperado := v_casos[v_i][2];
    v_obtido := app.telefone_e164(v_casos[v_i][1]);
    if v_obtido is distinct from v_esperado then
      v_ok := false;
      v_erros := v_erros || '"' || v_casos[v_i][1] || '"→' || coalesce(v_obtido, 'NULL') ||
                 ' (esperado ' || coalesce(v_esperado, 'NULL') || ') · ';
    end if;
  end loop;
  perform pg_temp.r90('1 · app.telefone_e164 = regra do TS', v_ok,
    case when v_ok then array_length(v_casos, 1) || '/' || array_length(v_casos, 1) || ' casos conferem'
         else v_erros end);
end $$;


-- ===========================================================================
-- 2 · casar_pessoa_por_telefone — 1, 0 e N.
-- ===========================================================================
do $$
declare
  v_p1 uuid; v_p2 uuid; v_j1 uuid;
  v_qtd_casa int; v_qtd_desconhecido int; v_qtd_ambiguo int;
  v_pessoa_casada uuid; v_jornada_casada uuid;
  v_ok boolean;
begin
  begin
    -- fixture: uma pessoa gravada SEM `+` (o formato do cadastro real).
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificação 0088 A', 'verif0088a@example.com', '11912345678', 'exemplo')
    returning id into v_p1;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p1, 'qualificado', 'indicacao', 'exemplo') returning id into v_j1;

    select quantidade, pessoa_id, jornada_id into v_qtd_casa, v_pessoa_casada, v_jornada_casada
      from casar_pessoa_por_telefone('+55 11 91234-5678');

    select quantidade into v_qtd_desconhecido from casar_pessoa_por_telefone('+5599999999999');

    -- a MESMA pessoa em outra grafia: cardinalidade 2 → o porteiro cala.
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificação 0088 B', 'verif0088b@example.com', '+5511912345678', 'exemplo')
    returning id into v_p2;
    select quantidade into v_qtd_ambiguo from casar_pessoa_por_telefone('11912345678');

    v_ok := v_qtd_casa = 1 and v_pessoa_casada = v_p1 and v_jornada_casada = v_j1
            and v_qtd_desconhecido = 0 and v_qtd_ambiguo = 2;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r90('2 · casar_pessoa_por_telefone', false, 'exceção: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r90('2 · casar_pessoa_por_telefone (1 · 0 · N)', coalesce(v_ok, false),
    'sem `+` casou=' || coalesce(v_qtd_casa::text, '?') ||
    ' · desconhecido=' || coalesce(v_qtd_desconhecido::text, '?') ||
    ' · ambíguo=' || coalesce(v_qtd_ambiguo::text, '?') || ' (esperado 1 · 0 · 2)');
end $$;


-- ===========================================================================
-- 3 · emitir_link_sistema — emite, REVOGA o anterior, e recusa o que tem de recusar.
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_jf uuid; v_perfil uuid;
  v_l1 links_publicos; v_l2 links_publicos;
  v_estado_l1 text;
  v_e_tipo text := ''; v_e_fechada text := ''; v_e_autor text := '';
  v_ok boolean;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificação 0089 L', 'verif0089l@example.com', '+5511911110000', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'croqui_contratado', 'indicacao', 'exemplo') returning id into v_j;

    v_l1 := emitir_link_sistema(v_j, 'documentos', repeat('a', 64), 'aaaaaa');
    v_l2 := emitir_link_sistema(v_j, 'documentos', repeat('b', 64), 'bbbbbb');
    select estado into v_estado_l1 from links_publicos where id = v_l1.id;

    begin
      perform emitir_link_sistema(v_j, 'material', repeat('c', 64), 'cccccc');
      v_e_tipo := 'NAO_RECUSOU';
    exception when others then v_e_tipo := left(sqlerrm, 40); end;

    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificação 0089 F', 'verif0089f@example.com', '+5511911110001', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, desfecho, motivo_desfecho, origem_dado)
    values (v_p, 'captado', 'indicacao', 'descartada', 'fixture', 'exemplo') returning id into v_jf;
    begin
      perform emitir_link_sistema(v_jf, 'documentos', repeat('d', 64), 'dddddd');
      v_e_fechada := 'NAO_RECUSOU';
    exception when others then v_e_fechada := left(sqlerrm, 40); end;

    begin
      perform emitir_link_sistema(v_j, 'formulario', repeat('e', 64), 'eeeeee', gen_random_uuid());
      v_e_autor := 'NAO_RECUSOU';
    exception when others then v_e_autor := left(sqlerrm, 40); end;

    v_ok := v_l1.estado = 'ativo' and v_l2.estado = 'ativo' and v_estado_l1 = 'revogado'
            and v_l1.criado_por is null
            and v_e_tipo like 'tipo_nao_suportado%'
            and v_e_fechada like 'jornada_invalida%'
            and v_e_autor like 'autor_invalido%';
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r90('3 · emitir_link_sistema', false, 'exceção: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r90('3 · emitir_link_sistema (emite · revoga · recusa)', coalesce(v_ok, false),
    'link1 depois=' || coalesce(v_estado_l1, '?') || ' (esperado revogado) · criado_por=NULL · ' ||
    'tipo→' || v_e_tipo || ' · fechada→' || v_e_fechada || ' · autor→' || v_e_autor);
end $$;


-- ===========================================================================
-- 4 · privilégios das 3 funções novas.
-- ===========================================================================
do $$
declare
  v_linhas text := ''; v_ok boolean := true;
  v_f text; v_r text; v_tem boolean; v_esperado boolean;
  v_funcoes text[] := array[
    'public.casar_pessoa_por_telefone(text)',
    'public.sinais_agente_whatsapp(uuid)',
    'public.emitir_link_sistema(uuid, tipo_link_publico, text, text, uuid)'
  ];
  v_papeis text[] := array['anon', 'authenticated', 'service_role'];
begin
  foreach v_f in array v_funcoes loop
    foreach v_r in array v_papeis loop
      v_tem := has_function_privilege(v_r, v_f, 'execute');
      v_esperado := (v_r = 'service_role');
      if v_tem <> v_esperado then v_ok := false; end if;
      v_linhas := v_linhas || split_part(v_f, '(', 1) || '/' || v_r || '=' || v_tem || ' ';
    end loop;
  end loop;
  -- app.telefone_e164: authenticated PRECISA (a view é security_invoker e a usa).
  if not has_function_privilege('authenticated', 'app.telefone_e164(text)', 'execute') then v_ok := false; end if;
  if has_function_privilege('anon', 'app.telefone_e164(text)', 'execute') then v_ok := false; end if;
  perform pg_temp.r90('4 · privilégios das funções novas', v_ok,
    v_linhas || '· app.telefone_e164 authenticated=' ||
    has_function_privilege('authenticated', 'app.telefone_e164(text)', 'execute') ||
    ' anon=' || has_function_privilege('anon', 'app.telefone_e164(text)', 'execute'));
end $$;


-- ===========================================================================
-- 5 · RLS e grants das 2 tabelas novas. `authenticated` só SELECT.
-- ===========================================================================
do $$
declare
  v_ok boolean;
  v_rls_e boolean; v_rls_r boolean; v_force_e boolean; v_force_r boolean;
  v_sel_e boolean; v_ins_e boolean; v_upd_e boolean; v_del_e boolean;
  v_sel_r boolean; v_ins_r boolean; v_del_r boolean;
  v_anon_e boolean; v_anon_r boolean;
begin
  select relrowsecurity, relforcerowsecurity into v_rls_e, v_force_e
    from pg_class where oid = 'agente_whatsapp_estado'::regclass;
  select relrowsecurity, relforcerowsecurity into v_rls_r, v_force_r
    from pg_class where oid = 'agente_whatsapp_respostas'::regclass;

  v_sel_e := has_table_privilege('authenticated', 'agente_whatsapp_estado', 'select');
  v_ins_e := has_table_privilege('authenticated', 'agente_whatsapp_estado', 'insert');
  v_upd_e := has_table_privilege('authenticated', 'agente_whatsapp_estado', 'update');
  v_del_e := has_table_privilege('authenticated', 'agente_whatsapp_estado', 'delete');
  v_sel_r := has_table_privilege('authenticated', 'agente_whatsapp_respostas', 'select');
  v_ins_r := has_table_privilege('authenticated', 'agente_whatsapp_respostas', 'insert');
  v_del_r := has_table_privilege('authenticated', 'agente_whatsapp_respostas', 'delete');
  v_anon_e := has_table_privilege('anon', 'agente_whatsapp_estado', 'select');
  v_anon_r := has_table_privilege('anon', 'agente_whatsapp_respostas', 'select');

  v_ok := v_rls_e and v_force_e and v_rls_r and v_force_r
          and v_sel_e and not v_ins_e and not v_upd_e and not v_del_e
          and v_sel_r and not v_ins_r and not v_del_r
          and not v_anon_e and not v_anon_r;

  perform pg_temp.r90('5 · RLS e grants (authenticated só SELECT)', v_ok,
    'estado{rls=' || v_rls_e || ' force=' || v_force_e || ' sel=' || v_sel_e || ' ins=' || v_ins_e ||
    ' upd=' || v_upd_e || ' del=' || v_del_e || '} respostas{rls=' || v_rls_r || ' force=' || v_force_r ||
    ' sel=' || v_sel_r || ' ins=' || v_ins_r || ' del=' || v_del_r || '} anon{estado=' || v_anon_e ||
    ' respostas=' || v_anon_r || '}');
end $$;


-- ===========================================================================
-- 6 · A CLAIM. O unique (mensagem_recebida_id) é a trava anti-resposta-dupla:
--     a segunda tentativa tem de falhar no BANCO, não num `if`.
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_m uuid; v_r1 uuid; v_segunda text := '';
  v_ok boolean;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificação 0088 C', 'verif0088c@example.com', '+5511922220000', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'croqui_contratado', 'indicacao', 'exemplo') returning id into v_j;
    insert into mensagens_recebidas (conversa_externa_id, mensagem_externa_id, telefone, pessoa_id, jornada_id, corpo, recebida_em, bruto)
    values ('9001', 'verif-0088-1', '+5511922220000', v_p, v_j, 'oi', now(), '{}'::jsonb) returning id into v_m;

    insert into agente_whatsapp_respostas (mensagem_recebida_id, jornada_id, conversa_externa_id)
    values (v_m, v_j, '9001') returning id into v_r1;

    begin
      insert into agente_whatsapp_respostas (mensagem_recebida_id, jornada_id, conversa_externa_id)
      values (v_m, v_j, '9001');
      v_segunda := 'NAO_BLOQUEOU';
    exception when unique_violation then v_segunda := 'bloqueada_pelo_unique'; end;

    v_ok := v_r1 is not null and v_segunda = 'bloqueada_pelo_unique';
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r90('6 · claim anti-resposta-dupla', false, 'exceção: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r90('6 · claim anti-resposta-dupla', coalesce(v_ok, false),
    '1ª inserção ok · 2ª → ' || v_segunda);
end $$;


-- ===========================================================================
-- 7 · As 2 pendências novas na view + a view continua sem escrita (0087).
-- ===========================================================================
do $$
declare
  v_p uuid; v_desconhecido int; v_fora int;
  v_ins boolean; v_upd boolean; v_del boolean; v_anon boolean; v_auth_sel boolean;
  v_ok boolean;
begin
  begin
    insert into mensagens_recebidas (conversa_externa_id, mensagem_externa_id, telefone, corpo, recebida_em, bruto)
    values ('9002', 'verif-0089-desconhecido', '+5511933330000', 'oi, tudo bem?', now(), '{}'::jsonb);
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificação 0089 T', 'verif0089t@example.com', '11944440000', 'exemplo') returning id into v_p;

    select count(*) into v_desconhecido from vw_pendencias_sistema
     where tipo = 'numero_desconhecido' and descricao like '%+5511933330000%';
    select count(*) into v_fora from vw_pendencias_sistema
     where tipo = 'telefone_fora_do_padrao' and pessoa_nome = 'Verificação 0089 T';

    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r90('7 · pendências novas', false, 'exceção: ' || sqlerrm);
      return;
    end if;
  end;

  v_ins  := has_table_privilege('authenticated', 'vw_pendencias_sistema', 'insert');
  v_upd  := has_table_privilege('authenticated', 'vw_pendencias_sistema', 'update');
  v_del  := has_table_privilege('authenticated', 'vw_pendencias_sistema', 'delete');
  v_anon := has_table_privilege('anon', 'vw_pendencias_sistema', 'select');
  v_auth_sel := has_table_privilege('authenticated', 'vw_pendencias_sistema', 'select');

  v_ok := v_desconhecido = 1 and v_fora = 1 and not v_ins and not v_upd and not v_del
          and not v_anon and v_auth_sel;
  perform pg_temp.r90('7 · pendências novas + view sem escrita', coalesce(v_ok, false),
    'numero_desconhecido=' || coalesce(v_desconhecido::text, '?') ||
    ' telefone_fora_do_padrao=' || coalesce(v_fora::text, '?') ||
    ' · authenticated{sel=' || v_auth_sel || ' ins=' || v_ins || ' upd=' || v_upd || ' del=' || v_del ||
    '} anon{sel=' || v_anon || '}');
end $$;


-- ===========================================================================
-- 8 · O interruptor. O agente NASCE DESLIGADO.
-- ===========================================================================
do $$
declare v_qtd int; v_ativo jsonb; v_ok boolean;
begin
  select count(*) into v_qtd from configuracoes where chave like 'agente_whatsapp.%';
  select valor into v_ativo from configuracoes where chave = 'agente_whatsapp.ativo';
  v_ok := v_qtd = 7 and v_ativo = 'false'::jsonb;
  perform pg_temp.r90('8 · configuracoes agente_whatsapp.* (ativo = false)', v_ok,
    'chaves=' || v_qtd || ' (esperado 7) · ativo=' || coalesce(v_ativo::text, 'AUSENTE'));
end $$;


-- ===========================================================================
-- 9 · O prompt nasce INATIVO (D17) e não desativa nenhum outro.
-- ===========================================================================
do $$
declare v_ativo boolean; v_versao int; v_outros int; v_ok boolean;
begin
  select ativo, versao into v_ativo, v_versao
    from prompts_versoes where chave = 'agente_whatsapp_onboarding' order by versao desc limit 1;
  select count(*) into v_outros from prompts_versoes where ativo;
  v_ok := v_versao = 1 and v_ativo = false and v_outros = 5;
  perform pg_temp.r90('9 · prompt do agente nasce ativo=false', coalesce(v_ok, false),
    'versao=' || coalesce(v_versao::text, 'AUSENTE') || ' ativo=' || coalesce(v_ativo::text, '?') ||
    ' · prompts ativos no banco=' || v_outros || ' (esperado 5, os mesmos de antes)');
end $$;


-- ===========================================================================
-- 10 · sinais_agente_whatsapp: entrega o contrato de Sinais e NÃO vaza PII.
--      A jornada usada é a que existir — o roteiro não cria fixture aqui de
--      propósito: queremos o comportamento sobre dado de verdade.
-- ===========================================================================
do $$
declare
  v_j uuid; v_sinais jsonb; v_chaves text[]; v_faltam text := '';
  v_esperadas text[] := array['etapa','nivel_pago_vigente','tem_formulario','tem_documentos',
                              'proxima_sessao_em','presenca_confirmada_em','croqui_status',
                              'material_estado','tarefas_abertas','desfecho','pessoa_origem_dado',
                              'jornada_origem_dado','primeiro_nome'];
  v_proibidas text[] := array['email','telefone','patrimonio','valor','cpf'];
  v_c text; v_ok boolean := true;
begin
  select id into v_j from jornadas order by criado_em limit 1;
  if v_j is null then
    perform pg_temp.r90('10 · sinais_agente_whatsapp', false, 'não há jornada no banco para testar');
    return;
  end if;
  v_sinais := sinais_agente_whatsapp(v_j);
  select array_agg(k) into v_chaves from jsonb_object_keys(v_sinais) k;

  foreach v_c in array v_esperadas loop
    if not (v_c = any (v_chaves)) then v_ok := false; v_faltam := v_faltam || 'falta:' || v_c || ' '; end if;
  end loop;
  foreach v_c in array v_proibidas loop
    if v_c = any (v_chaves) then v_ok := false; v_faltam := v_faltam || 'VAZOU:' || v_c || ' '; end if;
  end loop;

  perform pg_temp.r90('10 · sinais_agente_whatsapp (contrato + zero PII)', v_ok,
    coalesce(nullif(v_faltam, ''), 'as ' || array_length(v_esperadas,1) || ' chaves estão lá e nenhuma proibida aparece') ||
    ' · chaves=' || array_length(v_chaves, 1));
end $$;


-- ===========================================================================
-- 11 · Medição DEPOIS. Tem de bater com o passo 0.
-- ===========================================================================
do $$
declare v_pessoas int; v_jornadas int; v_links int; v_msgs int; v_tarefas int; v_exec int; v_resp int; v_est int;
begin
  select count(*) into v_pessoas  from pessoas;
  select count(*) into v_jornadas from jornadas;
  select count(*) into v_links    from links_publicos;
  select count(*) into v_msgs     from mensagens_recebidas;
  select count(*) into v_tarefas  from tarefas;
  select count(*) into v_exec     from execucoes_ia;
  select count(*) into v_resp     from agente_whatsapp_respostas;
  select count(*) into v_est      from agente_whatsapp_estado;
  perform pg_temp.r90('11 · medição DEPOIS (tem de bater com o passo 0)', true,
    'pessoas=' || v_pessoas || ' jornadas=' || v_jornadas || ' links=' || v_links ||
    ' mensagens_recebidas=' || v_msgs || ' tarefas=' || v_tarefas || ' execucoes_ia=' || v_exec ||
    ' · tabelas novas: respostas=' || v_resp || ' estado=' || v_est || ' (esperado 0 e 0)');
end $$;


select ordem, passo, ok, detalhe from resultado_0090 order by ordem;
