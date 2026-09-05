-- 0053_ligacoes_ia.sql
-- Fase 4 · F2 — Ligação por IA (SDR de voz) — ARQUITETURA-FASE-4.md §2.2–§2.4.
--
-- Aplicar DEPOIS da 0051 (agente A): `registrar_horario_ligacao_ia` chama
-- `app.confirmar_horario_da_sugestao(links_publicos, timestamptz, text)`, o
-- núcleo único de "confirmar horário" que a 0051 extrai de
-- `escolher_horario_publico`. O corpo plpgsql daqui compila sem a 0051 (a
-- resolução da chamada é em runtime), mas a RPC falha até a 0051 existir.
-- Também depende da 0052 (`tarefas.tipo`) para o adaptador manual.
--
-- O que esta migration faz (tudo ADITIVO — nenhum DELETE, nenhum UPDATE em
-- linha de cliente):
--   (a) tabela `ligacoes_ia` — a fila e o histórico das ligações por IA;
--   (b) guarda de transição (estado terminal é imutável) + atualizado_em;
--   (c) timeline em toda mudança de status;
--   (d) RPCs service_role: reivindicar (FOR UPDATE SKIP LOCKED),
--       registrar horário (via núcleo da 0051), emitir link de agendamento
--       pelo sistema, enfileirar a mensagem de fallback com o link;
--   (e) gatilho de entrada na fila após pagamento aprovado — DESLIGADO por
--       padrão (`ligacao_ia.automatica=false`, BLOQUEIO B33);
--   (f) chaves em `configuracoes`, template `agendamento_link` v1, view de custo.
--
-- REGRA DE OURO (§2.2): a IA só escolhe entre os horários que o link `/p/a`
-- ofertaria (`agendamentos_sugestoes` do `link_id`). Quem valida é o núcleo do
-- banco, nunca a rota. Nenhuma função daqui insere em `agendamentos`.

