# SIC-HF — Arquitetura

**Versão do plano:** 1.0 · 03/09/2026
**Autor:** arquiteto (Opus) · **Executam:** `backend-engineer`, `frontend-engineer` · **Valida:** `fable-orchestrator`
**Repositório:** `C:\Users\João\projetos\sic-hf`
**Fontes lidas:** `sic-hf-brain\06 - Materiais\SIC-HF (documento da Dra. Elaine).md`, `Relatorio da Sessao de Viabilidade (template).md`, `Script de Sessao de Viabilidade.md`

> Este documento é **plano**, não código de produção. O DDL abaixo é **rascunho comentado**: o `backend-engineer` transforma cada bloco no arquivo de migration indicado no cabeçalho do bloco. Nada aqui deve ser copiado sem ler os comentários `-- NOTA:`.

---

## 0. Sumário executivo

O SIC-HF não é um CRM. Um CRM guarda *contatos e negociações*. O SIC-HF guarda **a compreensão de uma família ao longo de uma esteira**, e o produto real do sistema é o **Briefing Estratégico** que chega antes da Sessão de Viabilidade.

Três decisões estruturais sustentam tudo:

1. **`pessoa` ≠ `jornada`.** A identidade da pessoa é permanente; a passagem dela pela esteira é um objeto separado e repetível. Quem não fechou em junho e volta em agosto é a **mesma pessoa** com **duas jornadas** — e as duas contam separado no funil.
2. **Progresso e desfecho são eixos distintos.** `etapa` só anda para frente. `desfecho` (aberta / ganha / perdida / descartada / congelada) responde "acabou como?". Nunca se "volta o card para trás" para marcar perda — isso apagaria o fato de que a pessoa chegou à Sessão realizada.
3. **Preparo não é etapa.** Formulário, ligação e briefing são **marcos derivados** (existe linha filha ou não), exibidos como selos no card. Não viram colunas do kanban, não viram flag duplicada na `jornadas`. Uma fonte de verdade só.

---

## 1. Modelo de domínio

### 1.1 Glossário de decisão — o que cada coisa **é** e o que **não é**

| Termo | **É** | **NÃO é** | Tabela |
|---|---|---|---|
| **Pessoa** | A identidade humana estável: nome, contatos, cidade/UF, profissão. Deduplicada por e-mail/telefone. Nunca deletada, só `ativo = false`. | Não é "lead" nem "cliente". Esses são *estados de uma jornada*, não tipos de gente. | `pessoas` |
| **Edição de seminário** | Uma **rodada datada** do seminário gratuito de 3 dias (jun/jul/ago/set/out/dez). Tem janela de datas, código e meta. | Não é o produto "Seminário" (esse é o programa, não a edição). Não é campo de texto na pessoa. | `edicoes_seminario` |
| **Participação** | **Evento**: pessoa X esteve na edição Y, nesta data, por este canal. Uma pessoa pode ter N participações. | Não é atributo da pessoa. Gravar "edição" como coluna em `pessoas` destrói o histórico na 2ª participação. | `participacoes_seminario` |
| **Jornada** | A **unidade da esteira**: uma pessoa + uma origem + um ciclo comercial. É o card do kanban, o dono da máquina de estados e o eixo de todo o resto. | Não é "oportunidade de venda" genérica, não é o pagamento, não é a reunião. | `jornadas` |
| **Etapa** | Posição de **progresso** na esteira. Monotônica: só avança. | Não carrega o desfecho. Não carrega "respondeu formulário". Não é lugar para marcar no-show. | `jornadas.etapa` |
| **Desfecho** | Como a jornada terminou (ou que segue aberta). Exige motivo quando ≠ `aberta`. | Não é etapa. Perder na etapa `sessao_realizada` mantém `etapa = sessao_realizada`. | `jornadas.desfecho` |
| **Sessão de Viabilidade** | A **reunião** de diagnóstico conduzida pela Dra. Elaine. Uma por jornada. | **Não é o pagamento.** O cliente compra o *direito à sessão* (Hotmart); a reunião é outra coisa e pode ser remarcada N vezes. | `sessoes_viabilidade` |
| **Agendamento** | Um **slot datado** para a sessão. N por sessão (remarcações). Só um `confirmado` por vez. | Não é a sessão. No-show é status **do agendamento**, não etapa da jornada. | `agendamentos` |
| **Briefing Estratégico** | Saída **imutável e versionada** da IA (Protocolo 01). Regerar cria versão nova. | Não é campo editável. Não é anotação humana (isso é `ligacoes_estrategicas.observacoes`). | `briefings` |
| **Croqui Estrutural** | Entregável técnico pós-pagamento, em HTML modo apresentação. Versionado. | Não é a *oferta* do croqui feita durante a SV (isso é `ofertas`). Ver CONFLITO C6. | `croquis` |
| **Documento** | Arquivo PII sensível (IR, contrato social) em bucket privado. | Nunca URL pública. Nunca conteúdo enviado à IA. | `documentos` |

### 1.2 Mapa de entidades

```
pessoas ──< participacoes_seminario >── edicoes_seminario
   │
   ├──< consentimentos            (gravação, IA, e-mail, WhatsApp, fontes públicas)
   ├──< familiares                (composição familiar do Relatório da SV)
   ├──< patrimonio_itens          (PII SENSÍVEL — valor histórico e de mercado)
   ├──< documentos                (PII SENSÍVEL — IR, contrato social → Storage privado)
   │
   └──< jornadas ─────────────────────────────────── (raiz da esteira)
           ├──< jornadas_transicoes                  (append-only, histórico do kanban)
           ├──< formularios_respostas                (POP 02, versionado)
           ├──< ligacoes_estrategicas                (POP 03 / 03-B)
           ├──< briefings ──> execucoes_ia ──> prompts_versoes
           ├──< sessoes_viabilidade ──< agendamentos
           │         └──1 relatorios_sessao          (template da Dra. Elaine)
           ├──< croquis ──< croqui_apresentacoes
           ├──< ofertas                              (o que foi ofertado e por quanto)
           ├──< pagamentos <── webhooks_eventos      (Hotmart, idempotente)
           ├──< mensagens_agendadas ──> mensagens_templates
           ├──< pesquisas_publicas                   (FASE 2 — bloqueado, ver B9)
           └──< eventos_timeline                     (append-only, alimenta a Ficha 360)

perfis_equipe  (a EQUIPE — admin, advogada, relacionamento, assistente)
```

> **Atenção herdada de outro projeto do João:** `perfis_equipe` é a tabela **da equipe**. Não existe trigger de signup criando linha lá. Ver §2.2.

### 1.3 Máquina de estados da esteira

**Eixo 1 — `etapa` (colunas do kanban, monotônica):**

| # | etapa | Rótulo na UI | O que dispara |
|---|---|---|---|
| 10 | `captado` | Captado | Import da edição do seminário / criação manual |
| 20 | `qualificado` | Qualificado (MQL) | Regra de MQL — **BLOQUEIO B1** |
| 30 | `sessao_contratada` | Sessão paga | Webhook Hotmart `produto=sessao_viabilidade` + status aprovado |
| 40 | `sessao_agendada` | Sessão agendada | Agendamento com `status = confirmado` |
| 50 | `sessao_realizada` | Sessão realizada | Advogada marca realizada (ou salva o relatório) |
| 60 | `croqui_contratado` | Croqui pago | Webhook Hotmart `produto=croqui_estrutural` + aprovado |
| 70 | `croqui_apresentado` | Croqui apresentado | Registro de `croqui_apresentacoes` (POP 06) |
| 80 | `holding_contratada` | Holding contratada | Webhook `produto=holding` **ou** registro manual — **BLOQUEIO B6** |

**Eixo 2 — `desfecho`:** `aberta` (default) · `ganha` (auto ao chegar em 80) · `perdida` (motivo obrigatório) · `descartada` (motivo obrigatório) · `congelada` (retomar depois).

**Transições permitidas** (tabela `transicoes_permitidas`, dado e não código — adicionar etapa é INSERT, não deploy):

```
10→20  20→30  10→30  30→40  40→50  50→60  60→70  70→80
40→40  (remarcação: mesmo estado, novo agendamento)
```

- **Salto 10→30 é permitido** e esperado: quem paga sem ter passado pelo crivo de MQL entra direto (dinheiro é fato, qualificação é hipótese).
- **Regressão é proibida por trigger.** `ordem(nova) < ordem(atual)` → exceção.
- **Irreversível por dinheiro:** ao registrar pagamento aprovado, `jornadas.nivel_pago` sobe (0→1→2→3) e a etapa nunca pode cair abaixo do piso daquele nível (30, 60, 80). **Estorno/chargeback não rebaixa etapa** — grava `pagamentos.status = estornado` e um evento na timeline. Rebaixar apagaria o fato de que o dinheiro entrou.
- **No-show não é etapa.** `agendamentos.status = nao_compareceu`; a jornada continua em `sessao_agendada` até remarcar ou receber `desfecho = perdida`.
- **Perda não é etapa.** `desfecho = perdida` + `motivo_desfecho`. A `etapa` congela onde estava. Reabrir volta `desfecho` para `aberta` (permitido, registrado).
- **Uma jornada aberta por pessoa por vez** — garantido por índice único parcial no banco (§2.4). Pessoa que retorna em outra edição gera **jornada nova**, não reciclagem da antiga. Ver **BLOQUEIO B2**.

Toda mudança de `etapa` ou `desfecho` grava linha em `jornadas_transicoes` (de, para, motivo, ator, ocorrido_em). Isso entrega de graça: histórico do card, tempo em etapa e os indicadores do POP 08 — sem tabela de métrica separada.

---

## 2. Schema Postgres

Convenções: identificadores em **português sem acento**, snake_case, plural. PK `uuid default gen_random_uuid()`. Todo timestamp é `timestamptz`; a UI renderiza em `America/Sao_Paulo`. Auditoria em toda tabela: `criado_em`, `atualizado_em`, `criado_por`, `atualizado_por`.

**RLS é ligada na mesma migration que cria a tabela.** Nunca existe janela em que a tabela está de pé sem policy.

Arquivos a criar em `supabase/migrations/`:

| Arquivo | Conteúdo |
|---|---|
| `0001_extensoes_enums_helpers.sql` | extensões, enums, schema `app`, funções de papel, trigger de `atualizado_em` |
| `0002_perfis_equipe.sql` | equipe + RLS + convite pré-autorizado |
| `0003_pessoas_edicoes_participacoes.sql` | identidade e origem |
| `0004_jornadas_transicoes.sql` | esteira, ordem das etapas, trigger da máquina de estados |
| `0005_consentimentos.sql` | LGPD — texto congelado por versão |
| `0006_formularios_ligacoes.sql` | POP 02 e POP 03/03-B |
| `0007_familia_patrimonio.sql` | composição familiar e patrimonial (PII sensível) |
| `0008_sessoes_agendamentos_relatorios.sql` | reunião, slots, relatório da SV |
| `0009_ia_prompts_execucoes_briefings.sql` | prompt versionado, custo, briefing |
| `0010_croquis.sql` | croqui + apresentação |
| `0011_produtos_ofertas_pagamentos_webhooks.sql` | Hotmart |
| `0012_documentos_storage.sql` | bucket privado + policies + auditoria de acesso |
| `0013_regua_mensagens.sql` | templates e fila |
| `0014_timeline.sql` | `eventos_timeline` append-only + triggers |
| `0015_views_indicadores.sql` | views `security_invoker` para kanban e POP 08 |
| `0016_seed_dev.sql` | **só ambiente de dev**, todas as linhas com `origem_dado = 'exemplo'` |

