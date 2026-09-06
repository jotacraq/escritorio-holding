-- 0080_direitos_do_titular.sql
-- LGPD art. 18: acesso/portabilidade (exportar) e eliminação (anonimizar).
-- Plano: docs/ARQUITETURA-FASE-7.md §B3. Roteiro: scripts/verificacao-0080.sql.
-- APLICAR DEPOIS da 0079 (valor de enum) — a RPC usa 'anonimizada'.
--
-- PRINCÍPIOS DESTE ARQUIVO
--   1. Nenhum DELETE. Em lugar nenhum. Linha antiga vira marcador; arquivo do
--      Storage é removido pela ROTA (service_role), em passo separado e idempotente.
--   2. O que sai é o que IDENTIFICA. O que fica é o fato econômico (pagamentos:
--      valor, status, data, transação) e o fato processual (houve ligação, houve
--      sessão, quando) — obrigação contábil/fiscal e prova de accountability.
--   3. `consentimentos` NÃO é tocado. É a prova da base legal do tratamento
--      (art. 37). Apagá-lo destruiria a defesa do próprio escritório, e ele não
--      contém dado do titular além do vínculo — o texto é do escritório.
--   4. Registro imutável: motivo, base legal, canal, quem, quando, e a contagem
--      do que foi alterado por tabela.
--
-- QUATRO CORREÇÕES AO PLANO, ACHADAS LENDO OS TRIGGERS (e não o plano):
--   (i)   `diagnosticos_sv.blocos` NÃO pode virar '{}': o CHECK
--         `ck_blocos_validos` exige ARRAY (app.blocos_diagnostico_validos).
--         Aqui vira '[]'.
--   (ii)  Três guardas de imutabilidade recusariam a anonimização com 23514:
--         `app.diagnostico_so_atual_edita` (versão antiga não se edita),
--         `app.trava_croqui_pronto_exige_revisao` (croqui pronto exige 13
--         slides revisados) e `app.croqui_calculo_imutavel` (snapshot não muda).
--         Ganham a MESMA porta de serviço que a casa já usa em
--         `app.croqui_troca_versao`/`app.diagnostico_troca_versao`: a GUC de
--         transação `app.anonimizacao`. Corpo idêntico ao original fora disso.
--   (iii) `ligacoes_ia` só pode ser cancelada a partir de 'na_fila'/'discando'
--         (`app.ligacao_ia_guarda_transicao`). 'em_ligacao' mantém o status e
--         perde o conteúdo — cancelar levantaria exceção e derrubaria tudo.
--   (iv)  ORDEM IMPORTA. `pessoas` é anonimizada PRIMEIRO porque
--         `app.regua_boas_vindas` dispara em todo UPDATE de `pagamentos` com
--         status 'aprovado' e lê `pessoas.email/telefone`: com a pessoa já
--         anonimizada, `app.enfileirar_mensagem` sai no primeiro `if` (sem
--         destinatário) e nenhuma mensagem nova é enfileirada para um titular
--         que pediu para sumir. `eventos_timeline` e `tarefas` são os ÚLTIMOS
--         porque absorvem o que os triggers das etapas anteriores escreveram.
--
-- TABELAS DO INVENTÁRIO QUE FICAM INTACTAS, DE PROPÓSITO (declarado, não esquecido):
--   · `consentimentos` — prova da base legal (art. 37).
--   · `documentos_acessos` — `ip`/`user_agent` ali são da EQUIPE que abriu o
--     arquivo, não do titular. É trilha de accountability do escritório.
--   · `participacoes_seminario`, `jornadas_transicoes`, `croqui_apresentacoes`,
--     `execucao_jornada_marcos` — fato processual sem PII.
--   · `consultas_cnpj.qsa` — nomes de sócios sem NENHUM vínculo com `pessoas`
--     no schema (BLOQUEIO B45). Fora de escopo, declarado na tela e no PDF.
--   · `erros_servidor` (tem expurgo próprio) e `publico_rate_limit` (efêmero).
--
-- REVERSÃO: não há para o dado — anonimização é irreversível por definição, é
-- isso que a torna eliminação. A migration em si reverte assim:
--   drop function if exists public.confirmar_expurgo_storage(uuid, text[]);
--   drop function if exists public.anonimizar_titular(uuid,text,text,text,timestamptz,uuid);
--   drop function if exists public.registrar_exportacao_titular(uuid,text,text,text,timestamptz,uuid);
--   alter table pessoas drop column if exists anonimizada_em, drop column if exists anonimizacao_id;
--   drop table if exists titulares_solicitacoes;
--   (e recriar as três guardas sem a GUC, com o corpo de 0058/0049/0069).

