-- 0004_jornadas_transicoes.sql
-- A esteira: jornadas + máquina de estados. Ordem das etapas e transições permitidas
-- são DADO (tabela), não `if` no código — adicionar/reordenar etapa é INSERT, não deploy.

create table etapas_jornada_ordem (
  etapa  etapa_jornada primary key,
  ordem  smallint not null unique,
  rotulo text not null,
  cor    text not null default 'slate'
);
insert into etapas_jornada_ordem (etapa, ordem, rotulo) values
 ('captado',10,'Captado'), ('qualificado',20,'Qualificado (MQL)'),
 ('sessao_contratada',30,'Sessão paga'), ('sessao_agendada',40,'Sessão agendada'),
 ('sessao_realizada',50,'Sessão realizada'), ('croqui_contratado',60,'Croqui pago'),
 ('croqui_apresentado',70,'Croqui apresentado'), ('holding_contratada',80,'Holding contratada');

create table transicoes_permitidas (
  de etapa_jornada not null, para etapa_jornada not null,
  primary key (de, para)
);
insert into transicoes_permitidas (de, para) values
 ('captado','qualificado'), ('captado','sessao_contratada'), ('qualificado','sessao_contratada'),
 ('sessao_contratada','sessao_agendada'), ('sessao_agendada','sessao_realizada'),
 ('sessao_realizada','croqui_contratado'), ('croqui_contratado','croqui_apresentado'),
 ('croqui_apresentado','holding_contratada');

create table jornadas (
  id         uuid primary key default gen_random_uuid(),
  pessoa_id  uuid not null references pessoas(id) on delete restrict,
  edicao_id  uuid references edicoes_seminario(id) on delete restrict, -- NULL quando origem <> seminário
  origem     origem_lead not null default 'seminario',
  trilha     trilha_jornada not null default 'seminario',              -- POP 03 x POP 03-B
  etapa      etapa_jornada  not null default 'captado',
  desfecho   desfecho_jornada not null default 'aberta',
  motivo_desfecho text,
  -- nivel_pago: 0 nada, 1 sessão, 2 croqui, 3 holding. Mantido por trigger a partir de pagamentos (0011).
  nivel_pago smallint not null default 0 check (nivel_pago between 0 and 3),
  -- Faixa DECLARADA (POP 02 P9). É o único dado patrimonial que a equipe toda enxerga.
  faixa_patrimonio_declarada text,
  responsavel_id uuid references perfis_equipe(id),   -- quem cuida do relacionamento
  -- Carimbo de dado fictício de seed (0016). A UI usa isto para marcar a linha na tela.
  origem_dado text not null default 'real' check (origem_dado in ('real','exemplo')),
  entrou_na_etapa_em timestamptz not null default now(),
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  criado_por uuid references perfis_equipe(id), atualizado_por uuid references perfis_equipe(id),
  constraint ck_desfecho_motivo check (desfecho = 'aberta' or motivo_desfecho is not null),
  constraint ck_edicao_por_origem check (origem <> 'seminario' or edicao_id is not null)
);

-- INVARIANTE FORTE: uma pessoa tem no máximo UMA jornada aberta.
-- Quem volta numa edição nova só entra depois que a anterior for fechada com motivo.
create unique index uniq_jornada_aberta_por_pessoa
  on jornadas (pessoa_id) where desfecho = 'aberta';

create index idx_jornadas_kanban on jornadas (etapa, edicao_id) where desfecho = 'aberta';
create index idx_jornadas_pessoa on jornadas (pessoa_id);
create index idx_jornadas_resp   on jornadas (responsavel_id) where desfecho = 'aberta';

create table jornadas_transicoes (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid not null references jornadas(id) on delete cascade,
  de_etapa etapa_jornada, para_etapa etapa_jornada,
  de_desfecho desfecho_jornada, para_desfecho desfecho_jornada,
  motivo text,
  ator_perfil_id uuid references perfis_equipe(id),
  ator_tipo text not null default 'humano' check (ator_tipo in ('humano','sistema','ia')),
  ocorrido_em timestamptz not null default now()
);
create index idx_transicoes_jornada on jornadas_transicoes (jornada_id, ocorrido_em desc);

