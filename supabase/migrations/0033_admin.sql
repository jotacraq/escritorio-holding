-- 0033_admin.sql
-- ONDA 2 (B-2B) — Admin de verdade (ARQUITETURA-FASE-2.md §4.6, linha B-2B da §5).
-- Pouco DDL de propósito: o admin opera tabelas que já existem (`perfis_equipe`,
-- `produtos`, `mensagens_templates`, `prompts_versoes`, `edicoes_seminario`,
-- `modelos_ia_precos`, `configuracoes`). O que faltava era rota + tela — a rota é
-- este agente, a tela é F-2B (`src/app/(app)/admin/**`, fora da minha fronteira).
--
-- Sete áreas + Pendências, no README de tarefa desta noite:
--   equipe · produtos · templates de mensagem · versões de prompt ·
--   edições de seminário · configurações · custo de IA · pendências
--
-- DECISÃO registrada aqui (não só no relatório de entrega): `vw_pendencias_sistema`
-- e a policy `wh_sel_pendencias` em `webhooks_eventos` JÁ EXISTEM (0034_painel_dia.sql,
-- de B-1B, aplicada nesta mesma noite antes desta migration). Não recrio nada disso —
-- a aba "Pendências" do Admin CONSOME a mesma view que alimenta o bloco 4 do Painel
-- do Dia (reuso, não duplicação — critério de Otimização do Fable). O que falta e
-- que ninguém mais tem fronteira para escrever é a AÇÃO sobre a pendência: reenfileirar
-- mensagem falhada. `reprocessar_webhook` (RPC de webhook) já existe desde a 0027.
-- ===========================================================================

-- ===========================================================================
-- (a) Convite de equipe (CONFLITO C15 / BLOQUEIO B16-B17): criar a linha em
--     `perfis_equipe` sempre funciona; o e-mail de convite (auth.admin.
--     inviteUserByEmail) exige SUPABASE_SERVICE_ROLE_KEY, hoje vazia. As duas
--     colunas abaixo são o único acréscimo de schema desta migration para a
--     área "equipe" — dão à tela e à rota como saber SE e QUANDO o convite foi
--     disparado, sem depender de `criado_em` (que existe desde sempre e mede
--     "quando a linha nasceu", não "quando alguém pediu para convidar").
-- ===========================================================================
alter table perfis_equipe
  add column convidado_em      timestamptz,
  add column convite_enviado_em timestamptz;

-- Backfill exato, não inventado: toda linha que já existe foi, por construção,
-- "convidada" no instante em que nasceu (não havia outro fluxo de criação antes
-- desta migration). Isto não reclassifica ninguém — é a mesma marca de tempo,
-- só copiada para o campo novo. `convite_enviado_em` fica NULL para o histórico
-- (não há prova de que o e-mail saiu para essas linhas — campo novo nasce vazio).
update perfis_equipe set convidado_em = criado_em where convidado_em is null;

comment on column perfis_equipe.convidado_em is
  'Quando o admin criou a linha de convite. Preenchido pela rota no INSERT.';
comment on column perfis_equipe.convite_enviado_em is
  'Quando auth.admin.inviteUserByEmail respondeu sem erro. NULL = e-mail nunca '
  'saiu (service_role ausente ou falha do provedor) — a tela mostra isso, nunca finge envio.';

-- ===========================================================================
-- (b) Custo de IA — três recortes sobre `execucoes_ia`, todos `security_invoker`:
--     a RLS de origem (`ex_sel`, 0009) já restringe a `app.ve_patrimonio()`
--     (admin/advogada — "mesmo recorte de quem vê patrimônio", regra da tarefa).
--     Nenhuma das três views soma `modo='real'` com `modo='demonstracao'` —
--     `modo` é sempre coluna do GROUP BY, nunca colapsado. A tela decide o que
--     mostrar; o banco nunca entrega os dois números já somados.
-- ===========================================================================
create view vw_custo_ia_mensal with (security_invoker = true) as
select
  date_trunc('month', criado_em) as mes,
  modo,
  count(*)                                    as execucoes,
  coalesce(sum(custo_usd), 0)::numeric(14,6)  as custo_usd_total,
  coalesce(sum(tokens_entrada), 0)::bigint    as tokens_entrada_total,
  coalesce(sum(tokens_saida), 0)::bigint      as tokens_saida_total
