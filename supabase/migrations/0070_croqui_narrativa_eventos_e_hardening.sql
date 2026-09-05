-- 0070_croqui_narrativa_eventos_e_hardening.sql
-- Fase 5 — rodada de correção depois do REPROVADO do Fable (solidificação +
-- otimização). Cinco blocos, todos ADITIVOS exceto o backfill do bloco (b),
-- que é uma RECLASSIFICAÇÃO CONTADA de eventos de timeline gravados com o tipo
-- errado por código desta mesma fase (ver o bloco para a contagem obrigatória).
--
-- Nenhuma linha de `croquis`, `croqui_calculos`, `croqui_analises`,
-- `documentos`, `pessoas`, `jornadas` ou `patrimonio_itens` é tocada.
--
-- ===========================================================================
-- (a) `app.timeline_croqui_calculo` deixa de escrever no tipo `croqui`
-- ===========================================================================
-- ACHADO DO FABLE (solidificação, bloqueante): `sinaisDaFicha()`
-- (`src/lib/pasta/sinais.ts`) deriva o estado do croqui do evento de timeline
-- `tipo='croqui'` MAIS RECENTE (a Ficha 360 ordena `ocorrido_em desc`,
-- `src/server/jornadas.ts`). O único escritor histórico daquele tipo é
-- `app.timeline_croqui` (0014), que SEMPRE grava `dados.status`.
--
-- A Fase 5 criou dois escritores novos com o mesmo tipo e SEM `status`:
--   • este trigger, na 0063 ("Croqui calculado (vN)");
--   • `src/app/api/croquis/[id]/docx/route.ts` ("Relatório exportado").
-- Como a leitura antiga tratava evento sem `status` como "pronto", fixar uma
-- versão de cálculo ou baixar o .docx fazia a Pasta e o trilho anunciarem
-- "croqui pronto — apresentar" com o croqui em rascunho (ou sem croqui
-- nenhum: `croqui_id` do cálculo é nullable) e REGREDIAM "apresentado" para
-- "pronto". Dado inventado na tela.
--
-- Conserto dos dois lados: aqui o evento ganha tipo próprio (`croqui_calculo`)
-- e a rota do .docx passa a gravar `croqui_exportacao`; do lado do TypeScript,
-- `sinaisDaFicha()` só aceita evento `croqui` que traga `dados.status`
-- legível e, se não trouxer, IGNORA e segue para o anterior. Cinto e
-- suspensório: um escritor futuro que erre o tipo não volta a mentir.
--
-- `eventos_timeline.tipo` é `text` sem CHECK (0014:10) — tipo novo não quebra
-- constraint. A tabela é append-only por policy (`tl_sel`/`tl_ins`, sem
-- update/delete para `authenticated`); o UPDATE do bloco (b) roda como dono da
-- migration, que ignora RLS.
--
-- ===========================================================================
-- (b) BACKFILL CONTADO dos eventos já gravados com o tipo errado
-- ===========================================================================
-- Regra da casa (`feedback_migration_backfill_reclassifica`): contar quem muda
-- de VALOR antes de aplicar. Os dois predicados abaixo são exatos, não
-- heurísticos — cada um casa a assinatura de UM escritor:
--
--   cálculo    → tipo='croqui' AND dados ? 'calculo_id'   (só o trigger da
--                0063 grava essa chave; `app.timeline_croqui` grava
--                'croqui_id' + 'status')
--   exportação → tipo='croqui' AND dados ? 'destino'      (só a rota do .docx
--                grava 'destino')
--
-- Nenhum evento legítimo de `app.timeline_croqui` casa com qualquer um dos
-- dois (ele grava exatamente {croqui_id, status}). CONTAGEM OBRIGATÓRIA no
-- passo 0 do roteiro: rode os dois `select count(*)` ANTES e confira que a
-- soma bate com o `resultado` do passo 3.
--
-- Por que reclassificar em vez de só deixar a leitura ignorar: `dados.status`
-- não é o único consumidor do tipo. `acharCroquiIdNaTimeline()`
-- (`src/lib/api.ts`) pega o PRIMEIRO evento `tipo='croqui'` e lê
-- `dados.croqui_id` para achar o croqui da jornada — um evento de cálculo com
-- `croqui_id` nulo no topo da timeline devolvia `null` e a tela dizia "sem
-- croqui" para uma jornada que tem croqui.
--
-- ===========================================================================
-- (c) `vw_automacoes_jornada` (0064) — privilégio explícito
-- ===========================================================================
-- RESSALVA DE SEGURANÇA DO FABLE. A 0064 criou a view sem `revoke`/`grant`
-- nomeados: valeu o default do projeto Supabase (`alter default privileges …
-- grant all on tables to anon, authenticated`), que é largo e invisível.
-- `security_invoker=true` salva a leitura (a RLS das tabelas-base continua
-- valendo), mas `anon` com SELECT em objeto que existe é superfície que não
-- precisa existir. Lição da 0065b: `grant` sem `revoke` anterior não restringe
-- NADA.
--
-- ===========================================================================
-- (d) `set search_path` nos 4 triggers da 0065/0067
-- ===========================================================================
-- RESSALVA DE SEGURANÇA DO FABLE. `app.protege_documento_pedido`,
-- `app.documentos_pedidos_timeline`, `app.protege_execucao_marco` e
-- `app.execucao_marco_timeline` nasceram sem `set search_path`. Nenhuma é
-- `security definer` (rodam com o privilégio de quem escreve), então o risco
-- não é escalada direta — é resolução de nome: `perfis_equipe`,
-- `execucao_marcos` e `app.registrar_evento_timeline` seriam procuradas no
-- `search_path` da SESSÃO, e uma tabela homônima em schema anterior
-- sequestraria o carimbo de autor ou o evento de timeline. Corpos IDÊNTICOS
-- aos da 0065/0067, só com a cláusula acrescentada — conferido linha a linha.
--
-- ===========================================================================
-- (e) `croqui_narrativas` — a tabela da narrativa v3 (o consumidor que faltava)
-- ===========================================================================
-- ACHADO DO FABLE (otimização): o §12 prometeu tirar a IA que calcula do
-- caminho ativo. Medido: `contexto-narrativa.ts` e
-- `schema-croqui-narrativa.ts` não tinham consumidor, e o prompt
-- `agente_croqui_narrativa` (0066) nasceu inativo — a IA do croqui em produção
-- continuava sendo a v1 de 4.133 bytes. Decisão do orquestrador: a v1 fica
-- ativa até a bancada, mas a narrativa ganha rota + tela AGORA, fail-closed
-- (409 `narrativa_inativa`) enquanto o prompt está inativo. Ativar passa a ser
-- um `UPDATE prompts_versoes`, sem deploy novo.
--
-- POR QUE TABELA PRÓPRIA, E NÃO `croqui_analises.schema_versao = 3`
-- (desvio do enunciado, deliberado e testável):
--   `uniq_croqui_analise_atual on croqui_analises (croqui_id) where atual` e a
--   RPC `registrar_croqui_analise` (0043) garantem UMA análise atual por
--   croqui — a RPC desmarca as outras. Gravar a narrativa ali derrubaria o
--   `atual` da análise v1 e três leitores passariam a não achar nada ou a ler
--   um payload de outra forma:
--     • `src/server/material/sinais.ts:87`  (lê `conteudo.riscos` e
--       `conteudo.resumo_executivo`, que a v3 não tem);
--     • `src/server/diagnostico/index.ts:77` (monta o diagnóstico da SV);
--     • `GET /api/croquis/[id]` (as análises embutidas do editor).
--   Ou seja: ligar a narrativa apagaria em silêncio o material pós-sessão e o
--   diagnóstico — exatamente a classe de regressão que o critério de
--   otimização existe para barrar. Ciclos de vida diferentes, tabelas
--   diferentes. `schema_versao` fica na tabela nova (default 3) para o carimbo
--   continuar existindo e a v4 caber sem migration.
--
-- ===========================================================================
-- ROTEIRO DE VERIFICAÇÃO
-- (harness runnável: scripts/verificacao-0070.sql — transacional, cada passo
-- termina em `raise 'rollback_proposital'`, resultado em `resultado_0070`)
-- ===========================================================================
--
--  0. PRÉ (ANTES de aplicar; guardar as três saídas):
--       select count(*) from eventos_timeline where tipo='croqui' and dados ? 'calculo_id';
--       select count(*) from eventos_timeline where tipo='croqui' and dados ? 'destino';
--       select count(*) from eventos_timeline where tipo='croqui';
--     A soma das duas primeiras é quantos eventos MUDAM DE VALOR. A terceira
--     menos a soma é quantos permanecem `croqui` — todos com `dados ? 'status'`:
--       select count(*) from eventos_timeline
--        where tipo='croqui' and not (dados ? 'status');   -- deve virar 0 no passo 3
--       select count(*) from croqui_narrativas;            -- erro 42P01 (não existe)
--
--  1. Tipo próprio no trigger:
--       select prosrc like '%''croqui_calculo''%' from pg_proc p
--         join pg_namespace n on n.oid=p.pronamespace
--        where n.nspname='app' and p.proname='timeline_croqui_calculo';
--     → t
--
--  2. Trigger vivo (o `create or replace` não recria o gatilho, só o corpo):
--       select tgenabled from pg_trigger where tgname='trg_timeline_croqui_calculo';
--     → 'O'
--
--  3. Backfill (depois de aplicar):
--       select tipo, count(*) from eventos_timeline
--        where tipo in ('croqui','croqui_calculo','croqui_exportacao') group by 1;
--       select count(*) from eventos_timeline where tipo='croqui' and not (dados ? 'status');
--     → 0. E `croqui_calculo` + `croqui_exportacao` = a soma medida no passo 0.
--
--  4. Grants da view:
--       select grantee, privilege_type from information_schema.role_table_grants
--        where table_name='vw_automacoes_jornada' order by 1,2;
--     → nenhuma linha com grantee 'anon' ou 'PUBLIC'; `authenticated` e
--       `service_role` só com SELECT.
--       select has_table_privilege('anon','vw_automacoes_jornada','select');       → f
--       select has_table_privilege('authenticated','vw_automacoes_jornada','select'); → t
--       select has_table_privilege('authenticated','vw_automacoes_jornada','insert'); → f
--
--  5. `search_path` das 4 funções:
--       select p.proname, p.proconfig from pg_proc p
--         join pg_namespace n on n.oid=p.pronamespace
--        where n.nspname='app' and p.proname in
--          ('protege_documento_pedido','documentos_pedidos_timeline',
--           'protege_execucao_marco','execucao_marco_timeline')
--        order by 1;
--     → 4 linhas, todas com proconfig = {"search_path=public, pg_temp"}
--
--  6. `croqui_narrativas`:
--       select relrowsecurity, relforcerowsecurity from pg_class
--        where oid='croqui_narrativas'::regclass;                       → t · t
--       select has_table_privilege('anon','croqui_narrativas','select');          → f
--       select has_table_privilege('authenticated','croqui_narrativas','select'); → t
--       select has_table_privilege('authenticated','croqui_narrativas','insert'); → f
--       select has_function_privilege('authenticated',
--         'public.registrar_croqui_narrativa(uuid,uuid,jsonb,smallint,smallint,uuid)','execute'); → f
--       select has_function_privilege('service_role',
--         'public.registrar_croqui_narrativa(uuid,uuid,jsonb,smallint,smallint,uuid)','execute'); → t
--       select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--        where n.nspname='public' and p.proname='registrar_croqui_narrativa';     → 1
--       (uma assinatura só — armadilha 6, sobrecarga ambígua)
--
--  7. Reaplicar a migration inteira não duplica nem re-move nada (idempotente):
--     repetir 3, 4, 5 e 6; mesmas contagens (o backfill vira 0 linhas afetadas).
--
-- ===========================================================================
-- REVERSÃO COMPLETA (copiar e colar; volta ao estado da 0069)
-- ===========================================================================
--   -- (e)
--   drop trigger if exists trg_timeline_croqui_narrativa on croqui_narrativas;
--   drop function if exists app.timeline_croqui_narrativa();
--   drop function if exists public.registrar_croqui_narrativa(uuid, uuid, jsonb, smallint, smallint, uuid);
--   drop table if exists croqui_narrativas;      -- destrói só narrativa gerada
--                                                -- por esta rodada; nenhuma
--                                                -- outra tabela referencia.
--   -- (d) recriar os 4 corpos EXATOS de 0065:160-215, 0065:218-239,
--   --     0067:128-153 e 0067:155-168, SEM a linha `set search_path`.
--   -- (c)
--   grant all on vw_automacoes_jornada to anon, authenticated;  -- default do projeto
--   -- (b) desfaz a reclassificação pelos MESMOS predicados:
--   update eventos_timeline set tipo='croqui' where tipo in ('croqui_calculo','croqui_exportacao');
--   -- (a)
--   -- recriar app.timeline_croqui_calculo() com 'croqui' no lugar de
--   -- 'croqui_calculo' (corpo em 0063:185-193).
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- (a) Tipo próprio para o evento de cálculo
-- ---------------------------------------------------------------------------
create or replace function app.timeline_croqui_calculo() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  -- `croqui_calculo`, NÃO `croqui`: o tipo `croqui` é o canal de
  -- `app.timeline_croqui` (0014) e carrega `dados.status`, do qual a Pasta e o
  -- trilho derivam o estado do croqui. Este evento é outro fato ("gravei a
  -- versão N do cálculo"), não um estado de croqui.
  perform app.registrar_evento_timeline(
    new.jornada_id, 'croqui_calculo', 'Croqui calculado (v' || new.versao || ')', null,
    jsonb_build_object('calculo_id', new.id, 'versao', new.versao,
                       'motor_versao', new.motor_versao, 'croqui_id', new.croqui_id));
  return new;
end $$;

comment on function app.timeline_croqui_calculo() is
  'Registra a versão nova de croqui_calculos na timeline com tipo PRÓPRIO (croqui_calculo). Nunca use tipo=''croqui'' aqui: aquele tipo é contrato com sinaisDaFicha() e exige dados.status.';

-- O gatilho continua o mesmo da 0063 (`create or replace function` troca só o
-- corpo). Recriado assim mesmo para que reaplicar esta migration num banco
-- restaurado da 0062 não deixe a função sem gatilho.
drop trigger if exists trg_timeline_croqui_calculo on croqui_calculos;
create trigger trg_timeline_croqui_calculo after insert on croqui_calculos
for each row execute function app.timeline_croqui_calculo();


-- ---------------------------------------------------------------------------
-- (b) Backfill contado. Predicados exatos, um por escritor.
-- ---------------------------------------------------------------------------
update eventos_timeline
   set tipo = 'croqui_calculo'
 where tipo = 'croqui'
   and dados ? 'calculo_id';

update eventos_timeline
   set tipo = 'croqui_exportacao'
 where tipo = 'croqui'
   and dados ? 'destino';


-- ---------------------------------------------------------------------------
-- (c) Privilégio explícito na view de automações
-- ---------------------------------------------------------------------------
revoke all on vw_automacoes_jornada from public, anon, authenticated;
grant  select on vw_automacoes_jornada to authenticated, service_role;

comment on view vw_automacoes_jornada is
  'Fase 5 §8.2 — "o que o sistema fez" por jornada: régua de mensagens, ligação por IA, confirmação de presença e pagamento como marco. Uma linha por automação, com resultado humano. NÃO expõe valor de pagamento, payload de webhook, transcrição, gravação, custo, destinatário nem corpo de mensagem. security_invoker: herda a RLS de quem consulta. Privilégio explícito desde a 0070: SELECT só para authenticated e service_role (o default do projeto dava tudo a anon também).';


-- ---------------------------------------------------------------------------
-- (d) `set search_path = public, pg_temp` nos 4 triggers da 0065/0067.
-- Corpos idênticos aos originais — só a cláusula entra.
-- ---------------------------------------------------------------------------
create or replace function app.protege_documento_pedido() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_perfil uuid;
begin
  select id into v_perfil from perfis_equipe where auth_user_id = auth.uid() and ativo;

  if tg_op = 'INSERT' then
    -- service_role (sem auth.uid()) pode carimbar quem quiser: é a régua/cron.
    if v_perfil is not null then
      new.pedido_em     := now();
      new.pedido_por    := v_perfil;
      new.mensagem_id   := null;   -- quem enfileira é o servidor, não a tela
    end if;
    -- Nunca nasce conferido/dispensado: são atos posteriores.
    new.conferido_em   := null;
    new.conferido_por  := null;
    new.dispensado_em  := null;
    new.dispensado_por := null;
    return new;
  end if;

  if new.jornada_id is distinct from old.jornada_id
     or new.chave    is distinct from old.chave
     or new.tipo     is distinct from old.tipo
     or new.item_ref is distinct from old.item_ref
     or new.pedido_em  is distinct from old.pedido_em
     or new.pedido_por is distinct from old.pedido_por then
    raise exception 'pedido_imutavel: jornada, chave, tipo, item e o pedido original não mudam.'
      using errcode = '23514';
  end if;

  -- Conferência e dispensa não voltam atrás (é registro de ato, não rascunho).
  if old.conferido_em is not null and new.conferido_em is null then
    raise exception 'conferencia_imutavel: documento conferido não volta a pendente.' using errcode = '23514';
  end if;
  if old.dispensado_em is not null and new.dispensado_em is null then
    raise exception 'dispensa_imutavel: documento dispensado não volta a pendente.' using errcode = '23514';
  end if;

  if v_perfil is not null then
    if new.conferido_em is distinct from old.conferido_em and new.conferido_em is not null then
      new.conferido_em  := now();
      new.conferido_por := v_perfil;
    end if;
    if new.dispensado_em is distinct from old.dispensado_em and new.dispensado_em is not null then
      new.dispensado_em  := now();
      new.dispensado_por := v_perfil;
    end if;
  end if;

  return new;
end $$;

create or replace function app.documentos_pedidos_timeline() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform app.registrar_evento_timeline(new.jornada_id, 'documento_pedido',
      'Documento pedido', new.tipo,
      jsonb_build_object('chave', new.chave, 'tipo', new.tipo, 'item_ref', new.item_ref, 'lado', split_part(new.chave, ':', 1)));
  elsif new.conferido_em is not null and old.conferido_em is null then
    perform app.registrar_evento_timeline(new.jornada_id, 'documento_pedido',
      'Documento conferido', new.tipo,
      jsonb_build_object('chave', new.chave, 'tipo', new.tipo, 'item_ref', new.item_ref));
  elsif new.dispensado_em is not null and old.dispensado_em is null then
    perform app.registrar_evento_timeline(new.jornada_id, 'documento_pedido',
      'Documento dispensado', new.tipo,
      jsonb_build_object('chave', new.chave, 'tipo', new.tipo, 'item_ref', new.item_ref, 'nota', new.nota));
  end if;
  return null;
end $$;

create or replace function app.protege_execucao_marco() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_perfil uuid;
begin
  select id into v_perfil from perfis_equipe where auth_user_id = auth.uid() and ativo;

  if tg_op = 'INSERT' then
    if v_perfil is not null then
      new.concluido_em  := now();
      new.concluido_por := v_perfil;
    end if;
    return new;
  end if;

  if new.jornada_id is distinct from old.jornada_id
     or new.marco_id is distinct from old.marco_id
     or new.concluido_em is distinct from old.concluido_em
     or new.concluido_por is distinct from old.concluido_por then
    raise exception 'marco_imutavel: marco concluído só aceita mudança de nota.' using errcode = '23514';
  end if;
  return new;
end $$;

create or replace function app.execucao_marco_timeline() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_rotulo text;
begin
  select rotulo into v_rotulo from execucao_marcos where id = new.marco_id;
  perform app.registrar_evento_timeline(new.jornada_id, 'execucao',
    'Marco concluído', v_rotulo,
    jsonb_build_object('marco_id', new.marco_id, 'rotulo', v_rotulo));
  return null;
end $$;


-- ---------------------------------------------------------------------------
-- (e) `croqui_narrativas` — saída do Agente do Croqui v3
-- ---------------------------------------------------------------------------
create table if not exists croqui_narrativas (
  id             uuid primary key default gen_random_uuid(),
  croqui_id      uuid not null references croquis(id) on delete cascade,
  execucao_id    uuid not null references execucoes_ia(id),
  versao         smallint not null,
  -- Valida contra `CroquiNarrativaSchema` (src/server/ia/schema-croqui-narrativa.ts)
  -- no servidor, antes de chegar aqui — o zod é a gramática, este CHECK é só a
  -- forma mínima que impede um `"texto"` solto de virar narrativa.
  conteudo       jsonb not null check (jsonb_typeof(conteudo) = 'object'),
  grau_confianca smallint check (grau_confianca between 0 and 100),
  -- 3 = CroquiNarrativaSchema (a IA narra; o motor calcula). Existe para que a
  -- v4 caiba sem migration, como `croqui_analises.schema_versao` (0043).
  schema_versao  smallint not null default 3,
  -- `real` | `exemplo`, herdado de `execucoes_ia.modo` pela RPC — mesma trava
  -- de `briefings`/`croqui_analises` (0027): saída de demonstração nunca se
  -- confunde com saída sobre dado de cliente.
  origem_dado    text not null default 'real' check (origem_dado in ('real', 'exemplo')),
  atual          boolean not null default false,
  criado_em      timestamptz not null default now(),
  criado_por     uuid references perfis_equipe(id),
  unique (croqui_id, versao)
);

create unique index if not exists uniq_croqui_narrativa_atual
  on croqui_narrativas (croqui_id) where atual;
create index if not exists idx_croqui_narrativas_croqui
  on croqui_narrativas (croqui_id, versao desc);

comment on table croqui_narrativas is
  'Fase 5 §6.1 — saída do agente `agente_croqui_narrativa` (v3): a IA NÃO calcula, narra o que o motor já sabe (como apresentar cada tabela, perguntas, objeções, fechamento, lacunas). Tabela SEPARADA de croqui_analises de propósito: `uniq_croqui_analise_atual` só admite uma análise atual por croqui, e gravar a narrativa lá derrubaria a análise v1 que material/sinais.ts e diagnostico/index.ts leem. Ciclos de vida diferentes.';
comment on column croqui_narrativas.schema_versao is
  '3 = CroquiNarrativaSchema (src/server/ia/schema-croqui-narrativa.ts). 1 e 2 nunca aparecem aqui — são formatos de croqui_analises (0043).';

-- RLS: a narrativa cita número do croqui e perfil da família. Mesmo recorte de
-- `croqui_analises` e `croqui_calculos`: quem vê patrimônio.
alter table croqui_narrativas enable row level security;
alter table croqui_narrativas force  row level security;

drop policy if exists cn_sel on croqui_narrativas;
create policy cn_sel on croqui_narrativas for select to authenticated
  using ((select app.ve_patrimonio()));
-- Sem policy de INSERT/UPDATE/DELETE para `authenticated`: a única porta de
-- escrita é `registrar_croqui_narrativa`, chamada pelo servidor com
-- service_role depois de `exigirVePatrimonio()`. Mesma decisão da 0069 para
-- `registrar_croqui_calculo` — resultado de IA não entra pelo navegador.

revoke all    on croqui_narrativas from public, anon, authenticated;
grant  select on croqui_narrativas to authenticated;
grant  select, insert, update on croqui_narrativas to service_role;

-- ---------------------------------------------------------------------------
-- RPC de gravação. `security definer` + `search_path` fixo, EXECUTE só para
-- service_role (lição da 0065b: `revoke all` ANTES do `grant`, senão o default
-- do projeto Supabase mantém `authenticated` com EXECUTE e o grant não
-- restringe nada).
--
-- ARMADILHA 6 (sobrecarga ambígua): `drop function` explícito antes do
-- `create`. Aqui a função é nova, mas o `drop if exists` fica como padrão da
-- casa e torna a reaplicação segura se a assinatura mudar.
-- ---------------------------------------------------------------------------
drop function if exists public.registrar_croqui_narrativa(uuid, uuid, jsonb, smallint, smallint, uuid);

create or replace function public.registrar_croqui_narrativa(
  p_croqui_id     uuid,
  p_execucao_id   uuid,
  p_conteudo      jsonb,
  p_grau_confianca smallint,
  p_schema_versao smallint default 3,
  p_criado_por    uuid default null
) returns croqui_narrativas
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_versao smallint;
  v_linha  croqui_narrativas;
  v_origem text;
begin
  -- Autor explícito e revalidado no banco: sob service_role não há auth.uid(),
  -- então o gate de papel não some — só troca de fonte (mesma decisão da 0069).
  if p_criado_por is null then
    raise exception 'criado_por_ausente: informe o perfil de quem gerou a narrativa'
      using errcode = '22004';
  end if;
  if not coalesce(app.perfil_ve_patrimonio(p_criado_por), false) then
    raise exception 'sem_permissao: só admin/advogada ativo grava narrativa de croqui'
      using errcode = '42501';
  end if;

  select case when e.modo = 'demonstracao' then 'exemplo' else 'real' end
    into v_origem
  from execucoes_ia e where e.id = p_execucao_id;
  if v_origem is null then
    raise exception 'execucao_nao_encontrada: %', p_execucao_id using errcode = 'P0002';
  end if;

  update croqui_narrativas set atual = false where croqui_id = p_croqui_id and atual;
  select coalesce(max(versao), 0) + 1 into v_versao from croqui_narrativas where croqui_id = p_croqui_id;

  insert into croqui_narrativas
    (croqui_id, execucao_id, versao, conteudo, grau_confianca, schema_versao, origem_dado, atual, criado_por)
  values
    (p_croqui_id, p_execucao_id, v_versao, p_conteudo, p_grau_confianca,
     coalesce(p_schema_versao, 3), v_origem, true, p_criado_por)
  returning * into v_linha;

  return v_linha;
end $$;

revoke all    on function public.registrar_croqui_narrativa(uuid, uuid, jsonb, smallint, smallint, uuid) from public, anon, authenticated;
grant  execute on function public.registrar_croqui_narrativa(uuid, uuid, jsonb, smallint, smallint, uuid) to service_role;

comment on function public.registrar_croqui_narrativa(uuid, uuid, jsonb, smallint, smallint, uuid) is
  'Grava a narrativa v3 como atual e desmarca a anterior na MESMA transação. EXECUTE só para service_role: o servidor chama com criarClienteAdmin() depois de exigirVePatrimonio(), e p_criado_por é revalidado aqui contra perfis_equipe ativo (admin/advogada).';

-- Timeline: a narrativa é um fato da jornada, com tipo PRÓPRIO (nunca `croqui`
-- — ver o bloco (a)).
create or replace function app.timeline_croqui_narrativa() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.registrar_evento_timeline(
    (select jornada_id from croquis where id = new.croqui_id),
    'croqui_narrativa',
    'Narrativa do croqui gerada (v' || new.versao || ')', null,
    jsonb_build_object('croqui_narrativa_id', new.id, 'grau_confianca', new.grau_confianca,
                       'schema_versao', new.schema_versao));
  return null;
end $$;

drop trigger if exists trg_timeline_croqui_narrativa on croqui_narrativas;
create trigger trg_timeline_croqui_narrativa after insert on croqui_narrativas
for each row execute function app.timeline_croqui_narrativa();