-- ===========================================================================
-- (a) O registro. Append-only de verdade: sem policy de UPDATE/DELETE e sem
--     privilégio de tabela para authenticated (mesma postura de
--     documentos_acessos, 0012, e de links_publicos depois da 0072).
-- ===========================================================================
create table if not exists titulares_solicitacoes (
  id             uuid primary key default gen_random_uuid(),
  pessoa_id      uuid not null references pessoas(id) on delete restrict,
  tipo           text not null check (tipo in ('exportacao','anonimizacao')),
  -- Por que foi feito. Texto do escritório, não do titular.
  motivo         text not null check (length(trim(motivo)) between 10 and 2000),
  -- Sob qual base legal (LGPD art. 7/16/18). Nunca preenchido pelo sistema.
  base_legal     text not null check (length(trim(base_legal)) between 5 and 2000),
  canal_pedido   text not null check (canal_pedido in
                   ('email','whatsapp','telefone','presencial','oficio','iniciativa_do_escritorio')),
  -- Quando o TITULAR pediu (pode ser dias antes da execução). Nunca no futuro.
  solicitado_em  timestamptz not null check (solicitado_em <= now() + interval '1 minute'),
  executado_em   timestamptz not null default now(),
  executado_por  uuid not null references perfis_equipe(id),
  -- {"tabelas":{"familiares":3,...},"storage_pendente":["pessoas/…"],"storage_removido_em":null,
  --  "avisos":["gravacao_e_transcricao_originais_vivem_na_vapi"]}
  resultado      jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now()
);
create index if not exists idx_titulares_solicitacoes_pessoa
  on titulares_solicitacoes (pessoa_id, executado_em desc);
-- Uma anonimização por pessoa. A segunda tentativa é no-op (a RPC devolve a
-- primeira) — o índice é a rede embaixo, caso alguém escreva por outro caminho.
create unique index if not exists uniq_anonimizacao_por_pessoa
  on titulares_solicitacoes (pessoa_id) where tipo = 'anonimizacao';

alter table titulares_solicitacoes enable row level security;
alter table titulares_solicitacoes force row level security;
drop policy if exists ts_sel on titulares_solicitacoes;
create policy ts_sel on titulares_solicitacoes for select to authenticated
  using ((select app.eh_admin()));
grant select on titulares_solicitacoes to authenticated;
revoke insert, update, delete on titulares_solicitacoes from public, anon, authenticated;
comment on table titulares_solicitacoes is
  'Trilha imutável dos pedidos de direito do titular (LGPD art. 18). Escrita SÓ pelas RPCs '
  'security definer; authenticated só lê, e só admin.';

alter table pessoas add column if not exists anonimizada_em  timestamptz;
alter table pessoas add column if not exists anonimizacao_id uuid references titulares_solicitacoes(id);
comment on column pessoas.anonimizada_em is
  'Carimbo de encerramento do tratamento. NULL = pessoa ativa. A linha NUNCA é apagada — '
  'as jornadas, pagamentos e etapas continuam contando no funil histórico.';

