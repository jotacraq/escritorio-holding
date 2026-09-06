-- scripts/verificacao-0071.sql — roteiro da 0071 (achados A3 e A5 do agente do mock).
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- postgres, com a 0071 APLICADA. A última instrução devolve `resultado_0071`
-- (ordem, passo, ok, detalhe). `ok = true` significa que o banco faz o que a
-- migration promete. Idempotente; nenhuma fixture sobrevive.
--
-- Molde: scripts/verificacao-0070.sql — inclusive a ARMADILHA que ele resolve e
-- que é fácil de reintroduzir: em PL/pgSQL o bloco `EXCEPTION` é uma
-- subtransação, então TUDO que o corpo escreveu (inclusive o INSERT em
-- `resultado_0071`) é desfeito quando o `raise 'rollback_proposital'` estoura.
-- Por isso o padrão é sempre: sub-bloco `begin … exception … end` que só
-- alimenta VARIÁVEIS locais, e o `perform pg_temp.r71(...)` **fora** dele.
--
-- O QUE ESTE ROTEIRO PROVA
--   1. `app.regua_boas_vindas` é `security definer` com `search_path` fixo, e
--      `service_role` executa `app.enfileirar_mensagem` (A3, o privilégio);
--   2. INSERT direto em `pagamentos` não levanta 42501 e ENFILEIRA as
--      boas-vindas (A3, o comportamento — é a operação que falhava);
--   3. privilégios: `anon` fora das duas; `authenticated` fora de
--      `enfileirar_mensagem` e DENTRO de `registrar_diagnostico_sv`;
--   4. `registrar_diagnostico_sv` com assinatura ÚNICA de 4 argumentos
--      (armadilha 6) e a chamada posicional de 3 ainda resolvendo;
--   5. sob service_role: autor ausente → 22004, autor sem papel → 42501, autor
--      admin/advogada → grava com `criado_por` correto (A5);
--   6. contagens de `pagamentos`, `mensagens_agendadas` e `diagnosticos_sv`
--      intactas;
--   7. informativo: a CLASSE do A3 — funções de `app` chamadas por trigger que
--      seguem sem EXECUTE para `service_role`.
--
-- O QUE NÃO DÁ PARA VERIFICAR AQUI: que a ROTA
-- `POST /api/jornadas/[id]/diagnostico` continua respondendo 201 para a
-- advogada logada. Isso é curl contra o Next, com sessão real.
-- ---------------------------------------------------------------------------