-- Trigger da máquina de estados. Mensagens de erro genéricas de propósito:
-- exceção em trigger BEFORE fala antes da RLS filtrar e não pode virar oráculo de existência.
create or replace function app.valida_transicao_jornada() returns trigger
language plpgsql as $$
declare ord_novo smallint; ord_velho smallint; piso smallint;
begin
  if new.etapa <> old.etapa then
    select ordem into ord_novo  from etapas_jornada_ordem where etapa = new.etapa;
    select ordem into ord_velho from etapas_jornada_ordem where etapa = old.etapa;
    if ord_novo < ord_velho then
      raise exception 'transicao_invalida: etapa nao regride' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from transicoes_permitidas where de = old.etapa and para = new.etapa) then
      raise exception 'transicao_invalida' using errcode = 'check_violation';
    end if;
  end if;
  -- piso por dinheiro: pagamento aprovado trava a etapa mínima. Estorno NÃO rebaixa.
  piso := case new.nivel_pago when 1 then 30 when 2 then 60 when 3 then 80 else 0 end;
  select ordem into ord_novo from etapas_jornada_ordem where etapa = new.etapa;
  if ord_novo < piso then
    raise exception 'transicao_invalida: abaixo do nivel pago' using errcode = 'check_violation';
  end if;
  if new.etapa = 'holding_contratada' and new.desfecho = 'aberta' then
    new.desfecho := 'ganha'; new.motivo_desfecho := coalesce(new.motivo_desfecho,'Holding contratada');
  end if;
  if new.etapa <> old.etapa then new.entrou_na_etapa_em := now(); end if;
  new.atualizado_em := now();
  return new;
end $$;

create trigger trg_valida_transicao before update on jornadas
for each row execute function app.valida_transicao_jornada();

-- NOTA DE CORREÇÃO (backend-engineer): jornadas_transicoes é append-only e não tem
-- policy de INSERT para `authenticated` (de propósito — ninguém deve inserir daí de fora
-- do fluxo de transição). Sem SECURITY DEFINER aqui, o INSERT do trigger seria bloqueado
-- pela própria RLS que protege a tabela, e toda transição de etapa quebraria em produção.
create or replace function app.registra_transicao_jornada() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.etapa is distinct from old.etapa or new.desfecho is distinct from old.desfecho then
    insert into jornadas_transicoes (jornada_id, de_etapa, para_etapa, de_desfecho, para_desfecho,
                                     motivo, ator_perfil_id)
    values (new.id, old.etapa, new.etapa, old.desfecho, new.desfecho, new.motivo_desfecho,
            (select id from perfis_equipe where auth_user_id = auth.uid()));
  end if;
  return new;
end $$;
create trigger trg_registra_transicao after update on jornadas
for each row execute function app.registra_transicao_jornada();

alter table jornadas enable row level security;
alter table jornadas_transicoes enable row level security;
alter table etapas_jornada_ordem enable row level security;
alter table transicoes_permitidas enable row level security;
alter table jornadas force row level security;
alter table jornadas_transicoes force row level security;
alter table etapas_jornada_ordem force row level security;
alter table transicoes_permitidas force row level security;

create policy jor_sel on jornadas for select to authenticated using ((select app.eh_interno()));
create policy jor_ins on jornadas for insert to authenticated with check ((select app.eh_interno()));
-- assistente não move card; só admin/advogada/relacionamento.
create policy jor_upd on jornadas for update to authenticated
  using  ((select app.papel()) in ('admin','advogada','relacionamento'))
  with check ((select app.papel()) in ('admin','advogada','relacionamento'));

create policy tra_sel on jornadas_transicoes for select to authenticated using ((select app.eh_interno()));
-- append-only: sem policy de update/delete. RLS nega por ausência.

create policy ord_sel on etapas_jornada_ordem for select to authenticated using ((select app.eh_interno()));
create policy tp_sel  on transicoes_permitidas for select to authenticated using ((select app.eh_interno()));
