-- 0028_links_publicos.sql
-- ONDA 1 (B-1A) — o núcleo da superfície pública (ARQUITETURA-FASE-2.md §2 e §4.1).
-- Depende de 0027 (tabela `configuracoes`, colunas `origem_dado`/`modo`, `documentos.ativo`).
--
-- Regra de desenho que vale para o arquivo inteiro: o token de 256 bits NUNCA chega
-- aqui. Toda função abaixo recebe só `p_hash` = sha256(token || LINK_PUBLICO_PEPPER),
-- calculado em src/server/publico/pepper.ts. O pepper não existe neste banco.
--
-- DESVIOS DELIBERADOS do rascunho do plano (§4.1), registrados aqui em vez de só no
-- relatório de entrega, porque quem ler esta migration no futuro precisa da mesma
-- explicação sem procurar em outro arquivo:
--
--   1) As 4 RPCs públicas ganham dois parâmetros a mais (`p_ip_hash text default null,
--      p_user_agent text default null`) que não estavam na assinatura do rascunho. O
--      hash de IP tem que ser calculado por quem tem o pepper — e o pepper só existe
--      no processo Next.js (`LINK_PUBLICO_PEPPER` é env do app, nunca do banco). Sem
--      esse parâmetro, `links_publicos_acessos.ip_hash` teria que ser calculado aqui
--      dentro, o que exigiria guardar o pepper em `configuracoes` — exatamente o que a
--      regra 2 da §2.2 proíbe. Os parâmetros têm default `null`: o contrato de rota
--      documentado em §4.1 (`/api/publico/[token]`, etc.) não muda para o front.
--
--   2) `app.consome_limite_publico(p_chave text) returns boolean` do rascunho lia
--      SEMPRE `link.limite_por_minuto`/`link.limite_por_dia`, o que faria o teto GLOBAL
--      por rota (300/min, regra 5 da §2.2) usar o mesmo número do teto POR TOKEN
--      (10/min) — não dá pra ter os dois com uma função de um parâmetro só. Virou
--      `app.consome_limite_publico(p_chave text, p_limite_minuto int, p_limite_dia int)`
--      genérica, com dois wrappers (`app.limite_token_ok`, `app.limite_rota_ok`) que
--      leem a chave de configuração certa para cada escopo. Mesma tabela
--      `publico_rate_limit`, mesmo comportamento observável.
--
--   3) Duas RPCs a mais que o rascunho não nomeia: `public.emitir_link_publico` e
--      `public.revogar_link_publico`. O rascunho descreve a rota
--      `POST /api/jornadas/[id]/links` fazendo "emitir token (mata o anterior do mesmo
--      tipo)" — duas escritas (revogar o antigo + inserir o novo) que precisam ser
--      UMA transação, não dois `await supabase.from(...)` da rota (a MESMA lição que o
--      comentário de `processar_pagamento_hotmart`, em 0011, já registrou sobre passos
--      HTTP separados não serem atômicos entre si). As duas seguem o padrão já usado em
--      `marcar_mensagem_manual`/`reprocessar_webhook`: SECURITY DEFINER que confere o
--      próprio papel, sem depender só da policy de RLS.
--
--   4) `escolher_horario_publico` referencia `agendamentos_sugestoes` (criada em 0029,
--      não neste arquivo) e `abrir_link_publico`/`app.payload_link_material` referencia
--      `materiais_gerados` (criada em 0031). PL/pgSQL não valida nome de tabela na
--      criação da função (diferente de `language sql`, lição já registrada em 0027) —
--      compila aqui, mas SÓ FUNCIONA em runtime depois que 0029/0031 forem aplicadas.
--      É a ordem que o próprio plano define em §9 ("0029 depende de 0028"), na direção
--      oposta: até 0029 aplicar, `escolher_horario_publico` sempre devolve
--      `{"erro":"horario_indisponivel"}` (nenhuma linha em agendamentos_sugestoes) e o
--      payload de agendamento sempre vem com `slots: []` — nunca 500, nunca dado
--      inventado. Mesma coisa para `material` até 0031: `{"disponivel": false}`.
--
--   5) `documentos.origem` (nova coluna) e o índice de dedupe por sha256 por jornada
--      entram aqui porque são exigidos pela regra "enviar o mesmo arquivo duas vezes é
--      bloqueado" (§2.2 regra 6) e por "`documentos.origem = 'cliente'`" (§2.4) — e
--      `documentos` é tabela de 0012, fora da minha fronteira de arquivo, mas o ALTER
--      TABLE vive na MINHA migration (0028), não editando 0012.
-- ===========================================================================

create type tipo_link_publico as enum ('formulario', 'agendamento', 'documentos', 'material');
create type estado_link_publico as enum ('ativo', 'usado', 'expirado', 'revogado');

-- ===========================================================================
-- Tabelas
-- ===========================================================================

create table links_publicos (
  id             uuid primary key default gen_random_uuid(),
  jornada_id     uuid not null references jornadas(id) on delete cascade,
  tipo           tipo_link_publico not null,
  -- NUNCA o token. sha256(token || LINK_PUBLICO_PEPPER), hex, calculado no app.
  token_hash     text not null unique,
  -- 6 primeiros caracteres do token, só para a equipe reconhecer o link na tela.
  token_prefixo  text not null,
  estado         estado_link_publico not null default 'ativo',
  expira_em      timestamptz not null,
  -- Contador único de "ação de escrita bem-sucedida via este link" — usado tanto
  -- para o teto de reenvio de documento (5, §2.4) quanto para o teto de remarcação
  -- de horário (1 remarcação depois da escolha inicial, §2.3).
  usos           int not null default 0,
  finalizado_em  timestamptz,
  revogado_em    timestamptz,
  revogado_por   uuid references perfis_equipe(id),
  criado_em      timestamptz not null default now(),
  criado_por     uuid references perfis_equipe(id),
  origem_dado    text not null default 'real' check (origem_dado in ('real', 'exemplo')),
  constraint ck_link_expira_futuro check (expira_em > criado_em)
);
-- Um link ATIVO por tipo por jornada. Emitir um novo mata o anterior — a atomicidade
-- de "matar o antigo + inserir o novo" é responsabilidade de `emitir_link_publico`,
-- não deste índice (o índice só garante que nunca existam DOIS ativos ao mesmo tempo,
-- de qualquer caminho de escrita, incluindo PostgREST direto).
create unique index uniq_link_ativo on links_publicos (jornada_id, tipo) where estado = 'ativo';
create index idx_links_jornada on links_publicos (jornada_id, criado_em desc);

