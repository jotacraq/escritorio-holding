-- 0027_fase2_travas_e_configuracao.sql
-- ONDA 0 da Fase 2 — pré-requisito de tudo. Fecha os 4 achados abertos do
-- pentest de 03/09/2026 (sic-hf-brain/04 - Tecnico/Seguranca.md, "Segue aberto")
-- e cria a mesa de configuração (`configuracoes`) que as ondas seguintes usam.
-- Todas as alterações são aditivas, exceto o `drop policy` do item (a), cujo
-- texto de reversão fica em comentário logo abaixo dele.

-- ===========================================================================
-- (a) ACHADO ALTO 1 (classe repetida): policy `for all` inclui DELETE via
--     PostgREST direto em tabela com PII. O molde já foi aplicado em
--     familiares/sessoes_viabilidade/agendamentos pela migration 0021
--     (fam_wr/ses_wr/age_wr já não existem — não repetir aqui, criar de novo
--     colidiria com as policies fam_ins/fam_upd/ses_ins/... já existentes).
--     Ficam de fora, e são fechadas agora: patrimonio_itens (pat_wr),
--     relatorios_sessao (rel_wr), croquis (cro_wr), formularios_respostas (fr_wr),
--     ligacoes_estrategicas (lig_wr). `documentos` não tem `for all` (só doc_sel,
--     upload é exclusivo de service_role — nada a fazer nela aqui).
-- ===========================================================================

-- patrimonio_itens ------------------------------------------------------------
-- Reversão: create policy pat_wr on patrimonio_itens for all to authenticated
--   using ((select app.ve_patrimonio())) with check ((select app.ve_patrimonio()));
drop policy if exists pat_wr on patrimonio_itens;
create policy pat_ins on patrimonio_itens for insert to authenticated
  with check ((select app.ve_patrimonio()));
create policy pat_upd on patrimonio_itens for update to authenticated
  using ((select app.ve_patrimonio())) with check ((select app.ve_patrimonio()));
-- Sem policy de DELETE: ausência de policy = negação. Baixa é `ativo=false`
-- (a coluna já existe, criada em 0007).

-- relatorios_sessao ------------------------------------------------------------
-- Reversão: create policy rel_wr on relatorios_sessao for all to authenticated
--   using ((select app.ve_patrimonio())) with check ((select app.ve_patrimonio()));
drop policy if exists rel_wr on relatorios_sessao;
create policy rel_ins on relatorios_sessao for insert to authenticated
  with check ((select app.ve_patrimonio()));
create policy rel_upd on relatorios_sessao for update to authenticated
  using ((select app.ve_patrimonio())) with check ((select app.ve_patrimonio()));
-- Sem policy de DELETE: relatório é 1:1 com a sessão e não tem baixa lógica
-- própria — apagar destruiria a prova do que foi levantado na SV.

-- croquis -----------------------------------------------------------------
-- Reversão: create policy cro_wr on croquis for all to authenticated
--   using ((select app.ve_patrimonio())) with check ((select app.ve_patrimonio()));
drop policy if exists cro_wr on croquis;
create policy cro_ins on croquis for insert to authenticated
  with check ((select app.ve_patrimonio()));
create policy cro_upd on croquis for update to authenticated
  using ((select app.ve_patrimonio())) with check ((select app.ve_patrimonio()));
-- Sem policy de DELETE: histórico de versão do croqui não se apaga
-- (uniq_croqui_pronto já impede mais de um "pronto"/"apresentado" por jornada).

-- formularios_respostas --------------------------------------------------------
-- Reversão: create policy fr_wr on formularios_respostas for all to authenticated
--   using ((select app.eh_interno())) with check ((select app.eh_interno()));
drop policy if exists fr_wr on formularios_respostas;
create policy fr_ins on formularios_respostas for insert to authenticated
  with check ((select app.eh_interno()));
create policy fr_upd on formularios_respostas for update to authenticated
  using ((select app.eh_interno())) with check ((select app.eh_interno()));