### 2.1 `0001` — extensões, enums, helpers

```sql
-- 0001_extensoes_enums_helpers.sql
create extension if not exists pgcrypto;   -- gen_random_uuid
create extension if not exists btree_gist; -- exclusion constraint de agenda
create extension if not exists unaccent;   -- busca por nome sem acento

create schema if not exists app;

create type papel_equipe as enum ('admin','advogada','relacionamento','assistente');
create type etapa_jornada as enum (
  'captado','qualificado','sessao_contratada','sessao_agendada',
  'sessao_realizada','croqui_contratado','croqui_apresentado','holding_contratada');
create type desfecho_jornada as enum ('aberta','ganha','perdida','descartada','congelada');
create type trilha_jornada  as enum ('seminario','preliminar'); -- POP 03 vs POP 03-B
create type origem_lead     as enum ('seminario','indicacao','organico','trafego_pago','outro');
create type produto_tipo    as enum ('sessao_viabilidade','croqui_estrutural','holding');
create type status_pagamento as enum ('pendente','em_analise','aprovado','cancelado','estornado','reembolsado');
create type tipo_bem        as enum ('imovel','veiculo','investimento','previdencia','empresa','outro');
create type status_agendamento as enum ('agendado','confirmado','realizado','nao_compareceu','cancelado','remarcado');
create type canal_mensagem  as enum ('email','whatsapp');
create type status_mensagem as enum ('pendente','enviando','enviada','falhou','cancelada');
create type status_execucao_ia as enum ('pendente','executando','concluida','falhou');
create type status_croqui   as enum ('rascunho','pronto','apresentado');
create type tipo_consentimento as enum (
  'gravacao_sessao','tratamento_ia','comunicacao_email','comunicacao_whatsapp','pesquisa_fontes_publicas');

-- NOTA: papel do usuário logado. SECURITY DEFINER + search_path fixo é obrigatório:
-- sem SET search_path a função é sequestrável por schema no path do chamador.
create or replace function app.papel() returns papel_equipe
language sql stable security definer set search_path = public, pg_temp as $$
  select p.papel from public.perfis_equipe p
   where p.auth_user_id = auth.uid() and p.ativo limit 1
$$;

create or replace function app.eh_interno() returns boolean
language sql stable as $$ select app.papel() is not null $$;

-- Quem enxerga VALOR de patrimônio, IR e contrato social. Só estes dois papéis.
create or replace function app.ve_patrimonio() returns boolean
language sql stable as $$ select app.papel() in ('admin','advogada') $$;

create or replace function app.eh_admin() returns boolean
language sql stable as $$ select app.papel() = 'admin' $$;

revoke execute on function app.papel() from public, anon;
grant  execute on function app.papel(), app.eh_interno(), app.ve_patrimonio(), app.eh_admin() to authenticated;

create or replace function app.set_atualizado_em() returns trigger
language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;
```

> **NOTA de performance (obrigatória para o backend):** em **toda** policy, chamar a função dentro de `(select ...)` — `using ((select app.eh_interno()))`. Sem o `select` o Postgres reavalia a função por linha e o kanban degrada linearmente. Com o `select`, vira InitPlan avaliado uma vez.

### 2.2 `0002` — equipe (e por que não existe trigger de signup)

```sql
-- 0002_perfis_equipe.sql
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
```

### 2.3 `0003` — pessoas, edições, participações

```sql
-- 0003_pessoas_edicoes_participacoes.sql
create table pessoas (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null,
  email        text,
  telefone     text,                     -- E.164 normalizado pelo app
  cidade       text,
  uf           char(2),
  profissao    text,
  faixa_etaria text,                     -- espelha o POP 02 pergunta 4
  estado_civil text,
  observacoes  text,
  ativo        boolean not null default true,
  auth_user_id uuid unique references auth.users(id), -- FUTURO portal do cliente. Hoje sempre NULL.
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  criado_por uuid references perfis_equipe(id), atualizado_por uuid references perfis_equipe(id)
);
-- Deduplicação: e-mail e telefone são únicos quando presentes, nunca obrigatórios.
create unique index uniq_pessoas_email    on pessoas (lower(email)) where email is not null;
create unique index uniq_pessoas_telefone on pessoas (telefone)     where telefone is not null;
create index idx_pessoas_nome_busca on pessoas using gin (to_tsvector('portuguese', unaccent(nome)));

create table edicoes_seminario (
  id        uuid primary key default gen_random_uuid(),
  codigo    text not null unique,          -- ex.: 'SEM-2026-09'
  nome      text not null,                 -- 'Seminário Setembro/2026'
  inicio_em date not null,
  fim_em    date not null,
  ativa     boolean not null default true,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  constraint ck_edicao_janela check (fim_em >= inicio_em)
);

-- Participação é EVENTO, não atributo. Pessoa que volta em outra edição ganha linha nova.
create table participacoes_seminario (
  id         uuid primary key default gen_random_uuid(),
  pessoa_id  uuid not null references pessoas(id) on delete restrict,
  edicao_id  uuid not null references edicoes_seminario(id) on delete restrict,
  origem     origem_lead not null default 'seminario',
  dias_assistidos smallint check (dias_assistidos between 0 and 3),
  registrado_em timestamptz not null default now(),
  criado_em timestamptz not null default now(),
  unique (pessoa_id, edicao_id)
);
create index idx_participacoes_edicao on participacoes_seminario (edicao_id);

alter table pessoas                enable row level security;
alter table edicoes_seminario      enable row level security;
alter table participacoes_seminario enable row level security;
-- Toda a equipe lê pessoa (nome/contato). Valor de patrimônio NÃO mora aqui.
create policy pessoas_sel on pessoas for select to authenticated using ((select app.eh_interno()));
create policy pessoas_ins on pessoas for insert to authenticated with check ((select app.eh_interno()));
create policy pessoas_upd on pessoas for update to authenticated
  using ((select app.eh_interno())) with check ((select app.eh_interno()));
-- NOTA: não existe policy de DELETE em lugar nenhum deste schema. Baixa é ativo=false.
create policy edicoes_sel on edicoes_seminario for select to authenticated using ((select app.eh_interno()));
create policy edicoes_wr  on edicoes_seminario for all to authenticated
  using ((select app.eh_admin())) with check ((select app.eh_admin()));
create policy part_sel on participacoes_seminario for select to authenticated using ((select app.eh_interno()));
create policy part_ins on participacoes_seminario for insert to authenticated with check ((select app.eh_interno()));
```

### 2.4 `0004` — jornadas e a máquina de estados

```sql
-- 0004_jornadas_transicoes.sql
-- Ordem das etapas é DADO. Renomear coluna do kanban = UPDATE, não deploy.
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
  edicao_id  uuid references edicoes_seminario(id) on delete restrict, -- NULL quando origem ≠ seminário
  origem     origem_lead not null default 'seminario',
  trilha     trilha_jornada not null default 'seminario',              -- POP 03 x POP 03-B
  etapa      etapa_jornada  not null default 'captado',
  desfecho   desfecho_jornada not null default 'aberta',
  motivo_desfecho text,
  -- nivel_pago: 0 nada, 1 sessão, 2 croqui, 3 holding. Mantido por trigger a partir de pagamentos.
  nivel_pago smallint not null default 0 check (nivel_pago between 0 and 3),
  -- Faixa DECLARADA (POP 02 P9). É o único dado patrimonial que a equipe toda enxerga.
  faixa_patrimonio_declarada text,
  responsavel_id uuid references perfis_equipe(id),   -- quem cuida do relacionamento
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

create or replace function app.registra_transicao_jornada() returns trigger
language plpgsql as $$
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
```

### 2.5 `0005` — consentimentos (LGPD)

```sql
-- 0005_consentimentos.sql
-- O TEXTO do consentimento é congelado na linha. Mudar o texto no futuro não pode
-- reescrever o que a pessoa aceitou ontem.
create table consentimentos (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references pessoas(id) on delete restrict,
  tipo tipo_consentimento not null,
  concedido boolean not null,
  texto_apresentado text not null,        -- cópia literal do que foi lido/mostrado
  versao_texto text not null,             -- ex.: '4-sims-v1'
  canal text not null,                    -- 'sessao_zoom' | 'formulario' | 'email' | 'telefone'
  registrado_por uuid references perfis_equipe(id),
  concedido_em timestamptz not null default now(),
  revogado_em  timestamptz,
  criado_em timestamptz not null default now()
);
create index idx_consent_pessoa_tipo on consentimentos (pessoa_id, tipo, concedido_em desc);

-- Consentimento VIGENTE: último registro não revogado daquele tipo.
create or replace function app.tem_consentimento(p_pessoa uuid, p_tipo tipo_consentimento)
returns boolean language sql stable as $$
  select coalesce((select c.concedido and c.revogado_em is null
                     from consentimentos c
                    where c.pessoa_id = p_pessoa and c.tipo = p_tipo
                    order by c.concedido_em desc limit 1), false)
$$;

alter table consentimentos enable row level security;
create policy con_sel on consentimentos for select to authenticated using ((select app.eh_interno()));
create policy con_ins on consentimentos for insert to authenticated with check ((select app.eh_interno()));
create policy con_upd on consentimentos for update to authenticated  -- só para revogar
  using ((select app.papel()) in ('admin','advogada')) with check ((select app.papel()) in ('admin','advogada'));
```

### 2.6 `0006` — formulário (POP 02) e ligação (POP 03/03-B)

