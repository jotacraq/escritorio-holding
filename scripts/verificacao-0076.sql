-- scripts/verificacao-0076.sql — roteiro da 0076 (registrar_briefing volta a derivar origem_dado).
-- Rodar como postgres com a 0076 aplicada. Termina SEMPRE em exceção: a mensagem
-- traz o resultado medido e o `rollback_proposital` desfaz as fixtures. Esperado:
-- demo→exemplo · real→real · atual só a última=t · completude=50 · execucao inexistente→P0002.
-- Rodado em 06/09/2026 pelo orquestrador: todos os valores esperados. (Superada pela 0077, que exige execução DA jornada — o roteiro continua válido.)
do $$
declare
  v_j uuid; v_pv uuid; v_exec_demo uuid; v_exec_real uuid; v_b1 briefings; v_b2 briefings; v_erro text := '';
  v_n int;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='registrar_briefing';
  if v_n <> 1 then raise exception 'verificacao_0076: % sobrecargas de registrar_briefing (esperado 1)', v_n; end if;
  select id into v_j from jornadas where origem_dado = 'exemplo' order by criado_em limit 1;
  select id into v_pv from prompts_versoes limit 1;
  insert into execucoes_ia (jornada_id, prompt_versao_id, modelo, modo) values (v_j, v_pv, 'fixture-0076', 'demonstracao') returning id into v_exec_demo;
  insert into execucoes_ia (jornada_id, prompt_versao_id, modelo, modo) values (v_j, v_pv, 'fixture-0076', 'real') returning id into v_exec_real;
  v_b1 := public.registrar_briefing(v_j, v_exec_demo, '{"fixture":"0076"}'::jsonb, 1::smallint, array['fixture'], false);
  v_b2 := public.registrar_briefing(v_j, v_exec_real, '{"fixture":"0076"}'::jsonb, 1::smallint, array['fixture'], false, 50::smallint, '{"ok":true}'::jsonb);
  begin
    perform public.registrar_briefing(v_j, '00000000-0000-4000-8000-000000000000'::uuid, '{}'::jsonb, 1::smallint, array[]::text[], false);
    v_erro := 'NAO RECUSOU';
  exception when others then v_erro := sqlstate;
  end;
  raise exception 'verificacao_0076 RESULTADO: demo→% (esp. exemplo) · real→% (esp. real) · atual só a última=% · completude=% · execucao inexistente→% (esp. P0002) [rollback_proposital]',
    v_b1.origem_dado, v_b2.origem_dado, (v_b1.id <> v_b2.id and v_b2.atual), v_b2.completude_entrada, v_erro;
end $$;