-- Sem policy de DELETE: `unique(jornada_id)` já impede duplicidade; sobrescrita
-- é UPDATE, apagar destruiria a resposta original do cliente (ver C9 do plano).

-- ligacoes_estrategicas ---------------------------------------------------------
-- Reversão: create policy lig_wr on ligacoes_estrategicas for all to authenticated
--   using ((select app.eh_interno())) with check ((select app.eh_interno()));
drop policy if exists lig_wr on ligacoes_estrategicas;
create policy lig_ins on ligacoes_estrategicas for insert to authenticated
  with check ((select app.eh_interno()));
create policy lig_upd on ligacoes_estrategicas for update to authenticated
  using ((select app.eh_interno())) with check ((select app.eh_interno()));
-- Sem policy de DELETE: ligação registra fato + frase literal do cliente —
-- mesmo motivo de fam_wr/ses_wr (0021): sem rastro fora da própria tabela.

-- VERIFICAÇÃO OBRIGATÓRIA (rodar depois de aplicar esta migration):
--   select polname, polcmd from pg_policy;
-- CORREÇÃO ao texto do plano (ARQUITETURA-FASE-2.md §4.0/§5): o catálogo
-- `pg_policy.polcmd` usa 'a' para INSERT (append), não para ALL — conferido
-- contra a documentação oficial do Postgres (catalog-pg-policy). O código que
-- significa "ALL" é '*'. A query abaixo usa o valor CERTO; rodar a do plano ao
-- pé da letra (`polcmd='a'`) teria testado a coisa errada (INSERT, que é
-- esperado existir) e deixaria passar uma `for all` de verdade sem acusar nada.
--
-- `polcmd` não pode voltar '*' (ALL) em NENHUMA policy de tabela com PII. Query
-- que restringe a resultado esperado vazio, olhando só as tabelas do domínio
-- (exclui prompts_versoes/modelos_ia_precos/produtos/ofertas/mensagens_templates/
-- edicoes_seminario/formularios, que não carregam PII de cliente):
--
--   select c.relname as tabela, p.polname, p.polcmd
--   from pg_policy p join pg_class c on c.oid = p.polrelid
--   where p.polcmd = '*'
--     and c.relname in (
--       'patrimonio_itens','relatorios_sessao','croquis','croqui_analises',
--       'documentos','documentos_acessos','familiares','formularios_respostas',
--       'ligacoes_estrategicas','sessoes_viabilidade','agendamentos','pessoas',
--       'jornadas','execucoes_ia','briefings','configuracoes','tarefas'
--     );
--   -- esperado: 0 linhas.

-- ===========================================================================
-- (b) Exclusão lógica onde faltava, para a baixa continuar possível sem DELETE.
--     patrimonio_itens e familiares JÁ têm `ativo` (0007) — não repetir aqui
--     (ALTER TABLE ... ADD COLUMN de coluna existente falha). Só `documentos`
--     ficou sem a coluna, apesar de `documentos_acessos.acao` já prever
--     'exclusao_logica' como ação de auditoria desde a 0012.
-- ===========================================================================
alter table documentos add column ativo boolean not null default true;
create index if not exists idx_documentos_ativos on documentos (pessoa_id) where ativo;

-- ===========================================================================
-- (c) Webhook que não reprocessa (item aberto do Seguranca.md).
--     Hoje reentrega de evento que falhou cai em "já recebi" sem olhar
--     processado_em. Index para a varredura de pendentes com erro, e RPC de
--     admin para destravar manualmente um evento específico.
-- ===========================================================================
create index if not exists idx_webhooks_falhos
  on webhooks_eventos (recebido_em) where processado_em is null and erro is not null;

