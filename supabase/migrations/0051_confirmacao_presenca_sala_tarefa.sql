-- 0051_confirmacao_presenca_sala_tarefa.sql
-- Fase 4 · F1 "esteira automatizada" (agente A). Depende de 0050 (valor
-- 'confirmacao' do enum tipo_link_publico) — aplicar em transação SEPARADA.
--
-- O que entra (tudo aditivo; nenhum DELETE, nenhum UPDATE de valor de cliente):
--   (a) agendamentos.presenca_confirmada_em/_via + invariante + triggers de
--       proteção (imutável; equipe só grava via='equipe') e de efeito (timeline,
--       cancela D-7 pendente, revoga link ao sair de agendado/confirmado).
--   (b) sessoes_viabilidade.link_sala_origem/link_sala_atualizado_em/
--       sala_solicitada_em + carimbo automático + RPC registrar_link_sala (n8n).
--   (c) links_publicos.agendamento_id (só tipo 'confirmacao') + acao 'confirmar'.
--   (d) produtos.url_checkout (link de pagamento da Hotmart, por produto).
--   (e) tarefas.tipo + índice único parcial (uma tarefa aberta por tipo por
--       jornada) + trigger app.tarefa_pos_sessao (sessão 'fechou' ou oferta
--       aceita → tarefa 'enviar_link_croqui'). NOTA: o plano (§1.7) colocava
--       `tarefas.tipo` na 0052; veio para cá porque o trigger e o índice desta
--       migration dependem da coluna.
--   (f) RPC pública confirmar_presenca_publico + app.payload_link_confirmacao +
--       abrir_link_publico com o case novo + emitir_link_confirmacao_sistema.
--   (g) app.confirmar_horario_da_sugestao — núcleo único de "gravar horário
--       escolhido entre os ofertados" (C26), que também CONSOME o link
--       (usos+1, 'usado'; devolve `usos`/`pode_remarcar`) — e
--       escolher_horario_publico reescrita por cima dele (assinatura e grants
--       preservados). `tarefas.tipo` NÃO tem lista fechada: check por regex
--       `^[a-z_]{3,60}$` — 'enviar_link_croqui' (A) e 'ligar_para_agendar' (B) passam.
--   (h) app.enfileirar_mensagem: {{link_sala}} só é substituído quando há link
--       (C24) — placeholder fica para o envio resolver.
--   (i) DROP + CREATE de reivindicar_mensagens_pendentes(int, canal_mensagem[])
--       com os holds (link_material · link_sala · link_confirmacao).
--   (j) app.regua_agendamento: {{data_sessao}} em America/Sao_Paulo (era UTC).
--   (k) templates v2 confirmacao_d7 (2 canais) e dia_da_sessao; v1 croqui_convite.
--
-- As views (vw_pendencias_sistema, vw_sessoes_do_dia, vw_jornada_kanban) ficam
-- na 0052, num único CREATE OR REPLACE cada — evita definir a mesma view duas
-- vezes em migrations consecutivas.
--
-- ROTEIRO DE VERIFICAÇÃO (orquestrador, via MCP — rodar de verdade):
--   0) Sobrecarga não pode existir (armadilha 6):
--      select oid::regprocedure from pg_proc where proname = 'reivindicar_mensagens_pendentes';
--      -- esperado: UMA linha: reivindicar_mensagens_pendentes(integer, canal_mensagem[])
--   1) Emitir link de confirmação para um agendamento ativo de exemplo:
--      select id, tipo, estado, agendamento_id from public.emitir_link_confirmacao_sistema(
--        '<agendamento_id>', 'hash-de-teste-0051', 'teste0');
--      select tipo, estado, payload from public.abrir_link_publico('hash-de-teste-0051');
--      -- esperado: tipo='confirmacao', payload {inicio_em, fim_em, ja_confirmada_em: null}
--   2) select public.confirmar_presenca_publico('hash-de-teste-0051');   -- {ok:true, confirmada_em:...}
--      select presenca_confirmada_em, presenca_confirmada_via from agendamentos where id = '<agendamento_id>';
--      select public.confirmar_presenca_publico('hash-de-teste-0051');   -- mesma confirmada_em (idempotente)
--      select titulo from eventos_timeline where dados->>'agendamento_id' = '<agendamento_id>' order by ocorrido_em desc limit 1;
--      -- esperado: 'Presença confirmada pelo cliente'; e nenhuma mensagem confirmacao_d7 'pendente' do agendamento
--      -- (select status from mensagens_agendadas where agendamento_id='<agendamento_id>')
--   3) Hold de sala: numa transação com rollback —
--      begin;
--        update sessoes_viabilidade set link_sala = null where id = '<sessao_id>';
--        update mensagens_agendadas set agendada_para = now() - interval '1 minute'
--         where agendamento_id = '<agendamento_id>' and template_id in (select id from mensagens_templates where chave='dia_da_sessao');
--        select id from public.reivindicar_mensagens_pendentes(50, array['email']::canal_mensagem[]);  -- NÃO devolve a de {{link_sala}}
--        update sessoes_viabilidade set link_sala = 'https://meet.example/x' where id = '<sessao_id>';
--        select id, corpo_renderizado from public.reivindicar_mensagens_pendentes(50, array['email']::canal_mensagem[]); -- devolve, corpo AINDA com {{link_sala}}
--        select link_sala_origem, link_sala_atualizado_em from sessoes_viabilidade where id='<sessao_id>'; -- 'manual' se auth.uid() não nulo; atualizado_em preenchido
--      rollback;
--   4) Remarcar/cancelar revoga o link: update agendamentos set status='cancelado' where id='<agendamento_id>';
--      select estado from links_publicos where agendamento_id='<agendamento_id>';  -- 'revogado'   (rollback depois)
--   5) Tarefa assistida: numa transação com rollback —
--      update sessoes_viabilidade set realizada_em = now(), resultado = 'fechou' where id='<sessao_id>';
--      select tipo, responsavel_id, vence_em, origem from tarefas where jornada_id='<jornada_id>' and concluida_em is null;
--      -- esperado: 1 linha tipo='enviar_link_croqui', origem='sistema'; repetir o update não duplica.
--   6) Núcleo não é chamável por anon/authenticated:
--      select has_function_privilege('anon', 'app.confirmar_horario_da_sugestao(links_publicos, timestamptz, text)', 'execute');         -- false
--      select has_function_privilege('authenticated', 'app.confirmar_horario_da_sugestao(links_publicos, timestamptz, text)', 'execute'); -- false
--      select has_function_privilege('anon', 'public.confirmar_presenca_publico(text, text, text)', 'execute');                        -- true
--   7) Equipe não forja 'link': com JWT de admin (ou set role authenticated + request.jwt.claims):
--      update agendamentos set presenca_confirmada_em = now(), presenca_confirmada_via = 'link' where id='<outro_agendamento>';
--      -- esperado: 23514 presenca_via_invalida
--   8) Templates: select chave, canal, versao, ativo from mensagens_templates where chave in ('confirmacao_d7','dia_da_sessao','croqui_convite') order by 1,2,3;
--      -- esperado: v1 ativo=false, v2 ativo=true (confirmacao_d7 email+whatsapp, dia_da_sessao email), croqui_convite whatsapp v1 ativo=true
--
-- REVERSÃO (ordem inversa; texto anterior das funções indicado por migration:linha):
--   drop trigger trg_tarefa_pos_sessao_sessao on sessoes_viabilidade; drop trigger trg_tarefa_pos_sessao_oferta on ofertas;
--   drop trigger trg_protege_tarefa on tarefas; drop trigger trg_timeline_link_sala on sessoes_viabilidade;
--   drop trigger trg_carimba_link_sala on sessoes_viabilidade; drop trigger trg_revoga_link_confirmacao on agendamentos;
--   drop trigger trg_presenca_confirmada_pos on agendamentos; drop trigger trg_protege_presenca_confirmada on agendamentos;
--   drop function app.tarefa_pos_sessao_sessao(), app.tarefa_pos_sessao_oferta(), app.criar_tarefa_enviar_link_croqui(uuid, uuid, date),
--        app.protege_tarefa(), app.timeline_link_sala(), app.carimba_link_sala(), app.revoga_link_confirmacao(),
--        app.presenca_confirmada_pos(), app.protege_presenca_confirmada();
--   drop function public.confirmar_presenca_publico(text, text, text), public.emitir_link_confirmacao_sistema(uuid, text, text),
--        public.registrar_link_sala(uuid, text, text), app.payload_link_confirmacao(links_publicos, jornadas);
--   -- abrir_link_publico: recriar pelo texto da 0031:443-492.
--   -- escolher_horario_publico: recriar pelo texto da 0028:622-731 (com `exclusion_violation or unique_violation`, 0038); depois
--   drop function app.confirmar_horario_da_sugestao(links_publicos, timestamptz, text);
--   drop function public.reivindicar_mensagens_pendentes(int, canal_mensagem[]);  -- e recriar (int) pelo texto da 0031:502-523
--   -- app.enfileirar_mensagem: recriar pelo texto da 0013:58-89.  app.regua_agendamento: pelo texto da 0020:23-63.
--   update mensagens_templates set ativo = (versao = 1) where chave in ('confirmacao_d7','dia_da_sessao');
--   update mensagens_templates set ativo = false where chave = 'croqui_convite';
--   drop index uniq_tarefa_aberta_por_tipo; alter table tarefas drop column tipo;
--   alter table produtos drop column url_checkout;
--   alter table links_publicos drop column agendamento_id;
--   alter table links_publicos_acessos drop constraint links_publicos_acessos_acao_check;
--   alter table links_publicos_acessos add constraint links_publicos_acessos_acao_check
--     check (acao in ('abrir','responder','escolher_horario','enviar_documento','negado'));
--   alter table sessoes_viabilidade drop column link_sala_origem, drop column link_sala_atualizado_em, drop column sala_solicitada_em;
--   alter table agendamentos drop constraint ck_presenca_confirmada, drop column presenca_confirmada_em, drop column presenca_confirmada_via;