```sql
-- 0006_formularios_ligacoes.sql
-- O formulário MUDA (hoje é v0.2). Resposta guardada como jsonb + versão da definição.
create table formularios (
  id uuid primary key default gen_random_uuid(),
  chave text not null,                 -- 'estrategico'
  versao smallint not null,            -- 2  (POP 02 v0.2)
  definicao jsonb not null,            -- [{id:'p9', bloco:'Patrimônio', tipo:'unica', rotulo:..., opcoes:[...]}]
  ativo boolean not null default false,
  criado_em timestamptz not null default now(),
  unique (chave, versao)
);
create unique index uniq_formulario_ativo on formularios (chave) where ativo;

create table formularios_respostas (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid not null references jornadas(id) on delete cascade,
  formulario_id uuid not null references formularios(id),
  respostas jsonb not null,            -- {"p1":"...","p9":"Entre R$ 1 milhão e R$ 2 milhões","p10":["Imóveis"]}
  origem text not null default 'sistema' check (origem in ('sistema','typeform','importado')),
  respondido_em timestamptz not null default now(),
  criado_em timestamptz not null default now(),
  unique (jornada_id)                  -- uma resposta por jornada; reenvio sobrescreve com histórico na timeline
);

-- POP 03 / 03-B. Separa FATO (resposta), OBSERVAÇÃO (o colaborador viu) e FRASE (literal do cliente).
-- O Protocolo 01 exige essa separação; misturar tudo num "notas" livre destrói o briefing.
create table ligacoes_estrategicas (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid not null references jornadas(id) on delete cascade,
  pop text not null default '03' check (pop in ('03','03-B')),
  realizada_em timestamptz not null default now(),
  duracao_segundos int check (duracao_segundos >= 0),
  colaborador_id uuid references perfis_equipe(id),
  -- respostas às 5 perguntas do roteiro, chaveadas por pergunta
  respostas jsonb not null default '{}'::jsonb,
  -- registro obrigatório do POP 03 ("Informações obrigatórias para registro")
  expectativa_principal text,
  preocupacao_principal text,
  assunto_atencao_especial text,
  objecoes_percebidas text[],
  pessoas_mencionadas text[],
  -- observação comportamental OBJETIVA (POP 03-B manda registrar sem interpretar DISC)
  ritmo text check (ritmo in ('rapido','moderado','pausado')),
  estilo_resposta text check (estilo_resposta in ('muito_objetiva','objetiva','detalhada','conta_historias')),
  sinais text[],                        -- 'interrompe','demonstra_cautela','procura_numeros',...
  frases_marcantes text[],              -- 1 a 3 frases LITERAIS
  processo_decisorio text check (processo_decisorio in ('influenciador','comunicador','decisor_conjunto','decide_sozinho')),
  decisores_presentes_na_sessao boolean,
  transcricao text,                     -- PII: só entra na IA com consentimento (§4.4)
  observacoes text,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  criado_por uuid references perfis_equipe(id), atualizado_por uuid references perfis_equipe(id)
);
create index idx_ligacoes_jornada on ligacoes_estrategicas (jornada_id, realizada_em desc);

alter table formularios enable row level security;
alter table formularios_respostas enable row level security;
alter table ligacoes_estrategicas enable row level security;
create policy form_sel on formularios for select to authenticated using ((select app.eh_interno()));
create policy form_wr  on formularios for all to authenticated
  using ((select app.eh_admin())) with check ((select app.eh_admin()));
create policy fr_sel on formularios_respostas for select to authenticated using ((select app.eh_interno()));
create policy fr_wr  on formularios_respostas for all to authenticated
  using ((select app.eh_interno())) with check ((select app.eh_interno()));
create policy lig_sel on ligacoes_estrategicas for select to authenticated using ((select app.eh_interno()));
create policy lig_wr  on ligacoes_estrategicas for all to authenticated
  using ((select app.eh_interno())) with check ((select app.eh_interno()));
```

### 2.7 `0007` — família e patrimônio (**PII sensível**)

```sql
-- 0007_familia_patrimonio.sql
create table familiares (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references pessoas(id) on delete restrict,
  registrado_na_jornada_id uuid references jornadas(id),
  parentesco text not null,             -- 'conjuge','filho','neto','outro'
  nome text, idade smallint check (idade between 0 and 130),
  ocupacao text,
  regime_casamento text,                -- do Relatório da SV
  ano_casamento smallint,
  dependente_financeiro boolean,
  observacoes text,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now()
);
create index idx_familiares_pessoa on familiares (pessoa_id);

-- Valor histórico E valor de mercado, como pede o template da Dra. Elaine.
create table patrimonio_itens (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references pessoas(id) on delete restrict,
  registrado_na_jornada_id uuid references jornadas(id),
  tipo tipo_bem not null,
  descricao text not null,
  ano_aquisicao smallint,
  valor_historico numeric(15,2) check (valor_historico >= 0),
  valor_mercado   numeric(15,2) check (valor_mercado   >= 0),
  destinacao text,                       -- 'residencia','locacao','uso da empresa'
  valor_locacao_mensal numeric(15,2) check (valor_locacao_mensal >= 0),
  -- campos específicos por tipo (empresa: objeto, composição societária, capital, PL, faturamento)
  detalhes jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  criado_por uuid references perfis_equipe(id), atualizado_por uuid references perfis_equipe(id)
);
create index idx_patrimonio_pessoa on patrimonio_itens (pessoa_id, tipo);

alter table familiares enable row level security;
alter table patrimonio_itens enable row level security;
-- Composição familiar: toda a equipe (é operacional — quem participa da sessão).
create policy fam_sel on familiares for select to authenticated using ((select app.eh_interno()));
create policy fam_wr  on familiares for all to authenticated
  using ((select app.eh_interno())) with check ((select app.eh_interno()));
-- VALOR de patrimônio: SÓ admin e advogada. Relacionamento e assistente enxergam
-- apenas jornadas.faixa_patrimonio_declarada. Ver BLOQUEIO B5.
create policy pat_sel on patrimonio_itens for select to authenticated using ((select app.ve_patrimonio()));
create policy pat_wr  on patrimonio_itens for all to authenticated
  using ((select app.ve_patrimonio())) with check ((select app.ve_patrimonio()));
```

### 2.8 `0008` — sessão, agendamento, relatório

```sql
-- 0008_sessoes_agendamentos_relatorios.sql
create table sessoes_viabilidade (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid not null unique references jornadas(id) on delete cascade,  -- 1:1 com a jornada
  advogada_id uuid references perfis_equipe(id),
  link_sala text,                        -- Zoom. MVP: colado à mão. Ver BLOQUEIO B10.
  realizada_em timestamptz,
  gravacao_url text,                     -- URL externa; conteúdo não fica no nosso Storage no MVP
  resultado text check (resultado in ('fechou','nao_fechou','indefinido')),
  motivo_resultado text,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now()
);

create table agendamentos (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid not null references sessoes_viabilidade(id) on delete cascade,
  inicio_em timestamptz not null,
  fim_em    timestamptz not null,
  status status_agendamento not null default 'agendado',
  origem  text not null default 'equipe' check (origem in ('equipe','cliente','ia')),
  observacoes text,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  criado_por uuid references perfis_equipe(id),
  constraint ck_agenda_janela check (fim_em > inicio_em)
);
-- Um slot confirmado por sessão por vez.
create unique index uniq_agendamento_confirmado on agendamentos (sessao_id) where status = 'confirmado';
-- A Dra. Elaine não pode estar em duas salas ao mesmo tempo. O banco garante.
alter table agendamentos add column advogada_id uuid references perfis_equipe(id);
alter table agendamentos add constraint ex_agenda_sem_sobreposicao
  exclude using gist (advogada_id with =, tstzrange(inicio_em, fim_em) with &&)
  where (status in ('agendado','confirmado'));
create index idx_agendamentos_proximos on agendamentos (inicio_em) where status in ('agendado','confirmado');

-- Espelha 1:1 o "Relatório da Sessão de Viabilidade (template)".
-- Cabeçalho vira coluna (é consultado/filtrado); corpo narrativo vira texto.
create table relatorios_sessao (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid not null unique references sessoes_viabilidade(id) on delete cascade,
  acompanhado boolean, quem_acompanha text,
  acompanhante_decide boolean, acompanhante_assistiu boolean,
  data_contratacao date, valor_pago_sessao numeric(15,2), parcelas smallint,
  motivacao_cliente text,
  receita_familiar_mensal numeric(15,2),
  ideia_custo_inventario text, reserva_ou_seguro text,
  ciente_itcmd boolean, preocupacao_predominante text,
  como_deseja_organizar text, motiva_evitar_inventario text,
  interesse_imediato text, relacao_filhos_terceiros text,
  porque_nos_procurou text, falta_planejamento_preocupa text,
  resultado_sessao text,
  -- Bloco "Dados para início da execução do croqui" (ITCMD / ITBI / cartórios).
  -- NOTA: nenhum cálculo automático de imposto no MVP. Alíquota e link são digitados
  -- pela advogada. Inventar cálculo tributário aqui seria inventar regra de negócio.
  tributos jsonb not null default '{}'::jsonb,
  consideracoes_apresentacao_croqui text,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  criado_por uuid references perfis_equipe(id), atualizado_por uuid references perfis_equipe(id)
);

alter table sessoes_viabilidade enable row level security;
alter table agendamentos enable row level security;
alter table relatorios_sessao enable row level security;
create policy ses_sel on sessoes_viabilidade for select to authenticated using ((select app.eh_interno()));
create policy ses_wr  on sessoes_viabilidade for all to authenticated
  using ((select app.eh_interno())) with check ((select app.eh_interno()));
create policy age_sel on agendamentos for select to authenticated using ((select app.eh_interno()));
create policy age_wr  on agendamentos for all to authenticated
  using ((select app.eh_interno())) with check ((select app.eh_interno()));
-- Relatório contém valores e detalhe patrimonial: mesmo recorte do patrimônio.
create policy rel_sel on relatorios_sessao for select to authenticated using ((select app.ve_patrimonio()));
create policy rel_wr  on relatorios_sessao for all to authenticated
  using ((select app.ve_patrimonio())) with check ((select app.ve_patrimonio()));
```

### 2.9 `0009` — IA: prompt versionado, execução, briefing

