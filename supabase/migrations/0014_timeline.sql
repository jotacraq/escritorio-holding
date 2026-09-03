-- 0014_timeline.sql
-- Uma linha do tempo só, alimentada por trigger. É o que faz a Ficha 360 ser uma
-- consulta, e não N consultas costuradas no front. Roda depois de 0009-0013 de propósito:
-- por essa altura todas as tabelas de entidade (briefings, croquis, documentos,
-- pagamentos, mensagens_agendadas) já existem, e esta migration pode ligar trigger nelas
-- sem precisar que o dono daquelas tabelas conheça o schema da timeline.

create table eventos_timeline (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid not null references jornadas(id) on delete cascade,
  tipo text not null,        -- 'etapa','pagamento','formulario','ligacao','briefing','agendamento',
                             -- 'documento','mensagem','croqui','patrimonio','familia','relatorio','nota'
  titulo text not null,
  descricao text,
  dados jsonb not null default '{}'::jsonb,
  ator_perfil_id uuid references perfis_equipe(id),
  ator_tipo text not null default 'humano' check (ator_tipo in ('humano','sistema','ia')),
  ocorrido_em timestamptz not null default now()
);
create index idx_timeline_jornada on eventos_timeline (jornada_id, ocorrido_em desc);

alter table eventos_timeline enable row level security;
alter table eventos_timeline force row level security;
create policy tl_sel on eventos_timeline for select to authenticated using ((select app.eh_interno()));
create policy tl_ins on eventos_timeline for insert to authenticated with check ((select app.eh_interno()));
-- append-only: sem update, sem delete.

-- Helper comum: quem chama já foi filtrado pela policy da tabela de origem
-- (equipe interna) ou é service_role (que ignora RLS). Não precisamos de
-- SECURITY DEFINER aqui — a policy tl_ins já libera qualquer `eh_interno()`.
create or replace function app.registrar_evento_timeline(
  p_jornada_id uuid, p_tipo text, p_titulo text, p_descricao text, p_dados jsonb
) returns void language plpgsql as $$
begin
  if p_jornada_id is null then
    return; -- sem jornada não há onde pendurar o evento; não inventamos uma
  end if;
  insert into eventos_timeline (jornada_id, tipo, titulo, descricao, dados, ator_perfil_id)
  values (p_jornada_id, p_tipo, p_titulo, p_descricao, coalesce(p_dados, '{}'::jsonb),
          (select id from perfis_equipe where auth_user_id = auth.uid()));
end $$;

-- 1) etapa/desfecho da jornada
create or replace function app.timeline_jornada() returns trigger
language plpgsql as $$
begin
  if new.etapa is distinct from old.etapa then
    perform app.registrar_evento_timeline(new.id, 'etapa',
      'Etapa: ' || old.etapa::text || ' → ' || new.etapa::text, null,
      jsonb_build_object('de', old.etapa, 'para', new.etapa));
  end if;
  if new.desfecho is distinct from old.desfecho then
    perform app.registrar_evento_timeline(new.id, 'etapa',
      'Desfecho: ' || new.desfecho::text, new.motivo_desfecho,
      jsonb_build_object('de', old.desfecho, 'para', new.desfecho));
  end if;
  return new;
end $$;
create trigger trg_timeline_jornada after update on jornadas
for each row execute function app.timeline_jornada();

-- 2) formulário estratégico (POP 02)
create or replace function app.timeline_formulario() returns trigger
language plpgsql as $$
begin
  perform app.registrar_evento_timeline(new.jornada_id, 'formulario',
    case when TG_OP = 'INSERT' then 'Formulário estratégico respondido' else 'Formulário estratégico atualizado' end,
    null, jsonb_build_object('formulario_id', new.formulario_id));
  return new;
end $$;
create trigger trg_timeline_formulario after insert or update on formularios_respostas
for each row execute function app.timeline_formulario();

-- 3) ligação estratégica (POP 03 / 03-B)
create or replace function app.timeline_ligacao() returns trigger
language plpgsql as $$
begin
  perform app.registrar_evento_timeline(new.jornada_id, 'ligacao',
    'Ligação estratégica registrada (POP ' || new.pop || ')', null,
    jsonb_build_object('ligacao_id', new.id));
  return new;
end $$;
create trigger trg_timeline_ligacao after insert on ligacoes_estrategicas
for each row execute function app.timeline_ligacao();

-- 4) patrimônio declarado (PII sensível — a timeline registra o EVENTO, não o valor)
create or replace function app.timeline_patrimonio() returns trigger
language plpgsql as $$
begin
  perform app.registrar_evento_timeline(new.registrado_na_jornada_id, 'patrimonio',
    'Item de patrimônio registrado: ' || new.tipo::text, null,
    jsonb_build_object('patrimonio_id', new.id, 'tipo', new.tipo));
  return new;
end $$;
create trigger trg_timeline_patrimonio after insert on patrimonio_itens
for each row execute function app.timeline_patrimonio();