-- ===========================================================================
-- (a) Presença confirmada é um FATO sobre o agendamento, não um status (C23).
-- ===========================================================================
alter table agendamentos
  add column presenca_confirmada_em  timestamptz,
  add column presenca_confirmada_via text
    check (presenca_confirmada_via in ('link', 'whatsapp', 'email', 'equipe', 'ligacao_ia'));
alter table agendamentos add constraint ck_presenca_confirmada
  check ((presenca_confirmada_em is null) = (presenca_confirmada_via is null));

comment on column agendamentos.presenca_confirmada_em is
  'Quando o cliente (ou a equipe por ele) confirmou PRESENÇA. Não confundir com status=confirmado, que é "horário escolhido".';
comment on column agendamentos.presenca_confirmada_via is
  'link = /p/c pelo cliente · equipe = marcado à mão (B34, nome na timeline) · ligacao_ia = assistente de voz · whatsapp/email = reservados.';

-- Proteção (BEFORE): imutável depois de gravada; equipe logada só grava 'equipe'
-- (B34: nunca se apresenta como "o cliente confirmou pelo link"); só em
-- agendamento ativo. Sem SECURITY DEFINER: não escreve em outra tabela.
create or replace function app.protege_presenca_confirmada() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.presenca_confirmada_em is distinct from old.presenca_confirmada_em
     or new.presenca_confirmada_via is distinct from old.presenca_confirmada_via then
    if old.presenca_confirmada_em is not null then
      raise exception 'presenca_imutavel: presença já confirmada no agendamento % não se altera', old.id
        using errcode = '23514';
    end if;
    if new.status not in ('agendado', 'confirmado') then
      raise exception 'presenca_agendamento_inativo: só agendamento agendado/confirmado recebe presença (%)', new.status
        using errcode = '23514';
    end if;
    if auth.uid() is not null and new.presenca_confirmada_via is distinct from 'equipe' then
      raise exception 'presenca_via_invalida: equipe só confirma presença com via = equipe (recebido %)', new.presenca_confirmada_via
        using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger trg_protege_presenca_confirmada before update on agendamentos
