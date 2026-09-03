-- 0013_regua_mensagens.sql
-- Régua de comunicação: templates versionados e fila de mensagens agendadas.
-- O disparo é feito por cron externo da Hostinger chamando POST /api/cron/regua
-- (ver ARQUITETURA.md §5) — este arquivo só cria o dado; nenhum pg_cron aqui.

create table mensagens_templates (
  id        uuid primary key default gen_random_uuid(),
  chave     text not null,             -- 'boas_vindas' | 'confirmacao_d7' | 'dia_da_sessao' | 'pos_sessao'
  canal     canal_mensagem not null,
  versao    smallint not null,
  assunto   text,                       -- só e-mail
  corpo     text not null,              -- mustache: {{nome}}, {{data_sessao}}, {{link_sala}}
  ativo     boolean not null default false,
  criado_em timestamptz not null default now(),
  unique (chave, canal, versao)
);
create unique index uniq_template_ativo on mensagens_templates (chave, canal) where ativo;

create table mensagens_agendadas (
  id                    uuid primary key default gen_random_uuid(),
  jornada_id            uuid not null references jornadas(id) on delete cascade,
  agendamento_id        uuid references agendamentos(id) on delete cascade, -- D-7 e dia da sessão
  template_id           uuid not null references mensagens_templates(id),
  canal                 canal_mensagem not null,
  destinatario          text not null,   -- e-mail ou telefone E.164
  agendada_para         timestamptz not null,
  status                status_mensagem not null default 'pendente',
  -- INVARIANTE de idempotência: a mesma régua nunca dispara duas vezes para o mesmo alvo.
  chave_idempotencia    text not null unique,  -- '{jornada_id}:{chave_template}:{agendamento_id|-}'
  tentativas            smallint not null default 0,
  proxima_tentativa_em  timestamptz,
  assunto_renderizado   text,            -- só e-mail; congelado no enfileiramento
  corpo_renderizado     text,            -- congelado no momento do envio (prova do que foi mandado)
  provedor_id           text,            -- id do Resend / do provedor
  erro                  text,
  enviada_em            timestamptz,
  marcada_manual_por    uuid references perfis_equipe(id), -- fila manual de WhatsApp
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);
create index idx_mensagens_fila on mensagens_agendadas (agendada_para) where status = 'pendente';
create index idx_mensagens_jornada on mensagens_agendadas (jornada_id, agendada_para desc);
create index idx_mensagens_agendamento on mensagens_agendadas (agendamento_id) where status = 'pendente';

create trigger trg_mensagens_atualizado_em before update on mensagens_agendadas
for each row execute function app.set_atualizado_em();

-- ===========================================================================
-- Motor da régua: 100% no banco, para não depender de qual rota (desta ou de
-- outro agente) altera pagamentos/agendamentos/sessão. É o mesmo princípio já
-- usado em jornadas (trigger de máquina de estados) e pagamentos (nivel_pago).
-- ===========================================================================

-- Helper genérico: renderiza o template ativo do canal e insere na fila,
-- idempotente por chave_idempotencia (ON CONFLICT DO NOTHING). Nunca enfileira
-- sem destinatário, e nunca falha se o template ainda não existir/estiver
-- inativo — vira pendência de configuração, não erro de trigger.
create or replace function app.enfileirar_mensagem(
  p_jornada_id uuid, p_agendamento_id uuid, p_chave_template text, p_canal canal_mensagem,
  p_destinatario text, p_agendada_para timestamptz,
  p_nome text, p_data_sessao text, p_link_sala text
) returns void
language plpgsql as $$
declare v_template mensagens_templates%rowtype; v_corpo text; v_assunto text; v_chave text;
begin
  if p_destinatario is null or length(trim(p_destinatario)) = 0 then
    return;
  end if;
  select * into v_template from mensagens_templates
   where chave = p_chave_template and canal = p_canal and ativo
   limit 1;
  if v_template.id is null then
    return;
  end if;
  v_corpo := replace(replace(replace(v_template.corpo,
               '{{nome}}', coalesce(p_nome, '')),
               '{{data_sessao}}', coalesce(p_data_sessao, '')),
               '{{link_sala}}', coalesce(p_link_sala, ''));
  v_assunto := replace(replace(replace(coalesce(v_template.assunto, ''),
               '{{nome}}', coalesce(p_nome, '')),
               '{{data_sessao}}', coalesce(p_data_sessao, '')),
               '{{link_sala}}', coalesce(p_link_sala, ''));
  v_chave := p_jornada_id::text || ':' || p_chave_template || ':' || coalesce(p_agendamento_id::text, '-');
  insert into mensagens_agendadas (jornada_id, agendamento_id, template_id, canal, destinatario,
                                   agendada_para, chave_idempotencia, assunto_renderizado, corpo_renderizado)
  values (p_jornada_id, p_agendamento_id, v_template.id, p_canal, p_destinatario,
          p_agendada_para, v_chave, nullif(v_assunto, ''), v_corpo)
  on conflict (chave_idempotencia) do nothing;
