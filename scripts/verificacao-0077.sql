-- scripts/verificacao-0077.sql — roteiro da 0077 (resolve_link_escrita com for update; registrar_briefing
-- exige execução DA jornada). Rodar como postgres com a 0077 aplicada. Termina SEMPRE em exceção com o
-- resultado medido; rollback_proposital desfaz as fixtures. Esperado:
--   briefing mesma jornada→exemplo · execução de OUTRA jornada→P0002 · upload 10º (usos=9)→true · 11º→limite_arquivos_atingido
-- Rodado em 06/09/2026 pelo orquestrador — ver diário.
do $$
declare
  v_j uuid; v_j2 uuid; v_pv uuid; v_exec_demo uuid; v_exec_outra uuid; v_b1 briefings; v_erro text := '';
  v_def text; v_n int; v_jid uuid; v_hash text; v_r1 jsonb; v_r2 jsonb;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname='resolve_link_escrita';
  if v_def not like '%for update%' then raise exception 'verificacao_0077: resolve_link_escrita sem for update'; end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='registrar_briefing';
  if v_n <> 1 then raise exception 'verificacao_0077: % sobrecargas de registrar_briefing', v_n; end if;
  select id into v_j from jornadas where origem_dado = 'exemplo' order by criado_em limit 1;
  select id into v_j2 from jornadas where origem_dado = 'exemplo' and id <> v_j order by criado_em limit 1;
  select id into v_pv from prompts_versoes limit 1;
  insert into execucoes_ia (jornada_id, prompt_versao_id, modelo, modo) values (v_j, v_pv, 'fixture-0077', 'demonstracao') returning id into v_exec_demo;
  insert into execucoes_ia (jornada_id, prompt_versao_id, modelo, modo) values (v_j2, v_pv, 'fixture-0077', 'demonstracao') returning id into v_exec_outra;
  v_b1 := public.registrar_briefing(v_j, v_exec_demo, '{"fixture":"0077"}'::jsonb, 1::smallint, array['fixture'], false);
  begin
    perform public.registrar_briefing(v_j, v_exec_outra, '{}'::jsonb, 1::smallint, array[]::text[], false);
    v_erro := 'NAO RECUSOU';
  exception when others then v_erro := sqlstate;
  end;
  select j.id into v_jid from jornadas j where j.desfecho = 'aberta'
     and not exists (select 1 from links_publicos l where l.jornada_id = j.id and l.tipo = 'documentos' and l.estado = 'ativo')
   order by j.criado_em limit 1;
  v_hash := 'verif0077_' || encode(gen_random_bytes(24), 'hex');
  insert into links_publicos (jornada_id, tipo, token_hash, token_prefixo, estado, expira_em, usos, origem_dado)
  values (v_jid, 'documentos', v_hash, 'vf0077', 'ativo', now() + interval '1 day', 9, 'exemplo');
  v_r1 := public.registrar_documento_publico(v_hash, 'outro', 'verif0077-a.pdf', 'pessoas/verificacao-0077/' || encode(gen_random_bytes(8), 'hex') || '/a.pdf', 'application/pdf', 1024, encode(gen_random_bytes(32), 'hex'));
  v_r2 := public.registrar_documento_publico(v_hash, 'outro', 'verif0077-b.pdf', 'pessoas/verificacao-0077/' || encode(gen_random_bytes(8), 'hex') || '/b.pdf', 'application/pdf', 1024, encode(gen_random_bytes(32), 'hex'));
  raise exception 'verificacao_0077 RESULTADO: briefing mesma jornada→% (esp. exemplo) · execução de OUTRA jornada→% (esp. P0002) · upload 10º (usos=9)→% (esp. true) · 11º→% (esp. limite_arquivos_atingido) [rollback_proposital]',
    v_b1.origem_dado, v_erro, v_r1 ->> 'ok', v_r2 ->> 'erro';
end $$;
