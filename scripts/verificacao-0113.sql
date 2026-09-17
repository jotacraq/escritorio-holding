-- scripts/verificacao-0113.sql — roteiro da integração Zoom OAuth
-- (singleton `integracoes_zoom`, sem PII, sem query de alta cardinalidade —
-- por isso este roteiro prova RLS/GRANT/singleton, não plano de execução).
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- `postgres`, com 0112 já aplicada e 0113 AINDA NÃO aplicada — dentro de
-- `begin; ...; rollback;`, mede o DDL e o RLS de 0113 sem deixar nada
-- gravado. A última instrução devolve `resultado_0113` (ordem, passo, ok,
-- detalhe).
--
-- ⚠️ Nenhum passo deste roteiro foi executado contra o banco real
-- (fcfsnqqaphtamhrpuyoh) por este agente — sem acesso de produção nesta
-- máquina, por regra dura da operação.
--
-- O QUE ESTE ROTEIRO PROVA
--   0  a tabela integracoes_zoom NÃO existe ainda
--   1  depois de aplicar 0113 (colar o corpo da migration ANTES deste
--      roteiro, ou rodar em sequência na mesma transação): singleton —
--      inserir id=2 falha por CHECK (id = 1)
--   2  RLS ligada e FORÇADA (relrowsecurity e relforcerowsecurity = true)
--   3  authenticated NÃO tem INSERT/UPDATE/DELETE (só SELECT) — grant
--      restrito conferido em information_schema.role_table_grants
--   4  service_role tem SELECT/INSERT/UPDATE (nunca DELETE — não há baixa
--      lógica de uma credencial, é sempre substituída por outra)
--   5  policy de SELECT usa app.eh_admin(), não app.ve_patrimonio() nem
--      app.eh_interno() — checado por pg_get_expr/pg_policy
--   6  tudo com ROLLBACK — nada fica gravado por este roteiro
-- ---------------------------------------------------------------------------

begin;

drop table if exists resultado_0113;
create temp table resultado_0113 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r113(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0113 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;

-- passo 0 — tabela ainda não existe (roda ANTES de aplicar 0113 de verdade)
select pg_temp.r113(
  '0 tabela ainda não existe',
  not exists (select 1 from information_schema.tables where table_name = 'integracoes_zoom'),
  'se já existir, este roteiro está rodando DEPOIS da migration — aceitável só para os passos 1-5'
);

-- Cole aqui o corpo de 0113_integracao_zoom_oauth.sql antes de continuar,
-- OU rode este arquivo em sequência logo depois de aplicar 0113 (mesma
-- sessão, mesma transação aberta por este `begin`).

-- passo 1 — singleton: id=2 falha por CHECK
do $$
begin
  begin
    insert into integracoes_zoom (id) values (2);
    perform pg_temp.r113('1 singleton (id=2 deve falhar)', false, 'inseriu id=2 sem erro — CHECK não está funcionando');
  exception when check_violation then
    perform pg_temp.r113('1 singleton (id=2 deve falhar)', true, 'check_violation, como esperado');
  end;
end $$;

-- passo 2 — RLS ligada e forçada
select pg_temp.r113(
  '2 RLS enable+force',
  (select relrowsecurity and relforcerowsecurity from pg_class where relname = 'integracoes_zoom'),
  (select format('relrowsecurity=%s relforcerowsecurity=%s', relrowsecurity, relforcerowsecurity) from pg_class where relname = 'integracoes_zoom')
);

-- passo 3 — authenticated só SELECT
select pg_temp.r113(
  '3 authenticated só SELECT',
  (select array_agg(privilege_type order by privilege_type) from information_schema.role_table_grants
     where table_name = 'integracoes_zoom' and grantee = 'authenticated') = array['SELECT'],
  (select string_agg(privilege_type, ',') from information_schema.role_table_grants
     where table_name = 'integracoes_zoom' and grantee = 'authenticated')
);

-- passo 4 — service_role tem SELECT/INSERT/UPDATE, nunca DELETE
select pg_temp.r113(
  '4 service_role SELECT/INSERT/UPDATE sem DELETE',
  (select array_agg(privilege_type order by privilege_type) from information_schema.role_table_grants
     where table_name = 'integracoes_zoom' and grantee = 'service_role') = array['INSERT','SELECT','UPDATE'],
  (select string_agg(privilege_type, ',') from information_schema.role_table_grants
     where table_name = 'integracoes_zoom' and grantee = 'service_role')
);

-- passo 5 — policy de SELECT usa app.eh_admin()
select pg_temp.r113(
  '5 policy iz_sel usa app.eh_admin()',
  (select pg_get_expr(polqual, polrelid) like '%eh_admin%' from pg_policy
     where polname = 'iz_sel' and polrelid = 'integracoes_zoom'::regclass),
  (select pg_get_expr(polqual, polrelid) from pg_policy
     where polname = 'iz_sel' and polrelid = 'integracoes_zoom'::regclass)
);

select * from resultado_0113 order by ordem;

rollback;