from execucoes_ia
group by 1, 2
order by 1 desc, 2;

create view vw_custo_ia_por_prompt with (security_invoker = true) as
select
  e.prompt_versao_id,
  p.chave,
  p.versao,
  p.ativo                                     as versao_ativa,
  e.modo,
  count(*)                                    as execucoes,
  coalesce(sum(e.custo_usd), 0)::numeric(14,6) as custo_usd_total
from execucoes_ia e
join prompts_versoes p on p.id = e.prompt_versao_id
group by 1, 2, 3, 4, 5
order by p.chave, p.versao desc, e.modo;

create view vw_custo_ia_por_jornada with (security_invoker = true) as
select
  e.jornada_id,
  e.modo,
  count(*)                                     as execucoes,
  coalesce(sum(e.custo_usd), 0)::numeric(14,6)  as custo_usd_total,
  max(e.criado_em)                              as ultima_execucao_em
from execucoes_ia e
where e.jornada_id is not null
group by 1, 2
order by custo_usd_total desc;

comment on view vw_custo_ia_mensal is
  'Admin > Custo de IA, recorte mensal. `modo` nunca é colapsado — demonstração não soma no real.';
comment on view vw_custo_ia_por_prompt is
  'Admin > Custo de IA, recorte por versão de prompt (custo de cada versão do método).';
comment on view vw_custo_ia_por_jornada is
  'Admin > Custo de IA, recorte por jornada — acha o cliente que mais consumiu IA.';

-- ===========================================================================
-- (c) Prompt e template são DADO VERSIONADO (regra não negociável da tarefa):
--     trocar é INSERT de versão nova + ativar, nunca UPDATE no corpo em uso.
--     As rotas (`src/app/api/admin/prompts`, `.../templates`) fazem o INSERT
--     direto pela RLS existente (`pv_wr`/`mt_wr`, ambas `app.eh_admin()`) — não
--     precisam de função. ATIVAR é o passo que exige atomicidade: desativar a
--     versão corrente e ativar a nova têm que acontecer na MESMA transação, ou
--     a unique index parcial (`uniq_prompt_ativo`/`uniq_template_ativo`) e o
--     `supabase-js` fazendo dois `.update()` sequenciais (não atômicos entre
--     si — mesma armadilha já catalogada em `processar_pagamento_hotmart`,
--     0011) deixam uma janela sem NENHUMA versão ativa. As duas funções abaixo
--     são `security invoker` (não `definer`): a RLS de escrita já é
--     `app.eh_admin()` nas duas tabelas, então não há privilégio a elevar —
--     só atomicidade a garantir. O `if not app.eh_admin()` explícito no topo
--     não é redundante: sem ele, um não-admin que chame a RPC não recebe 403,
--     recebe uma linha vazia (a RLS barra o UPDATE em silêncio, `returning`
--     não acha linha) — mesmo raciocínio do `reprocessar_webhook` (0027) e do
--     `marcar_mensagem_manual` (0019): a função audita a própria permissão.
-- ===========================================================================
create or replace function public.ativar_prompt_versao(p_id uuid)
returns prompts_versoes
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_chave text;
  v_linha prompts_versoes;
begin
  if not app.eh_admin() then
    raise exception 'sem_permissao: apenas admin ativa versão de prompt' using errcode = '42501';
  end if;

  select chave into v_chave from prompts_versoes where id = p_id;
  if v_chave is null then
    raise exception 'versao_nao_encontrada: %', p_id using errcode = 'P0002';
  end if;

  update prompts_versoes set ativo = false where chave = v_chave and ativo and id <> p_id;
  update prompts_versoes set ativo = true where id = p_id returning * into v_linha;

  return v_linha;
end $$;
revoke execute on function public.ativar_prompt_versao(uuid) from public, anon;
grant  execute on function public.ativar_prompt_versao(uuid) to authenticated;

create or replace function public.ativar_template_mensagem(p_id uuid)
returns mensagens_templates
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_chave text;
  v_canal canal_mensagem;
  v_linha mensagens_templates;