for each row execute function app.protege_presenca_confirmada();

-- Efeito (AFTER, SECURITY DEFINER — escreve em eventos_timeline e em
-- mensagens_agendadas, cujo UPDATE está revogado de authenticated desde 0019):
-- 1) evento na timeline com quem marcou; 2) cancela a D-7 ainda pendente deste
-- agendamento (o cliente já respondeu — não se pede confirmação de novo).
create or replace function app.presenca_confirmada_pos() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_jornada_id uuid; v_perfil perfis_equipe%rowtype;
begin
  if new.presenca_confirmada_em is null or old.presenca_confirmada_em is not null then
    return new;
  end if;
  select s.jornada_id into v_jornada_id from sessoes_viabilidade s where s.id = new.sessao_id;
  select * into v_perfil from perfis_equipe where auth_user_id = auth.uid() and ativo;

  insert into eventos_timeline (jornada_id, tipo, titulo, descricao, dados, ator_perfil_id, ator_tipo)
  values (
    v_jornada_id, 'agendamento',
    case new.presenca_confirmada_via
      when 'link'       then 'Presença confirmada pelo cliente'
      when 'equipe'     then 'Presença confirmada pela equipe'
      when 'ligacao_ia' then 'Presença confirmada na ligação por IA'
      else                   'Presença confirmada (' || new.presenca_confirmada_via || ')'
    end,
    case
      when new.presenca_confirmada_via = 'equipe' and v_perfil.id is not null
        then 'Marcada à mão por ' || v_perfil.nome || ' — fallback do WhatsApp (B34).'
      when new.presenca_confirmada_via = 'link' then 'O cliente tocou no link de confirmação.'
      else null
    end,
    jsonb_build_object('agendamento_id', new.id, 'via', new.presenca_confirmada_via, 'inicio_em', new.inicio_em),
    v_perfil.id,
    case new.presenca_confirmada_via when 'ligacao_ia' then 'ia' else 'humano' end
  );

  update mensagens_agendadas m
     set status = 'cancelada', erro = 'presenca ja confirmada'
   where m.agendamento_id = new.id
     and m.status = 'pendente'
     and exists (select 1 from mensagens_templates t where t.id = m.template_id and t.chave = 'confirmacao_d7');
  return new;
end $$;
create trigger trg_presenca_confirmada_pos after update on agendamentos
for each row execute function app.presenca_confirmada_pos();

-- Agendamento que deixa de estar ativo (remarcado, cancelado, realizado,
-- faltou) mata o link de confirmação dele — o agendamento novo enfileira D-7
-- nova, que emite link novo no envio. app.regua_agendamento (0020) já cancela
-- as mensagens pendentes; isto cobre o link.
create or replace function app.revoga_link_confirmacao() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.status in ('agendado', 'confirmado') and new.status not in ('agendado', 'confirmado') then
    update links_publicos
       set estado = 'revogado', revogado_em = now()
     where agendamento_id = old.id and estado = 'ativo';
  end if;
  return new;
end $$;
create trigger trg_revoga_link_confirmacao after update on agendamentos
for each row execute function app.revoga_link_confirmacao();

-- ===========================================================================
-- (b) Sala: origem do link, carimbo de quando mudou, quando foi pedida ao n8n.
-- ===========================================================================
alter table sessoes_viabilidade
  add column link_sala_origem        text not null default 'manual' check (link_sala_origem in ('manual', 'n8n')),
  add column link_sala_atualizado_em timestamptz,
  add column sala_solicitada_em      timestamptz;

comment on column sessoes_viabilidade.link_sala_origem is 'manual = colado na Ficha → Sessão · n8n = veio pelo webhook /api/webhooks/n8n/sala.';
comment on column sessoes_viabilidade.sala_solicitada_em is
  'Quando o cron (sincronizarSalas) pediu a sala ao n8n pela última vez. Evita pedir a cada 5 min; retenta depois de 1h sem resposta.';

-- Carimbo automático: qualquer mudança em link_sala grava o instante; se quem
-- mudou é um usuário logado (auth.uid() não nulo), a origem é 'manual' — o
-- caminho n8n é service_role via registrar_link_sala, que informa a origem.
create or replace function app.carimba_link_sala() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.link_sala is distinct from old.link_sala then
    new.link_sala_atualizado_em := now();
    if auth.uid() is not null then
      new.link_sala_origem := 'manual';
    end if;
  end if;
  return new;
end $$;
create trigger trg_carimba_link_sala before update on sessoes_viabilidade
for each row execute function app.carimba_link_sala();

create or replace function app.timeline_link_sala() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.link_sala is distinct from old.link_sala and new.link_sala is not null then
    insert into eventos_timeline (jornada_id, tipo, titulo, descricao, dados, ator_perfil_id, ator_tipo)
    values (new.jornada_id, 'agendamento',
            case new.link_sala_origem when 'n8n' then 'Link da sala criado pela integração' else 'Link da sala registrado' end,
            null,
            jsonb_build_object('sessao_id', new.id, 'origem', new.link_sala_origem),
            (select id from perfis_equipe where auth_user_id = auth.uid() and ativo),
            case new.link_sala_origem when 'n8n' then 'sistema' else 'humano' end);
  end if;
  return new;