-- 5) composição familiar
create or replace function app.timeline_familiar() returns trigger
language plpgsql as $$
begin
  perform app.registrar_evento_timeline(new.registrado_na_jornada_id, 'familia',
    'Familiar registrado: ' || new.parentesco, null,
    jsonb_build_object('familiar_id', new.id));
  return new;
end $$;
create trigger trg_timeline_familiar after insert on familiares
for each row execute function app.timeline_familiar();

-- 6) agendamento (via sessoes_viabilidade -> jornada)
create or replace function app.timeline_agendamento() returns trigger
language plpgsql as $$
declare v_jornada_id uuid;
begin
  select s.jornada_id into v_jornada_id from sessoes_viabilidade s where s.id = new.sessao_id;
  perform app.registrar_evento_timeline(v_jornada_id, 'agendamento',
    case
      when TG_OP = 'INSERT' then 'Sessão agendada para ' || to_char(new.inicio_em, 'DD/MM/YYYY HH24:MI')
      else 'Agendamento atualizado: ' || new.status::text
    end,
    new.observacoes,
    jsonb_build_object('agendamento_id', new.id, 'status', new.status, 'inicio_em', new.inicio_em));
  return new;
end $$;
create trigger trg_timeline_agendamento after insert or update on agendamentos
for each row execute function app.timeline_agendamento();

-- 7) relatório da Sessão de Viabilidade (via sessoes_viabilidade -> jornada)
create or replace function app.timeline_relatorio() returns trigger
language plpgsql as $$
declare v_jornada_id uuid;
begin
  select s.jornada_id into v_jornada_id from sessoes_viabilidade s where s.id = new.sessao_id;
  perform app.registrar_evento_timeline(v_jornada_id, 'relatorio',
    case when TG_OP = 'INSERT' then 'Relatório da Sessão de Viabilidade preenchido' else 'Relatório da Sessão de Viabilidade atualizado' end,
    null, jsonb_build_object('relatorio_id', new.id));
  return new;
end $$;
create trigger trg_timeline_relatorio after insert or update on relatorios_sessao
for each row execute function app.timeline_relatorio();

-- 8) pagamento (Hotmart) — grava mesmo sem jornada_id resolvida ainda (helper ignora nesse caso)
create or replace function app.timeline_pagamento() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if TG_OP = 'INSERT' or old.status is distinct from new.status then
    perform app.registrar_evento_timeline(new.jornada_id, 'pagamento',
      'Pagamento ' || new.status::text || (case when new.valor is not null then ' — R$ ' || new.valor::text else '' end),
      null, jsonb_build_object('pagamento_id', new.id, 'status', new.status, 'produto_id', new.produto_id));
  end if;
  return new;
end $$;
create trigger trg_timeline_pagamento after insert or update on pagamentos
for each row execute function app.timeline_pagamento();

-- 9) briefing estratégico (gerado pela rota de servidor com service_role)
create or replace function app.timeline_briefing() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.registrar_evento_timeline(new.jornada_id, 'briefing',
    'Briefing Estratégico gerado (v' || new.versao || ')', null,
    jsonb_build_object('briefing_id', new.id, 'grau_confianca', new.grau_confianca));
  return new;
end $$;
create trigger trg_timeline_briefing after insert on briefings
for each row execute function app.timeline_briefing();

-- 10) croqui estrutural
create or replace function app.timeline_croqui() returns trigger
language plpgsql as $$
begin
  if TG_OP = 'INSERT' or old.status is distinct from new.status then
    perform app.registrar_evento_timeline(new.jornada_id, 'croqui',
      'Croqui ' || new.status::text || ' (v' || new.versao || ')', null,
      jsonb_build_object('croqui_id', new.id, 'status', new.status));
  end if;
  return new;
end $$;
create trigger trg_timeline_croqui after insert or update on croquis
for each row execute function app.timeline_croqui();

-- 11) documento (metadado só — nunca o conteúdo)
create or replace function app.timeline_documento() returns trigger
language plpgsql as $$
begin
  perform app.registrar_evento_timeline(new.jornada_id, 'documento',
    'Documento enviado: ' || new.tipo, null,
    jsonb_build_object('documento_id', new.id, 'tipo', new.tipo));
  return new;
end $$;
create trigger trg_timeline_documento after insert on documentos
for each row execute function app.timeline_documento();

-- 12) mensagem da régua (só quando sai do estado pendente/enviando)
create or replace function app.timeline_mensagem() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status is distinct from old.status and new.status in ('enviada','falhou','cancelada') then
    perform app.registrar_evento_timeline(new.jornada_id, 'mensagem',
      'Mensagem ' || new.status::text || ' (' || new.canal::text || ')', new.erro,
      jsonb_build_object('mensagem_id', new.id, 'status', new.status, 'canal', new.canal));
  end if;
  return new;
end $$;
create trigger trg_timeline_mensagem after update on mensagens_agendadas
for each row execute function app.timeline_mensagem();