end $$;
revoke execute on function app.enfileirar_mensagem from public, anon, authenticated;

-- Régua D-7 e "dia da sessão": dispara ao criar/confirmar um agendamento.
-- Remarcação/cancelamento cancela a fila PENDENTE do slot antigo — mensagem já
-- ENVIADA nunca é apagada (é histórico). Reagendar gera chave_idempotencia nova
-- (o agendamento_id muda), então nada impede reenviar para o slot novo — exceto
-- a regra explícita abaixo: D-7 que já passou não é reenviado.
create or replace function app.regua_agendamento() returns trigger
language plpgsql as $$
declare v_jornada_id uuid; v_pessoa record; v_link text;
begin
  if tg_op = 'UPDATE' and (
       new.inicio_em is distinct from old.inicio_em or new.status in ('cancelado','remarcado')
     ) then
    update mensagens_agendadas set status = 'cancelada'
     where agendamento_id = old.id and status = 'pendente';
  end if;

  if new.status not in ('agendado','confirmado') then
    return new;
  end if;

  select s.jornada_id, s.link_sala into v_jornada_id, v_link
    from sessoes_viabilidade s where s.id = new.sessao_id;
  if v_jornada_id is null then
    return new;
  end if;

  select p.nome, p.email, p.telefone into v_pessoa
    from jornadas j join pessoas p on p.id = j.pessoa_id
   where j.id = v_jornada_id;

  if new.inicio_em - interval '7 days' > now() then
    perform app.enfileirar_mensagem(v_jornada_id, new.id, 'confirmacao_d7',
      case when v_pessoa.telefone is not null then 'whatsapp'::canal_mensagem else 'email'::canal_mensagem end,
      coalesce(v_pessoa.telefone, v_pessoa.email), new.inicio_em - interval '7 days',
      v_pessoa.nome, to_char(new.inicio_em, 'DD/MM/YYYY HH24:MI'), v_link);
  end if;

  perform app.enfileirar_mensagem(v_jornada_id, new.id, 'dia_da_sessao', 'email',
    v_pessoa.email, new.inicio_em - interval '10 minutes',
    v_pessoa.nome, to_char(new.inicio_em, 'DD/MM/YYYY HH24:MI'), v_link);

  return new;
end $$;
create trigger trg_regua_agendamento after insert or update on agendamentos
for each row execute function app.regua_agendamento();

-- Pós-sessão: dispara 2h depois de a sessão passar a `realizada_em` preenchido
-- (só no instante da transição NULL -> valor, nunca de novo em updates seguintes).
create or replace function app.regua_pos_sessao() returns trigger
language plpgsql as $$
declare v_pessoa record;
begin
  if new.realizada_em is null or old.realizada_em is not null then
    return new;
  end if;
  select p.nome, p.email into v_pessoa
    from jornadas j join pessoas p on p.id = j.pessoa_id
   where j.id = new.jornada_id;
  perform app.enfileirar_mensagem(new.jornada_id, null, 'pos_sessao', 'email',
    v_pessoa.email, new.realizada_em + interval '2 hours', v_pessoa.nome, null, null);
  return new;
end $$;
create trigger trg_regua_pos_sessao after update on sessoes_viabilidade
for each row execute function app.regua_pos_sessao();

