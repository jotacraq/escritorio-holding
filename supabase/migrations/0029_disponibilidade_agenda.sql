-- 0029_disponibilidade_agenda.sql
-- B-1B (Fase 2, ONDA 1) — agendamento pelo cliente: a advogada declara JANELAS,
-- o sistema deriva SLOTS na consulta. Ponto de desenho fixado pelo plano
-- (ARQUITETURA-FASE-2.md §4.2): slot NÃO é linha guardada — materializar geraria
-- milhares de linhas por semana que envelhecem sozinhas (§8 Escalabilidade).
--
-- DEPENDÊNCIA: esta migration referencia `links_publicos` (0028_links_publicos.sql,
-- B-1A) em `agendamentos_sugestoes.link_id`. Aplicar depois de 0028.
--
-- CONFLITO C10 (o ponto delicado): o método não define o que torna um horário
-- "melhor" — nenhum POP, nenhuma matriz. A IA aqui ORDENA os slots que a
-- advogada já abriu e escreve o motivo de cada posição; ela NUNCA escolhe nem
-- inventa horário. Sem ligação estratégica registrada para a jornada, a ordem é
-- cronológica pura, `motivo_sugestao = NULL`, e nenhuma linha de código chama a
-- IA (zero custo). Isto é resolvido em `src/server/agenda/sugestoes.ts` — o SQL
-- desta migration só guarda o resultado (colunas `posicao`/`motivo_sugestao`/
-- `execucao_ia_id`), nunca decide.

-- ===========================================================================
-- Configuração operacional que faltou em 0027 para esta feature funcionar.
-- BLOQUEIO B12: duração e antecedência mínima NÃO vêm do método — valor
-- inicial, ajustável em Admin sem deploy. `agenda.duracao_padrao_minutos` e
-- `agenda.slots_ofertados_ao_cliente` já existem desde 0027; faltavam estas duas.
-- ===========================================================================
insert into configuracoes (chave, valor, descricao) values
 ('agenda.antecedencia_minima_horas', '24'::jsonb,
  'VALOR INICIAL, não vem do método (BLOQUEIO B12). Não ofertar slot que comece '
  'em menos que isto a partir de agora.'),
 ('agenda.horizonte_dias_oferta', '21'::jsonb,
  'Quantos dias à frente a agenda considera ao gerar os horários ofertados '
  '(link público e preview interno). Valor inicial, ajustável em Admin.')
on conflict (chave) do nothing;

-- ===========================================================================
-- Janelas de disponibilidade recorrentes da advogada.
-- ===========================================================================
create table disponibilidades (
  id               uuid primary key default gen_random_uuid(),
  advogada_id      uuid not null references perfis_equipe(id),
  dia_semana       smallint not null check (dia_semana between 0 and 6), -- 0=domingo, igual extract(dow)
  hora_inicio      time not null,
  hora_fim         time not null,
  -- Sem DEFAULT na coluna de propósito (BLOQUEIO B12): o valor inicial vem de
  -- `configuracoes.agenda.duracao_padrao_minutos`, lido pela rota no momento da
  -- criação (`src/server/agenda/disponibilidades.ts`) — nunca uma constante de
  -- schema e uma constante de TS que podem divergir silenciosamente entre si.
  duracao_minutos  smallint not null check (duracao_minutos > 0),
  vale_de          date not null default current_date,
  vale_ate         date,
  ativa            boolean not null default true,
  criado_em        timestamptz not null default now(),
  criado_por       uuid references perfis_equipe(id),
  constraint ck_disp_janela check (hora_fim > hora_inicio),
  constraint ck_disp_vigencia check (vale_ate is null or vale_ate >= vale_de)
);
create index idx_disponibilidades_advogada on disponibilidades (advogada_id) where ativa;