begin
  if not app.eh_admin() then
    raise exception 'sem_permissao: apenas admin ativa versão de template' using errcode = '42501';
  end if;

  select chave, canal into v_chave, v_canal from mensagens_templates where id = p_id;
  if v_chave is null then
    raise exception 'versao_nao_encontrada: %', p_id using errcode = 'P0002';
  end if;

  update mensagens_templates set ativo = false
   where chave = v_chave and canal = v_canal and ativo and id <> p_id;
  update mensagens_templates set ativo = true where id = p_id returning * into v_linha;

  return v_linha;
end $$;
revoke execute on function public.ativar_template_mensagem(uuid) from public, anon;
grant  execute on function public.ativar_template_mensagem(uuid) to authenticated;

comment on function public.ativar_prompt_versao(uuid) is
  'Única porta para promover uma versão de prompt a ativa. Desativa a anterior '
  'da mesma chave na MESMA transação — nunca fica um instante sem versão ativa.';
comment on function public.ativar_template_mensagem(uuid) is
  'Única porta para promover uma versão de template a ativa, por (chave, canal).';

-- ===========================================================================
-- (d) Pendências, ação: reenfileirar mensagem `falhou`. A 0019 revogou UPDATE
--     direto em `mensagens_agendadas` de `authenticated` (ALTO 1 do pentest) e
--     deixou `marcar_mensagem_manual` como ÚNICA porta de escrita — e aquela
--     função só cobre WhatsApp pendente->enviada. Sem esta função, uma mensagem
--     `falhou` (e-mail sem remetente configurado, ou que esgotou tentativas —
--     `src/server/regua/processar.ts`) fica travada para sempre: nenhuma rota,
--     nenhuma RLS, nenhum cron a resgata. É a segunda metade de "pendências":
--     ver o problema (0034 já resolve) e AGIR sobre ele (esta função).
--     `security definer` é obrigatório aqui (não `invoker`, ao contrário de (c)):
--     o `revoke update ... from authenticated` da 0019 tira o PRIVILÉGIO, não
--     só a RLS — nenhuma função invoker consegue escrever nesta tabela.
-- ===========================================================================
create or replace function public.requeue_mensagem_falhada(p_id uuid)
returns mensagens_agendadas
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_linha mensagens_agendadas%rowtype;
begin
  if not app.eh_admin() then
    raise exception 'sem_permissao: apenas admin reenfileira mensagem falhada' using errcode = '42501';
  end if;

  select * into v_linha from mensagens_agendadas where id = p_id for update;
  if not found then
    raise exception 'mensagem_nao_encontrada' using errcode = 'P0002';
  end if;

  if v_linha.status <> 'falhou' then
    raise exception 'status_nao_falhou: mensagem está em status ''%'', só reenfileira falhou',
      v_linha.status using errcode = '23514';
  end if;

  -- `erro` e `tentativas` ficam como estão: histórico da tentativa anterior não
  -- se apaga (mesmo princípio de `reprocessar_webhook`, que também preserva
  -- `tentativas` e soma, nunca zera). O cron sobrescreve `erro` no próximo ciclo
  -- se falhar de novo; se der certo, `status='enviada'` fala por si.
  update mensagens_agendadas
     set status = 'pendente', proxima_tentativa_em = null
   where id = p_id
  returning * into v_linha;

  return v_linha;
end $$;
revoke execute on function public.requeue_mensagem_falhada(uuid) from public, anon;
grant  execute on function public.requeue_mensagem_falhada(uuid) to authenticated;

comment on function public.requeue_mensagem_falhada(uuid) is
  'Admin > Pendências, ação sobre "mensagem que não saiu": volta o status para '
  'pendente para o próximo ciclo do cron (/api/cron/regua) tentar de novo.';

-- ===========================================================================
-- NOTA de escopo — não construído nesta migration, por não ter onde ler:
--   `materiais_aguardando_aprovacao` (o 4º tipo de pendência que a tarefa nomeia
--   explicitamente) depende da tabela `materiais_pos_sessao`, que só nasce em
--   `0031_material_pos_sessao.sql` (ONDA 3, B-3B, fora da fronteira e do
--   cronograma desta migration — arquivo não existe no repo nesta noite).
--   `vw_pendencias_sistema` (0034) já documenta o mesmo gap no próprio comment.
--   `src/app/api/admin/pendencias/route.ts` devolve um stub explícito para este
--   tipo em vez de inventar dado — quando 0031 existir, é UPDATE de rota, não
--   de migration (a função é aditiva: só extends o `union all` da view).
-- ===========================================================================
