-- 0046 — log de erro de servidor consultável. APLICADA.
--
-- Por que existe: até aqui todo 500 ia só para o stdout do Node App da
-- Hostinger, que não é acessível de fora do painel. Duas vezes isso custou
-- horas: o formulário público em 500 (a causa real era um CHECK antigo, e a
-- hipótese plausível de permissão consumiu uma correção inteira no lugar
-- errado) e a geração de briefing. Sem o erro real sobra adivinhação — e
-- adivinhação que casa com um padrão conhecido é a pior, porque parece
-- diagnóstico.
--
-- O id gravado aqui é o MESMO `id_erro` devolvido ao cliente.
-- Escrita: `persistirErro()` em src/server/erros.ts (service_role, fire-and-forget).

create table if not exists erros_servidor (
  id           uuid primary key,
  contexto     text not null,
  nome         text,
  mensagem     text,
  pilha        text,
  extra        jsonb,
  perfil_id    uuid references perfis_equipe(id) on delete set null,
  ocorrido_em  timestamptz not null default now()
);

create index if not exists idx_erros_servidor_ocorrido_em on erros_servidor (ocorrido_em desc);
create index if not exists idx_erros_servidor_contexto on erros_servidor (contexto, ocorrido_em desc);

comment on table erros_servidor is
  'Erro de servidor com o mesmo id devolvido ao cliente. PODE CONTER PII em `extra` e `mensagem` '
  '(id de jornada, e-mail, trecho de payload) — por isso é admin-only e tem expurgo por retenção. '
  'Não é auditoria: auditoria é a timeline. Isto é diagnóstico de falha.';
comment on column erros_servidor.extra is
  'Contexto extra passado por registrarErro(). Nunca colocar segredo aqui — chave, token ou senha não entram.';

alter table erros_servidor enable row level security;
alter table erros_servidor force row level security;

-- Só admin lê. Ninguém escreve pelo PostgREST: a escrita é do service_role,
-- que passa por cima da RLS. Sem política de insert/update/delete de
-- propósito — erro não se edita, e o cliente não forja linha de log.
drop policy if exists erros_servidor_admin_le on erros_servidor;
create policy erros_servidor_admin_le on erros_servidor
  for select to authenticated
  using (app.papel() = 'admin');

revoke all on erros_servidor from anon, authenticated;
grant select on erros_servidor to authenticated;

-- Retenção de 90 dias. Log de erro velho não diagnostica nada e só acumula PII.
create or replace function public.expurgar_erros_servidor(p_dias int default 90)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_apagados int;
begin
  delete from erros_servidor where ocorrido_em < now() - make_interval(days => p_dias);
  get diagnostics v_apagados = row_count;
  return v_apagados;
end $$;

revoke execute on function public.expurgar_erros_servidor(int) from public, anon, authenticated;
grant  execute on function public.expurgar_erros_servidor(int) to service_role;