-- Auditoria append-only de TODO acesso público. Sem isto não há como investigar abuso.
create table links_publicos_acessos (
  id           uuid primary key default gen_random_uuid(),
  link_id      uuid references links_publicos(id) on delete cascade,
  acao         text not null check (acao in ('abrir', 'responder', 'escolher_horario', 'enviar_documento', 'negado')),
  resultado    text not null check (resultado in ('ok', 'invalido', 'expirado', 'revogado', 'limite', 'erro')),
  -- IP nunca em claro: sha256(ip || pepper), calculado no app (o pepper não existe aqui).
  ip_hash      text,
  user_agent   text,
  ocorrido_em  timestamptz not null default now()
);
create index idx_links_acessos on links_publicos_acessos (link_id, ocorrido_em desc);

-- Rate limit em TABELA, não em memória: o Node App da Hostinger não garante processo
-- único, e X-Forwarded-For é forjável (achado BAIXO 6 do pentest de 03/09). O sujeito
-- do limite é o TOKEN (chave 'tok:<hash>') ou a ROTA inteira (chave 'rota:<nome>').
create table publico_rate_limit (
  chave     text not null,
  janela    timestamptz not null,
  escopo    text not null check (escopo in ('minuto', 'dia')),
  contagem  int not null default 0,
  primary key (chave, janela, escopo)
);

-- ===========================================================================
-- Grants — regra dura 1 da §2.2: "`anon` não recebe privilégio de tabela nenhum.
-- Nem SELECT." RLS (abaixo) já nega tudo por ausência de policy `to anon`; este
-- REVOKE é redundante de propósito — defesa em profundidade explícita e auditável
-- por grep, no mesmo espírito da 0024 ("a proteção real hoje é configuração de
-- painel, não o banco" — aqui a proteção real é RLS, e isto é o cinto além do
-- suspensório).
-- ===========================================================================
revoke all on links_publicos, links_publicos_acessos, publico_rate_limit from anon;

alter table links_publicos        enable row level security;
alter table links_publicos_acessos enable row level security;
alter table publico_rate_limit    enable row level security;
alter table links_publicos        force row level security;
alter table links_publicos_acessos force row level security;
alter table publico_rate_limit    force row level security;

create policy lp_sel on links_publicos for select to authenticated using ((select app.eh_interno()));
-- Defesa em profundidade: o caminho real de escrita é `emitir_link_publico`/
-- `revogar_link_publico` (SECURITY DEFINER, auto-gate de papel, abaixo). Estas
-- policies existem para que PostgREST direto fique tão restrito quanto a RPC —
-- mesma lição do ALTO 1 (0019/0027): regra que só vive na rota não existe.
create policy lp_ins on links_publicos for insert to authenticated
  with check ((select app.papel()) in ('admin', 'advogada', 'relacionamento'));
create policy lp_upd on links_publicos for update to authenticated
  using ((select app.papel()) in ('admin', 'advogada', 'relacionamento'))
  with check ((select app.papel()) in ('admin', 'advogada', 'relacionamento'));
-- Sem policy de DELETE: link morto vira 'revogado'/'expirado', nunca some.

create policy lpa_sel on links_publicos_acessos for select to authenticated using ((select app.eh_admin()));
-- Sem policy de INSERT: só as RPCs SECURITY DEFINER (rodando como dono da função,
-- que não é `authenticated`) escrevem aqui.

-- publico_rate_limit: NENHUMA policy para `authenticated`/`anon`. RLS habilitado +
-- zero policy = negação total para todo mundo que não seja o dono da função
-- SECURITY DEFINER. Só `app.consome_limite_publico` toca esta tabela.

-- ===========================================================================
-- Documentos: coluna de origem (§2.4) e dedupe por sha256 dentro da mesma jornada
-- (§2.2 regra 6 — "enviar o mesmo arquivo duas vezes é bloqueado por sha256").
-- Escopo é POR JORNADA, não global: dois clientes diferentes podem enviar o mesmo
-- modelo de documento em branco sem colidir.
-- ===========================================================================
alter table documentos
  add column origem text not null default 'equipe' check (origem in ('equipe', 'cliente'));

create unique index uniq_documentos_jornada_sha256
  on documentos (jornada_id, sha256)
  where ativo and sha256 is not null;

-- ===========================================================================
-- Configuração adicional (tabela `configuracoes` já existe, criada em 0027).
-- ===========================================================================
insert into configuracoes (chave, valor, descricao) values
  ('link.limite_global_por_minuto', '300'::jsonb,
   'Teto de requisições por minuto somando TODOS os tokens, por rota pública — contém spam de token inventado, que o limite por token não alcança (regra 5, §2.2).'),
  ('consentimento.textos', jsonb_build_object(
     'tratamento_ia', jsonb_build_object(
       'texto', 'Autorizo o uso das minhas respostas e dos dados que eu informar neste formulário para que a equipe da Dra. Elaine Montenegro prepare minha Sessão de Viabilidade, inclusive com apoio de ferramentas de inteligência artificial.',
       'versao', 'formulario-publico-v1'),
     'comunicacao_email', jsonb_build_object(
       'texto', 'Autorizo o envio de comunicações por e-mail sobre o andamento do meu atendimento.',
       'versao', 'formulario-publico-v1'),
     'comunicacao_whatsapp', jsonb_build_object(
       'texto', 'Autorizo o envio de comunicações por WhatsApp sobre o andamento do meu atendimento.',
       'versao', 'formulario-publico-v1')
   ), 'Texto CONGELADO apresentado no formulário público para cada tipo de consentimento coletável por essa via. Mudar aqui não reescreve consentimento já concedido — cada linha de `consentimentos` guarda sua própria cópia.')