-- NOTA para quem tocar a rota do webhook (fora da fronteira desta migration/
-- deste agente — src/app/api/webhooks/hotmart/route.ts pertence a outra onda):
-- o `on conflict (origem, evento_externo_id)` da rota precisa passar a testar
-- `processado_em is null` antes de responder "já recebido, 200" — reentrega de
-- evento NÃO processado deve REPROCESSAR; reentrega de evento já processado
-- responde 200 sem tocar em nada. Esta RPC cobre o caminho manual (admin) até
-- essa mudança de rota entrar.
create or replace function public.reprocessar_webhook(p_evento_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not (select app.eh_admin()) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  update webhooks_eventos
     set processado_em = null, erro = null, tentativas = tentativas + 1
   where id = p_evento_id;
  if not found then
    raise exception 'evento_nao_encontrado: %', p_evento_id using errcode = 'P0002';
  end if;
end $$;
revoke execute on function public.reprocessar_webhook(uuid) from public, anon, authenticated;
grant  execute on function public.reprocessar_webhook(uuid) to authenticated;
-- NOTA: grant a `authenticated` (não a `service_role` apenas) de propósito — a
-- função checa `app.eh_admin()` ela mesma, mesmo padrão de `public.registrar_*`
-- que fazem seu próprio gate de papel em vez de depender só do grant.

-- ===========================================================================
-- (d) Configuração operacional vira DADO. Acaba com constante espalhada em TS
--     e permite ajustar prazo de link, cooldown e duração de sessão sem deploy
--     (BLOQUEIO B11/B12 do plano — "UPDATE em configuracoes, zero deploy").
-- ===========================================================================
create table configuracoes (
  chave          text primary key,
  valor          jsonb not null,
  descricao      text not null,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid references perfis_equipe(id)
);

create trigger trg_configuracoes_atualizado_em before update on configuracoes
for each row execute function app.set_atualizado_em();

insert into configuracoes (chave, valor, descricao) values
 ('link.validade_dias', '{"formulario":14,"agendamento":14,"documentos":30,"material":90}'::jsonb,
  'Validade padrão de cada tipo de link público, em dias.'),
 ('link.limite_por_minuto', '10'::jsonb, 'Requisições por minuto por token público.'),
 ('link.limite_por_dia',    '100'::jsonb, 'Requisições por dia por token público.'),
 ('ia.cooldown_segundos',   '600'::jsonb, 'Intervalo mínimo entre execuções de IA reais na mesma jornada.'),
 ('ia.teto_execucoes_dia_por_usuario', '20'::jsonb, 'Teto diário de execuções de IA reais por usuário.'),
 ('agenda.duracao_padrao_minutos', '60'::jsonb,
  'VALOR INICIAL, não vem do método (BLOQUEIO B12). Ajustar em Admin.'),
 ('agenda.slots_ofertados_ao_cliente', '6'::jsonb, 'Quantos horários o cliente vê no link.');

alter table configuracoes enable row level security;
alter table configuracoes force row level security;
create policy cfg_sel on configuracoes for select to authenticated using ((select app.eh_interno()));
create policy cfg_upd on configuracoes for update to authenticated
  using ((select app.eh_admin())) with check ((select app.eh_admin()));
-- Sem policy de INSERT/DELETE para authenticated: o conjunto de chaves nasce
-- pelo seed desta migration; chave nova é migration, não escrita livre pela
-- tela (evita "chave fantasma" que nenhum código lê).

-- ===========================================================================
-- (f, adiantado) `execucoes_ia.modo` precisa existir ANTES de (e): a função de
-- cooldown abaixo filtra por `e.modo = 'real'`. Ordem do rascunho do plano
-- (§4.0) tinha (e) antes de (f) — nesta ordem, `create function ... language
-- sql` falharia com "column modo does not exist" (função `language sql` é
-- validada contra o catálogo na criação, diferente de `plpgsql`). O restante
-- de (f) — colunas em briefings/croqui_analises, RPCs e trigger de trava —
-- continua mais abaixo, onde estava.
-- ===========================================================================
alter table execucoes_ia
  add column modo text not null default 'real' check (modo in ('real', 'demonstracao'));

-- ===========================================================================
-- (e) Cooldown de IA (item aberto: `forcar_regeracao` em laço custa dinheiro
--     real — claude-opus-5, US$ 5/25 por MTok). Só conta execução `modo='real'`:
--     demonstração nunca consome cooldown nem teto de ninguém (§3.3 do plano).
-- ===========================================================================
create or replace function app.pode_executar_ia(p_jornada uuid, p_perfil uuid)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select
    not exists (
      select 1 from execucoes_ia e
       where e.jornada_id = p_jornada and e.modo = 'real'
         and e.criado_em > now() - (
               (select (valor #>> '{}')::int from configuracoes where chave = 'ia.cooldown_segundos')
               * interval '1 second'
             )
    )
    and (
      select count(*) from execucoes_ia e2
       where e2.criado_por = p_perfil and e2.modo = 'real'
         and e2.criado_em > now() - interval '1 day'
    ) < (select (valor #>> '{}')::int from configuracoes where chave = 'ia.teto_execucoes_dia_por_usuario')
$$;
-- Desde a 0024, `alter default privileges in schema app` já revoga EXECUTE de
-- PUBLIC para toda função nova criada pelo mesmo role de migração — esta função
-- nasce sem PUBLIC/anon. Concede a `authenticated` de propósito: quem for ligar
-- o cooldown de verdade (onda 1+, dentro de briefing.ts/croqui-analise.ts) vai
-- chamar isto a partir de uma rota de servidor autenticada.
grant execute on function app.pode_executar_ia(uuid, uuid) to authenticated;

-- ===========================================================================
-- (f) Modo demonstração — o banco sabe que é demonstração, não só a tela (§3.3).
--     `execucoes_ia.modo` (já criada acima, antes de (e)) distingue execução
--     real de execução de exemplo fixo; `origem_dado` em briefings/
--     croqui_analises distingue conteúdo real de conteúdo de exemplo. A trava
--     por trigger garante isso mesmo se alguém tentar gravar direto
--     (PostgREST/bug de código) — não depende de lembrança do desenvolvedor.
-- ===========================================================================
alter table briefings
  add column origem_dado text not null default 'real' check (origem_dado in ('real', 'exemplo'));

alter table croqui_analises
  add column origem_dado text not null default 'real' check (origem_dado in ('real', 'exemplo'));

-- `registrar_briefing`/`registrar_croqui_analise` (0009/0010) não ganham parâmetro
-- novo — a assinatura muda de assinatura vira sobrecarga, não substituição (mesma
-- armadilha já catalogada no brain: "create or replace com novo parâmetro não
-- substitui, as duas coexistem e a chamada falha"). Em vez disso, a MESMA
-- assinatura passa a DERIVAR `origem_dado` de `execucoes_ia.modo` — a rota
-- (briefing.ts/croqui-analise.ts/demonstracao.ts) não precisa saber nem passar
-- essa informação, ela já está carimbada na execução.
create or replace function public.registrar_briefing(
  p_jornada_id uuid, p_execucao_id uuid, p_conteudo jsonb,
  p_grau_confianca smallint, p_fontes_usadas text[], p_modo_reduzido boolean
) returns briefings
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_versao smallint; v_linha briefings; v_origem_dado text;
begin
  select case when e.modo = 'demonstracao' then 'exemplo' else 'real' end
    into v_origem_dado
  from execucoes_ia e where e.id = p_execucao_id;
  if v_origem_dado is null then
    raise exception 'execucao_nao_encontrada: %', p_execucao_id using errcode = 'P0002';
  end if;

  update briefings set atual = false where jornada_id = p_jornada_id and atual;
  select coalesce(max(versao), 0) + 1 into v_versao from briefings where jornada_id = p_jornada_id;
  insert into briefings (jornada_id, execucao_id, versao, conteudo, grau_confianca,
                         fontes_usadas, modo_reduzido, origem_dado, atual)
  values (p_jornada_id, p_execucao_id, v_versao, p_conteudo, p_grau_confianca,
          p_fontes_usadas, p_modo_reduzido, v_origem_dado, true)
  returning * into v_linha;
  return v_linha;
end $$;
revoke execute on function public.registrar_briefing from public, anon, authenticated;
grant  execute on function public.registrar_briefing to service_role;

create or replace function public.registrar_croqui_analise(
  p_croqui_id uuid, p_execucao_id uuid, p_conteudo jsonb, p_grau_confianca smallint
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
  insert into croqui_analises (croqui_id, execucao_id, versao, conteudo, grau_confianca, origem_dado, atual)
  values (p_croqui_id, p_execucao_id, v_versao, p_conteudo, p_grau_confianca, v_origem_dado, true)
  returning * into v_linha;
  return v_linha;
end $$;
revoke execute on function public.registrar_croqui_analise from public, anon, authenticated;
grant  execute on function public.registrar_croqui_analise to service_role;

-- NOTA: a trava que importa. Saída de demonstração NUNCA é gravada como dado
-- real — garantido pelo banco, não por lembrança do desenvolvedor.
create or replace function app.trava_saida_demonstracao() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_modo text;
begin
  select e.modo into v_modo from execucoes_ia e where e.id = new.execucao_id;
  if v_modo = 'demonstracao' and new.origem_dado <> 'exemplo' then
    raise exception 'saida_de_demonstracao_exige_origem_dado_exemplo' using errcode = '23514';
  end if;
  if v_modo = 'real' and new.origem_dado <> 'real' then
    raise exception 'saida_real_nao_pode_ter_origem_dado_exemplo' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger trg_briefings_trava_demonstracao before insert or update on briefings
for each row execute function app.trava_saida_demonstracao();
create trigger trg_croqui_analises_trava_demonstracao before insert or update on croqui_analises
for each row execute function app.trava_saida_demonstracao();

-- ===========================================================================
-- (g) POP 07: tarefas de follow-up. Sem cadência automática (o método não
--     define uma — inventar cadência aqui seria inventar regra de negócio).
-- ===========================================================================
create table tarefas (
  id             uuid primary key default gen_random_uuid(),
  jornada_id     uuid not null references jornadas(id) on delete cascade,
  titulo         text not null,
  descricao      text,
  responsavel_id uuid references perfis_equipe(id),
  vence_em       date,
  concluida_em   timestamptz,
  concluida_por  uuid references perfis_equipe(id),
  origem         text not null default 'manual' check (origem in ('manual', 'sistema')),
  criado_em      timestamptz not null default now(),
  criado_por     uuid references perfis_equipe(id)
);
create index idx_tarefas_abertas on tarefas (vence_em) where concluida_em is null;
create index idx_tarefas_jornada on tarefas (jornada_id);

alter table tarefas enable row level security;
alter table tarefas force row level security;
create policy tar_sel on tarefas for select to authenticated using ((select app.eh_interno()));
create policy tar_ins on tarefas for insert to authenticated with check ((select app.eh_interno()));
create policy tar_upd on tarefas for update to authenticated
  using ((select app.eh_interno())) with check ((select app.eh_interno()));
-- Sem policy de DELETE: tarefa concluída vira histórico (`concluida_em`), não some.

-- NOTA de grants: `app.trava_saida_demonstracao` é função de TRIGGER — dispara
-- automaticamente na escrita, sem exigir EXECUTE do role que fez o INSERT/UPDATE
-- (mesmo padrão, sem grant explícito, de `app.set_atualizado_em`/
-- `app.impede_realocacao_familiar` nas migrations anteriores). `reprocessar_webhook`
-- vive em `public` e já leva seu próprio `revoke`/`grant` explícito acima.
-- `USAGE` em `schema app` para `authenticated` já existe desde a 0018 — necessário
-- para poder invocar `app.pode_executar_ia`, mas não substitui o `grant execute`
-- por função (concedido individualmente acima), que a 0024 passou a exigir.
