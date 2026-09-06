-- scripts/verificacao-0074.sql — roteiro da 0074 (autoria do link de confirmação
-- + revogação do EXECUTE de `anon` em app.registrar_evento_timeline).
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- postgres, com a 0074 APLICADA. Devolve `resultado_0074` (ordem, passo, ok,
-- detalhe) e, se QUALQUER passo falhar, levanta exceção nomeando os passos —
-- o roteiro é trava, não relatório. Idempotente; nenhuma fixture sobrevive.
--
-- Molde: `scripts/verificacao-0071.sql`, inclusive a ARMADILHA dele: em
-- PL/pgSQL o bloco `EXCEPTION` é subtransação, então tudo que o corpo escreveu
-- é desfeito quando o `raise 'rollback_proposital'` estoura. Por isso o padrão
-- é: sub-bloco `begin … exception … end` alimentando só VARIÁVEIS locais, e o
-- `perform pg_temp.r74(...)` FORA dele.
--
-- O QUE ESTE ROTEIRO PROVA
--   1. `emitir_link_confirmacao_sistema` tem UMA assinatura só, de 4
--      argumentos (armadilha da sobrecarga ambígua), é `security definer` com
--      `search_path` fixo, e o EXECUTE é só de `service_role`;
--   2. comportamento sob `service_role`: com autor humano o link nasce com
--      `criado_por` E o link anterior morre com `revogado_por`; sem autor
--      (caminho da régua) nasce com `criado_por` null, como sempre; autor
--      inexistente/sem papel → 42501 e NENHUM link criado;
--   3. `anon` está FORA de `app.registrar_evento_timeline`, e `authenticated`
--      e `service_role` continuam DENTRO (o caminho real não foi tocado);
--   4. a prova de que o grant revogado era inerte: `anon` não tem USAGE no
--      schema `app`, e a policy de INSERT de `eventos_timeline` é
--      `to authenticated`;
--   5. `eventos_timeline.tipo` continua `text` SEM CHECK — o tipo novo `'link'`
--      da Fase 7 entra sem migration (é por isso que a 0074 não toca a tabela);
--   6. contagens de `links_publicos` e `eventos_timeline` intactas.
--
-- O QUE NÃO DÁ PARA VERIFICAR AQUI: que a barra "Enviar" da Ficha responde 201
-- e que o 21º clique em 10 min responde 429. Isso é curl contra o Next, com
-- sessão real (o rate limit é em memória do processo Node, não do banco).
-- ---------------------------------------------------------------------------

