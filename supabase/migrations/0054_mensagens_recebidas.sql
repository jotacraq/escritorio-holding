-- 0054_mensagens_recebidas.sql
-- Fase 4 · F2 — Chatwoot como caixa de entrada de WhatsApp (ARQUITETURA-FASE-4.md §2.5).
-- Aplicar depois da 0053. Tudo ADITIVO.
--
--   (a) `mensagens_recebidas`: o que o cliente MANDOU (hoje só WhatsApp via
--       Chatwoot; e-mail é fase futura). Idempotente por (provedor, mensagem_externa_id).
--   (b) `mensagens_agendadas` ganha `provedor` e `conversa_externa_id` (por onde saiu).
--   (c) `regua.canal_whatsapp`: "manual" (fila de copiar/colar) | "chatwoot" (envio pela API).
--   (d) RPC `vincular_mensagem_recebida` — "Vincular a uma pessoa" quando o telefone não bate.
--   (e) timeline: mensagem recebida (com jornada) e vínculo feito à mão.

-- ===========================================================================
-- (a) Tabela
-- ===========================================================================
create table mensagens_recebidas (
  id                   uuid primary key default gen_random_uuid(),
  canal                canal_mensagem not null default 'whatsapp',
  provedor             text not null default 'chatwoot' check (provedor in ('chatwoot')),
  conversa_externa_id  text not null,
  mensagem_externa_id  text not null,
  telefone             text,                                   -- E.164 normalizado pelo app; NULL se o contato não tinha
  pessoa_id            uuid references pessoas(id) on delete set null,
  jornada_id           uuid references jornadas(id) on delete set null,
  corpo                text not null,
  anexos               jsonb not null default '[]'::jsonb,
  recebida_em          timestamptz not null,
  bruto                jsonb not null,                         -- payload original do Chatwoot, sempre
  vinculada_por        uuid references perfis_equipe(id),      -- quem fez o vínculo à mão (NULL = casou pelo telefone)
  vinculada_em         timestamptz,
  criado_em            timestamptz not null default now(),
  unique (provedor, mensagem_externa_id)
);
create index idx_mensagens_recebidas_jornada     on mensagens_recebidas (jornada_id, recebida_em desc);
create index idx_mensagens_recebidas_sem_pessoa  on mensagens_recebidas (recebida_em desc) where pessoa_id is null;
create index idx_mensagens_recebidas_conversa    on mensagens_recebidas (provedor, conversa_externa_id, recebida_em desc);

-- RLS: toda a equipe lê; ninguém logado insere (só o webhook, service_role);
-- UPDATE só de pessoa_id/jornada_id/vinculada_* (grant de coluna) — é o "vincular à mão".
revoke all on mensagens_recebidas from anon, authenticated;
alter table mensagens_recebidas enable row level security;
alter table mensagens_recebidas force row level security;
create policy mr_sel on mensagens_recebidas for select to authenticated using ((select app.eh_interno()));
create policy mr_upd on mensagens_recebidas for update to authenticated
  using ((select app.eh_interno())) with check ((select app.eh_interno()));
grant select on mensagens_recebidas to authenticated;
grant update (pessoa_id, jornada_id, vinculada_por, vinculada_em) on mensagens_recebidas to authenticated;

-- ===========================================================================
-- (b) Por onde a mensagem da régua SAIU (NULL = fila manual / Resend sem conversa)
-- ===========================================================================
alter table mensagens_agendadas
  add column provedor text check (provedor in ('resend', 'chatwoot', 'manual')),
  add column conversa_externa_id text;

-- ===========================================================================
-- (c) Canal de saída do WhatsApp
-- ===========================================================================
insert into configuracoes (chave, valor, descricao) values
 ('regua.canal_whatsapp', '"manual"'::jsonb,
  'Como o WhatsApp da régua sai: "manual" (copiar, abrir no WhatsApp, marcar enviada) ou "chatwoot" (API; exige CHATWOOT_URL, CHATWOOT_ACCOUNT_ID, CHATWOOT_API_TOKEN, CHATWOOT_INBOX_ID).')
on conflict (chave) do nothing;

