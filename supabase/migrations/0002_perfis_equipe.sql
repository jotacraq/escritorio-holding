-- 0002_perfis_equipe.sql
-- A EQUIPE (admin, advogada, relacionamento, assistente). Acesso é por CONVITE:
-- não existe trigger em auth.users criando linha aqui. Ver nota crítica abaixo.

create table perfis_equipe (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique references auth.users(id) on delete set null, -- NULL = convidado ainda não logou
  email         text not null,
  nome          text not null,
  papel         papel_equipe not null,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  criado_por    uuid references perfis_equipe(id)
);
create unique index uniq_perfis_equipe_email on perfis_equipe (lower(email));

create trigger trg_perfis_equipe_atualizado_em before update on perfis_equipe
for each row execute function app.set_atualizado_em();

alter table perfis_equipe enable row level security;
alter table perfis_equipe force row level security;  -- vale até para o dono da tabela

create policy pe_select on perfis_equipe for select to authenticated
  using ((select app.eh_interno()));
create policy pe_admin_write on perfis_equipe for all to authenticated
  using ((select app.eh_admin())) with check ((select app.eh_admin()));

-- NOTA CRÍTICA: NÃO criar trigger on auth.users que insira em perfis_equipe.
-- O acesso é por CONVITE: o admin cria a linha com o e-mail ANTES; ao primeiro login,
-- a rota /api/auth/vincular casa auth.uid() com a linha pré-autorizada (por e-mail).
-- Quem se cadastra sem convite fica com app.papel() = NULL e a RLS nega tudo. Fail-closed.
create or replace function app.vincular_perfil() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.perfis_equipe
     set auth_user_id = auth.uid(), atualizado_em = now()
   where auth_user_id is null
     and lower(email) = lower((select email from auth.users where id = auth.uid()))
     and ativo;
end $$;

revoke execute on function app.vincular_perfil() from public, anon;
grant  execute on function app.vincular_perfil() to authenticated;

-- NOTA (PostgREST): o schema `app` não é exposto por padrão para `.rpc()` do
-- supabase-js (só `public` é exposto sem mudar config de projeto no painel, que
-- este agente não tem como aplicar). Em vez de depender de mudança manual de
-- "Exposed schemas", expomos um wrapper fino em `public`, chamado pela rota
-- `POST /api/auth/vincular` via `supabase.rpc('vincular_perfil')`.
create or replace function public.vincular_perfil() returns void
language sql security invoker set search_path = public, pg_temp as $$
  select app.vincular_perfil()
$$;

revoke execute on function public.vincular_perfil() from public, anon;
grant  execute on function public.vincular_perfil() to authenticated;