end $$;
create trigger trg_timeline_link_sala after update on sessoes_viabilidade
for each row execute function app.timeline_link_sala();

-- Porta do webhook n8n → sala (service_role). Idempotente: mesmo link duas
-- vezes não gera segundo evento (o trigger acima só dispara em mudança real).
create or replace function public.registrar_link_sala(
  p_sessao_id uuid, p_link_sala text, p_origem text default 'n8n'
) returns sessoes_viabilidade
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_sessao sessoes_viabilidade%rowtype;
begin
  if p_origem not in ('manual', 'n8n') then
    raise exception 'origem_invalida: %', p_origem using errcode = '22023';
  end if;
  if p_link_sala is null or length(trim(p_link_sala)) = 0 or p_link_sala !~* '^https?://' then
    raise exception 'link_sala_invalido' using errcode = '22023';
  end if;
  update sessoes_viabilidade
     set link_sala = trim(p_link_sala),
         link_sala_origem = p_origem,
         link_sala_atualizado_em = now()
   where id = p_sessao_id
  returning * into v_sessao;
  if not found then
    raise exception 'sessao_nao_encontrada: %', p_sessao_id using errcode = 'P0002';
  end if;
  return v_sessao;
end $$;
revoke execute on function public.registrar_link_sala(uuid, text, text) from public, anon, authenticated;
grant  execute on function public.registrar_link_sala(uuid, text, text) to service_role;

-- ===========================================================================
-- (c) Link de confirmação aponta para UM agendamento; auditoria ganha a ação.
-- ===========================================================================
alter table links_publicos
  add column agendamento_id uuid references agendamentos(id) on delete cascade;
alter table links_publicos add constraint ck_link_confirmacao_agendamento
  check (tipo <> 'confirmacao' or agendamento_id is not null);
create index idx_links_agendamento on links_publicos (agendamento_id) where agendamento_id is not null;

alter table links_publicos_acessos drop constraint if exists links_publicos_acessos_acao_check;
alter table links_publicos_acessos add constraint links_publicos_acessos_acao_check
  check (acao in ('abrir', 'responder', 'escolher_horario', 'enviar_documento', 'confirmar', 'negado'));

-- ===========================================================================
-- (d) Link de checkout por produto (Admin → Produtos). Nunca inventado: nulo
-- vira <SeloStub> na tela e a mensagem do croqui sai sem o link (§1.4).
-- ===========================================================================
alter table produtos add column url_checkout text
  check (url_checkout is null or url_checkout ~* '^https://');
comment on column produtos.url_checkout is 'URL de checkout da Hotmart deste produto. Só https. Nulo = "não cadastrado" na tela.';

-- ===========================================================================
-- (e) Tarefa assistida "Enviar link do croqui" (reusa `tarefas`, 0027).
-- ===========================================================================
alter table tarefas add column tipo text
  check (tipo is null or (tipo ~ '^[a-z_]{3,60}$'));
comment on column tarefas.tipo is
  'Chave de máquina da tarefa gerada pelo sistema (enviar_link_croqui, ligar_para_agendar…). Nulo = tarefa livre criada à mão.';
-- Uma tarefa ABERTA por tipo por jornada — idempotência do trigger.
create unique index uniq_tarefa_aberta_por_tipo on tarefas (jornada_id, tipo)
  where concluida_em is null and tipo is not null;