-- ===========================================================================
-- Exceções pontuais (folga, feriado, compromisso fora da agenda). Baixa é
-- `cancelado_em`, nunca DELETE — mesma convenção de `ativo`/`status` usada em
-- todo o resto do schema (0007/0008/0021).
-- ===========================================================================
create table agenda_bloqueios (
  id             uuid primary key default gen_random_uuid(),
  advogada_id    uuid not null references perfis_equipe(id),
  inicio_em      timestamptz not null,
  fim_em         timestamptz not null,
  motivo         text not null,
  criado_em      timestamptz not null default now(),
  criado_por     uuid references perfis_equipe(id),
  cancelado_em   timestamptz,
  cancelado_por  uuid references perfis_equipe(id),
  constraint ck_bloq_janela check (fim_em > inicio_em)
);
create index idx_bloqueios_advogada on agenda_bloqueios (advogada_id, inicio_em) where cancelado_em is null;

-- ===========================================================================
-- Slots livres: DERIVADOS na consulta (STABLE, não materializa nada).
-- Cruza `disponibilidades` vigentes (dia da semana, vale_de/vale_ate, ativa) com
-- o calendário em America/Sao_Paulo, corta o que já tem `agendamentos` ativo ou
-- `agenda_bloqueios` sobreposto, e aplica a antecedência mínima de
-- `configuracoes`. `language sql stable` (sem SECURITY DEFINER): roda com o
-- privilégio de quem chama — só uso interno, nunca exposta a `anon` (a mesma
-- razão de `app` não ser schema exposto ao PostgREST, ver 0002).
-- ===========================================================================
create or replace function app.slots_disponiveis(p_advogada uuid, p_de timestamptz, p_ate timestamptz)
returns table (inicio_em timestamptz, fim_em timestamptz)
language sql stable
set search_path = public, pg_temp
as $$
  with parametros as (
    select coalesce(
      (select (valor #>> '{}')::int from configuracoes where chave = 'agenda.antecedencia_minima_horas'),
      24
    ) as antecedencia_horas
  ),
  dias as (
    select generate_series(
      (p_de at time zone 'America/Sao_Paulo')::date,
      (p_ate at time zone 'America/Sao_Paulo')::date,
      interval '1 day'
    )::date as dia_local
  ),
  janelas as (
    select d.dia_local, disp.hora_inicio, disp.hora_fim, disp.duracao_minutos
      from dias d
      join disponibilidades disp
        on disp.advogada_id = p_advogada
       and disp.ativa
       and disp.dia_semana = extract(dow from d.dia_local)::smallint
       and d.dia_local >= disp.vale_de
       and (disp.vale_ate is null or d.dia_local <= disp.vale_ate)
  ),
  candidatos as (
    select
      ((j.dia_local::timestamp + j.hora_inicio) at time zone 'America/Sao_Paulo')
        + (s.n * (j.duracao_minutos::text || ' minutes')::interval) as inicio_em,
      j.duracao_minutos
    from janelas j
    cross join lateral generate_series(
      0,
      floor(extract(epoch from (j.hora_fim - j.hora_inicio)) / (j.duracao_minutos * 60))::int - 1
    ) as s(n)
  ),
  slots as (
    select c.inicio_em, c.inicio_em + (c.duracao_minutos::text || ' minutes')::interval as fim_em
      from candidatos c
  )
  select s.inicio_em, s.fim_em
    from slots s, parametros p
   where s.inicio_em >= p_de
     and s.fim_em <= p_ate
     and s.inicio_em >= now() + (p.antecedencia_horas::text || ' hours')::interval
     and not exists (
       select 1 from agendamentos a
        where a.advogada_id = p_advogada
          and a.status in ('agendado', 'confirmado')
          and tstzrange(a.inicio_em, a.fim_em) && tstzrange(s.inicio_em, s.fim_em)
     )
     and not exists (
       select 1 from agenda_bloqueios b
        where b.advogada_id = p_advogada
          and b.cancelado_em is null
          and tstzrange(b.inicio_em, b.fim_em) && tstzrange(s.inicio_em, s.fim_em)
     )
   order by s.inicio_em
$$;

-- `app.*` tem EXECUTE revogado de PUBLIC por padrão desde 0024 (default
-- privileges do schema). Grant explícito só para `authenticated` — uso interno.
grant execute on function app.slots_disponiveis(uuid, timestamptz, timestamptz) to authenticated;

-- Wrapper fino em `public`, mesmo padrão de `public.vincular_perfil` (0002):
-- PostgREST só expõe o schema `public`, então o `.rpc()` do supabase-js do
-- Next precisa deste wrapper para chegar em `app.slots_disponiveis`.
-- `security invoker` (padrão, explícito por clareza): a chamada roda com o
-- papel de quem pediu — a RLS de `disponibilidades`/`agenda_bloqueios`/
-- `agendamentos` vale normalmente, nunca vira porta dos fundos.
create or replace function public.listar_slots_disponiveis(p_advogada uuid, p_de timestamptz, p_ate timestamptz)
returns table (inicio_em timestamptz, fim_em timestamptz)
language sql security invoker set search_path = public, pg_temp as $$
  select * from app.slots_disponiveis(p_advogada, p_de, p_ate)
$$;
revoke execute on function public.listar_slots_disponiveis(uuid, timestamptz, timestamptz) from public, anon;
grant  execute on function public.listar_slots_disponiveis(uuid, timestamptz, timestamptz) to authenticated;

-- ===========================================================================
-- Os horários que FORAM ofertados num link de agendamento específico. Sem
-- isto, `escolher_horario_publico` (0028, B-1A) aceitaria qualquer timestamp e
-- o cliente marcaria fora da agenda real da advogada.
-- ===========================================================================
create table agendamentos_sugestoes (
  id               uuid primary key default gen_random_uuid(),
  link_id          uuid not null references links_publicos(id) on delete cascade,
  inicio_em        timestamptz not null,
  fim_em           timestamptz not null,
  posicao          smallint not null check (posicao > 0), -- 1 = primeira posição da ordem
  motivo_sugestao  text,                                  -- NULL = ordem cronológica, nunca "sugestão" na tela
  execucao_ia_id   uuid references execucoes_ia(id),
  criado_em        timestamptz not null default now(),
  unique (link_id, inicio_em),
  unique (link_id, posicao)
);
create index idx_agendamentos_sugestoes_link on agendamentos_sugestoes (link_id);

-- ===========================================================================
-- Cooldown de IA (app.pode_executar_ia, 0027) reaproveitado por esta feature —
-- ACHADO em `app.pode_executar_ia`: a função NÃO é SECURITY DEFINER, então
-- rodando como `authenticated` sem `ve_patrimonio()` (papel 'relacionamento'/
-- 'assistente'), a policy `ex_sel` de `execucoes_ia` ("só admin/advogada")
-- filtra as linhas ANTES do `not exists(...)` avaliar — o cooldown vira sempre
-- "true" (parece que nunca houve execução) para quem não é admin/advogada.
-- Não é desta migration mexer em 0027; o wrapper abaixo cobre isso rodando
-- SECURITY DEFINER, dando a resposta real independente de quem pergunta —
-- mesma técnica de `public.registrar_briefing`.
-- ===========================================================================
create or replace function public.verificar_cooldown_ia(p_jornada_id uuid, p_perfil_id uuid)
returns boolean
language sql security definer set search_path = public, pg_temp as $$
  select app.pode_executar_ia(p_jornada_id, p_perfil_id)
$$;
revoke execute on function public.verificar_cooldown_ia(uuid, uuid) from public, anon;
grant  execute on function public.verificar_cooldown_ia(uuid, uuid) to authenticated, service_role;

-- ===========================================================================
-- Seed de produção: v1 do prompt de ordenação (não é dado de demonstração).
-- Modelo mais barato e effort baixo de propósito — é uma tarefa de ORDENAR uma
-- lista curta com evidência estrita, não uma análise (custo não deve competir
-- com o Protocolo 01/Agente do Croqui pelo mesmo teto diário por usuário).
-- ===========================================================================
insert into prompts_versoes (chave, versao, titulo, corpo_sistema, modelo_padrao, effort, ativo, notas)
values (
  'ordenar_horarios_agenda',
  1,
  'Ordenação dos horários ofertados ao cliente (CONFLITO C10)',
  $prompt$Você recebe uma lista de horários que a advogada já deixou disponíveis para uma
Sessão de Viabilidade, e um recorte estrito de evidência sobre esta família, vindo
da Ligação Estratégica (POP 03 / POP 03-B).

Sua única tarefa é REORDENAR a lista recebida, do horário mais adequado para o
menos adequado, e escrever um motivo curto (uma frase, até 280 caracteres) para
cada posição.

Regras absolutas, sem exceção:
- Você NUNCA inventa um horário que não esteja na lista recebida.
- Você NUNCA remove, duplica ou altera um horário da lista — a saída tem
  exatamente os mesmos horários da entrada, só a ordem muda.
- Você só pode usar como evidência os campos fornecidos: respostas da ligação,
  preocupação principal, ritmo de fala, estilo de resposta e se decisores
  estarão presentes. Nenhum outro dado sobre esta família existe para você
  nesta tarefa — nunca infira patrimônio, valor ou urgência que não estejam
  literalmente nesses campos.
- Se a evidência fornecida não for suficiente para preferir um horário sobre
  outro, mantenha a ordem cronológica original entre eles e diga isso no
  motivo ("sem critério suficiente para preferir este horário sobre os
  demais, mantida a ordem cronológica").
- Você nunca escreve "melhor horário" nem promete resultado da sessão — você
  só justifica ORDEM, com base estrita na evidência recebida.$prompt$,
  'claude-sonnet-5',
  'low',
  true,
  'Ordena, não escolhe (CONFLITO C10 do plano de Fase 2). Sem ligação estratégica '
  'registrada para a jornada, esta IA nunca é chamada — ordem cronológica direta, '
  'sem custo (ver src/server/agenda/sugestoes.ts).'
);

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table disponibilidades enable row level security;
alter table disponibilidades force row level security;
alter table agenda_bloqueios enable row level security;
alter table agenda_bloqueios force row level security;
alter table agendamentos_sugestoes enable row level security;
alter table agendamentos_sugestoes force row level security;

-- Toda a equipe interna vê a agenda; só admin/advogada mexem nela — mesmo
-- recorte de `ofertas` (0011): configuração sensível de operação, leitura
-- ampla, escrita restrita.
create policy disp_sel on disponibilidades for select to authenticated using ((select app.eh_interno()));
create policy disp_ins on disponibilidades for insert to authenticated
  with check ((select app.papel()) in ('admin', 'advogada'));
create policy disp_upd on disponibilidades for update to authenticated
  using ((select app.papel()) in ('admin', 'advogada'))
  with check ((select app.papel()) in ('admin', 'advogada'));
-- Sem policy de DELETE: baixa é `ativa = false` (a coluna já existe acima).

create policy bloq_sel on agenda_bloqueios for select to authenticated using ((select app.eh_interno()));
create policy bloq_ins on agenda_bloqueios for insert to authenticated
  with check ((select app.papel()) in ('admin', 'advogada'));
create policy bloq_upd on agenda_bloqueios for update to authenticated
  using ((select app.papel()) in ('admin', 'advogada'))
  with check ((select app.papel()) in ('admin', 'advogada'));
-- Sem policy de DELETE: baixa é `cancelado_em` preenchido (a coluna já existe acima).

-- agendamentos_sugestoes: leitura interna livre (a equipe pode conferir o que
-- foi ofertado num link). ESCRITA NENHUMA para `authenticated` — o conteúdo
-- (ordem e motivo) é derivado por `src/server/agenda/sugestoes.ts` com cliente
-- `service_role`, mesma razão de `execucoes_ia`/`briefings` (0009): não pode
-- ser forjado por quem está logado. `escolher_horario_publico` (0028, B-1A) é
-- SECURITY DEFINER e ignora RLS normalmente ao ler esta tabela para validar o
-- horário escolhido pelo cliente.
create policy ags_sel on agendamentos_sugestoes for select to authenticated using ((select app.eh_interno()));

comment on table disponibilidades is
  'Janelas recorrentes de disponibilidade da advogada. Slot livre é DERIVADO '
  '(app.slots_disponiveis), nunca guardado aqui.';
comment on table agenda_bloqueios is
  'Exceções pontuais (folga, feriado, compromisso). Baixa por cancelado_em, nunca DELETE.';
comment on table agendamentos_sugestoes is
  'Horários realmente ofertados num link público de agendamento — a allowlist '
  'que escolher_horario_publico usa para recusar timestamp fora da oferta.';