-- Reivindicação segura da fila (§5.2). Só canal 'email' — WhatsApp é fila manual,
-- nunca disparo automático (a advogada/relacionamento marca "enviei à mão" pela
-- tela, nunca o cron). Em public (não app) para ser chamável via `.rpc()` a
-- partir de POST /api/cron/regua.
create or replace function public.reivindicar_mensagens_pendentes(p_limite int default 50)
returns setof mensagens_agendadas
language sql as $$
  update mensagens_agendadas m set status = 'enviando', tentativas = tentativas + 1
   where m.id in (
     select id from mensagens_agendadas
      where status = 'pendente' and canal = 'email' and agendada_para <= now()
        and (proxima_tentativa_em is null or proxima_tentativa_em <= now())
      order by agendada_para
      for update skip locked
      limit greatest(p_limite, 0))
  returning *;
$$;
revoke execute on function public.reivindicar_mensagens_pendentes from public, anon, authenticated;
grant  execute on function public.reivindicar_mensagens_pendentes to service_role;

alter table mensagens_templates enable row level security;
alter table mensagens_templates force row level security;
alter table mensagens_agendadas enable row level security;
alter table mensagens_agendadas force row level security;

create policy mt_sel on mensagens_templates for select to authenticated using ((select app.eh_interno()));
create policy mt_wr  on mensagens_templates for all to authenticated
  using ((select app.eh_admin())) with check ((select app.eh_admin()));
create policy ma_sel on mensagens_agendadas for select to authenticated using ((select app.eh_interno()));
-- A fila manual de WhatsApp precisa marcar "enviei à mão" — update de status/enviada_em/
-- marcada_manual_por é permitido pra equipe interna; criação e envio automático via
-- service_role (rota de cron), nunca INSERT direto do cliente.
create policy ma_upd on mensagens_agendadas for update to authenticated
  using ((select app.eh_interno())) with check ((select app.eh_interno()));

-- ===========================================================================
-- Seed de produção (não é dado de demo): v1 dos templates das 4 réguas (§5.3).
-- Trocar de versão daqui pra frente é INSERT + ativar, nunca migration nova.
-- ===========================================================================

insert into mensagens_templates (chave, canal, versao, assunto, corpo, ativo) values
 ('boas_vindas', 'email', 1, 'Sua Sessão de Viabilidade — próximos passos',
  $t$Olá, {{nome}}.

Recebemos sua contratação da Sessão de Viabilidade. Em breve nossa equipe entra em
contato para o agendamento.

Qualquer dúvida, responda este e-mail.

Equipe Time Holding Brasil$t$, true),
 ('boas_vindas', 'whatsapp', 1, null,
  $t$Olá, {{nome}}! Recebemos sua contratação da Sessão de Viabilidade. Em breve
nossa equipe entra em contato para o agendamento. Qualquer dúvida, é só chamar por
aqui.$t$, true),
 ('confirmacao_d7', 'whatsapp', 1, null,
  $t$Olá, {{nome}}! Passando para confirmar sua Sessão de Viabilidade no dia
{{data_sessao}}. Você confirma presença?$t$, true),
 ('confirmacao_d7', 'email', 1, 'Confirmação da sua Sessão de Viabilidade',
  $t$Olá, {{nome}}.

Passando para confirmar sua Sessão de Viabilidade no dia {{data_sessao}}.

Por favor, responda confirmando sua presença.

Equipe Time Holding Brasil$t$, true),
 ('dia_da_sessao', 'email', 1, 'Sua Sessão de Viabilidade é hoje',
  $t$Olá, {{nome}}.

Sua Sessão de Viabilidade é hoje, {{data_sessao}}. A sala já está disponível:

{{link_sala}}

Até já.

Equipe Time Holding Brasil$t$, true),
 ('pos_sessao', 'email', 1, 'Obrigado pela Sessão de Viabilidade',
  $t$Olá, {{nome}}.

Obrigado por participar da sua Sessão de Viabilidade. Ficamos à disposição para
qualquer dúvida sobre os próximos passos.

Equipe Time Holding Brasil$t$, true);