```sql
-- 0009_ia_prompts_execucoes_briefings.sql
-- O Prompt Mestre e o Protocolo 01 são DOCUMENTO VIVO ("sistema vivo", diz a Dra. Elaine).
-- Versão fica no banco, não no código: mudar prompt não pode exigir deploy,
-- e todo briefing tem de saber qual versão o gerou.
create table prompts_versoes (
  id uuid primary key default gen_random_uuid(),
  chave text not null,                   -- 'protocolo_01_briefing' | 'prompt_mestre' | 'isca_pos_sessao'
  versao smallint not null,
  titulo text not null,
  corpo_sistema text not null,           -- system prompt
  esquema_saida jsonb,                   -- JSON Schema da resposta estruturada
  modelo_padrao text not null default 'claude-opus-5',
  effort text not null default 'high' check (effort in ('low','medium','high','xhigh','max')),
  ativo boolean not null default false,
  notas text,
  criado_em timestamptz not null default now(), criado_por uuid references perfis_equipe(id),
  unique (chave, versao)
);
create unique index uniq_prompt_ativo on prompts_versoes (chave) where ativo;

-- Preço por modelo em tabela: custo não pode viver espalhado em constante no código.
create table modelos_ia_precos (
  modelo text not null,
  entrada_usd_mtok numeric(10,4) not null,
  saida_usd_mtok   numeric(10,4) not null,
  cache_escrita_mult numeric(6,3) not null default 1.25,
  cache_leitura_mult numeric(6,3) not null default 0.10,
  vigente_desde date not null default current_date,
  primary key (modelo, vigente_desde)
);
insert into modelos_ia_precos (modelo, entrada_usd_mtok, saida_usd_mtok) values
 ('claude-opus-5', 5.0000, 25.0000),
 ('claude-sonnet-5', 2.0000, 10.0000);

create table execucoes_ia (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid references jornadas(id) on delete cascade,
  prompt_versao_id uuid not null references prompts_versoes(id),
  modelo text not null,
  status status_execucao_ia not null default 'pendente',
  tokens_entrada int, tokens_saida int,
  tokens_cache_escrita int, tokens_cache_leitura int,
  custo_usd numeric(12,6),
  latencia_ms int,
  hash_entrada text,                      -- sha256 do contexto montado (dedupe e auditoria)
  stop_reason text,
  erro text,
  request_id text,                        -- response._request_id da Anthropic, para suporte
  criado_em timestamptz not null default now(), concluido_em timestamptz,
  criado_por uuid references perfis_equipe(id)
);
create index idx_execucoes_jornada on execucoes_ia (jornada_id, criado_em desc);

-- Briefing é IMUTÁVEL. Regerar cria versão nova. Nunca UPDATE no conteúdo.
create table briefings (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid not null references jornadas(id) on delete cascade,
  execucao_id uuid not null references execucoes_ia(id),
  versao smallint not null,
  conteudo jsonb not null,                -- valida contra prompts_versoes.esquema_saida
  grau_confianca smallint check (grau_confianca between 0 and 100),
  fontes_usadas text[] not null,          -- ['formulario','ligacao_observacoes','transcricao','patrimonio_faixa']
  atual boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (jornada_id, versao)
);
create unique index uniq_briefing_atual on briefings (jornada_id) where atual;

alter table prompts_versoes enable row level security;
alter table modelos_ia_precos enable row level security;
alter table execucoes_ia enable row level security;
alter table briefings enable row level security;
create policy pv_sel on prompts_versoes for select to authenticated using ((select app.eh_interno()));
create policy pv_wr  on prompts_versoes for all to authenticated
  using ((select app.eh_admin())) with check ((select app.eh_admin()));
create policy mp_sel on modelos_ia_precos for select to authenticated using ((select app.eh_interno()));
create policy mp_wr  on modelos_ia_precos for all to authenticated
  using ((select app.eh_admin())) with check ((select app.eh_admin()));
-- Custo é informação de gestão: só admin/advogada.
create policy ex_sel on execucoes_ia for select to authenticated using ((select app.ve_patrimonio()));
create policy br_sel on briefings for select to authenticated using ((select app.eh_interno()));
-- INSERT de execucoes_ia e briefings é feito pela rota com service_role (fora da RLS),
-- porque o payload é montado no servidor e não pode ser forjado pelo cliente.
```

### 2.10 `0010` — croqui em modo apresentação

```sql
-- 0010_croquis.sql
create table croquis (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid not null references jornadas(id) on delete cascade,
  versao smallint not null,
  titulo text not null,
  status status_croqui not null default 'rascunho',
  -- slides tipados: {slides:[{id, tipo:'capa'|'familia'|'patrimonio'|'cenario_inventario'
  --  |'estrutura'|'custos'|'etapas'|'proximos_passos', titulo, blocos:[...]}]}
  conteudo jsonb not null default '{"slides":[]}'::jsonb,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  criado_por uuid references perfis_equipe(id), atualizado_por uuid references perfis_equipe(id),
  unique (jornada_id, versao)
);
create unique index uniq_croqui_pronto on croquis (jornada_id) where status in ('pronto','apresentado');

create table croqui_apresentacoes (
  id uuid primary key default gen_random_uuid(),
  croqui_id uuid not null references croquis(id) on delete cascade,
  iniciada_em timestamptz not null default now(),
  encerrada_em timestamptz,
  slides_vistos int,
  apresentador_id uuid references perfis_equipe(id)
);

alter table croquis enable row level security;
alter table croqui_apresentacoes enable row level security;
-- Croqui carrega números do patrimônio: mesmo recorte.
create policy cro_sel on croquis for select to authenticated using ((select app.ve_patrimonio()));
create policy cro_wr  on croquis for all to authenticated
  using ((select app.ve_patrimonio())) with check ((select app.ve_patrimonio()));
create policy cap_sel on croqui_apresentacoes for select to authenticated using ((select app.eh_interno()));
create policy cap_ins on croqui_apresentacoes for insert to authenticated with check ((select app.ve_patrimonio()));
```

### 2.11 `0011` — produtos, ofertas, pagamentos, webhooks

```sql
-- 0011_produtos_ofertas_pagamentos_webhooks.sql
create table produtos (
  id uuid primary key default gen_random_uuid(),
  tipo produto_tipo not null,
  nome text not null,
  hotmart_produto_id text,               -- preencher com os 3 IDs reais. Ver BLOQUEIO B7.
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (hotmart_produto_id)
);

-- O script tem preço padrão R$ 7.200 e "Incentivo do Resolvedor" R$ 4.500 válido no dia.
-- Sem registrar QUAL oferta foi feita, o valor que chega do webhook não bate com nada.
create table ofertas (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid not null references jornadas(id) on delete cascade,
  produto_id uuid not null references produtos(id),
  valor_padrao numeric(15,2) not null,
  valor_ofertado numeric(15,2) not null,
  condicao text not null,                -- 'padrao' | 'incentivo_resolvedor'
  valida_ate timestamptz,
  ofertada_em timestamptz not null default now(),
  ofertada_por uuid references perfis_equipe(id),
  aceita boolean,
  criado_em timestamptz not null default now()
);

create table pagamentos (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid references jornadas(id) on delete set null,
  pessoa_id  uuid references pessoas(id),
  produto_id uuid references produtos(id),
  origem text not null default 'hotmart',
  transacao_externa_id text not null,
  status status_pagamento not null,
  valor numeric(15,2), moeda char(3) default 'BRL',
  parcelas smallint,
  comprador_email text, comprador_nome text, comprador_telefone text,
  pago_em timestamptz,
  bruto jsonb not null,                  -- payload original, sempre
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  unique (origem, transacao_externa_id)
);
create index idx_pagamentos_jornada on pagamentos (jornada_id, criado_em desc);

-- Livro-razão do webhook. Grava PRIMEIRO, processa depois. Idempotência pelo id do evento.
create table webhooks_eventos (
  id uuid primary key default gen_random_uuid(),
  origem text not null default 'hotmart',
  evento_externo_id text not null,
  tipo_evento text,
  assinatura_valida boolean not null,
  bruto jsonb not null,
  processado_em timestamptz,
  erro text,
  tentativas smallint not null default 0,
  recebido_em timestamptz not null default now(),
  unique (origem, evento_externo_id)
);
create index idx_webhooks_pendentes on webhooks_eventos (recebido_em) where processado_em is null;

-- nivel_pago da jornada é derivado do pagamento aprovado. Nunca digitado à mão.
create or replace function app.atualiza_nivel_pago() returns trigger
language plpgsql as $$
declare novo smallint; tipo produto_tipo;
begin
  if new.status <> 'aprovado' or new.jornada_id is null then return new; end if;
  select p.tipo into tipo from produtos p where p.id = new.produto_id;
  novo := case tipo when 'sessao_viabilidade' then 1 when 'croqui_estrutural' then 2
                    when 'holding' then 3 else 0 end;
  update jornadas set nivel_pago = greatest(nivel_pago, novo) where id = new.jornada_id;
  return new;
end $$;
create trigger trg_nivel_pago after insert or update on pagamentos
for each row execute function app.atualiza_nivel_pago();

alter table produtos enable row level security;
alter table ofertas enable row level security;
alter table pagamentos enable row level security;
alter table webhooks_eventos enable row level security;
create policy prod_sel on produtos for select to authenticated using ((select app.eh_interno()));
create policy prod_wr  on produtos for all to authenticated
  using ((select app.eh_admin())) with check ((select app.eh_admin()));
create policy of_sel on ofertas for select to authenticated using ((select app.eh_interno()));
create policy of_wr  on ofertas for all to authenticated
  using ((select app.papel()) in ('admin','advogada')) with check ((select app.papel()) in ('admin','advogada'));
create policy pag_sel on pagamentos for select to authenticated using ((select app.eh_interno()));
-- webhooks_eventos: NENHUMA policy. Só service_role toca. Conteúdo bruto pode ter PII.
```

### 2.12 `0012` — documentos (IR, contrato social) e Storage

```sql
-- 0012_documentos_storage.sql
create table documentos (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references pessoas(id) on delete restrict,
  jornada_id uuid references jornadas(id),
  tipo text not null check (tipo in ('imposto_renda','contrato_social','matricula_imovel','outro')),
  nome_arquivo text not null,
  bucket text not null default 'documentos-sensiveis',
  caminho text not null unique,          -- pessoas/{pessoa_id}/{documento_id}/{slug}
  mime text not null, tamanho_bytes bigint not null check (tamanho_bytes > 0),
  sha256 text,
  enviado_por uuid references perfis_equipe(id),
  criado_em timestamptz not null default now()
);
create index idx_documentos_pessoa on documentos (pessoa_id, tipo);

-- Auditoria de ACESSO a PII: quem abriu o IR de quem e quando. Append-only.
create table documentos_acessos (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references documentos(id) on delete cascade,
  perfil_id uuid references perfis_equipe(id),
  acao text not null check (acao in ('url_assinada','download','exclusao_logica')),
  ip inet, user_agent text,
  ocorrido_em timestamptz not null default now()
);

alter table documentos enable row level security;
alter table documentos_acessos enable row level security;
create policy doc_sel on documentos for select to authenticated using ((select app.ve_patrimonio()));
create policy doc_wr  on documentos for all to authenticated
  using ((select app.ve_patrimonio())) with check ((select app.ve_patrimonio()));
create policy da_sel on documentos_acessos for select to authenticated using ((select app.eh_admin()));

-- Bucket PRIVADO. Criado via SQL para ficar versionado na migration.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos-sensiveis','documentos-sensiveis', false, 20971520,
        array['application/pdf','image/jpeg','image/png'])
on conflict (id) do nothing;

-- Nem mesmo admin/advogada acessam o objeto direto pelo client: o app usa service_role
-- e devolve URL assinada de 5 min. A policy abaixo é a segunda trava, não a primeira.
create policy storage_doc_sel on storage.objects for select to authenticated
  using (bucket_id = 'documentos-sensiveis' and (select app.ve_patrimonio()));
-- Sem policy de INSERT/UPDATE/DELETE para authenticated: upload passa obrigatoriamente
-- pela rota do servidor, que valida mime, tamanho e monta o caminho. Cliente nunca escolhe path.
```