-- ===========================================================================
-- (d) Vincular à mão. A jornada é derivada: a ABERTA da pessoa (invariante da
-- 0004: no máximo uma). Sem jornada aberta, fica só a pessoa.
-- Devolve a linha atualizada. P0002 se a mensagem ou a pessoa não existem.
-- ===========================================================================
create or replace function public.vincular_mensagem_recebida(p_mensagem_id uuid, p_pessoa_id uuid)
returns mensagens_recebidas
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_perfil uuid; v_jornada uuid; v_row mensagens_recebidas;
begin
  select id into v_perfil from perfis_equipe where auth_user_id = auth.uid() and ativo;
  if v_perfil is null and auth.uid() is not null then
    raise exception 'sem_permissao: sem convite ativo na equipe' using errcode = '42501';
  end if;
  if not exists (select 1 from pessoas where id = p_pessoa_id) then
    raise exception 'pessoa_invalida: pessoa nao encontrada' using errcode = 'P0002';
  end if;
  select id into v_jornada from jornadas where pessoa_id = p_pessoa_id and desfecho = 'aberta';

  update mensagens_recebidas
     set pessoa_id = p_pessoa_id, jornada_id = v_jornada, vinculada_por = v_perfil, vinculada_em = now()
   where id = p_mensagem_id
  returning * into v_row;
  if not found then
    raise exception 'mensagem_invalida: mensagem nao encontrada' using errcode = 'P0002';
  end if;
  return v_row;
end $$;
revoke execute on function public.vincular_mensagem_recebida(uuid, uuid) from public, anon;
grant  execute on function public.vincular_mensagem_recebida(uuid, uuid) to authenticated, service_role;

-- ===========================================================================
-- (e) Timeline
-- ===========================================================================
create or replace function app.timeline_mensagem_recebida() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.jornada_id is null then return new; end if;
    perform app.registrar_evento_timeline(new.jornada_id, 'mensagem',
      'Mensagem recebida (' || new.canal::text || ')', left(new.corpo, 280),
      jsonb_build_object('mensagem_recebida_id', new.id, 'canal', new.canal, 'provedor', new.provedor,
                         'conversa_externa_id', new.conversa_externa_id, 'direcao', 'recebida'));
  elsif tg_op = 'UPDATE' and old.jornada_id is null and new.jornada_id is not null then
    perform app.registrar_evento_timeline(new.jornada_id, 'mensagem',
      'Mensagem recebida vinculada à jornada (' || new.canal::text || ')', left(new.corpo, 280),
      jsonb_build_object('mensagem_recebida_id', new.id, 'canal', new.canal, 'provedor', new.provedor,
                         'conversa_externa_id', new.conversa_externa_id, 'direcao', 'recebida', 'vinculo', 'manual'));
  end if;
  return new;
end $$;
create trigger trg_timeline_mensagem_recebida after insert or update on mensagens_recebidas
for each row execute function app.timeline_mensagem_recebida();

-- ===========================================================================
-- ROTEIRO DE VERIFICAÇÃO:
--  1. Como `relacionamento`: `select * from mensagens_recebidas` → ok (0 linhas);
--     `insert ...` → 42501; `update mensagens_recebidas set corpo='x'` → 42501 (coluna sem grant).
--  2. Como service_role: inserir uma recebida com telefone de uma pessoa existente e
--     `pessoa_id`/`jornada_id` resolvidos → timeline da jornada ganha "Mensagem recebida (whatsapp)".
--     Inserir de novo com a MESMA mensagem_externa_id → 23505 (idempotência).
--  3. Inserir uma recebida sem pessoa → aparece em `where pessoa_id is null` (índice parcial);
--     como `relacionamento`: `select vincular_mensagem_recebida(<id>, <pessoa>)` → pessoa_id,
--     jornada_id (aberta da pessoa), vinculada_por preenchidos; timeline "vinculada à jornada".
--  4. `select valor from configuracoes where chave='regua.canal_whatsapp'` → "manual".
--  5. `\d mensagens_agendadas` → colunas provedor, conversa_externa_id presentes, NULL nas antigas.
--
-- REVERSÃO: drop trigger trg_timeline_mensagem_recebida on mensagens_recebidas;
--   drop function app.timeline_mensagem_recebida(), public.vincular_mensagem_recebida(uuid,uuid);
--   drop table mensagens_recebidas; alter table mensagens_agendadas drop column provedor,
--   drop column conversa_externa_id; delete from configuracoes where chave='regua.canal_whatsapp'.
-- ===========================================================================
