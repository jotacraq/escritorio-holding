-- 0043_analise_schema_v2.sql
-- ARQUITETURA-FASE-3.md §2 e §3.6 — Onda 2, agente E (backend-analise).
--
-- (a) `croqui_analises.schema_versao` — carimba QUAL formato de `conteudo`
--     aquela linha carrega. Hoje só existe a v1 (`CroquiAnaliseSchema`, croqui
--     como array de strings soltas — src/server/ia/schema-croqui-analise.ts).
--     A v2 tipada (croqui como 13 slides com categoria/fontes/pontos, mais
--     arquitetura.alocacao — §3.2) já tem o CONTRATO escrito nesta onda
--     (src/server/croqui/schema-analise-v2.ts) e a função pura que o consome
--     (src/server/croqui/gerar-slides.ts), mas o PROMPT v2 do
--     `agente_croqui_analise` (previsto para a 0042, dono: agente A/
--     backend-ia) NÃO foi publicado neste checkout — ver relatório desta
--     onda. Até lá, toda análise nasce `schema_versao = 1` (default) e
--     `gerarSlidesDaAnalise()` devolve os slides do método intocados nesse
--     caso — nunca inventa correspondência com um array de string solta
--     (§3.1). Quando o prompt v2 existir, `croqui-analise.ts` passa a chamar
--     `registrar_croqui_analise(..., p_schema_versao := 2)` e a ponte liga
--     sozinha, sem nova migration.
--
-- (b) Invariante nova: `croquis.status` só pode virar 'pronto'/'apresentado'
--     com os 13 slides marcados `revisado: true` em `conteudo->slides` —
--     trigger no BANCO, não checagem de rota (CONFLITO C19: "se a IA
--     preenche os 13 slides, o que a advogada assina?"). Dispara só quando o
--     status muda para pronto/apresentado OU o conteúdo de um croqui JÁ nesse
--     status é reescrito — uma linha intocada nunca é revalidada.
--
--     ATENÇÃO PARA QUEM APLICAR: nenhum croqui hoje tem a chave `revisado`
--     em `conteudo->slides` (campo aditivo novo, src/server/ia/schema-croqui-
--     slides.ts). Ausência de chave conta como NÃO revisado. Se existir
--     algum croqui em produção já 'pronto'/'apresentado' e alguém tentar
--     reescrever `conteudo` (ou trocar o status) depois desta migration sem
--     antes marcar os 13 slides como revisados, a escrita falha até isso ser
--     feito na tela (Onda 3, agente H). Nenhum croqui já 'pronto' e NÃO
--     tocado por escrita alguma é afetado — o trigger só roda em INSERT/UPDATE
--     novos.
--
-- (c) `registrar_croqui_analise` (0010/0027) ganha `p_schema_versao`
--     opcional, DEFAULT 1 — DROP explícito da assinatura de 4 parâmetros
--     antes do CREATE (armadilha 6 desta base: parâmetro novo em
--     `create or replace function` cria SOBRECARGA, não substitui, e a
--     chamada existente de `croqui-analise.ts`/`demonstracao.ts` — 4 args
--     nomeados — ficaria ambígua entre as duas). Nenhum dos dois chamadores
--     precisa mudar: o 5º parâmetro nasce 1 (schema v1, o que os dois já
--     produzem hoje).
--
-- Reversão: `drop trigger trg_croquis_pronto_exige_revisao on croquis`;
-- `drop function app.trava_croqui_pronto_exige_revisao()`;
-- `drop trigger trg_timeline_analise_sessao on croqui_analises`;
-- `drop function app.timeline_analise_sessao()`;
-- `alter table croqui_analises drop column schema_versao`; recriar
-- `registrar_croqui_analise` na assinatura de 4 parâmetros (texto preservado
-- no comentário da 0027, cabeçalho (f)). Nenhum DELETE; nenhuma linha de
-- cliente existente é tocada; nenhuma pessoa muda de faixa, papel ou etapa.

-- ===========================================================================
-- (a) schema_versao
-- ===========================================================================
alter table croqui_analises add column if not exists schema_versao smallint not null default 1;

comment on column croqui_analises.schema_versao is
  'Formato de conteudo desta análise: 1 = CroquiAnaliseSchema (croqui: string[] '
  'solto, sem tipo de slide — não mapeável 1:1, ARQUITETURA-FASE-3.md §3.1). '
  '2 = CroquiAnaliseV2 (src/server/croqui/schema-analise-v2.ts: croqui tipado '
  'por slide + arquitetura.alocacao — a ponte de gerarSlidesDaAnalise(), §3.2/3.3). '
  'NOT NULL DEFAULT 1: análises anteriores a esta coluna, e toda análise até o '
  'prompt v2 existir, são schema_versao=1.';

-- ===========================================================================
-- (c) registrar_croqui_analise — DROP explícito da assinatura de 4 parâmetros
-- antes do CREATE (armadilha 6). Chamadores conferidos no código:
-- src/server/ia/croqui-analise.ts (4 args nomeados) e
-- src/server/ia/demonstracao.ts — nenhum dos dois passa p_schema_versao hoje.
-- ===========================================================================
drop function if exists public.registrar_croqui_analise(uuid, uuid, jsonb, smallint);

create or replace function public.registrar_croqui_analise(
  p_croqui_id uuid, p_execucao_id uuid, p_conteudo jsonb, p_grau_confianca smallint,
  p_schema_versao smallint default 1
) returns croqui_analises
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_versao smallint; v_linha croqui_analises; v_origem_dado text;
begin
  select case when e.modo = 'demonstracao' then 'exemplo' else 'real' end
    into v_origem_dado
  from execucoes_ia e where e.id = p_execucao_id;
  if v_origem_dado is null then
    raise exception 'execucao_nao_encontrada: %', p_execucao_id using errcode = 'P0002';
  end if;

  update croqui_analises set atual = false where croqui_id = p_croqui_id and atual;
  select coalesce(max(versao), 0) + 1 into v_versao from croqui_analises where croqui_id = p_croqui_id;
  insert into croqui_analises (croqui_id, execucao_id, versao, conteudo, grau_confianca, origem_dado, schema_versao, atual)
  values (p_croqui_id, p_execucao_id, v_versao, p_conteudo, p_grau_confianca, v_origem_dado, coalesce(p_schema_versao, 1), true)
  returning * into v_linha;
  return v_linha;
end $$;
revoke execute on function public.registrar_croqui_analise from public, anon, authenticated;
grant  execute on function public.registrar_croqui_analise to service_role;

-- ===========================================================================
-- Timeline: a Análise da Sessão vira evento na Ficha 360, mesmo padrão de
-- app.timeline_briefing (0014) — inserida por service_role (RPC acima), então
-- security definer + search_path fixo pelo mesmo motivo daquela.
-- ===========================================================================
create or replace function app.timeline_analise_sessao() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.registrar_evento_timeline(
    (select jornada_id from croquis where id = new.croqui_id),
    'analise_sessao',
    'Análise da Sessão gerada (v' || new.versao || ')', null,
    jsonb_build_object('croqui_analise_id', new.id, 'grau_confianca', new.grau_confianca,
                        'schema_versao', new.schema_versao));
  return new;
end $$;

create trigger trg_timeline_analise_sessao after insert on croqui_analises
for each row execute function app.timeline_analise_sessao();

-- ===========================================================================
-- (b) Invariante: croqui só vira pronto/apresentado com os 13 slides
-- revisados por humano. `conteudo->slides[].revisado` é campo aditivo do
-- schema TS (src/server/ia/schema-croqui-slides.ts, §3.3) — ausência de chave
-- conta como NÃO revisado (coalesce false).
-- ===========================================================================
create or replace function app.trava_croqui_pronto_exige_revisao() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v_total_slides int;
  v_nao_revisados int;
begin
  if new.status not in ('pronto', 'apresentado') then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.status is not distinct from new.status
     and old.conteudo is not distinct from new.conteudo then
    return new; -- nada que afete a invariante mudou; linha intocada não é revalidada
  end if;

  v_total_slides := jsonb_array_length(coalesce(new.conteudo -> 'slides', '[]'::jsonb));
  select count(*) into v_nao_revisados
    from jsonb_array_elements(coalesce(new.conteudo -> 'slides', '[]'::jsonb)) as slide
   where coalesce((slide ->> 'revisado')::boolean, false) = false;

  if v_total_slides <> 13 or v_nao_revisados > 0 then
    raise exception 'croqui_pronto_exige_13_slides_revisados: % de % slide(s) sem revisao humana',
      v_nao_revisados, v_total_slides
      using errcode = '23514';
  end if;

  return new;
end $$;

create trigger trg_croquis_pronto_exige_revisao before insert or update on croquis
for each row execute function app.trava_croqui_pronto_exige_revisao();