-- ===========================================================================
-- (b) As três guardas de imutabilidade ganham a porta de serviço da
--     anonimização. Corpo IDÊNTICO ao original (0058 / 0049 / 0069) com uma
--     linha a mais no topo. A GUC é setada com `is_local = true` dentro da
--     própria RPC: morre no fim da transação, não vaza para a sessão.
--
--     Por que não `session_replication_role = replica` (que desligaria TODOS
--     os triggers): é GUC de superusuário, não disponível ao dono aqui, e
--     desligar tudo apagaria também os triggers que a anonimização QUER que
--     rodem (revogação de link ao fechar a jornada, carimbo de atualizado_em).
--
--     Superfície de risco (para o pentester): quem consegue executar
--     `set_config('app.anonimizacao','on',...)` numa transação sua pode editar
--     versão antiga de diagnóstico, snapshot de cálculo e croqui pronto. Pelo
--     PostgREST isso NÃO é alcançável (não há RPC que exponha `set_config`, e
--     `authenticated` não roda SQL arbitrário). É exatamente o mesmo modelo de
--     ameaça de `app.croqui_troca_versao` (0069) e `app.diagnostico_troca_versao`
--     (0061), que já vivem no repositório desde a Fase 5.
-- ===========================================================================
create or replace function app.diagnostico_so_atual_edita() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  -- 0080: encerramento de tratamento do titular limpa versão antiga também.
  if coalesce(current_setting('app.anonimizacao', true), '') = 'on' then return new; end if;

  if not old.atual and (new.blocos is distinct from old.blocos
                        or new.aprovado_em is distinct from old.aprovado_em
                        or new.aprovado_por is distinct from old.aprovado_por) then
    raise exception 'diagnostico_versao_antiga: só a versão atual do diagnóstico é editável'
      using errcode = '23514';
  end if;
  if new.versao is distinct from old.versao or new.jornada_id is distinct from old.jornada_id
     or new.criado_em is distinct from old.criado_em then
    raise exception 'diagnostico_imutavel: versão/jornada/criação não mudam' using errcode = '23514';
  end if;
  new.atualizado_por := coalesce(
    (select id from perfis_equipe where auth_user_id = auth.uid() and ativo limit 1),
    new.atualizado_por);
  return new;
end $$;

create or replace function app.trava_croqui_pronto_exige_revisao() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v_exige_revisao boolean;
  v_total_slides int;
  v_nao_revisados int;