-- ===========================================================================
-- (a) Tabela
-- ===========================================================================
create table ligacoes_ia (
  id                uuid primary key default gen_random_uuid(),
  jornada_id        uuid not null references jornadas(id) on delete cascade,
  -- O link de agendamento cujos slots a IA ofereceu. NULL só enquanto a fila
  -- ainda não preparou a oferta (o trigger de pagamento não emite link — isso
  -- exige pepper e TS; `fila.ts` faz ao reivindicar).
  link_id           uuid references links_publicos(id) on delete set null,
  provedor          text not null check (provedor in ('n8n', 'manual')),
  status            text not null default 'na_fila'
    check (status in ('na_fila', 'discando', 'em_ligacao', 'concluida', 'sem_resposta', 'falhou', 'cancelada')),
  tentativa         smallint not null default 1 check (tentativa >= 1),
  -- Retentativa: não discar antes deste instante (NULL = pode já).
  nao_antes_de      timestamptz,
  -- 'equipe' = botão "Ligar por IA" na Ficha; 'automatica' = trigger de pagamento (B33).
  origem            text not null default 'equipe' check (origem in ('equipe', 'automatica')),
  solicitada_por    uuid references perfis_equipe(id),
  telefone          text not null,                                -- E.164, copiado de pessoas no enfileiramento
  id_externo        text,                                         -- id da call na Vapi (via n8n)
  disparada_em      timestamptz,
  atendida_em       timestamptz,
  encerrada_em      timestamptz,
  duracao_segundos  int check (duracao_segundos >= 0),
  resultado         text check (resultado in ('agendou', 'recusou', 'pediu_retorno', 'caixa_postal', 'numero_invalido', 'manual')),
  horario_escolhido timestamptz,
  agendamento_id    uuid references agendamentos(id) on delete set null,
  -- PII. Mesma posição de `ligacoes_estrategicas.transcricao`: RLS eh_interno,
  -- e SÓ entra em contexto de IA sob o gate `tratamento_ia` (B33/C31).
  transcricao       text,
  resumo            text,
  gravacao_url      text,
  -- `cost` do end-of-call-report da Vapi. NULL = provedor não informou (nunca zero inventado).
  custo_usd         numeric(10,4) check (custo_usd >= 0),
  erro              text,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

create index idx_ligacoes_ia_fila    on ligacoes_ia (criado_em) where status = 'na_fila';
create index idx_ligacoes_ia_presas  on ligacoes_ia (disparada_em) where status in ('discando', 'em_ligacao');
create index idx_ligacoes_ia_jornada on ligacoes_ia (jornada_id, criado_em desc);
-- Uma ligação ATIVA por jornada por vez — vale para qualquer caminho de escrita.
create unique index uniq_ligacao_ia_ativa on ligacoes_ia (jornada_id)
  where status in ('na_fila', 'discando', 'em_ligacao');

-- ===========================================================================
-- (b) Guarda de transição — estado terminal não volta atrás. Protege contra
-- "evento `concluida` duas vezes" e contra UPDATE via PostgREST (armadilha 4:
-- regra que só existe na rota não existe).
-- ===========================================================================
create or replace function app.ligacao_ia_guarda_transicao() returns trigger
language plpgsql as $$
begin
  if old.status in ('concluida', 'sem_resposta', 'falhou', 'cancelada')
     and new.status is distinct from old.status then
    raise exception 'ligacao_ia_encerrada: ligacao % ja esta em estado terminal (%)', old.id, old.status
      using errcode = '23514';
  end if;
  if new.status = 'cancelada' and old.status not in ('na_fila', 'discando') then
    raise exception 'ligacao_ia_nao_cancelavel: ligacao % em % nao pode ser cancelada', old.id, old.status
      using errcode = '23514';
  end if;
  new.atualizado_em := now();
  return new;
end $$;
create trigger trg_ligacao_ia_guarda before update on ligacoes_ia
for each row execute function app.ligacao_ia_guarda_transicao();

-- ===========================================================================
-- (c) Timeline. `app.registrar_evento_timeline` tem EXECUTE para
-- authenticated e service_role (0024) — o trigger roda como o invocador
-- (cancelamento pela equipe) ou como service_role (fila/webhook), os dois cobertos.
-- ===========================================================================
create or replace function app.timeline_ligacao_ia() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_titulo text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  v_titulo := case new.status
    when 'na_fila'      then 'Ligação por IA na fila'
    when 'discando'     then 'Ligação por IA discando'
    when 'em_ligacao'   then 'Ligação por IA atendida'
    when 'concluida'    then case when new.resultado = 'agendou' then 'Ligação por IA agendou a sessão'
                                  when new.resultado = 'manual' then 'Ligação por IA virou tarefa para a equipe'
                                  else 'Ligação por IA concluída' end
    when 'sem_resposta' then 'Ligação por IA sem resposta'
    when 'falhou'       then 'Ligação por IA falhou'
    when 'cancelada'    then 'Ligação por IA cancelada'
    else 'Ligação por IA: ' || new.status end;
  perform app.registrar_evento_timeline(new.jornada_id, 'ligacao', v_titulo,
    coalesce(new.resumo, new.erro),
    jsonb_build_object('ligacao_ia_id', new.id, 'status', new.status, 'resultado', new.resultado,
                       'tentativa', new.tentativa, 'provedor', new.provedor,
                       'horario_escolhido', new.horario_escolhido, 'agendamento_id', new.agendamento_id));
  return new;
end $$;
create trigger trg_timeline_ligacao_ia after insert or update on ligacoes_ia
for each row execute function app.timeline_ligacao_ia();

-- ===========================================================================
-- RLS + grants. `relacionamento` (toda a equipe) lê; ninguém logado insere;
-- UPDATE só na coluna `status`, e só para cancelar o que ainda não aconteceu.
-- `custo_usd`, `transcricao`, `resultado` etc. NÃO são graváveis por
-- authenticated (grant de coluna), nem por PostgREST direto.
-- ===========================================================================
revoke all on ligacoes_ia from anon, authenticated;
alter table ligacoes_ia enable row level security;
alter table ligacoes_ia force row level security;
create policy lia_sel on ligacoes_ia for select to authenticated using ((select app.eh_interno()));
create policy lia_cancel on ligacoes_ia for update to authenticated
  using ((select app.eh_interno()) and status in ('na_fila', 'discando'))
  with check ((select app.eh_interno()) and status = 'cancelada');
grant select on ligacoes_ia to authenticated;
grant update (status) on ligacoes_ia to authenticated;

-- ===========================================================================
-- (d) RPCs — todas security definer, search_path fixo, service_role apenas.
-- ===========================================================================

-- Reivindica até p_limite ligações `na_fila` cuja hora chegou e marca `discando`
-- na MESMA instrução (FOR UPDATE SKIP LOCKED: duas passagens de cron não pegam
-- a mesma linha). Quem falhar em disparar devolve a linha para `falhou`/`na_fila`.
create or replace function public.reivindicar_ligacoes_ia(p_limite int default 10)
returns setof ligacoes_ia
language sql security definer set search_path = public, pg_temp as $$
  update ligacoes_ia l
     set status = 'discando', disparada_em = now()
   where l.id in (
     select id from ligacoes_ia
      where status = 'na_fila' and (nao_antes_de is null or nao_antes_de <= now())
      order by criado_em
      for update skip locked
      limit greatest(coalesce(p_limite, 10), 1)
   )
  returning l.*
$$;
revoke execute on function public.reivindicar_ligacoes_ia(int) from public, anon, authenticated;
grant  execute on function public.reivindicar_ligacoes_ia(int) to service_role;

-- Grava o horário que a IA devolveu — pelo MESMO núcleo do link público (0051).
-- Devolve o jsonb do núcleo: {ok, agendamento_id, inicio_em, fim_em} ou {erro}.
-- Só o núcleo decide se o horário estava entre os ofertados e se a jornada pagou.
create or replace function public.registrar_horario_ligacao_ia(p_ligacao_id uuid, p_inicio timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lig  ligacoes_ia;
  v_link links_publicos;
  v_res  jsonb;
begin
  select * into v_lig from ligacoes_ia where id = p_ligacao_id;
  if not found then
    return jsonb_build_object('erro', 'ligacao_nao_encontrada');
  end if;
  if v_lig.status in ('concluida', 'sem_resposta', 'falhou', 'cancelada') then
    return jsonb_build_object('erro', 'ligacao_encerrada');
  end if;
  if v_lig.link_id is null then
    return jsonb_build_object('erro', 'sem_link');
  end if;

  select * into v_link from links_publicos where id = v_lig.link_id;
  if not found then
    return jsonb_build_object('erro', 'sem_link');
  end if;
  -- Link ativo ou já usado (remarcação); expirado/revogado não serve.
  if v_link.estado not in ('ativo', 'usado') or v_link.expira_em <= now() then
    return jsonb_build_object('erro', 'link_invalido');
  end if;

  -- Núcleo da 0051 (agente A): valida slot ∈ sugestões, nivel_pago >= 1, cria
  -- sessão se não há, remarca atomicamente, avança etapa. origem 'ia'.
  v_res := app.confirmar_horario_da_sugestao(v_link, p_inicio, 'ia');

  if coalesce((v_res ->> 'ok')::boolean, false) then
    update ligacoes_ia
       set status = 'concluida',
           resultado = 'agendou',
           horario_escolhido = p_inicio,
           agendamento_id = (v_res ->> 'agendamento_id')::uuid,
           encerrada_em = coalesce(encerrada_em, now()),
           erro = null
     where id = p_ligacao_id;
  end if;

  return v_res;
end $$;
revoke execute on function public.registrar_horario_ligacao_ia(uuid, timestamptz) from public, anon, authenticated;
grant  execute on function public.registrar_horario_ligacao_ia(uuid, timestamptz) to service_role;

-- Link de agendamento emitido PELO SISTEMA (fila da ligação IA, sem auth.uid()).
-- Espelha `emitir_link_material_sistema` (0031): mata o ativo anterior do mesmo
-- tipo, sem checagem de papel. Exige jornada aberta e pagamento (nivel_pago >= 1):
-- a ligação é para marcar a Sessão de Viabilidade contratada, nunca antes.
create or replace function public.emitir_link_agendamento_sistema(
  p_jornada_id uuid, p_token_hash text, p_token_prefixo text
) returns links_publicos
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_dias int; v_link links_publicos;
begin
  if not exists (select 1 from jornadas where id = p_jornada_id and desfecho = 'aberta') then
    raise exception 'jornada_invalida: jornada nao encontrada ou fechada' using errcode = 'P0002';
  end if;
  if not exists (select 1 from jornadas where id = p_jornada_id and nivel_pago >= 1) then
    raise exception 'sem_pagamento: jornada % sem pagamento aprovado', p_jornada_id using errcode = 'P0002';
  end if;

  select (valor ->> 'agendamento')::int into v_dias from configuracoes where chave = 'link.validade_dias';
  v_dias := coalesce(v_dias, 14);

  update links_publicos
     set estado = 'revogado', revogado_em = now()
   where jornada_id = p_jornada_id and tipo = 'agendamento' and estado = 'ativo';

  insert into links_publicos (jornada_id, tipo, token_hash, token_prefixo, expira_em, criado_por)
  values (p_jornada_id, 'agendamento', p_token_hash, p_token_prefixo, now() + (v_dias * interval '1 day'), null)
  returning * into v_link;

  return v_link;
end $$;
revoke execute on function public.emitir_link_agendamento_sistema(uuid, text, text) from public, anon, authenticated;
grant  execute on function public.emitir_link_agendamento_sistema(uuid, text, text) to service_role;

-- Fallback (§2.4): a IA não agendou → a MESMA oferta segue por e-mail e WhatsApp
-- com o link `/p/a`. `app.enfileirar_mensagem` (0013) não conhece
-- `{{link_agendamento}}` e tem EXECUTE revogado para tudo que não é trigger —
-- por isso este helper renderiza e insere direto, idempotente por
-- chave_idempotencia '{jornada}:agendamento_link:{ligacao_id}'.
-- Devolve quantas mensagens entraram na fila (0 = sem template ativo ou sem contato).
create or replace function public.enfileirar_link_agendamento_ligacao_ia(p_ligacao_id uuid, p_url text)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lig ligacoes_ia; v_pessoa record; v_t mensagens_templates; v_n int := 0;
  v_corpo text; v_assunto text; v_dest text;
begin
  select * into v_lig from ligacoes_ia where id = p_ligacao_id;
  if not found then return 0; end if;

  select p.nome, p.email, p.telefone into v_pessoa
    from jornadas j join pessoas p on p.id = j.pessoa_id
   where j.id = v_lig.jornada_id;

  for v_t in select * from mensagens_templates where chave = 'agendamento_link' and ativo loop
    v_dest := case v_t.canal when 'email' then v_pessoa.email else coalesce(v_pessoa.telefone, v_lig.telefone) end;
    if v_dest is null or length(trim(v_dest)) = 0 then continue; end if;

    v_corpo := replace(replace(v_t.corpo, '{{nome}}', coalesce(v_pessoa.nome, '')), '{{link_agendamento}}', p_url);
    v_assunto := nullif(replace(coalesce(v_t.assunto, ''), '{{nome}}', coalesce(v_pessoa.nome, '')), '');

    insert into mensagens_agendadas (jornada_id, agendamento_id, template_id, canal, destinatario,
                                     agendada_para, chave_idempotencia, assunto_renderizado, corpo_renderizado)
    values (v_lig.jornada_id, null, v_t.id, v_t.canal, v_dest, now(),
            v_lig.jornada_id::text || ':agendamento_link:' || p_ligacao_id::text || ':' || v_t.canal::text,
            v_assunto, v_corpo)
    on conflict (chave_idempotencia) do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;
revoke execute on function public.enfileirar_link_agendamento_ligacao_ia(uuid, text) from public, anon, authenticated;
grant  execute on function public.enfileirar_link_agendamento_ligacao_ia(uuid, text) to service_role;

-- ===========================================================================
-- (e) Entrada automática na fila após pagamento aprovado de Sessão de
-- Viabilidade. DESLIGADA por padrão (B33 — Vapi é subprocessador de voz sem
-- decisão LGPD). Liga com: update configuracoes set valor='true' where chave='ligacao_ia.automatica'.
-- Dispara depois de `trg_regua_boas_vindas` (ordem alfabética de trigger).
-- Só enfileira UMA vez por jornada (nunca re-liga sozinho para quem já teve ligação).
-- ===========================================================================
create or replace function app.enfileira_ligacao_ia() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tipo produto_tipo; v_tel text; v_prov text;
begin
  if new.status <> 'aprovado' or new.jornada_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;

  if not coalesce((select (valor)::boolean from configuracoes where chave = 'ligacao_ia.automatica'), false) then
    return new;
  end if;

  select p.tipo into v_tipo from produtos p where p.id = new.produto_id;
  if v_tipo is distinct from 'sessao_viabilidade' then return new; end if;

  if exists (select 1 from ligacoes_ia where jornada_id = new.jornada_id) then return new; end if;

  select p.telefone into v_tel from jornadas j join pessoas p on p.id = j.pessoa_id where j.id = new.jornada_id;
  v_tel := coalesce(v_tel, new.comprador_telefone);
  if v_tel is null or length(trim(v_tel)) = 0 then return new; end if;

  select valor #>> '{}' into v_prov from configuracoes where chave = 'ligacao_ia.provedor';
  if v_prov not in ('n8n', 'manual') then v_prov := 'manual'; end if;

  insert into ligacoes_ia (jornada_id, provedor, telefone, origem)
  values (new.jornada_id, v_prov, v_tel, 'automatica')
  on conflict (jornada_id) where status in ('na_fila', 'discando', 'em_ligacao') do nothing;

  return new;
end $$;
create trigger trg_regua_ligacao_ia after insert or update on pagamentos
for each row execute function app.enfileira_ligacao_ia();

-- ===========================================================================
-- (f) Configuração, template de fallback, view de custo
-- ===========================================================================
insert into configuracoes (chave, valor, descricao) values
 ('ligacao_ia.automatica', 'false'::jsonb,
  'Enfileirar ligação por IA sozinha após pagamento aprovado da Sessão de Viabilidade. Padrão false (BLOQUEIO B33 — decisão LGPD sobre a Vapi). O botão "Ligar por IA" na Ficha funciona independente disto.'),
 ('ligacao_ia.provedor', '"manual"'::jsonb,
  'Quem liga: "n8n" (Vapi via n8n, exige N8N_WEBHOOK_LIGACAO_URL + LIGACAO_IA_WEBHOOK_SECRET + VAPI_ASSISTENTE_ID) ou "manual" (vira tarefa para a equipe ligar).'),
 ('ligacao_ia.max_tentativas', '2'::jsonb,
  'Quantas ligações por IA tentar antes de cair para o link por e-mail/WhatsApp.'),
 ('ligacao_ia.intervalo_retentativa_minutos', '240'::jsonb,
  'Espera entre uma tentativa sem resposta e a próxima.'),
 ('ligacao_ia.timeout_minutos', '20'::jsonb,
  'Reaper: ligação "discando"/"em ligação" há mais que isto vira "falhou" (timeout_reaper).')
on conflict (chave) do nothing;

insert into mensagens_templates (chave, canal, versao, assunto, corpo, ativo) values
 ('agendamento_link', 'email', 1, 'Escolha o horário da sua Sessão de Viabilidade',
  $t$Olá, {{nome}}.

Tentamos falar com você por telefone para marcar a sua Sessão de Viabilidade e não conseguimos.

Escolha o melhor horário por aqui, leva menos de um minuto:

{{link_agendamento}}

Se preferir, responda este e-mail que a equipe marca com você.

Equipe Time Holding Brasil$t$, true),
 ('agendamento_link', 'whatsapp', 1, null,
  $t$Olá, {{nome}}! Tentamos ligar para marcar a sua Sessão de Viabilidade e não conseguimos falar com você. Escolha o melhor horário por aqui (leva menos de um minuto): {{link_agendamento}}$t$, true)
on conflict (chave, canal, versao) do nothing;

-- Custo de voz por mês — recorte "ligações" da aba Custo de IA (§2.8).
-- Só linhas com custo informado pelo provedor: NULL nunca vira zero.
create view vw_custo_ligacoes_ia_mensal with (security_invoker = true) as
select
  date_trunc('month', coalesce(encerrada_em, criado_em)) as mes,
  provedor,
  count(*)::int                                            as ligacoes,
  count(*) filter (where resultado = 'agendou')::int       as agendaram,
  count(custo_usd)::int                                    as com_custo_informado,
  sum(custo_usd)::numeric(14,4)                            as custo_usd_total,
  sum(duracao_segundos)::bigint                            as duracao_segundos_total
from ligacoes_ia
where status in ('concluida', 'sem_resposta', 'falhou')
group by 1, 2
order by 1 desc, 2;
grant select on vw_custo_ligacoes_ia_mensal to authenticated;

-- ===========================================================================
-- ROTEIRO DE VERIFICAÇÃO (rodar de verdade, depois de 0051 e 0052):
--  1. Como `relacionamento`: `select count(*) from ligacoes_ia` → 0 linhas, sem erro;
--     `insert into ligacoes_ia (...)` → 42501; `update ligacoes_ia set custo_usd=1` → 42501
--     (grant de coluna: só `status`).
--  2. Como service_role: inserir uma ligação `na_fila` para uma jornada com nivel_pago>=1;
--     `select * from reivindicar_ligacoes_ia(10)` → a linha volta com status 'discando'
--     e `disparada_em` preenchido; segunda chamada → 0 linhas.
--  3. Emitir link pelo sistema: `select emitir_link_agendamento_sistema(<jornada>, 'hash', 'pref')`
--     → link ativo tipo 'agendamento'; inserir `agendamentos_sugestoes` (2 slots) para ele;
--     `update ligacoes_ia set link_id = <link>`.
--  4. `select registrar_horario_ligacao_ia(<ligacao>, <inicio de um dos slots>)` → {ok:true,...};
--     ligação vira `concluida`/`agendou` com `agendamento_id`; timeline ganha
--     "Ligação por IA agendou a sessão"; `agendamentos.origem='ia'`.
--  5. Repetir o passo 4 com horário fora dos slots (nova ligação) → {erro:'horario_indisponivel'}
--     e a ligação NÃO muda de status.
--  6. `update ligacoes_ia set status='na_fila' where status='concluida'` → 23514 (terminal).
--  7. `select enfileirar_link_agendamento_ligacao_ia(<ligacao>, 'https://x/p/a/t')` → 1 ou 2
--     (depende de e-mail/telefone da pessoa); repetir → 0 (idempotente).
--  8. `ligacao_ia.automatica=false`: inserir pagamento aprovado de SV → nenhuma linha em
--     ligacoes_ia. Trocar para true, repetir com outra jornada com telefone → 1 linha
--     `na_fila`/`automatica`. Voltar para false.
--  9. `explain (analyze, buffers) select * from reivindicar_ligacoes_ia(10)` → Index Scan em
--     idx_ligacoes_ia_fila, sem Seq Scan.
--
-- REVERSÃO: drop view vw_custo_ligacoes_ia_mensal; drop trigger trg_regua_ligacao_ia on pagamentos;
--   drop function app.enfileira_ligacao_ia(), public.enfileirar_link_agendamento_ligacao_ia(uuid,text),
--   public.emitir_link_agendamento_sistema(uuid,text,text), public.registrar_horario_ligacao_ia(uuid,timestamptz),
--   public.reivindicar_ligacoes_ia(int), app.timeline_ligacao_ia(), app.ligacao_ia_guarda_transicao();
--   drop table ligacoes_ia; delete from configuracoes where chave like 'ligacao_ia.%';
--   update mensagens_templates set ativo=false where chave='agendamento_link'.
-- ===========================================================================