drop table if exists resultado_0074;
create temp table resultado_0074 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r74(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0074 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;

create temp table contagem_0074 on commit drop as
select (select count(*) from links_publicos)   as links,
       (select count(*) from eventos_timeline) as eventos;


-- ===========================================================================
-- 1. Assinatura, definer e privilégios de emitir_link_confirmacao_sistema.
--    Leitura pura do catálogo.
-- ===========================================================================
do $$
declare
  v_n int; v_args text; v_definer boolean; v_path text[];
  v_srv boolean; v_auth boolean; v_anon boolean; v_acl text;
begin
  select count(*), string_agg(pg_get_function_identity_arguments(p.oid), ' | '),
         bool_and(p.prosecdef), max(p.proconfig)
    into v_n, v_args, v_definer, v_path
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'emitir_link_confirmacao_sistema';

  perform pg_temp.r74(
    '1a UMA assinatura de emitir_link_confirmacao_sistema, com p_criado_por',
    v_n = 1 and coalesce(v_args, '') like '%p_criado_por%',
    format('assinaturas = %s · args = %s', v_n, coalesce(v_args, '(nenhuma)')));

  perform pg_temp.r74(
    '1b security definer com search_path fixo',
    coalesce(v_definer, false) and v_path is not null
      and array_to_string(v_path, ',') like '%search_path=public%',
    format('prosecdef=%s · proconfig=%s', coalesce(v_definer::text, '(ausente)'),
           coalesce(array_to_string(v_path, ','), 'null')));

  v_srv  := has_function_privilege('service_role',  'public.emitir_link_confirmacao_sistema(uuid, text, text, uuid)', 'execute');
  v_auth := has_function_privilege('authenticated', 'public.emitir_link_confirmacao_sistema(uuid, text, text, uuid)', 'execute');
  v_anon := has_function_privilege('anon',          'public.emitir_link_confirmacao_sistema(uuid, text, text, uuid)', 'execute');

  select coalesce(array_to_string(p.proacl, ' '), '(sem acl)') into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'emitir_link_confirmacao_sistema';

  perform pg_temp.r74(
    '1c EXECUTE só de service_role (authenticated e anon FORA) e sem grant para PUBLIC',
    v_srv and not v_auth and not v_anon
      and v_acl not like '%{=X/%' and v_acl not like '% =X/%',
    format('service_role=%s authenticated=%s anon=%s · proacl=%s', v_srv, v_auth, v_anon, v_acl));
end $$;


-- ===========================================================================
-- 2. COMPORTAMENTO — o que a migration promete, medido.
--
--    `set local role service_role`: como `postgres` (superusuário) o passo
--    passaria mesmo sem os grants, porque superusuário não é submetido a
--    checagem de EXECUTE. Com o role real, é a operação exata da rota.
--
--    Sequência dentro da fixture:
--      (i)   emite SEM autor            → criado_por null (caminho da régua)
--      (ii)  emite COM autor humano     → criado_por = perfil E o link (i) foi
--                                          revogado com revogado_por = perfil
--      (iii) emite com autor inventado  → 42501, e nenhum link novo
-- ===========================================================================
do $$
declare
  v_tag      text := left(gen_random_uuid()::text, 8);
  v_pessoa   uuid; v_jornada uuid; v_sessao uuid; v_agend uuid; v_perfil uuid;
  v_l1 links_publicos; v_l2 links_publicos;
  v_l1_depois links_publicos;
  v_erro_autor text := ''; v_links int;
  ok boolean := false; det text;
begin
  begin
    select id into v_perfil from perfis_equipe
     where ativo and papel in ('admin', 'advogada', 'relacionamento') limit 1;
    if v_perfil is null then
      det := 'sem perfil ativo de admin/advogada/relacionamento para usar de autor';
      raise exception 'rollback_proposital';
    end if;

    set local role service_role;

    insert into pessoas (nome, email, telefone, cidade, uf, origem_dado)
    values ('Verificação 0074 ' || v_tag, 'verif74.' || v_tag || '@example.com',
            '+55000000' || lpad((random() * 99999)::int::text, 5, '0'), 'São Paulo', 'SP', 'exemplo')
    returning id into v_pessoa;

    insert into jornadas (pessoa_id, origem, etapa, origem_dado)
    values (v_pessoa, 'outro', 'sessao_agendada', 'exemplo') returning id into v_jornada;

    insert into sessoes_viabilidade (jornada_id) values (v_jornada) returning id into v_sessao;

    -- `advogada_id` fica null de propósito: o índice de exclusão
    -- `ex_agenda_sem_sobreposicao` é `advogada_id with =`, e null não conflita
    -- com a agenda real de ninguém.
    insert into agendamentos (sessao_id, inicio_em, fim_em, status, origem)
    values (v_sessao, now() + interval '3 days', now() + interval '3 days 1 hour', 'agendado', 'equipe')
    returning id into v_agend;

    -- (i) caminho da régua: sem autor.
    select * into v_l1 from public.emitir_link_confirmacao_sistema(
      v_agend, repeat('a', 64), 'aaaaaa');

    -- (ii) caminho humano: com autor. Revoga o (i).
    select * into v_l2 from public.emitir_link_confirmacao_sistema(
      v_agend, repeat('b', 64), 'bbbbbb', v_perfil);

    select * into v_l1_depois from links_publicos where id = v_l1.id;

    -- (iii) autor inventado → 42501 e nenhum link novo.
    begin
      perform public.emitir_link_confirmacao_sistema(
        v_agend, repeat('c', 64), 'cccccc', '00000000-0000-4000-8000-000000000000'::uuid);
      v_erro_autor := 'NAO RECUSOU';
    exception when others then v_erro_autor := sqlstate;
    end;

    select count(*) into v_links from links_publicos where jornada_id = v_jornada;

    ok := v_l1.criado_por is null
      and v_l2.criado_por = v_perfil
      and v_l1_depois.estado = 'revogado'
      and v_l1_depois.revogado_por = v_perfil
      and v_l2.agendamento_id = v_agend
      and v_erro_autor = '42501'
      and v_links = 2;

    det := format('como service_role · (i) sem autor→criado_por=%s (esp. null) · (ii) com autor→criado_por correto=%s · (i) virou %s com revogado_por correto=%s · (iii) autor inventado→%s (esp. 42501) · links da jornada=%s (esp. 2)',
                  coalesce(v_l1.criado_por::text, 'null'),
                  v_l2.criado_por = v_perfil,
                  v_l1_depois.estado,
                  v_l1_depois.revogado_por = v_perfil,
                  v_erro_autor, v_links);
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      ok := false;
      det := coalesce(det || ' · ', '') || sqlstate || ' ' || sqlerrm;
    end if;
  end;
  reset role;
  perform pg_temp.r74('2 autoria: criado_por e revogado_por carimbados; autor inválido → 42501', ok, det);
end $$;


-- ===========================================================================
-- 3. `anon` fora de app.registrar_evento_timeline; o caminho real intacto.
-- ===========================================================================
do $$
declare v_anon boolean; v_auth boolean; v_srv boolean; v_acl text;
begin
  v_anon := has_function_privilege('anon',          'app.registrar_evento_timeline(uuid, text, text, text, jsonb)', 'execute');
  v_auth := has_function_privilege('authenticated', 'app.registrar_evento_timeline(uuid, text, text, text, jsonb)', 'execute');
  v_srv  := has_function_privilege('service_role',  'app.registrar_evento_timeline(uuid, text, text, text, jsonb)', 'execute');

  select coalesce(array_to_string(p.proacl, ' '), '(sem acl)') into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'registrar_evento_timeline';

  perform pg_temp.r74(
    '3a app.registrar_evento_timeline: anon FORA, authenticated e service_role DENTRO',
    not v_anon and v_auth and v_srv,
    format('anon=%s authenticated=%s service_role=%s', v_anon, v_auth, v_srv));

  -- `=X/` sem role à esquerda é o grant para PUBLIC (lição da 0065b).
  perform pg_temp.r74(
    '3b proacl sem grant para PUBLIC',
    v_acl not like '%{=X/%' and v_acl not like '% =X/%',
    format('proacl = %s', v_acl));
end $$;


-- ===========================================================================
-- 4. Por que o grant era INERTE (as duas travas que já existiam).
-- ===========================================================================
do $$
declare v_usage boolean; v_pol_ins text; v_anon_ins boolean;
begin
  v_usage := has_schema_privilege('anon', 'app', 'usage');

  select coalesce(string_agg(
           polname || '→' || coalesce((select string_agg(r.rolname, '+') from pg_roles r
                                        where r.oid = any (pol.polroles)), 'public'), ', '), '(nenhuma)')
    into v_pol_ins
    from pg_policy pol
   where pol.polrelid = 'public.eventos_timeline'::regclass and pol.polcmd = 'a';

  v_anon_ins := has_table_privilege('anon', 'public.eventos_timeline', 'insert');

  perform pg_temp.r74(
    '4a anon não tem USAGE no schema app (0018) — nenhuma função de app é resolvível por ele',
    not v_usage, format('has_schema_privilege(anon, app, usage) = %s', v_usage));

  perform pg_temp.r74(
    '4b INSERT em eventos_timeline: policy só para authenticated e anon sem privilégio de tabela',
    v_pol_ins like '%authenticated%' and v_pol_ins not like '%anon%' and not v_anon_ins,
    format('policies de insert = %s · has_table_privilege(anon, insert) = %s', v_pol_ins, v_anon_ins));
end $$;


-- ===========================================================================
-- 5. `eventos_timeline.tipo` continua sem CHECK — o tipo 'link' da Fase 7
--    entra sem migration. Se um dia alguém adicionar um CHECK sem incluir
--    'link', é AQUI que a Pasta do Cliente para de contar link enviado.
-- ===========================================================================
do $$
declare v_checks text; v_tipo text; ok boolean; det text; v_id uuid; v_attnum smallint;
begin
  select a.attnum, format_type(a.atttypid, a.atttypmod) into v_attnum, v_tipo
    from pg_attribute a
   where a.attrelid = 'public.eventos_timeline'::regclass and a.attname = 'tipo' and a.attnum > 0;

  -- Só CHECKs que tocam a COLUNA `tipo` (por conkey, não por texto: o check de
  -- `ator_tipo` contém a palavra "tipo" e daria falso positivo).
  select coalesce(string_agg(conname || ': ' || pg_get_constraintdef(oid), ' | '), '(nenhum)')
    into v_checks
    from pg_constraint
   where conrelid = 'public.eventos_timeline'::regclass and contype = 'c'
     and v_attnum = any (conkey);

  -- Prova de comportamento, não só de catálogo: gravar o tipo 'link' de verdade
  -- e desfazer. `jornada_id` sai da própria base (FK not null) — se não houver
  -- jornada nenhuma, o passo vira informativo em vez de falso negativo.
  begin
    select id into v_id from jornadas limit 1;
    if v_id is null then
      ok := v_checks = '(nenhum)'; det := 'sem jornada no banco para o INSERT de prova';
    else
      begin
        insert into eventos_timeline (jornada_id, tipo, titulo, dados, ator_tipo)
        values (v_id, 'link', 'Verificação 0074', '{"fixture":"0074"}'::jsonb, 'sistema');
        ok := true;
        raise exception 'rollback_proposital';
      exception when others then
        if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if;
      end;
      det := coalesce(det, 'INSERT de tipo=''link'' aceito e desfeito');
    end if;
  end;

  perform pg_temp.r74(
    '5 eventos_timeline.tipo sem CHECK e aceitando o tipo ''link''',
    ok and v_checks = '(nenhum)',
    format('tipo = %s · checks sobre a coluna tipo = %s · %s', v_tipo, v_checks, det));
end $$;


-- ===========================================================================
-- 6. Nenhuma fixture sobreviveu.
-- ===========================================================================
do $$
declare v_links int; v_ev int; c record;
begin
  select * into c from contagem_0074;
  select count(*) into v_links from links_publicos;
  select count(*) into v_ev    from eventos_timeline;

  perform pg_temp.r74(
    '6 contagens intactas (links_publicos · eventos_timeline)',
    v_links = c.links and v_ev = c.eventos,
    format('links %s→%s · eventos %s→%s', c.links, v_links, c.eventos, v_ev));
end $$;


select * from resultado_0074 order by ordem;

-- Trava: qualquer passo em `ok = false` derruba o roteiro nomeando os passos.
do $$
declare v_falhas text;
begin
  select string_agg(passo || ' [' || coalesce(detalhe, '') || ']', ' ;; ' order by ordem)
    into v_falhas from resultado_0074 where not ok;
  if v_falhas is not null then
    raise exception 'verificacao_0074_falhou: %', v_falhas;
  end if;
end $$;