### 2.13 `0013` — régua de comunicação

```sql
-- 0013_regua_mensagens.sql
create table mensagens_templates (
  id uuid primary key default gen_random_uuid(),
  chave text not null,                   -- 'boas_vindas','confirmacao_d7','dia_da_sessao','pos_sessao'
  canal canal_mensagem not null,
  versao smallint not null,
  assunto text,                          -- só e-mail
  corpo text not null,                   -- mustache: {{nome}}, {{data_sessao}}, {{link_sala}}
  ativo boolean not null default false,
  criado_em timestamptz not null default now(),
  unique (chave, canal, versao)
);
create unique index uniq_template_ativo on mensagens_templates (chave, canal) where ativo;

create table mensagens_agendadas (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid not null references jornadas(id) on delete cascade,
  agendamento_id uuid references agendamentos(id) on delete cascade, -- D-7 e dia da sessão
  template_id uuid not null references mensagens_templates(id),
  canal canal_mensagem not null,
  destinatario text not null,            -- e-mail ou telefone E.164
  agendada_para timestamptz not null,
  status status_mensagem not null default 'pendente',
  -- INVARIANTE de idempotência: a mesma régua nunca dispara duas vezes para o mesmo alvo.
  chave_idempotencia text not null unique,   -- '{jornada}:{chave_template}:{agendamento|-}'
  tentativas smallint not null default 0,
  proxima_tentativa_em timestamptz,
  corpo_renderizado text,                -- congelado no momento do envio (prova do que foi mandado)
  provedor_id text,                      -- id do Resend / do provedor
  erro text,
  enviada_em timestamptz,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now()
);
create index idx_mensagens_fila on mensagens_agendadas (agendada_para)
  where status = 'pendente';
create index idx_mensagens_jornada on mensagens_agendadas (jornada_id, agendada_para desc);

alter table mensagens_templates enable row level security;
alter table mensagens_agendadas enable row level security;
create policy mt_sel on mensagens_templates for select to authenticated using ((select app.eh_interno()));
create policy mt_wr  on mensagens_templates for all to authenticated
  using ((select app.eh_admin())) with check ((select app.eh_admin()));
create policy ma_sel on mensagens_agendadas for select to authenticated using ((select app.eh_interno()));
-- A fila manual de WhatsApp precisa marcar "enviei à mão":
create policy ma_upd on mensagens_agendadas for update to authenticated
  using ((select app.eh_interno())) with check ((select app.eh_interno()));
```

### 2.14 `0014` — timeline

```sql
-- 0014_timeline.sql
-- Uma linha do tempo só, alimentada por trigger. É o que faz a Ficha 360 ser uma
-- consulta, e não sete consultas costuradas no front.
create table eventos_timeline (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid not null references jornadas(id) on delete cascade,
  tipo text not null,        -- 'etapa','pagamento','formulario','ligacao','briefing',
                             -- 'agendamento','documento','mensagem','croqui','nota'
  titulo text not null,
  descricao text,
  dados jsonb not null default '{}'::jsonb,
  ator_perfil_id uuid references perfis_equipe(id),
  ator_tipo text not null default 'humano' check (ator_tipo in ('humano','sistema','ia')),
  ocorrido_em timestamptz not null default now()
);
create index idx_timeline_jornada on eventos_timeline (jornada_id, ocorrido_em desc);

alter table eventos_timeline enable row level security;
create policy tl_sel on eventos_timeline for select to authenticated using ((select app.eh_interno()));
create policy tl_ins on eventos_timeline for insert to authenticated with check ((select app.eh_interno()));
-- append-only: sem update, sem delete.
```

### 2.15 `0015` — views (kanban e POP 08)

```sql
-- 0015_views_indicadores.sql
-- security_invoker: a view herda a RLS de quem consulta. SEM isso a view vira
-- porta dos fundos que expõe patrimônio a quem a policy negou.
create view vw_jornada_kanban with (security_invoker = true) as
select j.id, j.etapa, j.desfecho, j.origem, j.trilha, j.edicao_id, e.codigo as edicao_codigo,
       j.faixa_patrimonio_declarada, j.nivel_pago, j.responsavel_id,
       p.id as pessoa_id, p.nome, p.cidade, p.uf, p.telefone, p.email,
       j.entrou_na_etapa_em,
       extract(day from now() - j.entrou_na_etapa_em)::int as dias_na_etapa,
       exists (select 1 from formularios_respostas f where f.jornada_id = j.id) as tem_formulario,
       exists (select 1 from ligacoes_estrategicas l where l.jornada_id = j.id) as tem_ligacao,
       exists (select 1 from briefings b where b.jornada_id = j.id and b.atual)  as tem_briefing,
       (select min(a.inicio_em) from agendamentos a
          join sessoes_viabilidade s on s.id = a.sessao_id
         where s.jornada_id = j.id and a.status in ('agendado','confirmado')
           and a.inicio_em > now()) as proxima_sessao_em
  from jornadas j
  join pessoas p on p.id = j.pessoa_id
  left join edicoes_seminario e on e.id = j.edicao_id;

-- POP 08 — indicadores calculados das transições, sem tabela de métrica paralela.
create view vw_indicadores_esteira with (security_invoker = true) as
select j.edicao_id,
       count(*) filter (where j.etapa >= 'sessao_contratada')            as sessoes_contratadas,
       count(*) filter (where j.etapa >= 'sessao_realizada')             as sessoes_realizadas,
       count(*) filter (where j.etapa >= 'croqui_contratado')            as croquis_contratados,
       count(*) filter (where j.desfecho = 'ganha')                      as holdings,
       count(*) filter (where exists (select 1 from formularios_respostas f where f.jornada_id = j.id)
                          and j.nivel_pago >= 1)                         as formularios_respondidos,
       count(*) filter (where exists (select 1 from ligacoes_estrategicas l where l.jornada_id = j.id)) as ligacoes_feitas
  from jornadas j group by j.edicao_id;
-- NOTA: comparação entre enums usa a ordem de declaração do enum, que aqui coincide
-- com a ordem da esteira POR CONSTRUÇÃO. Se alguém inserir valor no meio do enum, quebra.
-- Etapa nova SEMPRE entra no fim do enum + linha em etapas_jornada_ordem.
```

---

## 3. Contratos de API (Next.js App Router)

**Regras que valem para 100% das rotas** (Hostinger Node.js App, sem Vercel):

```ts
export const runtime = 'nodejs';        // NUNCA 'edge' — Hostinger não tem Edge runtime
export const dynamic = 'force-dynamic'; // sem ISR/cache de rota
```

Autorização em **duas camadas**: (1) sessão Supabase via `@supabase/ssr` no server + checagem de papel na rota; (2) RLS no banco. A rota nunca é a única trava. Cliente Supabase com `service_role` **só** nas rotas de webhook, IA, upload e cron — nunca importado em componente client.

| Rota | Método | Quem pode | Request | Response |
|---|---|---|---|---|
| `/api/auth/vincular` | POST | autenticado | — | `{vinculado:boolean, papel}` — chama `app.vincular_perfil()` |
| `/api/jornadas` | GET | interno | `?etapa=&edicao_id=&origem=&responsavel_id=&busca=&desfecho=&pagina=` | `{itens: JornadaKanban[], total}` (view `vw_jornada_kanban`) |
| `/api/jornadas` | POST | admin/advogada/relacionamento | `{pessoa:{nome,email,telefone,...}, edicao_id, origem, trilha}` | `{jornada_id}` — dedupe de pessoa por e-mail/telefone |
| `/api/jornadas/[id]` | GET | interno | — | Ficha 360: jornada + pessoa + formulário + ligação + briefing atual + sessão + agendamentos + documentos (metadados) + timeline. **Patrimônio só vem se `ve_patrimonio`** |
| `/api/jornadas/[id]/etapa` | PATCH | admin/advogada/relacionamento | `{etapa?, desfecho?, motivo?}` | `{jornada}` · 409 `transicao_invalida` |
| `/api/jornadas/[id]/formulario` | GET/PUT | interno | `{formulario_id, respostas}` | `{resposta}` — grava `faixa_patrimonio_declarada` na jornada |
| `/api/jornadas/[id]/ligacao` | POST/PUT | interno | corpo = campos do POP 03 (§2.6) | `{ligacao}` |
| `/api/jornadas/[id]/patrimonio` | GET/POST/PUT/DELETE | **admin/advogada** | `{tipo, descricao, ano_aquisicao, valor_historico, valor_mercado, ...}` | `{itens}` · 403 para os demais |
| `/api/jornadas/[id]/briefing` | POST | admin/advogada/relacionamento | `{forcar_regeracao?:boolean}` | 202 `{execucao_id, briefing_id}` — ver §4 |
| `/api/briefings/[id]` | GET | interno | — | `{versao, conteudo, grau_confianca, fontes_usadas, prompt_versao, custo_usd}` |
| `/api/jornadas/[id]/agendamentos` | POST | interno | `{inicio_em, fim_em, advogada_id}` | `{agendamento}` · 409 se sobrepõe (exclusion constraint) |
| `/api/agendamentos/[id]` | PATCH | interno | `{status}` ou `{inicio_em, fim_em}` (remarcar) | `{agendamento}` — cancela mensagens `pendente` do slot antigo e reagenda |
| `/api/jornadas/[id]/documentos` | POST | **admin/advogada** | `multipart/form-data` ≤ 20 MB, mime ∈ {pdf,jpeg,png} | `{documento_id}` — servidor monta o `caminho`, cliente nunca |
| `/api/documentos/[id]/url` | GET | **admin/advogada** | — | `{url, expira_em}` — URL assinada 300 s + linha em `documentos_acessos` |
| `/api/jornadas/[id]/relatorio` | GET/PUT | **admin/advogada** | campos do template da SV | `{relatorio}` |
| `/api/jornadas/[id]/croqui` | GET/POST/PUT | **admin/advogada** | `{titulo, conteudo:{slides:[]}, status}` | `{croqui}` |
| `/api/croquis/[id]/apresentacao` | POST | **admin/advogada** | `{acao:'iniciar'\|'encerrar', slides_vistos?}` | `{apresentacao}` — ao encerrar, avança etapa para `croqui_apresentado` |
| `/api/indicadores` | GET | admin/advogada | `?edicao_id=` | `vw_indicadores_esteira` |
| `/api/webhooks/hotmart` | POST | **público** | payload Hotmart | 200 / 401 / 503 — ver §3.1 |
| `/api/cron/regua` | POST | **cron externo** | header `x-cron-secret` | `{processadas, enviadas, falhas}` — ver §5 |

### 3.1 Webhook Hotmart — contrato de segurança

Ordem **obrigatória**, sem exceção:

1. **Fail-CLOSED de segredo.** `if (!process.env.HOTMART_WEBHOOK_SECRET) return 503`. Nunca `if (secret && ...)` — esse padrão deixa o endpoint público quando a env var some, e já apareceu explorável em produção em outro sistema desta casa.
2. **Comparação em tempo constante** (`crypto.timingSafeEqual`) do header `x-hotmart-hottok` contra o segredo. Falhou → grava `webhooks_eventos` com `assinatura_valida = false` e responde **401** (grava mesmo assim: tentativa inválida é sinal de segurança).
3. **Persistir o bruto primeiro.** `insert into webhooks_eventos ... on conflict (origem, evento_externo_id) do nothing`. Se `rowCount = 0`, é reentrega → responde **200** imediatamente sem reprocessar. Idempotência é do banco, não de cache em memória.
4. **Processar em transação:** casar `produtos.hotmart_produto_id` → resolver/criar `pessoas` por e-mail → achar jornada aberta (ou criar) → `insert into pagamentos` → trigger sobe `nivel_pago` → transicionar etapa → enfileirar `boas_vindas`.
5. **Erro no processamento → 500** (com o bruto já salvo): a Hotmart reentrega e a idempotência do passo 3 protege. Nunca engolir erro devolvendo 200.
6. **Produto desconhecido** (`hotmart_produto_id` sem linha em `produtos`) → grava `erro = 'produto_nao_mapeado'`, responde **200** e aparece numa tela de pendências. Não adivinhar o produto pelo valor.
7. Rate limit simples por IP (60 req/min) e limite de corpo de 1 MB.

---

## 4. Camada de IA

Arquivos: `src/server/ia/cliente.ts` (SDK), `src/server/ia/contexto.ts` (montagem), `src/server/ia/briefing.ts` (orquestração), `src/server/ia/custo.ts`. **Nenhum componente de UI importa o SDK.**

### 4.1 SDK e modelo

`@anthropic-ai/sdk`. Briefing → `claude-opus-5` ($5,00 entrada / $25,00 saída por MTok). Tarefas menores (resumo de transcrição, sugestão de horários, isca pós-sessão) → `claude-sonnet-5` ($2,00 / $10,00).

Armadilhas de API que o backend **precisa** respeitar (verificadas na referência da API):
- `thinking: { type: 'adaptive' }` — `budget_tokens` **retorna 400** nesses modelos.
- Profundidade via `output_config.effort` (`high` para o briefing).
- **Prefill de assistant retorna 400** — formatação vem de structured output ou do system prompt.
- Saída estruturada é `output_config: { format: zodOutputFormat(Schema) }` com `client.messages.parse()`; `parsed_output` pode vir `null` → tratar. O parâmetro antigo `output_format` está deprecado.
- Usar `.stream()` + `finalMessage()` para o briefing (saída longa, evita timeout HTTP).
- Cache de prompt (`cache_control: {type:'ephemeral'}`) no bloco do Protocolo 01, que é idêntico entre clientes — conferir `usage.cache_read_input_tokens > 0` nas execuções seguintes; se vier zero, algo volátil vazou para o prefixo.
- Tratar `stop_reason === 'refusal'` gravando `execucoes_ia.status = 'falhou'` com o motivo. Nunca renderizar briefing vazio como se fosse análise.

### 4.2 O Prompt Mestre vira dado

`prompts_versoes` recebe no seed (`0016`):
- `prompt_mestre` v1 — texto integral do "Prompt Mestre do SIC-HF".
- `protocolo_01_briefing` v1 — `corpo_sistema` = Prompt Mestre + Protocolo 01 integral (as 13 perguntas obrigatórias, a REGRA DE OURO e a exigência de separar fato / hipótese / inferência / recomendação).

Trocar o prompt = INSERT de versão + ativar. **Sem deploy.** Todo briefing guarda `prompt_versao_id`: "qual prompt gerou isto" é sempre respondível.

### 4.3 O que entra no contexto (**allowlist**, nunca denylist)

`montarContextoBriefing(jornadaId)` devolve um objeto tipado, serializado como JSON. Só estes campos:

```
identificacao : { primeiro_nome, faixa_etaria, estado_civil, cidade, uf, profissao }
origem        : { trilha, edicao_codigo, origem }
formulario    : todas as respostas do POP 02, com P9 como FAIXA (texto do formulário)
patrimonio    : { faixa_declarada, tipos_de_bem[], quantidade_imoveis_faixa }
familia       : { quantidade_filhos, todos_maiores, ha_dependente, participantes_da_sessao[] }
ligacao       : { respostas, expectativa_principal, preocupacao_principal,
                  assunto_atencao_especial, objecoes_percebidas[], pessoas_mencionadas[],
                  ritmo, estilo_resposta, sinais[], frases_marcantes[], processo_decisorio,
                  decisores_presentes_na_sessao }
transcricao   : SOMENTE se app.tem_consentimento(pessoa,'tratamento_ia') = true
```

**Nunca entram, em hipótese nenhuma:** CPF/RG, endereço completo, dados bancários, **valores absolutos de patrimônio** (só faixa), conteúdo de IR ou contrato social, anexos de qualquer natureza, sobrenome completo quando dispensável, dado de fonte pública sobre terceiros.

`fontes_usadas[]` é gravado no briefing e **exibido na tela**: a advogada vê que aquele briefing saiu de formulário + observações, sem transcrição — e sabe o quanto pesar a conclusão.

### 4.4 Trava de consentimento

A rota de briefing verifica `app.tem_consentimento(pessoa_id, 'tratamento_ia')`.
- **Sem consentimento** → gera o briefing em **modo reduzido** (sem transcrição literal), grava `fontes_usadas` sem `'transcricao'` e a UI mostra o selo *"Briefing sem transcrição — consentimento de tratamento por IA não registrado"*.
- Nunca falha em silêncio, nunca manda a transcrição assumindo consentimento. O 1º SIM do script autoriza *gravação para análise da equipe* — não autoriza, com as palavras que estão lá hoje, tratamento por operador de IA no exterior. Ver **BLOQUEIO B3**.

### 4.5 Saída estruturada

Zod `BriefingSchema` — 12 seções na ordem exata do Protocolo 01:

```
resumo_executivo: string
perfil_disc: { predominante, secundario, confianca: 0-100, evidencias: string[] }
arquetipo_patrimonial: { escolhido, justificativa, evidencias: string[] }
o_que_protege: { objeto, justificativa }
motivadores: { principal, secundarios: string[], justificativa }
objecoes_provaveis: [{ objecao, probabilidade: 'alta'|'media'|'baixa', justificativa }]
processo_decisorio: { velocidade, necessidade_seguranca, necessidade_validacao,
                      necessidade_detalhe, decisores: string[] }
linguagem_recomendada: { tom: string[], justificativa }
pontos_de_atencao: [{ nao_fazer, motivo }]
perguntas_para_aprofundar: [{ pergunta, motivo }]
frases_para_o_fechamento: [{ frase_literal, como_usar }]
estrategia_sessao: { ritmo, mais_tempo_em: string[], menos_tempo_em: string[],
                     momento_croqui, momento_investimento, tratamento_objecoes }
estrategia_fechamento: string
grau_confianca: 0-100
lacunas: string[]        // o que faltou — a REGRA DE OURO exige dizer
```

Cada conclusão carrega `evidencias[]`. Sem evidência, a UI marca a seção como **hipótese**, e não como fato. É a REGRA DE OURO do Protocolo 01 virando restrição de schema, não pedido no prompt.

### 4.6 Custo e observabilidade

Após cada chamada, gravar em `execucoes_ia`: `tokens_entrada`, `tokens_saida`, `tokens_cache_escrita`, `tokens_cache_leitura`, `latencia_ms`, `stop_reason`, `request_id` (`response._request_id`).
Custo = tokens × preço de `modelos_ia_precos` (cache escrita ×1,25; leitura ×0,10). Preço nunca hardcoded no TS.
Tela `/admin/ia` mostra custo por jornada, por mês e por versão de prompt.

---

## 5. Régua de comunicação

### 5.1 Decisão: **cron externo da Hostinger**, não `pg_cron`

Justificativa (e não é preferência):
1. As credenciais de e-mail e a renderização de template vivem no app Node. `pg_cron` obrigaria a guardar segredo no banco e chamar HTTP com `pg_net` — mais superfície e um segredo a mais para rotacionar.
2. O painel da Hostinger já tem cron; é `curl` a cada 5 min. Custo operacional zero.
3. Um mecanismo só. Ter `pg_cron` *e* worker HTTP cria dois donos da mesma fila — e um dia eles disparam a mesma mensagem duas vezes.
4. O banco continua sendo a fonte da verdade da fila; o cron é só o gatilho. Trocar o gatilho depois não muda schema.

```
*/5 * * * *  curl -fsS -m 60 -X POST https://<dominio>/api/cron/regua -H "x-cron-secret: $CRON_SECRET"
```

`/api/cron/regua` é **fail-closed**: sem `CRON_SECRET` na env → 503 e log crítico. Header ausente/errado → 401.

### 5.2 Fila e idempotência

Reivindicação segura contra execuções sobrepostas:

```sql
update mensagens_agendadas m set status = 'enviando', tentativas = tentativas + 1
 where m.id in (
   select id from mensagens_agendadas
    where status = 'pendente' and agendada_para <= now()
      and (proxima_tentativa_em is null or proxima_tentativa_em <= now())
    order by agendada_para
    for update skip locked
    limit 50)
returning *;
```

`chave_idempotencia` única impede duplicata mesmo com corrida. Falha → `status='falhou'`, `proxima_tentativa_em = now() + 2^tentativas min`, máximo 5 tentativas.

### 5.3 As quatro réguas

| Chave | Gatilho | Quando | Canais |
|---|---|---|---|
| `boas_vindas` | pagamento `sessao_viabilidade` aprovado | imediato | e-mail + WhatsApp |
| `confirmacao_d7` | agendamento confirmado | `inicio_em - 7 dias` | WhatsApp (e-mail se sem telefone) |
| `dia_da_sessao` | agendamento confirmado | `inicio_em - 10 min` (sala abre 10 min antes) | e-mail com `link_sala` |
| `pos_sessao` | sessão marcada realizada | +2 h | e-mail com material/isca |

**Remarcação:** ao mudar/cancelar um agendamento, todas as `mensagens_agendadas` com `status='pendente'` daquele `agendamento_id` viram `cancelada` e novas são criadas para o slot novo. Mensagens já **enviadas** permanecem — são histórico. Se o D-7 já passou no momento da remarcação, ele **não** é reenviado (a `chave_idempotencia` inclui o `agendamento_id`, então o slot novo tem chave nova; a regra de negócio é: só agenda se `inicio_em - 7d > now()`).

### 5.4 Canais