begin
  -- 0080: o croqui de um titular anonimizado fica sem slides de propósito.
  if coalesce(current_setting('app.anonimizacao', true), '') = 'on' then return new; end if;

  if new.status not in ('pronto', 'apresentado') then
    return new;
  end if;

  select coalesce((valor #>> '{}')::boolean, false)
    into v_exige_revisao
    from configuracoes
   where chave = 'croqui.exige_revisao_para_pronto';

  if not coalesce(v_exige_revisao, false) then
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

create or replace function app.croqui_calculo_imutavel() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  -- 0080: o snapshot de entrada guarda família, município e bens do titular.
  if coalesce(current_setting('app.anonimizacao', true), '') = 'on' then return new; end if;

  if new.jornada_id          is distinct from old.jornada_id
  or new.croqui_id           is distinct from old.croqui_id
  or new.versao              is distinct from old.versao
  or new.motor_versao        is distinct from old.motor_versao
  or new.entrada_snapshot    is distinct from old.entrada_snapshot
  or new.parametros_snapshot is distinct from old.parametros_snapshot
  or new.resultado           is distinct from old.resultado
  or new.criado_em           is distinct from old.criado_em
  or new.criado_por          is distinct from old.criado_por then
    raise exception 'calculo_imutavel: o snapshot de um cálculo não muda — calcule de novo e grave outra versão'
      using errcode = '23514';
  end if;

  if new.atual is distinct from old.atual
     and coalesce(current_setting('app.croqui_troca_versao', true), '') <> 'on' then
    raise exception 'calculo_atual_imutavel: use registrar_croqui_calculo ou fixar_croqui_calculo'
      using errcode = '23514';
  end if;

  return new;
end $$;

-- ===========================================================================
-- (c) Registrar uma EXPORTAÇÃO. Chamada pela rota ANTES de montar o dossiê:
--     se a gravação do registro falhar, ninguém exporta. Exportar PII sem
--     deixar rastro de quem exportou é o pior caso desta feature.
-- ===========================================================================
create or replace function public.registrar_exportacao_titular(
  p_pessoa_id     uuid,
  p_motivo        text,
  p_base_legal    text,
  p_canal         text,
  p_solicitado_em timestamptz default now(),
  p_executado_por uuid default null
) returns titulares_solicitacoes
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_autor uuid; v_linha titulares_solicitacoes;
begin
  if auth.uid() is not null then
    if not app.eh_admin() then
      raise exception 'sem_permissao: apenas admin exporta dados de titular' using errcode = '42501';
    end if;
    select id into v_autor from perfis_equipe where auth_user_id = auth.uid() and ativo;
  else
    if p_executado_por is null then
      raise exception 'autor_obrigatorio: sem sessão, p_executado_por é obrigatório' using errcode = '22004';
    end if;
    select id into v_autor from perfis_equipe where id = p_executado_por and ativo and papel = 'admin';
    if v_autor is null then
      raise exception 'sem_permissao: p_executado_por não é admin ativo' using errcode = '42501';
    end if;
  end if;

  if not exists (select 1 from pessoas where id = p_pessoa_id) then
    raise exception 'pessoa_nao_encontrada: %', p_pessoa_id using errcode = 'P0002';
  end if;

  insert into titulares_solicitacoes
    (pessoa_id, tipo, motivo, base_legal, canal_pedido, solicitado_em, executado_por)
  values (p_pessoa_id, 'exportacao', p_motivo, p_base_legal, p_canal, p_solicitado_em, v_autor)
  returning * into v_linha;
  return v_linha;
end $$;
revoke execute on function public.registrar_exportacao_titular(uuid,text,text,text,timestamptz,uuid)
  from public, anon;
grant execute on function public.registrar_exportacao_titular(uuid,text,text,text,timestamptz,uuid)
  to authenticated, service_role;
comment on function public.registrar_exportacao_titular(uuid,text,text,text,timestamptz,uuid) is
  'Grava o pedido de acesso/portabilidade ANTES do dossiê sair. Nenhuma exportação sem registro.';

-- ===========================================================================
-- (d) A anonimização. UMA transação, `for update` na pessoa. Idempotente:
--     chamada de novo sobre alguém já anonimizado devolve o registro original
--     e não altera nada.
-- ===========================================================================
create or replace function public.anonimizar_titular(
  p_pessoa_id     uuid,
  p_motivo        text,
  p_base_legal    text,
  p_canal         text,
  p_solicitado_em timestamptz default now(),
  p_executado_por uuid default null
) returns titulares_solicitacoes
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_autor      uuid;
  v_pessoa     pessoas%rowtype;
  v_linha      titulares_solicitacoes;
  v_marcador   text;
  v_jornadas   uuid[];
  v_sessoes    uuid[];
  v_croquis    uuid[];
  v_caminhos   text[];
  v_transacoes text[];
  v_contagem   jsonb := '{}'::jsonb;
  v_avisos     text[] := '{}';
  v_n          int;
begin
  -- ---- autor (padrão 0071) -------------------------------------------------
  if auth.uid() is not null then
    if not app.eh_admin() then
      raise exception 'sem_permissao: apenas admin encerra o tratamento de um titular' using errcode = '42501';
    end if;
    select id into v_autor from perfis_equipe where auth_user_id = auth.uid() and ativo;
  else
    if p_executado_por is null then
      raise exception 'autor_obrigatorio: sem sessão, p_executado_por é obrigatório' using errcode = '22004';
    end if;
    select id into v_autor from perfis_equipe where id = p_executado_por and ativo and papel = 'admin';
    if v_autor is null then
      raise exception 'sem_permissao: p_executado_por não é admin ativo' using errcode = '42501';
    end if;
  end if;

  select * into v_pessoa from pessoas where id = p_pessoa_id for update;
  if not found then
    raise exception 'pessoa_nao_encontrada: %', p_pessoa_id using errcode = 'P0002';
  end if;

  -- ---- idempotência --------------------------------------------------------
  if v_pessoa.anonimizada_em is not null then
    select * into v_linha from titulares_solicitacoes
     where pessoa_id = p_pessoa_id and tipo = 'anonimizacao' limit 1;
    return v_linha;   -- no-op explícito; a rota devolve 200 com ja_anonimizada
  end if;

  -- ---- travas de negócio ---------------------------------------------------
  -- (1) dado de demonstração não é titular. Anonimizar as 4 famílias de exemplo
  --     quebraria `scripts/seed-exemplo-completo.ts` e a apresentação.
  if v_pessoa.origem_dado = 'exemplo' then
    raise exception 'origem_dado_exemplo: esta pessoa é dado de demonstração, não um titular real'
      using errcode = '22023';
  end if;
  -- (2) login do cliente. Hoje sempre NULL (o cliente não loga). Se um dia
  --     existir, apagar conta de auth é decisão que não cabe nesta RPC.
  if v_pessoa.auth_user_id is not null then
    raise exception 'titular_com_login: esta pessoa tem conta de acesso; trate auth.users antes'
      using errcode = '22023';
  end if;
  -- (3) HIPÓTESE CONSERVADORA do BLOQUEIO B41: holding contratada e em
  --     execução recusa. Enquanto o contrato roda, o escritório precisa dos
  --     dados para executá-lo.
  if exists (
    select 1 from jornadas
     where pessoa_id = p_pessoa_id and etapa = 'holding_contratada' and desfecho = 'aberta'
  ) then
    raise exception 'holding_em_execucao: há holding contratada em execução para este titular'
      using errcode = '22023';
  end if;

  -- Porta de serviço das três guardas de imutabilidade (ver bloco (b)).
  -- `is_local = true`: vale só até o fim desta transação.
  perform set_config('app.anonimizacao', 'on', true);

  v_marcador := 'Titular anonimizado ' || left(replace(p_pessoa_id::text, '-', ''), 8);

  select coalesce(array_agg(id), '{}') into v_jornadas from jornadas where pessoa_id = p_pessoa_id;
  select coalesce(array_agg(id), '{}') into v_sessoes  from sessoes_viabilidade where jornada_id = any (v_jornadas);
  select coalesce(array_agg(id), '{}') into v_croquis  from croquis where jornada_id = any (v_jornadas);
  select coalesce(array_agg(caminho), '{}') into v_caminhos from documentos where pessoa_id = p_pessoa_id;
  select coalesce(array_agg(transacao_externa_id), '{}') into v_transacoes
    from pagamentos where pessoa_id = p_pessoa_id or jornada_id = any (v_jornadas);

  -- =========================================================================
  -- SUBSTITUIÇÃO DE PII. Tudo UPDATE. Nenhum DELETE.
  -- A ORDEM É PARTE DO DESENHO — ver correção (iv) no cabeçalho.
  -- =========================================================================

  -- pessoas PRIMEIRO: é o que as réguas leem. Sobra id, criado_em, origem_dado.
  -- Nem UF fica: UF + faixa etária + faixa de patrimônio reidentificam num
  -- universo pequeno como o do escritório.
  update pessoas set
    nome = v_marcador, email = null, telefone = null, cidade = null, uf = null,
    profissao = null, faixa_etaria = null, estado_civil = null, observacoes = null,
    ativo = false, anonimizada_em = now()
   where id = p_pessoa_id;
  v_contagem := v_contagem || jsonb_build_object('pessoas', 1);

  -- familiares: são TERCEIROS cujos dados o escritório trata. Saem junto.
  update familiares set
    nome = null, ocupacao = null, observacoes = null, regime_casamento = null,
    ano_casamento = null, idade = null, ativo = false
   where pessoa_id = p_pessoa_id;
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('familiares', v_n);

  -- patrimônio: fica o TIPO do bem (estatística), somem descrição e valores.
  update patrimonio_itens set
    descricao = 'removido', detalhes = '{}'::jsonb, destinacao = null,
    valor_historico = null, valor_mercado = null, valor_locacao_mensal = null,
    ano_aquisicao = null, ativo = false
   where pessoa_id = p_pessoa_id;
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('patrimonio_itens', v_n);

  -- respostas do POP 02: fica a prova de que respondeu e quando.
  update formularios_respostas set respostas = '{}'::jsonb where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('formularios_respostas', v_n);

  -- respostas do seminário (`resposta` é not null com check de 1 a 2000).
  update respostas_seminario set resposta = 'removida' where pessoa_id = p_pessoa_id;
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('respostas_seminario', v_n);

  -- ligação humana (POP 03/03-B): some o conteúdo E o perfilamento comportamental.
  update ligacoes_estrategicas set
    respostas = '{}'::jsonb, expectativa_principal = null, preocupacao_principal = null,
    assunto_atencao_especial = null, objecoes_percebidas = null, pessoas_mencionadas = null,
    ritmo = null, estilo_resposta = null, sinais = null, frases_marcantes = null,
    processo_decisorio = null, decisores_presentes_na_sessao = null,
    transcricao = null, observacoes = null
   where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('ligacoes_estrategicas', v_n);

  -- ligação por IA: fica o custo e a duração; some voz, texto e telefone.
  -- `id_externo` sai também: é o ponteiro para a gravação na Vapi.
  -- Cancela SÓ o que a guarda de transição (0053) permite cancelar.
  update ligacoes_ia set
    transcricao = null, resumo = null, gravacao_url = null, telefone = 'removido',
    id_externo = null, erro = null,
    status = case when status in ('na_fila','discando') then 'cancelada' else status end
   where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('ligacoes_ia', v_n);
  if v_n > 0 then v_avisos := v_avisos || 'gravacao_e_transcricao_originais_vivem_na_vapi'; end if;

  -- briefing: é o retrato psicológico do titular. Some inteiro, com a
  -- verificação (que cita trechos da entrada).
  update briefings set conteudo = '{}'::jsonb, verificacao = null where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('briefings', v_n);

  -- execuções de IA: custo/tokens/modelo FICAM (contabilidade de IA);
  -- some tudo que aponta para a entrada e a saída.
  update execucoes_ia set hash_entrada = null, erro = null, request_id = null
   where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('execucoes_ia', v_n);

  -- sessão, relatório da SV e observação do agendamento.
  update sessoes_viabilidade set link_sala = null, gravacao_url = null, motivo_resultado = null
   where id = any (v_sessoes);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('sessoes_viabilidade', v_n);

  update relatorios_sessao set
    quem_acompanha = null, motivacao_cliente = null, receita_familiar_mensal = null,
    ideia_custo_inventario = null, reserva_ou_seguro = null, preocupacao_predominante = null,
    como_deseja_organizar = null, motiva_evitar_inventario = null, interesse_imediato = null,
    relacao_filhos_terceiros = null, porque_nos_procurou = null, falta_planejamento_preocupa = null,
    resultado_sessao = null, consideracoes_apresentacao_croqui = null, tributos = '{}'::jsonb
   where sessao_id = any (v_sessoes);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('relatorios_sessao', v_n);

  update agendamentos set observacoes = null where sessao_id = any (v_sessoes);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('agendamentos', v_n);

  -- diagnóstico (blocos é ARRAY — ck_blocos_validos), cenários e rubricas.
  update diagnosticos_sv set blocos = '[]'::jsonb where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('diagnosticos_sv', v_n);

  update cenarios_patrimoniais set nota = null where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('cenarios_patrimoniais', v_n);

  update cenario_rubricas set nota = null
   where cenario_id in (select id from cenarios_patrimoniais where jornada_id = any (v_jornadas));
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('cenario_rubricas', v_n);

  -- croqui e derivados. `croqui_calculos`: fica o RESULTADO (tabelas de
  -- números, sem nome) e os parâmetros; sai o snapshot de entrada, que carrega
  -- família, município e bens.
  update croquis set titulo = 'Croqui de titular anonimizado', conteudo = '{"slides":[]}'::jsonb
   where id = any (v_croquis);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('croquis', v_n);

  update croqui_analises set conteudo = '{}'::jsonb where croqui_id = any (v_croquis);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('croqui_analises', v_n);

  update croqui_narrativas set conteudo = '{}'::jsonb where croqui_id = any (v_croquis);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('croqui_narrativas', v_n);

  update croqui_calculos set entrada_snapshot = '{}'::jsonb, nota = null
   where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('croqui_calculos', v_n);

  update materiais_gerados set conteudo = '{}'::jsonb, dor_principal = null
   where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('materiais_gerados', v_n);

  -- transcrições de reunião com este cliente (base de conhecimento) + análises.
  update analises_transcricao set conteudo = '{}'::jsonb
   where transcricao_id in (select id from transcricoes where jornada_id = any (v_jornadas));
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('analises_transcricao', v_n);

  update transcricoes set conteudo = '', rotulo = 'Transcrição de titular anonimizado', consultor = null
   where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('transcricoes', v_n);

  -- comunicação enviada e recebida. Status e datas ficam (prova de contato).
  update mensagens_agendadas set
    destinatario = 'removido', assunto_renderizado = null, corpo_renderizado = null,
    provedor_id = null, erro = null,
    status = case when status in ('pendente','enviando') then 'cancelada' else status end
   where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('mensagens_agendadas', v_n);

  update mensagens_recebidas set
    corpo = '', telefone = null, anexos = '[]'::jsonb, bruto = '{}'::jsonb
   where pessoa_id = p_pessoa_id or jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('mensagens_recebidas', v_n);

  -- dinheiro: fica valor, status, data e a transação (obrigação fiscal).
  update pagamentos set
    comprador_email = null, comprador_nome = null, comprador_telefone = null, bruto = '{}'::jsonb
   where pessoa_id = p_pessoa_id or jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('pagamentos', v_n);

  -- webhook cru da Hotmart: casado pelo id de transação (não há FK).
  -- Varredura por texto; ver §F.1 do plano (gatilho de 100 mil linhas).
  update webhooks_eventos set bruto = '{}'::jsonb
   where array_length(v_transacoes, 1) is not null
     and exists (select 1 from unnest(v_transacoes) as t(transacao)
                  where bruto::text like '%' || t.transacao || '%');
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('webhooks_eventos', v_n);

  -- pesquisa em fontes públicas (`resumo` é not null com check de 1 a 10000).
  update pesquisas_publicas set resumo = 'removido a pedido do titular', url = null
   where pessoa_id = p_pessoa_id or jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('pesquisas_publicas', v_n);

  -- linha bruta da planilha de importação (nome, e-mail, telefone).
  update importacoes_linhas set dados = '{}'::jsonb, motivo = null where pessoa_id = p_pessoa_id;
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('importacoes_linhas', v_n);

  update documentos_pedidos set nota = null where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('documentos_pedidos', v_n);

  -- acessos aos links públicos: IP e user-agent são do TITULAR (diferente de
  -- documentos_acessos, que registra a EQUIPE e por isso fica).
  update links_publicos_acessos set ip_hash = null, user_agent = null
   where link_id in (select id from links_publicos where jornada_id = any (v_jornadas));
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('links_publicos_acessos', v_n);

  -- links ativos: revogados aqui E pela trigger de fechamento da jornada (0028).
  update links_publicos set estado = 'revogado', revogado_em = now()
   where jornada_id = any (v_jornadas) and estado = 'ativo';
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('links_publicos_revogados', v_n);

  -- agendamentos sugeridos: o motivo é texto livre da IA sobre o titular.
  update agendamentos_sugestoes set motivo_sugestao = null
   where link_id in (select id from links_publicos where jornada_id = any (v_jornadas));
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('agendamentos_sugestoes', v_n);

  -- documentos: a LINHA fica (prova de que existiu e foi acessada); o nome do
  -- arquivo e o hash saem. `caminho` fica INTACTO aqui de propósito — a rota
  -- precisa dele para remover o objeto do Storage no passo seguinte, e ele é
  -- `not null unique`. Quem zera é `confirmar_expurgo_storage`.
  update documentos set nome_arquivo = 'removido', sha256 = null where pessoa_id = p_pessoa_id;
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('documentos', v_n);

  -- jornadas: faixa declarada sai; desfecho vira 'anonimizada' (0079). A
  -- trigger app.revoga_links_ao_fechar_jornada roda aqui de novo, idempotente.
  update jornadas set
    faixa_patrimonio_declarada = null,
    motivo_desfecho = 'Tratamento encerrado a pedido do titular (LGPD art. 18)',
    desfecho = 'anonimizada'
   where pessoa_id = p_pessoa_id;
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('jornadas', v_n);

  -- ÚLTIMOS: absorvem o que os triggers das etapas acima escreveram.
  -- O TÍTULO fica (é rótulo de sistema — "Formulário estratégico atualizado");
  -- descrição e payload saem.
  update tarefas set descricao = null where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('tarefas', v_n);

  update eventos_timeline set descricao = null, dados = '{}'::jsonb where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('eventos_timeline', v_n);

  if array_length(v_caminhos, 1) is not null then
    v_avisos := v_avisos || 'arquivos_do_storage_pendentes_de_remocao';
  end if;

  insert into titulares_solicitacoes
    (pessoa_id, tipo, motivo, base_legal, canal_pedido, solicitado_em, executado_por, resultado)
  values (p_pessoa_id, 'anonimizacao', p_motivo, p_base_legal, p_canal, p_solicitado_em, v_autor,
          jsonb_build_object(
            'tabelas', v_contagem,
            'storage_pendente', to_jsonb(coalesce(v_caminhos, '{}')),
            'storage_removido_em', null,
            'avisos', to_jsonb(v_avisos)))
  returning * into v_linha;

  update pessoas set anonimizacao_id = v_linha.id where id = p_pessoa_id;

  perform set_config('app.anonimizacao', 'off', true);

  return v_linha;
end $$;

revoke execute on function public.anonimizar_titular(uuid,text,text,text,timestamptz,uuid) from public, anon;
grant  execute on function public.anonimizar_titular(uuid,text,text,text,timestamptz,uuid)
  to authenticated, service_role;
comment on function public.anonimizar_titular(uuid,text,text,text,timestamptz,uuid) is
  'LGPD art. 18 — encerra o tratamento dos dados de um titular. Uma transação, for update na pessoa, '
  'nenhum DELETE. Idempotente: segunda chamada devolve o registro da primeira. NÃO remove objeto do '
  'Storage (é passo da rota) nem a gravação que vive na Vapi.';

-- ===========================================================================
-- (e) Fecho do expurgo de Storage. Chamada pela rota DEPOIS de remover os
--     objetos. Idempotente: rodar duas vezes não muda o resultado.
-- ===========================================================================
create or replace function public.confirmar_expurgo_storage(
  p_solicitacao_id uuid,
  p_caminhos       text[]
) returns titulares_solicitacoes
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_linha titulares_solicitacoes; v_pessoa uuid;
begin
  if auth.uid() is not null and not app.eh_admin() then
    raise exception 'sem_permissao: apenas admin conclui o expurgo' using errcode = '42501';
  end if;

  select * into v_linha from titulares_solicitacoes where id = p_solicitacao_id for update;
  if not found then
    raise exception 'solicitacao_nao_encontrada: %', p_solicitacao_id using errcode = 'P0002';
  end if;
  if v_linha.tipo <> 'anonimizacao' then
    raise exception 'tipo_invalido: só anonimização tem expurgo de arquivo' using errcode = '22023';
  end if;
  v_pessoa := v_linha.pessoa_id;

  -- `caminho` é not null unique: vira um valor estável e não identificável.
  update documentos set caminho = 'expurgado/' || id::text
   where pessoa_id = v_pessoa and caminho = any (p_caminhos);

  update titulares_solicitacoes
     set resultado = resultado
                   || jsonb_build_object('storage_removido_em', to_jsonb(now()))
                   || jsonb_build_object('storage_pendente',
                        coalesce((select jsonb_agg(c.caminho)
                                    from jsonb_array_elements_text(resultado -> 'storage_pendente') as c(caminho)
                                   where c.caminho <> all (p_caminhos)), '[]'::jsonb))
   where id = p_solicitacao_id
  returning * into v_linha;

  return v_linha;
end $$;
revoke execute on function public.confirmar_expurgo_storage(uuid, text[]) from public, anon;
grant  execute on function public.confirmar_expurgo_storage(uuid, text[]) to authenticated, service_role;
comment on function public.confirmar_expurgo_storage(uuid, text[]) is
  'Passo 4 dos três tempos do expurgo (docs/ARQUITETURA-FASE-7.md §B4.1). Idempotente.';
