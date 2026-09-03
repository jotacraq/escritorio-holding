-- 0017_fixa_search_path_das_funcoes.sql
-- Toda funcao NOSSA passa a ter search_path fixo. Sem isto, uma funcao chamada por
-- trigger resolve nomes pelo search_path de quem disparou o comando -- porta aberta para
-- sequestro de schema. Achado do linter de seguranca do Supabase (lint 0011).
-- Filtra por dono = current_user para nao tentar alterar funcao de extensao (btree_gist).
do $$
declare r record;
begin
  for r in
    select n.nspname as esquema, p.proname as nome,
           pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
     where n.nspname in ('app','public')
       and p.prokind = 'f'
       and d.objid is null
       and pg_get_userbyid(p.proowner) = current_user
       and not exists (
         select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %I.%I(%s) set search_path = public, pg_temp',
                   r.esquema, r.nome, r.args);
  end loop;
end $$;

comment on table webhooks_eventos is
  'Livro-razao de eventos da Hotmart. RLS ligada SEM policy de proposito: so service_role acessa (payload bruto tem PII do comprador).';