- **E-mail:** Resend. Sem `RESEND_API_KEY` ou `EMAIL_REMETENTE` → a mensagem fica `falhou` com `erro='remetente nao configurado'` e aparece na tela de pendências. Nunca some em silêncio. Domínio/remetente → **BLOQUEIO B8**.
- **WhatsApp:** sem provedor decidido (**BLOQUEIO B8**). MVP entrega **fila manual honesta**: a mensagem é renderizada, aparece em `/comunicacao` com botão *"Copiar texto"* + link `wa.me`, e o operador clica *"Marcar como enviada"* (grava `enviada_em` + quem marcou). A UI diz, escrito: **"Envio manual — o sistema não dispara WhatsApp ainda."** Nenhuma tela finge automação que não existe.

---

## 6. Plano de execução em fatias

Legenda: **[CC]** caminho crítico da demo de amanhã · **[S]** stub honesto rotulado na UI.

### Ordem e dependências

```
F0 (back, sozinho, bloqueia tudo)
  └─> F1 back ‖ F1 front
        └─> F2 back ‖ F2 front
              ├─> F3 (IA)      back ‖ front
              ├─> F4 (Hotmart+régua) back ‖ front
              └─> F5 (croqui)  back ‖ front
                    └─> P (pentester)  └─> Fable
```

### backend-engineer

| # | Tarefa | Fatia | Entrega |
|---|---|---|---|
| **B0** | Bootstrap: `create-next-app` (App Router, TS, Tailwind), `next.config.mjs` com `output:'standalone'`, `@supabase/ssr`, `@anthropic-ai/sdk`, `zod`, `resend`. `.env.example` completo. `README` com o passo da Hostinger (copiar `.next/static` e `public/` para dentro de `.next/standalone/`). | **[CC]** F0 | projeto sobe local |
| **B1** | Projeto Supabase novo na org Grupo Participa, **região `sa-east-1`**. Migrations `0001`–`0004` aplicadas. | **[CC]** F0 | `supabase db push` verde |
| **B2** | Migrations `0005`–`0008` (consentimento, formulário, ligação, família/patrimônio, sessão/agenda/relatório). | **[CC]** F0 | — |
| **B3** | Auth: login e-mail/senha, middleware de sessão, `/api/auth/vincular`, guard de papel em `src/server/auth.ts`. **Teste explícito: usuário sem convite não lê uma linha sequer.** | **[CC]** F0 | — |
| **B4** | Seed `0016`: 1 edição, 6 pessoas/jornadas espalhadas nas etapas, 1 formulário, 1 ligação, produtos, templates, prompts v1. Toda linha com `origem_dado='exemplo'`. | **[CC]** F0 | demo tem dado |
| **B5** | `GET/POST /api/jornadas`, `PATCH /api/jornadas/[id]/etapa` (valida transição no servidor **antes** do banco, para dar erro legível), `GET /api/jornadas/[id]` (Ficha 360, com recorte de patrimônio por papel). | **[CC]** F1 | — |
| **B6** | `formulario`, `ligacao`, `patrimonio`, `familiares`, `relatorio`, `agendamentos`. Trigger de timeline em cada um. | **[CC]** F2 | — |
| **B7** | Migration `0009` + camada de IA (§4) + `POST /api/jornadas/[id]/briefing` + `GET /api/briefings/[id]`. Registro de custo obrigatório. | **[CC]** F3 | — |
| **B8** | Migrations `0011` + `0013`. `POST /api/webhooks/hotmart` com os 7 passos da §3.1. **Teste com secret ausente → tem que dar 503**, e com evento repetido → 200 sem duplicar. | **[CC]** F4 | — |
| **B9** | `POST /api/cron/regua` + worker de fila + Resend + enfileiramento das 4 réguas + cancelamento em remarcação. | F4 | — |
| **B10** | Migrations `0010` + `0012`. Upload de documento (validação mime/tamanho no servidor, caminho montado pelo servidor), `GET /api/documentos/[id]/url` com URL assinada 300 s + `documentos_acessos`. | F5 | — |
| **B11** | `croqui` CRUD + `POST /api/croquis/[id]/apresentacao` (encerrar avança etapa). | F5 | — |
| **B12** | Migration `0015` (views) + `GET /api/indicadores`. | F5 | — |
| **B13** | **[S]** `pesquisas_publicas`: só a tabela e a tela vazia com selo **"NÃO IMPLEMENTADO — pendente de decisão jurídica (LGPD)"**. Zero scraping. Ver **BLOQUEIO B4**. | **[S]** F5 | — |

### frontend-engineer

| # | Tarefa | Fatia | Entrega |
|---|---|---|---|
| **F1** | Shell: layout autenticado, navegação (Esteira · Agenda · Comunicação · Indicadores · Admin), tema, componente `<SeloStub>` (tarja âmbar, texto obrigatório) e `<SeloDadoExemplo>`. | **[CC]** F1 | — |
| **F2** | **Kanban da esteira**: colunas vindas de `etapas_jornada_ordem` (nunca hardcoded), card com nome, cidade/UF, faixa declarada, selos *Formulário · Ligação · Briefing*, dias na etapa. Filtros: edição, origem, responsável, busca, alternar "mostrar fechadas". Drag-and-drop chamando `PATCH .../etapa`; **em erro 409, o card volta ao lugar com o motivo** — nunca move otimista sem confirmação. | **[CC]** F1 | — |
| **F3** | **Ficha 360** `/jornadas/[id]`: cabeçalho (pessoa, etapa, desfecho, origem/edição, nível pago) + abas *Formulário · Ligação · Patrimônio · Documentos · Sessão · Briefing · Croqui · Linha do tempo*. Abas de patrimônio/documentos **não aparecem** para quem não pode ver (esconder E o servidor negar). | **[CC]** F2 | — |
| **F4** | Formulário do POP 02 renderizado a partir de `formularios.definicao` (17 perguntas, condicional da P11) e formulário do POP 03 com os campos obrigatórios de registro — frases marcantes como lista, sinais como chips. | **[CC]** F2 | — |
| **F5** | **Tela do Briefing**: 12 seções na ordem do Protocolo 01, badge de `grau_confianca`, `fontes_usadas` visível, seção sem evidência marcada como *hipótese*, bloco `lacunas` em destaque. Botão "Gerar/Regerar" com estado de carregamento e histórico de versões. | **[CC]** F3 | — |
| **F6** | **Croqui modo apresentação** `/jornadas/[id]/croqui/[croquiId]/apresentar`: tela cheia, sem chrome, navegação por seta/espaço/Esc, contador de slides, `print` decente. Editor simples de slides tipados. | **[CC]** F5 | — |
| **F7** | Agenda: lista dos próximos agendamentos, criar/remarcar/cancelar, marcar no-show e realizada. Conflito de horário mostra erro do banco de forma legível. | F5 | — |
| **F8** | `/comunicacao`: fila de mensagens (pendentes, enviadas, falhas) + **fila manual de WhatsApp** com "Copiar texto", link `wa.me` e "Marcar como enviada". Texto fixo: *"Envio manual — o sistema não dispara WhatsApp ainda."* | **[S]** F4 | — |
| **F9** | Upload de documentos (drag-drop, barra de progresso, aviso de PII) e visualização por URL assinada. | F5 | — |
| **F10** | `/indicadores` (POP 08) com o que a view realmente calcula. **Indicador sem fonte de dado não é exibido** — nem zerado, nem placeholder. | F5 | — |

### security-pentester (**obrigatório** — o desenho toca auth, RLS, PII, pagamento, upload e endpoint público)

| # | Alvo | O que auditar |
|---|---|---|
| **P1** | RLS de ponta a ponta | Logar como `relacionamento` e como `assistente` e tentar ler `patrimonio_itens`, `relatorios_sessao`, `croquis`, `documentos`, `execucoes_ia`. Tentar pelas **views** (`security_invoker` está mesmo ligado?) e pelo PostgREST direto com a anon key. |
| **P2** | `/api/webhooks/hotmart` | Sem `HOTMART_WEBHOOK_SECRET` na env → tem que ser 503, nunca 200. Hottok errado → 401. Replay do mesmo `evento_externo_id` → nenhuma duplicata em `pagamentos`. Payload forjado com produto de valor maior → não pode subir `nivel_pago`. |
| **P3** | Documentos e Storage | Path traversal no nome do arquivo; upload de mime falsificado; adivinhar URL de objeto do bucket; URL assinada continua válida depois do papel do usuário ser revogado; `documentos_acessos` registra todo acesso. |
| **P4** | Vazamento de PII para a IA | Provar que valor absoluto de patrimônio, CPF, endereço e conteúdo de documento **não** aparecem no payload enviado à Anthropic. Provar que sem `tratamento_ia` a transcrição não vai. Conferir que `execucoes_ia` não guarda o prompt completo com PII. |
| **P5** | Auth e escalonamento | Usuário autenticado sem convite (`app.papel()` NULL) tenta tudo. Chamar `PATCH /etapa` como `assistente`. Forjar `perfis_equipe.papel` via PostgREST. Verificar que `service_role` não vaza para bundle client (`grep` no `.next`). |

---

## 7. CONFLITO

| # | Conflito | Consequência | Encaminhamento |
|---|---|---|---|
| **C1** | **O nome.** O documento institucional diz *"Sistema de Inteligência para **Conversão** em Holding Familiar"*; o POP 03 v1.0 e o pedido do João dizem *"Inteligência **Comercial**"*. O mesmo documento afirma: *"O sistema não foi desenvolvido para vender"*. | Duas identidades para o mesmo produto no mesmo material. | Mantenho a sigla **SIC-HF** e uso "Sistema de Inteligência para Conversão" no produto, por ser a do documento institucional que também define os princípios. Decisão final: Dra. Elaine. |
| **C2** | **MQL por patrimônio > R$ 1 milhão.** O único dado patrimonial estruturado é a P9 do formulário — que só é respondida **depois** da compra (POP 02 é pós-contratação). E a faixa `Entre R$ 500 mil e R$ 1 milhão` não separa exatamente em R$ 1 mi. | O critério de MQL, como enunciado, **não tem fonte de dado no momento em que precisa ser aplicado**. | Vira **BLOQUEIO B1**. Schema já suporta: `jornadas.faixa_patrimonio_declarada` + etapa `qualificado` opcional (salto 10→30 permitido). |
| **C3** | **Ordem do agendamento.** O João descreve: compra → formulário → ligação → **agendamento**. O POP 01 manda **agendar na Etapa 3**, antes de orientar sobre formulário (Etapa 4) e ligação (Etapa 5). | Se o agendamento vem antes, o D-7 pode disparar antes de existir formulário e briefing. Se vem depois, a etapa `sessao_agendada` demora e o kanban engana. | Modelei agendamento **independente** do formulário (por isso preparo é selo, não etapa). Mas a régua D-7 precisa de uma verdade: **quem confirma qual ordem vale?** |
| **C4** | **POP 03 x POP 03-B.** O documento traz um segundo fluxo completo para quem **não** foi ao seminário, com outra reunião ("Reunião Preliminar de Diagnóstico"). O escopo do João só prevê a trilha do seminário. | Metade do material operacional ficaria fora do sistema. | `jornadas.trilha` (`seminario` \| `preliminar`) já está no schema. **O MVP só entrega a trilha `seminario`** — a outra fica desenhada e desligada. |
| **C5** | **O script existe em 4 versões no mesmo arquivo** (Guias 1–4), sem numeração e sem indicação de qual vale. A 4ª traz falas que a 1ª não tem (ex.: "Condição dos Resolvedores"). | Um roteiro na tela precisa apontar para **uma** versão. | Proponho `roteiros_versoes` (mesmo padrão de `prompts_versoes`) na fase 2. Para o MVP não coloco roteiro na tela. Alguém precisa carimbar a v1. |
| **C6** | **"O Croqui vira HTML em apresentação"** — mas no script (PARTES 10-12) o que acontece na Sessão de Viabilidade é a **oferta** do croqui, não o croqui. O croqui pronto é apresentado depois, no POP 06. | Duas apresentações diferentes sendo tratadas como uma. | Modelei o `croquis` como **POP 06** (croqui pronto, pós-pagamento) e a oferta feita na SV como `ofertas`. Se o João quis a outra, o front muda de lugar, o schema não. |
| **C7** | **Consentimento x IA.** O 1º SIM autoriza gravação *"para que minha equipe possa analisar"*. Enviar a transcrição para a Anthropic é tratamento por operador terceiro, fora do Brasil — não coberto por essa frase. | O item central do sistema (briefing a partir da transcrição) opera sobre base de consentimento frágil. | Vira **BLOQUEIO B3**. Implementei a trava técnica (§4.4) para o sistema funcionar **em modo reduzido** enquanto a decisão não vem. |
| **C8** | **Preço vs. webhook.** O script tem R$ 7.200 padrão e R$ 4.500 no "Incentivo do Resolvedor", *"válido apenas para quem decide hoje"*. O webhook da Hotmart não informa qual condição foi aplicada. | Sem registrar a oferta, o valor recebido não reconcilia com nada e não dá para medir a eficácia do incentivo. | Tabela `ofertas` obrigatória: a advogada registra o que ofertou **antes** do pagamento chegar. |