drop table if exists resultado_0071;
create temp table resultado_0071 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r71(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0071 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;

-- Contagens do PRÉ, para o passo 6 comparar sem depender de anotação humana.
create temp table contagem_0071 on commit drop as
select (select count(*) from pagamentos)           as pagamentos,
       (select count(*) from mensagens_agendadas)  as mensagens,
       (select count(*) from diagnosticos_sv)      as diagnosticos;


-- ===========================================================================
-- 1. [A3] cabeçalho da trigger e EXECUTE de app.enfileirar_mensagem.
--    Leitura pura do catálogo — sem escrita, sem subtransação.
-- ===========================================================================
do $$
declare
  v_definer boolean; v_path text[]; v_srv boolean; v_auth boolean; v_anon boolean;
  v_sobrecargas int;
begin
  select p.prosecdef, p.proconfig into v_definer, v_path
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'regua_boas_vindas';

  select count(*) into v_sobrecargas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'enfileirar_mensagem';

  v_srv  := has_function_privilege('service_role',
              'app.enfileirar_mensagem(uuid, uuid, text, canal_mensagem, text, timestamptz, text, text, text)', 'execute');
  v_auth := has_function_privilege('authenticated',
              'app.enfileirar_mensagem(uuid, uuid, text, canal_mensagem, text, timestamptz, text, text, text)', 'execute');
  v_anon := has_function_privilege('anon',
              'app.enfileirar_mensagem(uuid, uuid, text, canal_mensagem, text, timestamptz, text, text, text)', 'execute');

  perform pg_temp.r71(
    '1a app.regua_boas_vindas é SECURITY DEFINER com search_path fixo',
    coalesce(v_definer, false) and v_path is not null
      and array_to_string(v_path, ',') like '%search_path=public%',
    format('prosecdef=%s · proconfig=%s', coalesce(v_definer::text, '(função ausente)'),
           coalesce(array_to_string(v_path, ','), 'null')));

  perform pg_temp.r71(
    '1b app.enfileirar_mensagem: service_role DENTRO, authenticated e anon FORA',
    v_srv and not v_auth and not v_anon,
    format('service_role=%s authenticated=%s anon=%s', v_srv, v_auth, v_anon));

  perform pg_temp.r71(
    '1c app.enfileirar_mensagem tem UMA assinatura só (armadilha 6)',
    v_sobrecargas = 1, format('assinaturas = %s (esperado 1)', v_sobrecargas));
end $$;


-- ===========================================================================
-- 2. [A3] A prova de comportamento: INSERT direto em `pagamentos` de um
--    produto `sessao_viabilidade` aprovado. Antes da 0071 isto devolvia
--    42501 "permission denied for function enfileirar_mensagem".
--
--    ATENÇÃO — a razão do `set local role service_role`: rodado como `postgres`
--    (superusuário), este passo passaria MESMO SEM A CORREÇÃO, porque
--    superusuário não é submetido a checagem de EXECUTE. Sem trocar de papel,
--    o teste seria decorativo. Com `set local role`, é a operação exata que o
--    agente do mock mediu em 42501.
--
--    `set local` é revertido quando a subtransação aborta (o
--    `raise 'rollback_proposital'` do fim do bloco), então o papel não vaza
--    para os passos seguintes.
-- ===========================================================================
do $$
declare
  v_tag     text := left(gen_random_uuid()::text, 8);
  v_pessoa  uuid; v_jornada uuid; v_produto uuid; v_pagamento uuid; v_etapa etapa_jornada;
  v_criou_produto boolean := false;
  v_msgs int := 0; v_msgs_boas_vindas int := 0;
  ok boolean := false; det text;
begin
  begin
    set local role service_role;

    select id into v_produto from produtos where tipo = 'sessao_viabilidade' limit 1;
    if v_produto is null then
      insert into produtos (nome, tipo, ativo)
      values ('Verificação 0071 ' || v_tag, 'sessao_viabilidade', true)
      returning id into v_produto;
      v_criou_produto := true;
    end if;

    insert into pessoas (nome, email, telefone, cidade, uf, origem_dado)
    values ('Verificação 0071 ' || v_tag, 'verif71.' || v_tag || '@example.com',
            '+55000000' || lpad((random() * 99999)::int::text, 5, '0'), 'São Paulo', 'SP', 'exemplo')
    returning id into v_pessoa;

    -- ARMADILHA (05/09 à noite): a jornada precisa nascer na etapa "pagou" (ordem >= 30).
    -- atualiza_nivel_pago sobe nivel_pago=1 e valida_transicao_jornada recusa etapa abaixo
    -- do piso pago (23514 'abaixo do nivel pago'); em 'captado' o passo morria na fixture.
    select etapa into v_etapa from etapas_jornada_ordem where ordem >= 30 order by ordem limit 1;
    insert into jornadas (pessoa_id, origem, etapa, origem_dado)
    values (v_pessoa, 'outro', v_etapa, 'exemplo') returning id into v_jornada;

    -- A operação do achado A3, sem RPC nenhuma no meio.
    -- `transacao_externa_id` e `bruto` são NOT NULL (0011:39,48); `valor` é
    -- numeric, não centavos. `origem` fica no default 'hotmart' e o par
    -- (origem, transacao_externa_id) é único — daí a tag no id.
    insert into pagamentos (pessoa_id, jornada_id, produto_id, status, valor,
                            transacao_externa_id, comprador_nome, comprador_email, bruto)
    values (v_pessoa, v_jornada, v_produto, 'aprovado', 2000.00,
            'verificacao-0071-' || v_tag, 'Verificação 0071',
            'verif71.' || v_tag || '@example.com',
            jsonb_build_object('fixture', 'verificacao-0071'))
    returning id into v_pagamento;

    select count(*) into v_msgs from mensagens_agendadas where jornada_id = v_jornada;
    select count(*) into v_msgs_boas_vindas
      from mensagens_agendadas m join mensagens_templates t on t.id = m.template_id
     where m.jornada_id = v_jornada and t.chave = 'boas_vindas';

    -- O INSERT não levantar 42501 já é o A3 fechado. As mensagens são 0 se os
    -- templates `boas_vindas` estiverem inativos — por isso a assertiva é o
    -- INSERT, e a contagem entra como detalhe, não como trava.
    ok  := v_pagamento is not null and v_msgs_boas_vindas >= 1;
    det := format('como service_role: pagamento gravado=%s · mensagens da jornada=%s (boas_vindas=%s) · produto %s',
                  v_pagamento is not null, v_msgs, v_msgs_boas_vindas,
                  case when v_criou_produto then 'criado na fixture' else 'reaproveitado do banco' end);
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      ok := false;
      -- 42501 "permission denied for function enfileirar_mensagem" aqui = a
      -- correção NÃO pegou. Qualquer outro sqlstate é problema da fixture.
      det := sqlstate || ' ' || sqlerrm;
    end if;
  end;
  reset role;
  perform pg_temp.r71('2 [A3] INSERT direto em pagamentos, como service_role, dispara a régua sem 42501', ok, det);
end $$;


-- ===========================================================================
-- 3. [A5] Privilégios de registrar_diagnostico_sv na assinatura NOVA.
-- ===========================================================================
do $$
declare v_auth boolean; v_srv boolean; v_anon boolean; v_acl text;
begin
  v_auth := has_function_privilege('authenticated', 'public.registrar_diagnostico_sv(uuid, uuid, jsonb, uuid)', 'execute');
  v_srv  := has_function_privilege('service_role',  'public.registrar_diagnostico_sv(uuid, uuid, jsonb, uuid)', 'execute');
  v_anon := has_function_privilege('anon',          'public.registrar_diagnostico_sv(uuid, uuid, jsonb, uuid)', 'execute');

  select coalesce(array_to_string(p.proacl, ' '), '(sem acl)') into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'registrar_diagnostico_sv';

  perform pg_temp.r71(
    '3a registrar_diagnostico_sv: authenticated e service_role DENTRO, anon FORA',
    v_auth and v_srv and not v_anon,
    format('authenticated=%s service_role=%s anon=%s', v_auth, v_srv, v_anon));

  -- `=X/` sem role à esquerda é o grant para PUBLIC — o que a lição da 0065b manda caçar.
  perform pg_temp.r71(
    '3b proacl sem grant para PUBLIC',
    v_acl not like '%{=X/%' and v_acl not like '% =X/%',
    format('proacl = %s', v_acl));
end $$;


-- ===========================================================================
-- 4. [A5] Assinatura única de 4 argumentos + compatibilidade posicional de 3.
-- ===========================================================================
do $$
declare
  v_n int; v_args text; v_compat boolean := false; v_erro text := '';
begin
  select count(*), string_agg(pg_get_function_identity_arguments(p.oid), ' | ')
    into v_n, v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'registrar_diagnostico_sv';

  perform pg_temp.r71(
    '4a UMA assinatura de registrar_diagnostico_sv, com 4 argumentos',
    v_n = 1 and v_args like '%p_criado_por%',
    format('assinaturas = %s · args = %s', v_n, coalesce(v_args, '(nenhuma)')));

  -- Chamada posicional de 3 argumentos: precisa RESOLVER (o erro esperado é de
  -- regra de negócio, nunca "function does not exist" nem "is not unique").
  begin
    perform public.registrar_diagnostico_sv(
      '00000000-0000-4000-8000-000000000000'::uuid, null::uuid, '[]'::jsonb);
    v_compat := true;
  exception when undefined_function or ambiguous_function then
    v_compat := false; v_erro := sqlstate || ' ' || sqlerrm;
  when others then
    -- 22004 (autor ausente, sob service_role/postgres) ou 42501/P0002:
    -- todos provam que a função foi ENCONTRADA com 3 argumentos.
    v_compat := true; v_erro := sqlstate;
  end;

  perform pg_temp.r71(
    '4b chamada posicional de 3 argumentos ainda resolve (verificacao-0061, TS, seed)',
    v_compat, format('sqlstate = %s', coalesce(nullif(v_erro, ''), 'nenhum')));
end $$;


-- ===========================================================================
-- 5. [A5] O gate por AUTOR DECLARADO, sob a ausência de auth.uid().
--    Três chamadas: sem autor, com autor sem papel, com autor válido.
--    Também como `service_role` — assim o passo prova de uma vez o EXECUTE
--    (o que o A5 quebrava) e o gate por autor declarado.
-- ===========================================================================
do $$
declare
  v_tag     text := left(gen_random_uuid()::text, 8);
  v_pessoa  uuid; v_jornada uuid; v_admin uuid; v_relac uuid;
  v_linha   diagnosticos_sv;
  v_sem_autor text := ''; v_sem_papel text := ''; v_pulou_papel boolean := false;
  v_gravou boolean := false; v_autor_ok boolean := false; v_linhas int;
  ok boolean := false; det text;
  c_blocos constant jsonb :=
    '[{"chave":"situacao_familiar","titulo":"t","conteudo":"c","pontos":[],"fontes":[],"categoria":"fato_declarado","visivel_ao_cliente":false}]'::jsonb;
begin
  begin
    select id into v_admin from perfis_equipe where papel in ('admin','advogada') and ativo limit 1;
    select id into v_relac from perfis_equipe where papel = 'relacionamento' and ativo limit 1;
    if v_admin is null then
      det := 'sem perfil admin/advogada ativo para usar de autor';
      raise exception 'rollback_proposital';
    end if;

    set local role service_role;

    insert into pessoas (nome, email, telefone, cidade, uf, origem_dado)
    values ('Verificação 0071 A5 ' || v_tag, 'verif71a5.' || v_tag || '@example.com',
            '+55000000' || lpad((random() * 99999)::int::text, 5, '0'), 'São Paulo', 'SP', 'exemplo')
    returning id into v_pessoa;
    insert into jornadas (pessoa_id, origem, etapa, origem_dado)
    values (v_pessoa, 'outro', 'sessao_realizada', 'exemplo') returning id into v_jornada;

    -- (i) autor ausente → 22004
    begin
      perform public.registrar_diagnostico_sv(v_jornada, null::uuid, c_blocos, null::uuid);
      v_sem_autor := 'NAO RECUSOU';
    exception when others then v_sem_autor := sqlstate;
    end;

    -- (ii) autor sem ve_patrimonio → 42501
    if v_relac is null then
      v_pulou_papel := true;
    else
      begin
        perform public.registrar_diagnostico_sv(v_jornada, null::uuid, c_blocos, v_relac);
        v_sem_papel := 'NAO RECUSOU';
      exception when others then v_sem_papel := sqlstate;
      end;
    end if;

    -- (iii) autor admin/advogada ativo → grava, com criado_por = o perfil
    select * into v_linha from public.registrar_diagnostico_sv(v_jornada, null::uuid, c_blocos, v_admin);
    v_gravou   := v_linha.id is not null and v_linha.atual and v_linha.versao = 1;
    v_autor_ok := v_linha.criado_por = v_admin and v_linha.atualizado_por = v_admin;

    -- as duas recusas não podem ter deixado linha para trás
    select count(*) into v_linhas from diagnosticos_sv where jornada_id = v_jornada;

    ok := v_sem_autor = '22004'
      and (v_pulou_papel or v_sem_papel = '42501')
      and v_gravou and v_autor_ok and v_linhas = 1;
    det := format('como service_role · sem autor→%s (esp. 22004) · autor sem papel→%s%s (esp. 42501) · gravou v%s atual=%s criado_por correto=%s · linhas na jornada=%s (esp. 1)',
                  v_sem_autor,
                  case when v_pulou_papel then 'pulado' else v_sem_papel end,
                  case when v_pulou_papel then ' (sem perfil relacionamento ativo)' else '' end,
                  coalesce(v_linha.versao::text, '-'), coalesce(v_linha.atual::text, '-'),
                  v_autor_ok, v_linhas);
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if;
  end;
  reset role;
  perform pg_temp.r71('5 [A5] service_role monta diagnóstico com autor declarado e validado', ok, det);
end $$;


-- ===========================================================================
-- 6. Nenhuma fixture sobreviveu: as contagens batem com o PRÉ.
-- ===========================================================================
do $$
declare v_pag int; v_msg int; v_diag int; c record;
begin
  select * into c from contagem_0071;
  select count(*) into v_pag  from pagamentos;
  select count(*) into v_msg  from mensagens_agendadas;
  select count(*) into v_diag from diagnosticos_sv;

  perform pg_temp.r71(
    '6 contagens intactas (pagamentos · mensagens_agendadas · diagnosticos_sv)',
    v_pag = c.pagamentos and v_msg = c.mensagens and v_diag = c.diagnosticos,
    format('pagamentos %s→%s · mensagens %s→%s · diagnosticos %s→%s',
           c.pagamentos, v_pag, c.mensagens, v_msg, c.diagnosticos, v_diag));
end $$;


-- ===========================================================================
-- 7. INFORMATIVO — a CLASSE do A3, não só o sintoma.
--    Funções de `app` referenciadas por alguma função de trigger, que NÃO são
--    `security definer` elas mesmas e seguem sem EXECUTE para `service_role`.
--    Cada linha aqui é um "42501 esperando um escritor direto".
--    `ok = true` sempre: isto é mapa, não trava.
-- ===========================================================================
do $$
declare v_lista text;
begin
  select coalesce(string_agg(distinct alvo.proname, ', '), '(nenhuma)')
    into v_lista
    from pg_proc t
    join pg_namespace tn on tn.oid = t.pronamespace
    join pg_proc alvo on alvo.oid <> t.oid
    join pg_namespace an on an.oid = alvo.pronamespace
   where t.prorettype = 'trigger'::regtype
     and an.nspname = 'app'
     and tn.nspname in ('app', 'public')
     and t.prosrc like '%' || alvo.proname || '(%'
     and not alvo.prosecdef
     and not has_function_privilege('service_role', alvo.oid, 'execute');

  perform pg_temp.r71(
    '7 [mapa] funções de app chamadas por trigger, sem definer e sem EXECUTE p/ service_role',
    true, v_lista);
end $$;


select * from resultado_0071 order by ordem;