on conflict (chave) do nothing;

-- ===========================================================================
-- Trigger: fechar a jornada mata os links (regra dura 7, §2.2 — "link não sobrevive
-- ao fim do relacionamento"). SECURITY DEFINER por robustez: jornada pode fechar por
-- caminho `authenticated` (equipe) ou por um futuro caminho `service_role` — mesma
-- postura defensiva de `app.timeline_pagamento`/`app.registra_transicao_jornada`.
-- ===========================================================================
create or replace function app.revoga_links_ao_fechar_jornada() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.desfecho <> 'aberta' and old.desfecho = 'aberta' then
    update links_publicos
       set estado = 'revogado', revogado_em = now()
     where jornada_id = new.id and estado = 'ativo';
  end if;
  return new;
end $$;

create trigger trg_revoga_links after update on jornadas
for each row execute function app.revoga_links_ao_fechar_jornada();

-- ===========================================================================
-- Rate limit — genérico (uma tabela, dois escopos). Ver DESVIO 2 no topo do arquivo.
-- ===========================================================================
create or replace function app.consome_limite_publico(p_chave text, p_limite_minuto int, p_limite_dia int)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare c_min int; c_dia int;
begin
  insert into publico_rate_limit (chave, janela, escopo, contagem)
  values (p_chave, date_trunc('minute', now()), 'minuto', 1)
  on conflict (chave, janela, escopo) do update set contagem = publico_rate_limit.contagem + 1
  returning contagem into c_min;

  insert into publico_rate_limit (chave, janela, escopo, contagem)
  values (p_chave, date_trunc('day', now()), 'dia', 1)
  on conflict (chave, janela, escopo) do update set contagem = publico_rate_limit.contagem + 1
  returning contagem into c_dia;

  return c_min <= p_limite_minuto and (p_limite_dia is null or c_dia <= p_limite_dia);
end $$;

-- `coalesce(..., <default documentado em §2.3/§4.0>)`: se a linha de configuração
-- sumir (ninguém deveria conseguir apagá-la — `configuracoes` não tem policy de
-- DELETE — mas isto é rate limit de segurança, não custa blindar), o teto vira o
-- valor padrão do plano, nunca NULL. `NULL <= n` avalia NULL, e `if not NULL then`
-- em plpgsql é `false` — ou seja, config sumida sem este COALESCE abriria o rate
-- limit por completo (fail-OPEN) em vez de aplicar um teto.
create or replace function app.limite_token_ok(p_hash text) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select app.consome_limite_publico(
    'tok:' || p_hash,
    coalesce((select (valor #>> '{}')::int from configuracoes where chave = 'link.limite_por_minuto'), 10),
    coalesce((select (valor #>> '{}')::int from configuracoes where chave = 'link.limite_por_dia'), 100)
  )
$$;

create or replace function app.limite_rota_ok(p_rota text) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select app.consome_limite_publico(
    'rota:' || p_rota,
    coalesce((select (valor #>> '{}')::int from configuracoes where chave = 'link.limite_global_por_minuto'), 300),
    null
  )
$$;

-- ===========================================================================
-- Resolução do link. Duas variantes:
--   `resolve_link_leitura` — aceita 'ativo' E 'usado' (GET precisa mostrar o estado
--   terminal: "recebemos suas respostas", "horário confirmado" — isso NÃO é um erro,
--   é o desenho documentado em §2.3).
--   `resolve_link_escrita` — só aceita 'ativo'. Nenhuma escrita acontece num link já
--   finalizado, exceto a remarcação de horário, que tem sua própria checagem de
--   `usos` dentro de `escolher_horario_publico` (ver comentário lá).
-- As duas expiram o link em cima da hora se `expira_em` já passou, e as duas negam
-- se a jornada não estiver mais aberta (regra dura 7). Retornam NULL para TODO caso
-- ruim — nunca uma exceção que vazaria detalhe por mensagem de erro distinta.
-- ===========================================================================
create or replace function app.resolve_link_leitura(p_hash text) returns links_publicos
language plpgsql security definer set search_path = public, pg_temp as $$
declare v links_publicos;
begin
  select * into v from links_publicos where token_hash = p_hash;
  if not found then return null; end if;

  if v.estado = 'ativo' and v.expira_em <= now() then
    update links_publicos set estado = 'expirado' where id = v.id returning * into v;
  end if;

  if v.estado not in ('ativo', 'usado') then return null; end if;

  if not exists (select 1 from jornadas j where j.id = v.jornada_id and j.desfecho = 'aberta') then
    return null;
  end if;

  return v;
end $$;

create or replace function app.resolve_link_escrita(p_hash text) returns links_publicos
language plpgsql security definer set search_path = public, pg_temp as $$
declare v links_publicos;
begin
  select * into v from links_publicos where token_hash = p_hash;
  if not found then return null; end if;

  if v.estado = 'ativo' and v.expira_em <= now() then
    update links_publicos set estado = 'expirado' where id = v.id returning * into v;
  end if;

  if v.estado <> 'ativo' then return null; end if;

  if not exists (select 1 from jornadas j where j.id = v.jornada_id and j.desfecho = 'aberta') then
    return null;
  end if;

  return v;
end $$;

create or replace function app.registrar_acesso_publico(
  p_link_id uuid, p_acao text, p_resultado text, p_ip_hash text default null, p_user_agent text default null
) returns void
language sql set search_path = public, pg_temp as $$
  insert into links_publicos_acessos (link_id, acao, resultado, ip_hash, user_agent)
  values (p_link_id, p_acao, p_resultado, p_ip_hash, p_user_agent)
$$;

-- ===========================================================================
-- Escopo mínimo na resposta (regra dura 4, §2.2). Um `payload_link_*` por
-- finalidade — cada um decide sozinho o que aquela finalidade pode ver, nunca mais.
-- ===========================================================================
-- Rótulo curto por chave de consentimento — só usado aqui, para montar
-- `consentimentos[].titulo` sem exigir uma tabela nova para 3 strings fixas.
create or replace function app.titulo_consentimento(p_chave text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case p_chave
    when 'tratamento_ia' then 'Uso de IA na preparação da sessão'
    when 'comunicacao_email' then 'Comunicação por e-mail'
    when 'comunicacao_whatsapp' then 'Comunicação por WhatsApp'
    else initcap(replace(p_chave, '_', ' '))
  end
$$;

-- NOTA DE CONTRATO (relatório de entrega, divergência com src/types/publico-ui.ts,
-- fora da minha fronteira): o formulário público tem TRÊS consentimentos GRANULARES
-- (`tratamento_ia`, `comunicacao_email`, `comunicacao_whatsapp` — o enum real de
-- `tipo_consentimento`, 0001), não um único `'tratamento_dados_formulario'` genérico.
-- Juntar os três en um checkbox só violaria a granularidade que a própria LGPD exige
-- (ver sic-hf-brain/04 - Tecnico/Seguranca.md, achado 2: "trava de LGPD é por
-- CAMINHO DE SAÍDA DE DADO" — tratamento por IA é uma saída diferente de
-- comunicação por e-mail/WhatsApp). A tela pública precisa de até 3 checkboxes.
create or replace function app.payload_link_formulario(p_link links_publicos, p_jornada jornadas)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare v_formulario formularios%rowtype; v_resposta formularios_respostas%rowtype; v_textos jsonb; v_consentimentos jsonb;
begin
  select * into v_formulario from formularios where chave = 'estrategico' and ativo limit 1;
  select * into v_resposta   from formularios_respostas where jornada_id = p_jornada.id;
  select valor into v_textos from configuracoes where chave = 'consentimento.textos';

  select coalesce(jsonb_agg(jsonb_build_object(
           'chave', chave,
           'titulo', app.titulo_consentimento(chave),
           'texto', v_textos -> chave ->> 'texto',
           'versao', v_textos -> chave ->> 'versao'
         )), '[]'::jsonb)
    into v_consentimentos
    from jsonb_object_keys(coalesce(v_textos, '{}'::jsonb)) as chave;

  -- `respondido_em` não-nulo é o sinal de somente-leitura (§2.3) — mesmo com o
  -- link ainda 'ativo' logo após o POST desta mesma sessão de navegador, e
  -- também quando o link já está 'usado'. `respostas`/`definicao` continuam
  -- presentes mesmo depois de finalizado: a reabertura mostra o que foi
  -- respondido, nunca um formulário em branco.
  return jsonb_build_object(
    'definicao', coalesce(v_formulario.definicao, '[]'::jsonb),
    'respostas', v_resposta.respostas,
    'respondido_em', v_resposta.respondido_em,
    'consentimentos', v_consentimentos
  );
end $$;

-- Forma unificada, combinando com `PayloadAgendamentoPublico` de
-- src/types/publico-ui.ts (F-1A): SEMPRE `{slots, horario_confirmado}` juntos —
-- nunca um ou outro por causa do `estado` — porque a remarcação (§2.3, "reabre
-- para remarcar 1x") precisa mostrar o horário já confirmado E os slots ainda
-- livres na MESMA tela. `slots` já exclui, na hora de montar o payload (não só
-- na escrita), qualquer sugestão que colidiria com um agendamento real de outra
-- jornada para a mesma advogada — é a proteção contra "o slot some enquanto o
-- cliente decide" que o F-1A pediu no front; sem isto o cliente veria um
-- horário na lista e levaria `horario_indisponivel` só ao tentar confirmar.
create or replace function app.payload_link_agendamento(p_link links_publicos, p_jornada jornadas)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_sessao_id uuid;
  v_advogada_id uuid;
  v_confirmado record;
  v_pode_remarcar boolean;
  v_horario_confirmado jsonb := null;
  v_slots jsonb;
begin
  select s.id, s.advogada_id into v_sessao_id, v_advogada_id
    from sessoes_viabilidade s where s.jornada_id = p_jornada.id;

  if v_sessao_id is not null then
    select a.inicio_em, a.fim_em into v_confirmado
      from agendamentos a
     where a.sessao_id = v_sessao_id and a.status = 'confirmado'
     limit 1;
    if found then
      v_pode_remarcar := p_link.usos < 2;
      v_horario_confirmado := jsonb_build_object(
        'inicio_em', v_confirmado.inicio_em, 'fim_em', v_confirmado.fim_em,
        'pode_remarcar', v_pode_remarcar
      );
    end if;
  end if;

  -- `agendamentos_sugestoes` só existe a partir da 0029 (ver DESVIO 4 no topo do
  -- arquivo). Até lá, esta consulta sempre devolve vazio — nunca inventa horário.
  select coalesce(jsonb_agg(jsonb_build_object(
           'inicio_em', s.inicio_em, 'fim_em', s.fim_em,
           'posicao', s.posicao, 'motivo_sugestao', s.motivo_sugestao
         ) order by s.posicao, s.inicio_em), '[]'::jsonb)
    into v_slots
    from agendamentos_sugestoes s
   where s.link_id = p_link.id
     and not exists (
       -- Sem advogada definida ainda na sessão (`v_advogada_id is null`), não há
       -- contra quem checar conflito — não filtra nada nesse caso (nunca um
       -- `false` universal por acidente de NULL).
       select 1 from agendamentos a2
        where v_advogada_id is not null
          and a2.advogada_id = v_advogada_id
          and a2.status in ('agendado', 'confirmado')
          and a2.sessao_id is distinct from v_sessao_id
          and tstzrange(a2.inicio_em, a2.fim_em) && tstzrange(s.inicio_em, s.fim_em)
     );

  return jsonb_build_object('slots', v_slots, 'horario_confirmado', v_horario_confirmado);
end $$;

-- NOTA DE CONTRATO (relatório de entrega, divergência com src/types/publico-ui.ts,
-- fora da minha fronteira): `TipoDocumentoPublico` do F-1A é
-- `'imposto_de_renda' | 'contrato_social' | 'outro'` — dois problemas contra o
-- banco de verdade: (1) o valor real do `check` de `documentos.tipo` (0012) é
-- `'imposto_renda'` (sem "de"), não `'imposto_de_renda'`; (2) falta
-- `'matricula_imovel'`, que também é um tipo válido e pedido pelo método
-- ("Dados para início da execução do croqui" cita ITBI/matrícula). Uso os TRÊS
-- valores reais do banco abaixo — sem isso, gravar o tipo que o F-1A mandaria
-- (`imposto_de_renda`) falharia no `check` de `registrar_documento_publico` e
-- toda tentativa de envio de IR pelo cliente quebraria.
create or replace function app.payload_link_documentos(p_link links_publicos, p_jornada jornadas)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare v_recebidos jsonb;
begin
  -- "Tipos pedidos" não tem tabela própria no método (nenhum POP define uma lista
  -- configurável por cliente) — é o mesmo universo nomeado no relatório da SV e no
  -- `check` de `documentos.tipo` (0012), exceto o catch-all 'outro'. Não é dado
  -- inventado: é o enum real do banco, restrito ao que a Dra. Elaine efetivamente
  -- pede ("pede o IR" — Esteira do cliente.md). `obrigatorio` sempre `false`: o
  -- método não define quais documentos são obrigatórios por cliente — inventar
  -- isso aqui seria inventar regra de negócio.
  select coalesce(jsonb_agg(jsonb_build_object('tipo', d.tipo, 'nome_arquivo', d.nome_arquivo, 'enviado_em', d.criado_em)
           order by d.criado_em desc), '[]'::jsonb)
    into v_recebidos
    from documentos d
   where d.jornada_id = p_jornada.id and d.ativo;

  return jsonb_build_object(
    'tipos_pedidos', jsonb_build_array(
      jsonb_build_object('chave', 'imposto_renda', 'rotulo', 'Imposto de Renda', 'obrigatorio', false),
      jsonb_build_object('chave', 'contrato_social', 'rotulo', 'Contrato Social', 'obrigatorio', false),
      jsonb_build_object('chave', 'matricula_imovel', 'rotulo', 'Matrícula de Imóvel', 'obrigatorio', false)
    ),
    'recebidos', v_recebidos,
    'limite_arquivos', 5,
    'tamanho_maximo_mb', 20,
    'extensoes_aceitas', jsonb_build_array('pdf', 'jpg', 'jpeg', 'png')
  );
end $$;

create or replace function app.payload_link_material(p_link links_publicos, p_jornada jornadas)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare v_material record;
begin
  -- `materiais_gerados` só existe a partir da 0031 (ver DESVIO 4 no topo do arquivo).
  -- Até lá: sempre "indisponível", nunca 500, nunca conteúdo inventado.
  select conteudo into v_material
    from materiais_gerados
   where jornada_id = p_jornada.id and atual and aprovado_em is not null
   limit 1;
  if not found then
    return jsonb_build_object('disponivel', false);
  end if;
  return jsonb_build_object('disponivel', true, 'conteudo', v_material.conteudo);
end $$;

-- ===========================================================================
-- AS QUATRO RPCs PÚBLICAS. É a ÚNICA coisa que `anon` pode fazer neste banco.
-- Todas: security definer + search_path fixo + rate limit (rota + token) +
-- auditoria + erro único para todo caso ruim de token.
-- ===========================================================================

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
    else                    app.payload_link_material(v_link, v_jornada)
  end;

  perform app.registrar_acesso_publico(v_link.id, 'abrir', 'ok', p_ip_hash, p_user_agent);

  return jsonb_build_object(
    'tipo', v_link.tipo,
    'primeiro_nome', split_part(trim(coalesce(v_pessoa.nome, '')), ' ', 1),
    'expira_em', v_link.expira_em,
    'estado', v_link.estado,
    'payload', v_payload
  );
end $$;

create or replace function public.responder_formulario_publico(
  p_hash text, p_respostas jsonb, p_consentimentos jsonb,
  p_ip_hash text default null, p_user_agent text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_link links_publicos;
  v_formulario formularios%rowtype;
  v_faixa text;
  v_chave text;
  v_item jsonb;
  v_textos jsonb;
  v_respondido_em timestamptz;
begin
  if not app.limite_rota_ok('responder_formulario_publico') then
    return jsonb_build_object('erro', 'limite_excedido');
  end if;
  if not app.limite_token_ok(p_hash) then
    perform app.registrar_acesso_publico(null, 'responder', 'limite', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'limite_excedido');
  end if;

  v_link := app.resolve_link_escrita(p_hash);
  if v_link is null or v_link.tipo <> 'formulario' then
    perform app.registrar_acesso_publico(coalesce(v_link.id, null), 'responder', 'invalido', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'link_invalido');
  end if;

  if p_respostas is null or jsonb_typeof(p_respostas) <> 'object' or p_respostas = '{}'::jsonb then
    perform app.registrar_acesso_publico(v_link.id, 'responder', 'erro', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'respostas_invalidas');
  end if;

  select * into v_formulario from formularios where chave = 'estrategico' and ativo limit 1;
  if not found then
    perform app.registrar_acesso_publico(v_link.id, 'responder', 'erro', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'formulario_indisponivel');
  end if;

  -- Upsert por jornada_id (unique já existe desde 0006). CONFLITO C9 do plano: a
  -- sobrescrita não apaga prova — `trg_timeline_formulario` (0014) já grava
  -- "Formulário estratégico atualizado" na timeline a cada UPDATE, e a resposta
  -- anterior fica só substituída na linha corrente, nunca na timeline.
  v_respondido_em := now();
  insert into formularios_respostas (jornada_id, formulario_id, respostas, origem, respondido_em)
  values (v_link.jornada_id, v_formulario.id, p_respostas, 'cliente_link', v_respondido_em)
  on conflict (jornada_id) do update
    set formulario_id = excluded.formulario_id,
        respostas = excluded.respostas,
        origem = 'cliente_link',
        respondido_em = v_respondido_em;

  -- Espelha P9 na jornada — mesma regra de src/app/api/jornadas/[id]/formulario/route.ts:82.
  v_faixa := p_respostas ->> 'p9';
  if v_faixa is not null and length(trim(v_faixa)) > 0 then
    update jornadas set faixa_patrimonio_declarada = v_faixa where id = v_link.jornada_id;
  end if;

  -- Consentimentos coletáveis nesta via. `p_consentimentos` é um ARRAY
  -- `[{"chave":"tratamento_ia","versao":"..."}, ...]` — só uma entrada por item
  -- ACEITO (contrato de src/types/publico-ui.ts: "todas aceitas"; recusar é
  -- simplesmente não mandar a chave). `gravacao_sessao` (POP 05, 1º SIM) e
  -- `pesquisa_fontes_publicas` são de captura interna — não aparecem aqui. O
  -- texto/versão gravados vêm SEMPRE de `configuracoes` no servidor, nunca do
  -- que o cliente mandou no corpo — o `versao` do item de entrada é ignorado de
  -- propósito (o cliente não é fonte confiável do texto que ele mesmo aceitou).
  select valor into v_textos from configuracoes where chave = 'consentimento.textos';
  for v_item in select * from jsonb_array_elements(coalesce(p_consentimentos, '[]'::jsonb))
  loop
    v_chave := v_item ->> 'chave';
    if v_chave in ('tratamento_ia', 'comunicacao_email', 'comunicacao_whatsapp') then
      insert into consentimentos (pessoa_id, tipo, concedido, texto_apresentado, versao_texto, canal)
      values (
        (select pessoa_id from jornadas where id = v_link.jornada_id),
        v_chave::tipo_consentimento,
        true,
        coalesce(v_textos -> v_chave ->> 'texto', 'Texto de consentimento não configurado.'),
        coalesce(v_textos -> v_chave ->> 'versao', 'sem-versao'),
        'formulario_publico'
      );
    end if;
  end loop;

  update links_publicos
     set usos = usos + 1, estado = 'usado', finalizado_em = v_respondido_em
   where id = v_link.id;

  perform app.registrar_acesso_publico(v_link.id, 'responder', 'ok', p_ip_hash, p_user_agent);

  return jsonb_build_object('ok', true, 'respondido_em', v_respondido_em);
end $$;

create or replace function public.escolher_horario_publico(
  p_hash text, p_inicio timestamptz,
  p_ip_hash text default null, p_user_agent text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_link links_publicos;
  v_slot record;
  v_jornada jornadas%rowtype;
  v_sessao sessoes_viabilidade%rowtype;
  v_agendamento agendamentos%rowtype;
begin
  if not app.limite_rota_ok('escolher_horario_publico') then
    return jsonb_build_object('erro', 'limite_excedido');
  end if;
  if not app.limite_token_ok(p_hash) then
    perform app.registrar_acesso_publico(null, 'escolher_horario', 'limite', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'limite_excedido');
  end if;

  -- Resolução TOLERANTE a 'usado': a remarcação (§2.3 — "reabre para remarcar 1x")
  -- precisa achar o link mesmo depois da primeira escolha. O teto de 1 remarcação é
  -- o `usos < 2` abaixo, não o estado.
  v_link := app.resolve_link_leitura(p_hash);
  if v_link is null or v_link.tipo <> 'agendamento' then
    perform app.registrar_acesso_publico(coalesce(v_link.id, null), 'escolher_horario', 'invalido', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'link_invalido');
  end if;

  if v_link.usos >= 2 then
    perform app.registrar_acesso_publico(v_link.id, 'escolher_horario', 'limite', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'limite_remarcacoes');
  end if;

  -- Só entre os horários REALMENTE ofertados neste link (regra dura, §4.2) — sem
  -- isto o cliente marcaria qualquer timestamp, fora da agenda da advogada.
  -- `agendamentos_sugestoes` só existe a partir da 0029 — até lá, nunca encontra
  -- linha nenhuma, e a resposta é sempre 'horario_indisponivel' (nunca 500).
  select * into v_slot from agendamentos_sugestoes
   where link_id = v_link.id and inicio_em = p_inicio;
  if not found then
    perform app.registrar_acesso_publico(v_link.id, 'escolher_horario', 'invalido', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'horario_indisponivel');
  end if;

  select * into v_jornada from jornadas where id = v_link.jornada_id;
  -- P9 (§5, ONDA 5): nunca confirmar sessão de jornada que não pagou nada.
  if v_jornada.nivel_pago < 1 then
    perform app.registrar_acesso_publico(v_link.id, 'escolher_horario', 'erro', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'agendamento_indisponivel');
  end if;

  select * into v_sessao from sessoes_viabilidade where jornada_id = v_link.jornada_id;
  if not found then
    insert into sessoes_viabilidade (jornada_id) values (v_link.jornada_id)
    returning * into v_sessao;
  end if;

  begin
    select * into v_agendamento from agendamentos
     where sessao_id = v_sessao.id and status = 'confirmado';

    if found then
      -- CORREÇÃO (orquestrador): remarcar NÃO edita o slot antigo. O trigger
      -- `app.impede_alteracao_direta_agendamento` (0021, já aplicado) recusa
      -- UPDATE que mexa em inicio_em/fim_em — o UPDATE daqui viraria exceção
      -- não tratada (500), e não o `{erro:...}` que a página pública espera.
      -- A regra do projeto é: remarcar CRIA agendamento novo e marca o antigo
      -- como 'remarcado', preservando a prova do horário original. O trigger
      -- `app.regua_agendamento` (0013) já cancela as mensagens pendentes do
      -- slot antigo e enfileira as do novo — nada a fazer aqui além disso.
      update agendamentos set status = 'remarcado' where id = v_agendamento.id;

      insert into agendamentos (sessao_id, inicio_em, fim_em, status, origem, advogada_id)
      values (v_sessao.id, v_slot.inicio_em, v_slot.fim_em, 'confirmado', 'cliente', v_sessao.advogada_id)
      returning * into v_agendamento;
    else
      insert into agendamentos (sessao_id, inicio_em, fim_em, status, origem, advogada_id)
      values (v_sessao.id, v_slot.inicio_em, v_slot.fim_em, 'confirmado', 'cliente', v_sessao.advogada_id)
      returning * into v_agendamento;
    end if;
  exception when exclusion_violation then
    -- A Dra. Elaine (ou outra advogada) já está ocupada nesse horário — o mesmo
    -- `ex_agenda_sem_sobreposicao` de 0008. Não vaza DE QUEM é o conflito.
    perform app.registrar_acesso_publico(v_link.id, 'escolher_horario', 'erro', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'horario_indisponivel');
  end;

  update links_publicos
     set usos = usos + 1, estado = 'usado'
   where id = v_link.id
  returning usos into v_link.usos;

  -- BLOQUEIO B20 do plano: o link de agendamento não exige formulário respondido
  -- antes — dinheiro entrou, cliente marca. `trg_timeline_agendamento` (0014) e
  -- `trg_valida_transicao`/`trg_registra_transicao` (0004) já disparam sozinhos
  -- pelo INSERT/UPDATE acima; nenhum evento de timeline extra é gravado aqui.
  if v_jornada.etapa = 'sessao_contratada' then
    update jornadas set etapa = 'sessao_agendada' where id = v_jornada.id;
  end if;

  perform app.registrar_acesso_publico(v_link.id, 'escolher_horario', 'ok', p_ip_hash, p_user_agent);

  -- Forma combinando com `RespostaEscolherHorarioPublico` de src/types/publico-ui.ts.
  return jsonb_build_object('ok', true, 'horario_confirmado', jsonb_build_object(
    'inicio_em', v_agendamento.inicio_em,
    'fim_em', v_agendamento.fim_em,
    'pode_remarcar', v_link.usos < 2
  ));
end $$;

create or replace function public.registrar_documento_publico(
  p_hash text, p_tipo text, p_nome text, p_caminho text, p_mime text, p_bytes bigint, p_sha256 text,
  p_ip_hash text default null, p_user_agent text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_link links_publicos; v_jornada jornadas%rowtype;
begin
  if not app.limite_rota_ok('registrar_documento_publico') then
    return jsonb_build_object('erro', 'limite_excedido');
  end if;
  if not app.limite_token_ok(p_hash) then
    perform app.registrar_acesso_publico(null, 'enviar_documento', 'limite', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'limite_excedido');
  end if;

  v_link := app.resolve_link_escrita(p_hash);
  if v_link is null or v_link.tipo <> 'documentos' then
    perform app.registrar_acesso_publico(coalesce(v_link.id, null), 'enviar_documento', 'invalido', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'link_invalido');
  end if;

  -- 'arquivo_invalido' é o código do F-1A (src/types/publico-ui.ts) para todo
  -- problema de arquivo — tipo, mime, tamanho. Tipo é validado aqui; mime e
  -- tamanho já foram validados na rota antes do upload (ela usa o mesmo código
  -- para os dois casos, então tanto faz onde a validação de fato rejeita).
  if p_tipo not in ('imposto_renda', 'contrato_social', 'matricula_imovel', 'outro') then
    perform app.registrar_acesso_publico(v_link.id, 'enviar_documento', 'erro', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'arquivo_invalido');
  end if;

  -- 5 arquivos por link (§2.4). `usos` também conta remarcação/formulário noutros
  -- tipos de link — aqui só cresce por documento, porque cada link é de um tipo só.
  -- NOTA DE CONTRATO: `CodigoErroPublico` do F-1A não tem um código dedicado para
  -- "limite de arquivos atingido" nem para "arquivo duplicado" — o comentário dele
  -- em publico-ui.ts diz que os limites são mostrados ANTES da tentativa (via
  -- `limite_arquivos`/`tamanho_maximo_mb` do payload), então isto só dispara numa
  -- corrida rara (duas abas, ou alguém contornando a checagem client-side).
  -- Devolvo os dois como estão — sinalizado no relatório para o F-1A decidir se
  -- quer tratá-los como `arquivo_invalido` (perde a mensagem específica) ou
  -- ampliar o próprio enum (uma mudança de tipo, aditiva, sem risco).
  if v_link.usos >= 5 then
    perform app.registrar_acesso_publico(v_link.id, 'enviar_documento', 'limite', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'limite_arquivos_atingido');
  end if;

  select * into v_jornada from jornadas where id = v_link.jornada_id;

  begin
    insert into documentos (pessoa_id, jornada_id, tipo, nome_arquivo, caminho, mime, tamanho_bytes, sha256, origem, enviado_por)
    values (v_jornada.pessoa_id, v_jornada.id, p_tipo, p_nome, p_caminho, p_mime, p_bytes, p_sha256, 'cliente', null);
  exception when unique_violation then
    -- `uniq_documentos_jornada_sha256`: mesmo arquivo, mesma jornada, de novo.
    perform app.registrar_acesso_publico(v_link.id, 'enviar_documento', 'erro', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'arquivo_duplicado');
  end;

  update links_publicos set usos = usos + 1 where id = v_link.id;

  perform app.registrar_acesso_publico(v_link.id, 'enviar_documento', 'ok', p_ip_hash, p_user_agent);

  -- Nunca `documento_id` na resposta pública (regra dura 4, §2.2) — só o que o
  -- cliente já podia ver na lista `recebidos` do payload de `abrir_link_publico`.
  return jsonb_build_object('ok', true, 'documento', jsonb_build_object(
    'tipo', p_tipo, 'nome_arquivo', p_nome, 'enviado_em', now()
  ));
end $$;

-- ===========================================================================
-- Emissão e revogação — porta única de escrita para a EQUIPE (não para `anon`).
-- Ver DESVIO 3 no topo do arquivo. Auto-gate de papel, mesmo padrão de
-- `marcar_mensagem_manual` (0019) e `reprocessar_webhook` (0027).
-- ===========================================================================
create or replace function public.emitir_link_publico(
  p_jornada_id uuid, p_tipo tipo_link_publico, p_token_hash text, p_token_prefixo text
) returns links_publicos
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_papel papel_equipe; v_perfil_id uuid; v_dias int; v_link links_publicos;
begin
  select p.papel, p.id into v_papel, v_perfil_id
    from perfis_equipe p where p.auth_user_id = auth.uid() and p.ativo;

  if v_papel is null or v_papel not in ('admin', 'advogada', 'relacionamento') then
    raise exception 'sem_permissao: papel sem autorização para emitir link publico' using errcode = '42501';
  end if;

  if not exists (select 1 from jornadas where id = p_jornada_id and desfecho = 'aberta') then
    raise exception 'jornada_invalida: jornada nao encontrada ou fechada' using errcode = 'P0002';
  end if;

  select (valor ->> p_tipo::text)::int into v_dias
    from configuracoes where chave = 'link.validade_dias';
  v_dias := coalesce(v_dias, 14);

  -- Emitir um novo mata o anterior do mesmo tipo (§2.3) — evita link antigo
  -- circulando em WhatsApp depois que a equipe já mandou um novo. Mesma transação
  -- do INSERT abaixo: as duas escritas são atômicas (ao contrário de dois `await
  -- supabase.from(...)` da rota Next, que não são atômicos entre si).
  update links_publicos
     set estado = 'revogado', revogado_em = now(), revogado_por = v_perfil_id
   where jornada_id = p_jornada_id and tipo = p_tipo and estado = 'ativo';

  insert into links_publicos (jornada_id, tipo, token_hash, token_prefixo, expira_em, criado_por)
  values (p_jornada_id, p_tipo, p_token_hash, p_token_prefixo, now() + (v_dias * interval '1 day'), v_perfil_id)
  returning * into v_link;

  return v_link;
end $$;
revoke execute on function public.emitir_link_publico(uuid, tipo_link_publico, text, text) from public, anon;
grant  execute on function public.emitir_link_publico(uuid, tipo_link_publico, text, text) to authenticated;

create or replace function public.revogar_link_publico(p_link_id uuid) returns links_publicos
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_papel papel_equipe; v_perfil_id uuid; v_link links_publicos;
begin
  select p.papel, p.id into v_papel, v_perfil_id
    from perfis_equipe p where p.auth_user_id = auth.uid() and p.ativo;

  if v_papel is null or v_papel not in ('admin', 'advogada', 'relacionamento') then
    raise exception 'sem_permissao: papel sem autorização para revogar link publico' using errcode = '42501';
  end if;

  select * into v_link from links_publicos where id = p_link_id;
  if not found then
    raise exception 'link_nao_encontrado: %', p_link_id using errcode = 'P0002';
  end if;

  if v_link.estado = 'ativo' then
    update links_publicos
       set estado = 'revogado', revogado_em = now(), revogado_por = v_perfil_id
     where id = p_link_id
    returning * into v_link;
  end if;

  return v_link;
end $$;
revoke execute on function public.revogar_link_publico(uuid) from public, anon;
grant  execute on function public.revogar_link_publico(uuid) to authenticated;

-- ===========================================================================
-- Grants finais das 4 RPCs públicas — a ÚNICA coisa que `anon` pode executar neste
-- banco. Tudo em `app` já nasce sem PUBLIC/anon por causa da 0024 (`alter default
-- privileges in schema app revoke execute on functions from public`); e `usage on
-- schema app` para `anon` segue revogado desde a 0018. Aqui só falta o
-- `revoke ... from public` explícito nas 4 funções de `public` (que, ao contrário
-- de `app`, expõe EXECUTE a PUBLIC por padrão em todo CREATE FUNCTION) e o grant
-- nomeado, um por um.
-- ===========================================================================
revoke execute on function public.abrir_link_publico(text, text, text) from public;
revoke execute on function public.responder_formulario_publico(text, jsonb, jsonb, text, text) from public;
revoke execute on function public.escolher_horario_publico(text, timestamptz, text, text) from public;
revoke execute on function public.registrar_documento_publico(text, text, text, text, text, bigint, text, text, text) from public;

grant execute on function public.abrir_link_publico(text, text, text) to anon;
grant execute on function public.responder_formulario_publico(text, jsonb, jsonb, text, text) to anon;
grant execute on function public.escolher_horario_publico(text, timestamptz, text, text) to anon;
grant execute on function public.registrar_documento_publico(text, text, text, text, text, bigint, text, text, text) to anon;

-- NOTA final de verificação (rodar depois de aplicar, junto com a query de 0027):
--   select p.proname, p.proacl from pg_proc p
--    join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('abrir_link_publico','responder_formulario_publico',
--                        'escolher_horario_publico','registrar_documento_publico');
--   -- esperado: 'anon=X/postgres' aparece nas 4, e em NENHUMA outra função de public.
--
--   select c.relname, p.polcmd, p.polroles::regrole[] from pg_policy p
--     join pg_class c on c.oid = p.polrelid
--    where c.relname in ('links_publicos','links_publicos_acessos','publico_rate_limit');
--   -- esperado: nenhuma linha com 'anon' em polroles.