---

## 8. BLOQUEIO — decisões que não são minhas

| # | Bloqueio | Por que não decido | O que trava |
|---|---|---|---|
| **B1** | **Critério de MQL.** De onde sai o patrimônio **antes** da compra? A faixa "R$ 500 mil a R$ 1 milhão" entra ou não? MQL é etapa manual ou automática? | Define quem a equipe liga e quem ignora. Errar aqui descarta gente com dinheiro ou queima time com gente sem. | Etapa `qualificado` e qualquer automação de qualificação. O resto do MVP anda sem isso. |
| **B2** | **Lead que não paga.** Fica `aberta` esperando a próxima edição, ou fecha como `perdida` e a volta cria jornada nova? | Muda a contagem de "leads" **para sempre** e afeta o índice único de jornada aberta. Não invento critério que redefine o funil. | Régua de reengajamento e o número do funil por edição. |
| **B3** | **LGPD / IA.** Autorização explícita para tratamento de transcrição e dados patrimoniais por IA de terceiro (Anthropic, EUA). Proposta: acrescentar uma frase ao 1º SIM + registrar em `consentimentos`. | É decisão jurídica da Dra. Elaine, não de arquitetura. | Briefing com transcrição. Sem a decisão, roda em modo reduzido e **avisa na tela**. |
| **B4** | **Pesquisa em fonte pública (JusBrasil).** Base legal, o que pode ser guardado, se entra no briefing, e o meio técnico — o JusBrasil não tem API pública contratada; raspar tem risco de ToS e jurídico. | Advogada tratando dado judicial de cliente sem base legal definida é exposição séria. | Todo o módulo. Entregue como **[S]** stub rotulado. |
| **B5** | **Quem vê patrimônio de quem.** Minha proposta: `admin`/`advogada` veem valores, IR e contrato social; `relacionamento` vê só a faixa declarada; `assistente` vê só agenda e contato. | É política de acesso a dado sensível de cliente do escritório. | Nada — implemento a proposta. Mas precisa de OK explícito antes de subir para produção com cliente real. |
| **B6** | **A Holding é venda Hotmart ou contrato fora da plataforma?** | Define se existe um 3º webhook ou registro manual da etapa 80. | Fechamento da esteira. |
| **B7** | **Credenciais Hotmart:** os 3 `hotmart_produto_id` reais e o mecanismo de verificação (hottok / basic auth / assinatura) da versão contratada. | Não invento id de produto nem esquema de assinatura. | O webhook sai do stub. Até lá, `produtos` fica vazio e o webhook responde 200 marcando `produto_nao_mapeado`. |
| **B8** | **Domínio/remetente de e-mail** e **provedor de WhatsApp** (API oficial da Meta? Z-API? manual permanente?). | Domínio errado no Resend queima reputação de envio; WhatsApp não oficial é risco de banimento do número. | Envio automático. WhatsApp entrega como fila manual rotulada. |
| **B9** | **Retenção.** Por quanto tempo guardar gravação, transcrição, IR e contrato social? Expurgo automático? | Guardar IR de cliente por prazo indeterminado é passivo, não patrimônio. Sem prazo, não escrevo política de expurgo. | Job de expurgo. O schema já suporta (`criado_em` em tudo, exclusão lógica). |
| **B10** | **Sala da reunião.** Link fixo por advogada ou gerado por sessão? Integração com a API do Zoom ou colagem manual? | Muda a régua do dia da sessão e o "abre 10 min antes". | MVP: campo manual `sessoes_viabilidade.link_sala`, rotulado. |

---

## 9. Os 5 critérios do Fable

| Critério | O que este plano garante |
|---|---|
| **Segurança** | RLS ligada na mesma migration da tabela, `force row level security`, quatro papéis com recorte real (patrimônio/IR/relatório/croqui só para `admin` e `advogada`), acesso ao portal **por convite** — signup sem convite não lê uma linha; webhook Hotmart **fail-closed** (sem secret → 503, nunca 200), idempotente por `evento_externo_id` e com comparação em tempo constante; documentos em bucket privado com URL assinada de 300 s e auditoria de acesso; contexto da IA por **allowlist** com trava de consentimento; views com `security_invoker` para não virarem porta dos fundos; 5 tarefas obrigatórias de pentester. |
| **Escalabilidade** | Kanban lê uma view com índice parcial `(etapa, edicao_id) where desfecho='aberta'` — o custo acompanha o *aberto*, não o histórico. Funções de papel envolvidas em `(select ...)` para virarem InitPlan avaliado uma vez, e não por linha. Fila de mensagens com `FOR UPDATE SKIP LOCKED` suporta workers concorrentes sem mudar nada. Timeline particionável por data quando crescer. A 10× o volume (≈6 edições/ano × milhares de captados) nada aqui muda de forma: o que dobra é linha em tabela indexada. |
| **Solidificação** | Invariantes que o **banco** passa a garantir sozinho: uma jornada aberta por pessoa (índice único parcial); etapa nunca regride e nunca cai abaixo do nível pago (trigger + tabela de ordem); transição só pelas permitidas (tabela, não `if` no código); a Dra. Elaine não é agendada em dois lugares ao mesmo tempo (exclusion constraint GiST); um agendamento confirmado por sessão; um briefing atual por jornada; um prompt ativo por chave; mensagem da régua nunca duplica (`chave_idempotencia` única); pagamento nunca duplica (`unique(origem, transacao_externa_id)`); desfecho ≠ aberta exige motivo (check). Nenhuma dessas depende de o app lembrar de verificar. |
| **UX** | O kanban mostra a esteira do POP 01 ao POP 06 com as colunas vindas do banco. O card diz, sem clicar, se falta formulário, ligação ou briefing. Card não se move sozinho: erro de transição devolve o card com o motivo escrito. A Ficha 360 substitui a caça a informação em Typeform + planilha + WhatsApp. O briefing chega na ordem exata que a advogada já conhece do Protocolo 01, com grau de confiança, fontes usadas e lacunas visíveis — ela sabe **quanto** confiar. Toda parte não pronta é **stub rotulado em âmbar**; nenhuma tela finge dado ou automação. |
| **Otimização** | A feature **remove** trabalho em vez de empilhar: (a) preparo é derivado da existência da linha filha — zero flag duplicada, zero drift entre "tem formulário" e ter formulário; (b) indicadores do POP 08 saem de `jornadas_transicoes` e de views, sem tabela de métrica paralela para manter sincronizada; (c) ordem de etapa, transições, prompts e templates são **dado** — mexer neles é `UPDATE`, não deploy; (d) uma timeline única alimenta a Ficha 360 em uma consulta, no lugar de sete costuradas no front; (e) preço de modelo em tabela, não constante espalhada; (f) um único mecanismo de agendamento de mensagem (cron externo), recusando o segundo dono da fila. |

---

## 10. Anexo — convenções e ambiente

### `.env.example`

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # SÓ no servidor. Nunca com prefixo NEXT_PUBLIC_.
ANTHROPIC_API_KEY=
HOTMART_WEBHOOK_SECRET=           # ausente => /api/webhooks/hotmart responde 503
CRON_SECRET=                      # ausente => /api/cron/regua responde 503
RESEND_API_KEY=
EMAIL_REMETENTE=
APP_URL=
TZ=America/Sao_Paulo
```

### Hostinger (Node.js App) — checklist de deploy

1. `next.config.mjs`: `output: 'standalone'`, `images: { unoptimized: true }`, `experimental.serverActions.bodySizeLimit: '20mb'`.
2. `runtime = 'nodejs'` em **toda** rota. Nenhum `export const runtime = 'edge'`.
3. Nada de API exclusiva da Vercel: sem `@vercel/*`, sem `vercel.json`, sem cron da Vercel, sem `waitUntil`.
4. Pós-build, copiar `public/` e `.next/static/` **para dentro** de `.next/standalone/` — o standalone não os inclui. É a causa clássica de "sobe mas fica sem CSS".
5. Start: `node .next/standalone/server.js`, porta vinda de `process.env.PORT`.
6. Cron do painel: `*/5 * * * *` → `curl` para `/api/cron/regua` com `x-cron-secret`.
7. `TZ=America/Sao_Paulo` no ambiente; guardar sempre `timestamptz`.

### Regras de código para os executores

- Nenhuma rota confia só na RLS, e nenhuma confia só no guard da rota. As duas camadas, sempre.
- `service_role` só em: webhook, cron, IA, upload. Um `grep -r "SERVICE_ROLE" src/app/**/page.tsx` tem que voltar vazio.
- Nada de `DELETE`. Baixa é `ativo = false` ou `desfecho`.
- Todo `catch` grava o erro em algum lugar consultável. Nunca `catch {}`.
- `COALESCE` só quando zero for **de fato** o valor — nunca para esconder ausência de dado.
- Todo stub carrega `<SeloStub texto="..." />`. Stub sem selo é reprovação automática.