create or replace function app.criar_tarefa_enviar_link_croqui(
  p_jornada_id uuid, p_responsavel_id uuid, p_vence_em date
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_jornada_id is null then return; end if;
  insert into tarefas (jornada_id, tipo, titulo, descricao, responsavel_id, vence_em, origem)
  values (p_jornada_id, 'enviar_link_croqui', 'Enviar link do croqui',
          'Enviar pessoalmente ao cliente: link de pagamento do Croqui, data da apresentação e pedido do IR/contrato social.',
          p_responsavel_id, p_vence_em, 'sistema')
  on conflict (jornada_id, tipo) where concluida_em is null and tipo is not null do nothing;
end $$;
revoke execute on function app.criar_tarefa_enviar_link_croqui(uuid, uuid, date) from public, anon;
grant  execute on function app.criar_tarefa_enviar_link_croqui(uuid, uuid, date) to authenticated, service_role;

-- Gatilho 1: a sessão passa a (realizada_em preenchido E resultado='fechou').
create or replace function app.tarefa_pos_sessao_sessao() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (new.realizada_em is not null and new.resultado = 'fechou')
     and not (old.realizada_em is not null and old.resultado = 'fechou') then
    perform app.criar_tarefa_enviar_link_croqui(new.jornada_id, new.advogada_id, (new.realizada_em + interval '1 day')::date);
  end if;
  return new;
end $$;
create trigger trg_tarefa_pos_sessao_sessao after update on sessoes_viabilidade
for each row execute function app.tarefa_pos_sessao_sessao();

-- Gatilho 2: oferta registrada como aceita (INSERT já aceita, ou UPDATE que vira aceita).
create or replace function app.tarefa_pos_sessao_oferta() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_advogada_id uuid;
begin
  if new.aceita is true and (tg_op = 'INSERT' or old.aceita is distinct from true) then
    select advogada_id into v_advogada_id from sessoes_viabilidade where jornada_id = new.jornada_id;
    perform app.criar_tarefa_enviar_link_croqui(new.jornada_id, coalesce(v_advogada_id, new.ofertada_por), (now() + interval '1 day')::date);
  end if;
  return new;
end $$;
create trigger trg_tarefa_pos_sessao_oferta after insert or update on ofertas
for each row execute function app.tarefa_pos_sessao_oferta();

-- Conclusão: carimbada pelo servidor (quem concluiu = quem está logado) e imutável.
create or replace function app.protege_tarefa() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if old.concluida_em is not null
     and (new.concluida_em is distinct from old.concluida_em or new.concluida_por is distinct from old.concluida_por) then
    raise exception 'tarefa_concluida_imutavel: tarefa % já concluída', old.id using errcode = '23514';
  end if;
  if new.concluida_em is not null and old.concluida_em is null then
    select id into new.concluida_por from perfis_equipe where auth_user_id = auth.uid() and ativo;
    new.concluida_em := now();
  end if;
  return new;
end $$;
create trigger trg_protege_tarefa before update on tarefas
for each row execute function app.protege_tarefa();

-- ===========================================================================
-- (f) Link público de confirmação — 5ª RPC pública, mesmo pepper/hash/rate
-- limit/auditoria das 4 de 0028.
-- ===========================================================================
create or replace function app.payload_link_confirmacao(p_link links_publicos, p_jornada jornadas)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare v_ag agendamentos%rowtype;
begin
  select * into v_ag from agendamentos
   where id = p_link.agendamento_id and status in ('agendado', 'confirmado');
  if not found then
    return null;  -- agendamento remarcado/cancelado: abrir_link_publico trata como link_invalido
  end if;
  return jsonb_build_object(
    'inicio_em', v_ag.inicio_em,
    'fim_em', v_ag.fim_em,
    'ja_confirmada_em', v_ag.presenca_confirmada_em
  );
end $$;

-- Texto anterior: 0031:443-492. Único trecho novo: o `when 'confirmacao'` e o
-- tratamento de payload nulo também para esse tipo (mesmo DESVIO do material).
create or replace function public.abrir_link_publico(
  p_hash text, p_ip_hash text default null, p_user_agent text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_link links_publicos; v_jornada jornadas%rowtype; v_pessoa pessoas%rowtype; v_payload jsonb;
begin
  if not app.limite_rota_ok('abrir_link_publico') then
    return jsonb_build_object('erro', 'limite_excedido');
  end if;
  if not app.limite_token_ok(p_hash) then
    perform app.registrar_acesso_publico(null, 'abrir', 'limite', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'limite_excedido');
  end if;

  v_link := app.resolve_link_leitura(p_hash);
  if v_link is null then
    perform app.registrar_acesso_publico(null, 'abrir', 'invalido', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'link_invalido');
  end if;

  select * into v_jornada from jornadas where id = v_link.jornada_id;
  select * into v_pessoa  from pessoas  where id = v_jornada.pessoa_id;

  v_payload := case v_link.tipo
    when 'formulario'  then app.payload_link_formulario(v_link, v_jornada)
    when 'agendamento' then app.payload_link_agendamento(v_link, v_jornada)
    when 'documentos'  then app.payload_link_documentos(v_link, v_jornada)
    when 'confirmacao' then app.payload_link_confirmacao(v_link, v_jornada)
    else                    app.payload_link_material(v_link, v_jornada)
  end;

  if v_link.tipo in ('material', 'confirmacao') and v_payload is null then
    perform app.registrar_acesso_publico(v_link.id, 'abrir', 'invalido', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'link_invalido');
  end if;

  perform app.registrar_acesso_publico(v_link.id, 'abrir', 'ok', p_ip_hash, p_user_agent);

  return jsonb_build_object(
    'tipo', v_link.tipo,
    'primeiro_nome', split_part(trim(coalesce(v_pessoa.nome, '')), ' ', 1),
    'expira_em', v_link.expira_em,
    'estado', v_link.estado,
    'payload', v_payload
  );
end $$;
revoke execute on function public.abrir_link_publico(text, text, text) from public;
grant  execute on function public.abrir_link_publico(text, text, text) to anon;

-- Tolerante a 'usado' (resolve_link_leitura): reabrir o link depois de
-- confirmar mostra "já confirmado" em vez de erro. O agendamento alvo é o que
-- estava ativo quando o link foi emitido (links_publicos.agendamento_id).
create or replace function public.confirmar_presenca_publico(
  p_hash text, p_ip_hash text default null, p_user_agent text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_link links_publicos; v_ag agendamentos%rowtype;
begin
  if not app.limite_rota_ok('confirmar_presenca_publico') then
    return jsonb_build_object('erro', 'limite_excedido');
  end if;
  if not app.limite_token_ok(p_hash) then
    perform app.registrar_acesso_publico(null, 'confirmar', 'limite', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'limite_excedido');
  end if;

  v_link := app.resolve_link_leitura(p_hash);
  if v_link is null or v_link.tipo <> 'confirmacao' then
    perform app.registrar_acesso_publico(coalesce(v_link.id, null), 'confirmar', 'invalido', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'link_invalido');
  end if;

  select * into v_ag from agendamentos
   where id = v_link.agendamento_id and status in ('agendado', 'confirmado')
   for update;
  if not found then
    perform app.registrar_acesso_publico(v_link.id, 'confirmar', 'erro', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'agendamento_indisponivel');
  end if;

  if v_ag.presenca_confirmada_em is null then
    -- Os triggers de (a) gravam a timeline e cancelam a D-7 pendente.
    update agendamentos
       set presenca_confirmada_em = now(), presenca_confirmada_via = 'link'
     where id = v_ag.id
    returning * into v_ag;
    update links_publicos set usos = usos + 1, estado = 'usado', finalizado_em = now() where id = v_link.id;
  end if;

  perform app.registrar_acesso_publico(v_link.id, 'confirmar', 'ok', p_ip_hash, p_user_agent);
  -- Nunca ids na resposta pública (regra dura 4, §2.2 da Fase 2).
  return jsonb_build_object('ok', true, 'inicio_em', v_ag.inicio_em, 'fim_em', v_ag.fim_em,
                            'confirmada_em', v_ag.presenca_confirmada_em);
end $$;
revoke execute on function public.confirmar_presenca_publico(text, text, text) from public, authenticated;
grant  execute on function public.confirmar_presenca_publico(text, text, text) to anon;

-- Emissão NO ENVIO (G18, irmã de emitir_link_material_sistema 0031:307-338):
-- service_role, sem gate de papel — quem chama é o cron/preparar.
create or replace function public.emitir_link_confirmacao_sistema(
  p_agendamento_id uuid, p_token_hash text, p_token_prefixo text
) returns links_publicos
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ag agendamentos%rowtype; v_jornada_id uuid; v_dias int; v_link links_publicos;
begin
  select * into v_ag from agendamentos where id = p_agendamento_id and status in ('agendado', 'confirmado');
  if not found then
    raise exception 'agendamento_indisponivel: agendamento % não está ativo', p_agendamento_id using errcode = 'P0002';
  end if;
  select s.jornada_id into v_jornada_id from sessoes_viabilidade s where s.id = v_ag.sessao_id;
  if not exists (select 1 from jornadas where id = v_jornada_id and desfecho = 'aberta') then
    raise exception 'jornada_invalida: jornada nao encontrada ou fechada' using errcode = 'P0002';
  end if;

  select (valor ->> 'confirmacao')::int into v_dias from configuracoes where chave = 'link.validade_dias';
  v_dias := coalesce(v_dias, 14);

  update links_publicos
     set estado = 'revogado', revogado_em = now()
   where jornada_id = v_jornada_id and tipo = 'confirmacao' and estado = 'ativo';

  -- Vale pelo menos até o fim da sessão: confirmar na véspera não pode dar "expirado".
  insert into links_publicos (jornada_id, tipo, token_hash, token_prefixo, expira_em, criado_por, agendamento_id)
  values (v_jornada_id, 'confirmacao', p_token_hash, p_token_prefixo,
          greatest(now() + (v_dias * interval '1 day'), v_ag.fim_em + interval '1 hour'), null, v_ag.id)
  returning * into v_link;
  return v_link;
end $$;
revoke execute on function public.emitir_link_confirmacao_sistema(uuid, text, text) from public, anon, authenticated;
grant  execute on function public.emitir_link_confirmacao_sistema(uuid, text, text) to service_role;

-- ===========================================================================
-- (g) Núcleo único de "gravar o horário escolhido entre os ofertados" (C26).
-- Extraído de escolher_horario_publico (0028:656-721, com o handler de 0038).
-- Comportamento idêntico: slot ∈ agendamentos_sugestoes(link); nivel_pago >= 1;
-- cria sessão se não há; remarca (antigo -> 'remarcado', novo 'confirmado');
-- exclusion/unique -> {erro:'horario_indisponivel'}; avança
-- sessao_contratada -> sessao_agendada. Quem chama: escolher_horario_publico
-- (anon, abaixo) e registrar_horario_ligacao_ia (agente B, service_role).
-- ===========================================================================
create or replace function app.confirmar_horario_da_sugestao(
  p_link links_publicos, p_inicio timestamptz, p_origem text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_slot record;
  v_jornada jornadas%rowtype;
  v_sessao sessoes_viabilidade%rowtype;
  v_agendamento agendamentos%rowtype;
  v_usos int;
begin
  if p_origem is null or p_origem not in ('cliente', 'ia') then
    return jsonb_build_object('erro', 'origem_invalida');
  end if;
  if p_link.id is null or p_link.tipo <> 'agendamento' then
    return jsonb_build_object('erro', 'link_invalido');
  end if;

  select * into v_slot from agendamentos_sugestoes
   where link_id = p_link.id and inicio_em = p_inicio;
  if not found then
    return jsonb_build_object('erro', 'horario_indisponivel');
  end if;

  select * into v_jornada from jornadas where id = p_link.jornada_id;
  if v_jornada.id is null or v_jornada.desfecho <> 'aberta' then
    return jsonb_build_object('erro', 'link_invalido');
  end if;
  if v_jornada.nivel_pago < 1 then
    return jsonb_build_object('erro', 'agendamento_indisponivel');
  end if;

  select * into v_sessao from sessoes_viabilidade where jornada_id = p_link.jornada_id;
  if not found then
    insert into sessoes_viabilidade (jornada_id) values (p_link.jornada_id)
    returning * into v_sessao;
  end if;

  begin
    select * into v_agendamento from agendamentos
     where sessao_id = v_sessao.id and status = 'confirmado';
    if found then
      update agendamentos set status = 'remarcado' where id = v_agendamento.id;
    end if;
    insert into agendamentos (sessao_id, inicio_em, fim_em, status, origem, advogada_id)
    values (v_sessao.id, v_slot.inicio_em, v_slot.fim_em, 'confirmado', p_origem, v_sessao.advogada_id)
    returning * into v_agendamento;
  exception when exclusion_violation or unique_violation then
    -- O rollback deste bloco desfaz o 'remarcado' — o cliente nunca fica sem
    -- o horário que já tinha. Não vaza de quem é o conflito.
    return jsonb_build_object('erro', 'horario_indisponivel');
  end;

  if v_jornada.etapa = 'sessao_contratada' then
    update jornadas set etapa = 'sessao_agendada' where id = v_jornada.id;
  end if;

  -- O consumo do link é do NÚCLEO (pedido do agente B): `registrar_horario_ligacao_ia`
  -- chama aqui direto, sem passar pelo wrapper público — o teto de 1 remarcação
  -- (`usos < 2`) continua valendo para o link que a IA usou.
  update links_publicos
     set usos = usos + 1, estado = 'usado'
   where id = p_link.id
  returning usos into v_usos;

  return jsonb_build_object('ok', true, 'agendamento_id', v_agendamento.id,
                            'inicio_em', v_agendamento.inicio_em, 'fim_em', v_agendamento.fim_em,
                            'usos', v_usos, 'pode_remarcar', v_usos < 2);
end $$;
-- Nunca chamável fora dos wrappers: sem EXECUTE para anon/authenticated (e o
-- schema app não é exposto ao PostgREST). service_role recebe por ser o papel
-- do cron/webhook; os wrappers SECURITY DEFINER não dependem deste grant.
revoke execute on function app.confirmar_horario_da_sugestao(links_publicos, timestamptz, text) from public, anon, authenticated;
grant  execute on function app.confirmar_horario_da_sugestao(links_publicos, timestamptz, text) to service_role;

-- escolher_horario_publico por cima do núcleo. Assinatura, grants e forma da
-- resposta NÃO mudam. Texto anterior: 0028:622-731 (+ handler da 0038).
create or replace function public.escolher_horario_publico(
  p_hash text, p_inicio timestamptz,
  p_ip_hash text default null, p_user_agent text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_link links_publicos; v_res jsonb;
begin
  if not app.limite_rota_ok('escolher_horario_publico') then
    return jsonb_build_object('erro', 'limite_excedido');
  end if;
  if not app.limite_token_ok(p_hash) then
    perform app.registrar_acesso_publico(null, 'escolher_horario', 'limite', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'limite_excedido');
  end if;

  v_link := app.resolve_link_leitura(p_hash);
  if v_link is null or v_link.tipo <> 'agendamento' then
    perform app.registrar_acesso_publico(coalesce(v_link.id, null), 'escolher_horario', 'invalido', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'link_invalido');
  end if;

  if v_link.usos >= 2 then
    perform app.registrar_acesso_publico(v_link.id, 'escolher_horario', 'limite', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'limite_remarcacoes');
  end if;

  -- O núcleo grava o agendamento E consome o link (usos + 1, estado 'usado').
  v_res := app.confirmar_horario_da_sugestao(v_link, p_inicio, 'cliente');
  if v_res ? 'erro' then
    perform app.registrar_acesso_publico(v_link.id, 'escolher_horario',
      case when v_res ->> 'erro' = 'link_invalido' then 'invalido' else 'erro' end, p_ip_hash, p_user_agent);
    return v_res;
  end if;

  perform app.registrar_acesso_publico(v_link.id, 'escolher_horario', 'ok', p_ip_hash, p_user_agent);

  return jsonb_build_object('ok', true, 'horario_confirmado', jsonb_build_object(
    'inicio_em', v_res -> 'inicio_em',
    'fim_em', v_res -> 'fim_em',
    'pode_remarcar', v_res -> 'pode_remarcar'
  ));
end $$;
revoke execute on function public.escolher_horario_publico(text, timestamptz, text, text) from public, authenticated;
grant  execute on function public.escolher_horario_publico(text, timestamptz, text, text) to anon;

-- ===========================================================================
-- (h) {{link_sala}} só é substituído quando há link no enfileiramento (C24).
-- Sem link, o placeholder FICA e é resolvido no envio (processar.ts /
-- preparar). Mesma assinatura da 0013:58 → substitui, não sobrecarrega.
-- ===========================================================================
create or replace function app.enfileirar_mensagem(
  p_jornada_id uuid, p_agendamento_id uuid, p_chave_template text, p_canal canal_mensagem,
  p_destinatario text, p_agendada_para timestamptz,
  p_nome text, p_data_sessao text, p_link_sala text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
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
  v_corpo := replace(replace(v_template.corpo,
               '{{nome}}', coalesce(p_nome, '')),
               '{{data_sessao}}', coalesce(p_data_sessao, ''));
  v_assunto := replace(replace(coalesce(v_template.assunto, ''),
               '{{nome}}', coalesce(p_nome, '')),
               '{{data_sessao}}', coalesce(p_data_sessao, ''));
  if p_link_sala is not null and length(trim(p_link_sala)) > 0 then
    v_corpo   := replace(v_corpo,   '{{link_sala}}', p_link_sala);
    v_assunto := replace(v_assunto, '{{link_sala}}', p_link_sala);
  end if;
  v_chave := p_jornada_id::text || ':' || p_chave_template || ':' || coalesce(p_agendamento_id::text, '-');
  insert into mensagens_agendadas (jornada_id, agendamento_id, template_id, canal, destinatario,
                                   agendada_para, chave_idempotencia, assunto_renderizado, corpo_renderizado)
  values (p_jornada_id, p_agendamento_id, v_template.id, p_canal, p_destinatario,
          p_agendada_para, v_chave, nullif(v_assunto, ''), v_corpo)
  on conflict (chave_idempotencia) do nothing;
end $$;
revoke execute on function app.enfileirar_mensagem(uuid, uuid, text, canal_mensagem, text, timestamptz, text, text, text) from public, anon, authenticated;

-- ===========================================================================
-- (i) Reivindicação com canais e holds. DROP EXPLÍCITO da assinatura antiga
-- (armadilha 6 / C30): `create or replace` com parâmetro novo criaria
-- sobrecarga e o cron falharia com "function is not unique".
-- Holds (mensagem fica 'pendente', sem consumir tentativa nem virar 'falhou'):
--   {{link_material}}     → só com material atual APROVADO (B14, igual à 0031)
--   {{link_sala}}         → só com sessoes_viabilidade.link_sala preenchido (C24)
--   {{link_confirmacao}}  → só com agendamento ativo e presença ainda não confirmada
-- ===========================================================================
drop function if exists public.reivindicar_mensagens_pendentes(int);
create function public.reivindicar_mensagens_pendentes(
  p_limite int default 50,
  p_canais canal_mensagem[] default array['email']::canal_mensagem[]
) returns setof mensagens_agendadas
language sql as $$
  update mensagens_agendadas m set status = 'enviando', tentativas = tentativas + 1
   where m.id in (
     select ma.id
       from mensagens_agendadas ma
       left join agendamentos ag on ag.id = ma.agendamento_id
       left join sessoes_viabilidade sv
         on sv.id = coalesce(ag.sessao_id, (select s2.id from sessoes_viabilidade s2 where s2.jornada_id = ma.jornada_id))
      where ma.status = 'pendente'
        and ma.canal = any (coalesce(p_canais, array['email']::canal_mensagem[]))
        and ma.agendada_para <= now()
        and (ma.proxima_tentativa_em is null or ma.proxima_tentativa_em <= now())
        and (
          ma.corpo_renderizado is null
          or ma.corpo_renderizado not like '%{{link_material}}%'
          or exists (
            select 1 from materiais_gerados mg
             where mg.jornada_id = ma.jornada_id and mg.atual and mg.aprovado_em is not null
          )
        )
        and (
          ma.corpo_renderizado is null
          or ma.corpo_renderizado not like '%{{link_sala}}%'
          or sv.link_sala is not null
        )
        and (
          ma.corpo_renderizado is null
          or ma.corpo_renderizado not like '%{{link_confirmacao}}%'
          or (ag.id is not null and ag.status in ('agendado', 'confirmado') and ag.presenca_confirmada_em is null)
        )
      order by ma.agendada_para
      for update of ma skip locked
      limit greatest(p_limite, 0))
  returning *;
$$;
revoke execute on function public.reivindicar_mensagens_pendentes(int, canal_mensagem[]) from public, anon, authenticated;
grant  execute on function public.reivindicar_mensagens_pendentes(int, canal_mensagem[]) to service_role;

-- ===========================================================================
-- (j) app.regua_agendamento (0020:23-63): ÚNICA mudança é o fuso do
-- {{data_sessao}} — to_char de timestamptz sem `at time zone` renderizava UTC,
-- e o cliente receberia "15:00" para uma sessão às 12:00 de Brasília.
-- ===========================================================================
create or replace function app.regua_agendamento() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_jornada_id uuid; v_pessoa record; v_link text; v_data text;
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

  v_data := to_char(new.inicio_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');

  if new.inicio_em - interval '7 days' > now() then
    perform app.enfileirar_mensagem(v_jornada_id, new.id, 'confirmacao_d7',
      case when v_pessoa.telefone is not null then 'whatsapp'::canal_mensagem else 'email'::canal_mensagem end,
      coalesce(v_pessoa.telefone, v_pessoa.email), new.inicio_em - interval '7 days',
      v_pessoa.nome, v_data, v_link);
  end if;

  perform app.enfileirar_mensagem(v_jornada_id, new.id, 'dia_da_sessao', 'email',
    v_pessoa.email, new.inicio_em - interval '10 minutes',
    v_pessoa.nome, v_data, v_link);

  return new;
end $$;

-- ===========================================================================
-- (k) Templates. v1 fica (ativo=false, histórico); v2 nasce ativa. Tom do
-- seminário: direto, humano, frases curtas. Nada de dado inventado —
-- {{link_confirmacao}}/{{link_sala}} são resolvidos no envio; os placeholders
-- do croqui_convite viram frase honesta quando o dado não existe (§1.4).
-- ===========================================================================
update mensagens_templates set ativo = false
 where chave in ('confirmacao_d7', 'dia_da_sessao') and versao = 1;

insert into mensagens_templates (chave, canal, versao, assunto, corpo, ativo) values
 ('confirmacao_d7', 'email', 2, 'Sua Sessão de Viabilidade é dia {{data_sessao}} — confirma presença?',
  $t$Olá, {{nome}}.

Sua Sessão de Viabilidade com a Dra. Elaine Montenegro está marcada para {{data_sessao}}.

Confirme sua presença com um toque:

{{link_confirmacao}}

Se precisar remarcar, responda este e-mail e a equipe ajusta com você.

Equipe Time Holding Brasil$t$, true),
 ('confirmacao_d7', 'whatsapp', 2, null,
  $t$Olá, {{nome}}! Sua Sessão de Viabilidade com a Dra. Elaine está marcada para {{data_sessao}}. Confirma presença tocando aqui: {{link_confirmacao}}

Se precisar remarcar, é só responder por aqui.$t$, true),
 ('dia_da_sessao', 'email', 2, 'Sua Sessão de Viabilidade é hoje',
  $t$Olá, {{nome}}.

Sua Sessão de Viabilidade é hoje, {{data_sessao}}. A sala já está aberta — entre por aqui:

{{link_sala}}

Recomendamos entrar alguns minutos antes, em um lugar tranquilo, com os documentos que quiser mostrar por perto.

Até já.

Equipe Time Holding Brasil$t$, true),
 ('croqui_convite', 'whatsapp', 1, null,
  $t$Olá, {{nome}}, aqui é a Dra. Elaine. Foi muito bom conversar com você na Sessão de Viabilidade.

Como combinamos, o próximo passo é o Croqui Estrutural, no valor de {{valor_croqui}}. {{link_pagamento}}

Sobre a apresentação do croqui: {{data_apresentacao}}.

Para eu já começar a desenhar a estrutura, preciso da sua última declaração de Imposto de Renda e, se tiver empresa, do contrato social. {{link_documentos}}

Qualquer dúvida, é só me chamar por aqui.$t$, true)
on conflict (chave, canal, versao) do nothing;
