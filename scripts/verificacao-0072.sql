-- scripts/verificacao-0072.sql — roteiro da 0072 (links_publicos só por RPC).
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor) como postgres, com a 0072 aplicada.
-- Transacional (temp table on commit drop, set local role + reset role); nenhuma fixture sobrevive.
-- Rodado em 05/09/2026 à noite: 6/6 OK.

drop table if exists resultado_0072;
create temp table resultado_0072 (ordem serial primary key, passo text, ok boolean, detalhe text) on commit drop;
do $$
declare v_ins boolean; v_upd boolean; v_del boolean; v_pol text; v_defs text; v_nao_def int; e text; n int;
begin
  v_ins := has_table_privilege('authenticated','public.links_publicos','insert');
  v_upd := has_table_privilege('authenticated','public.links_publicos','update');
  v_del := has_table_privilege('authenticated','public.links_publicos','delete');
  select string_agg(polname, ',' order by polname) into v_pol from pg_policy where polrelid = 'public.links_publicos'::regclass;
  insert into resultado_0072 (passo, ok, detalhe) values ('1 authenticated sem INSERT/UPDATE/DELETE', not (v_ins or v_upd or v_del), format('insert=%s update=%s delete=%s', v_ins, v_upd, v_del));
  insert into resultado_0072 (passo, ok, detalhe) values ('2 só a policy de leitura sobrou', v_pol = 'lp_sel', 'policies = ' || coalesce(v_pol,'(nenhuma)'));
  select string_agg(p.proname || '=' || p.prosecdef, ', '), count(*) filter (where not p.prosecdef) into v_defs, v_nao_def
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and (p.proname like 'emitir_link%' or p.proname = 'revogar_link_publico');
  insert into resultado_0072 (passo, ok, detalhe) values ('3 RPCs de link continuam security definer', v_nao_def = 0, v_defs);
  -- Superusuário não passa por EXECUTE/privilégio de tabela: a prova tem de ser com o role real.
  begin
    set local role authenticated;
    update links_publicos set usos = 0 where false; get diagnostics n = row_count; e := 'PASSOU';
  exception when others then e := sqlstate; end;
  reset role;
  insert into resultado_0072 (passo, ok, detalhe) values ('4 UPDATE direto como authenticated → 42501', e = '42501', 'sqlstate = ' || e);
  begin
    set local role authenticated;
    insert into links_publicos (jornada_id, tipo, token_hash, token_prefixo, expira_em) values (gen_random_uuid(), 'formulario', repeat('9',64), '999999', now()); e := 'PASSOU';
  exception when others then e := sqlstate; end;
  reset role;
  insert into resultado_0072 (passo, ok, detalhe) values ('5 INSERT direto como authenticated → 42501', e = '42501', 'sqlstate = ' || e);
  begin
    set local role authenticated;
    perform count(*) from links_publicos; e := 'PASSOU';
  exception when others then e := sqlstate; end;
  reset role;
  insert into resultado_0072 (passo, ok, detalhe) values ('6 SELECT como authenticated continua permitido no privilégio (RLS decide a linha)', e = 'PASSOU', 'resultado = ' || e);
end $$;
select * from resultado_0072 order by ordem;
