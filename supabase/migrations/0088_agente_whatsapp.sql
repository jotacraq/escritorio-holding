-- 0088 — Agente de WhatsApp de onboarding: estado, livro-razão e interruptor
-- Fase 9, 07/09/2026. Plano: docs/ARQUITETURA-FASE-9.md §E (D22–D28) e §B.
--
-- 100% ADITIVA: nenhuma tabela, coluna, view, função ou policy existente é
-- alterada. O agente nasce DESLIGADO (`agente_whatsapp.ativo = false`).
--
-- O QUE ENTRA
--   (a) app.telefone_e164(text)          — a MESMA regra de normalização que
--                                          `src/server/integracoes/telefone.ts`,
--                                          agora também no banco (imutável).
--   (b) índice de expressão em pessoas   — casar telefone normalizado sem seq scan.
--   (c) casar_pessoa_por_telefone(text)  — UMA consulta que devolve pessoa +
--                                          jornada aberta + CARDINALIDADE.
--   (d) agente_whatsapp_estado           — 1 linha por jornada (memória curta).
--   (e) agente_whatsapp_respostas        — append-only; o `unique` É a claim
--                                          anti-resposta-dupla.
--   (f) configuracoes['agente_whatsapp.*'] — 7 chaves, `ativo` = false.
--
-- REVERSÃO (nesta ordem):
--   drop table if exists agente_whatsapp_respostas;
--   drop table if exists agente_whatsapp_estado;
--   delete from configuracoes where chave like 'agente_whatsapp.%';
--   drop function if exists public.casar_pessoa_por_telefone(text);
--   drop index if exists idx_pessoas_telefone_e164;
--   drop function if exists app.telefone_e164(text);
--
-- ROTEIRO DE VERIFICAÇÃO: `scripts/verificacao-0088-0090.sql` (com rollback).
-- ===========================================================================


-- ===========================================================================
-- (a) Normalização E.164 NO BANCO — a mesma regra dos dois lados.
--
--     `resolverPessoaPorTelefone` normaliza o telefone que chega do Chatwoot,
--     mas comparava com o que está GRAVADO em `pessoas.telefone` sem
--     normalizar o lado de cá. Medido em 07/09: das 6 pessoas, a ÚNICA com
--     `origem_dado = 'real'` está gravada como `11988887777` (11 dígitos, sem
--     `+`) — ou seja, hoje o casamento falha justamente para quem é real.
--
--     `immutable` é obrigatório para virar índice de expressão. A função é
--     puramente textual (não lê tabela, não lê `now()`), então é imutável de
--     verdade — não é uma promessa vazia ao planejador.
--
--     REGRA (idêntica a `normalizarTelefoneE164`, e o teste do roteiro prova
--     a paridade nos mesmos casos do vitest):
--       . começa com '+'  → 8..15 dígitos viram '+' || dígitos; fora disso NULL
--       . 10 ou 11 dígitos → '+55' || dígitos (Brasil sem DDI)
--       . 12 ou 13 dígitos começando por '55' → '+' || dígitos
--       . qualquer outro tamanho → NULL (não casa com ninguém, e é assim que
--         tem de ser: casar com a pessoa errada é pior que não casar)
-- ===========================================================================
create or replace function app.telefone_e164(p_bruto text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_tem_mais boolean;
  v_digitos  text;
begin
  if p_bruto is null then return null; end if;
  v_tem_mais := left(btrim(p_bruto), 1) = '+';
  v_digitos  := regexp_replace(p_bruto, '[^0-9]', '', 'g');
  if v_digitos = '' then return null; end if;

  if v_tem_mais then
    if length(v_digitos) between 8 and 15 then return '+' || v_digitos; end if;
    return null;
  end if;

  if length(v_digitos) in (10, 11) then return '+55' || v_digitos; end if;
  if length(v_digitos) in (12, 13) and left(v_digitos, 2) = '55' then return '+' || v_digitos; end if;
  return null;
end $$;

revoke execute on function app.telefone_e164(text) from public, anon;
grant  execute on function app.telefone_e164(text) to authenticated, service_role;

comment on function app.telefone_e164(text) is
  'E.164 conservador — mesma regra de src/server/integracoes/telefone.ts. NULL quando o formato é '
  'desconhecido (não casa com ninguém, em vez de casar com a pessoa errada). Imutável de propósito: '
  'sustenta idx_pessoas_telefone_e164.';


-- ===========================================================================
-- (b) Índice de expressão. Sem ele, `casar_pessoa_por_telefone` faria seq scan
--     em `pessoas` a cada mensagem recebida — e `pessoas` só cresce.
--     Parcial: linha sem telefone nunca casa e não merece entrada no índice.
--     NÃO é único: duas pessoas com o mesmo número existem no mundo real
--     (casal, empresa) e a resposta certa a isso é RECUSAR, não impedir o
--     cadastro. Quem recusa é a cardinalidade da RPC abaixo.
-- ===========================================================================
create index if not exists idx_pessoas_telefone_e164
  on pessoas (app.telefone_e164(telefone))
  where telefone is not null;


-- ===========================================================================
-- (c) `casar_pessoa_por_telefone` — o casamento do porteiro, em UMA consulta.
--
--     Devolve `quantidade` de propósito: quem chama precisa distinguir
--     "ninguém" (0) de "ambíguo" (>1). O código de hoje faz `.limit(1)` e
--     escolheria a errada em silêncio.
--
--     Considera o nono dígito do celular nas duas direções — é a mesma pessoa
--     gravada em duas épocas diferentes, não um chute de DDI.
--
--     NÃO devolve nome, e-mail nem nada do cadastro: quem chama é o webhook,
--     e um webhook que devolve PII a partir de um telefone forjado no payload
--     é um oráculo de "esse número é cliente?". Só id, jornada e contagem.
--
--     `security definer` + `set search_path`: quem chama é `service_role`,
--     que já lê tudo — o definer aqui existe para o dia em que a rota chamar
--     com outro papel, não para dar privilégio a ninguém.
-- ===========================================================================
create or replace function public.casar_pessoa_por_telefone(p_telefone text)
returns table (pessoa_id uuid, jornada_id uuid, quantidade integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_e164      text;
  v_ddd       text;
  v_assinante text;
  v_variantes text[];
  v_qtd       integer;
  v_pessoa    uuid;
  v_jornada   uuid;
begin
  v_e164 := app.telefone_e164(p_telefone);
  if v_e164 is null then
    return query select null::uuid, null::uuid, 0;
    return;
  end if;

  v_variantes := array[v_e164];
  if v_e164 ~ '^\+55[0-9]{10,11}$' then
    v_ddd       := substring(v_e164 from 4 for 2);
    v_assinante := substring(v_e164 from 6);
    if length(v_assinante) = 9 and left(v_assinante, 1) = '9' then
      v_variantes := v_variantes || ('+55' || v_ddd || substring(v_assinante from 2));
    elsif length(v_assinante) = 8 then
      v_variantes := v_variantes || ('+55' || v_ddd || '9' || v_assinante);
    end if;
  end if;

  select count(*)::integer into v_qtd
    from pessoas p
   where p.telefone is not null
     and app.telefone_e164(p.telefone) = any (v_variantes);

  if v_qtd <> 1 then
    return query select null::uuid, null::uuid, v_qtd;
    return;
  end if;

  select p.id into v_pessoa
    from pessoas p
   where p.telefone is not null
     and app.telefone_e164(p.telefone) = any (v_variantes);

  -- A jornada ABERTA da pessoa. `uniq_jornada_aberta_por_pessoa` (0004:52)
  -- garante no máximo uma; processo fechado devolve NULL e o porteiro
  -- transforma isso em tarefa, nunca em resposta (B62).
  select j.id into v_jornada
    from jornadas j
   where j.pessoa_id = v_pessoa and j.desfecho = 'aberta'
   limit 1;

  return query select v_pessoa, v_jornada, 1;
end $$;

revoke all on function public.casar_pessoa_por_telefone(text) from public, anon, authenticated;
grant execute on function public.casar_pessoa_por_telefone(text) to service_role;

comment on function public.casar_pessoa_por_telefone(text) is
  'Casa um telefone (em qualquer formato) com UMA pessoa, normalizando os dois lados (C1/D3 da '
  'Fase 9). Devolve quantidade=0 (desconhecido), 1 (casou) ou N (ambíguo — o porteiro cala). '
  'Nunca devolve dado de cadastro: seria um oráculo de "esse número é cliente?". service_role only.';


-- ===========================================================================
-- (d) `agente_whatsapp_estado` — a memória curta do robô, 1 linha por jornada.
--
--     Não é uma segunda máquina de estados: o passo continua saindo de
--     `derivarProximoPasso()` (D1/D9). Aqui só mora o que a máquina de passos
--     não sabe — quantas vezes o cliente já fugiu do tema, quando um humano
--     falou por último, até quando a conversa está pausada, e quando cada
--     tipo de link foi emitido (C5: emitir de novo REVOGA o anterior).
-- ===========================================================================
create table agente_whatsapp_estado (
  jornada_id          uuid primary key references jornadas(id) on delete cascade,
  -- Último `ProximoPasso.chave` que o agente traduziu. Serve para a tela e
  -- para a trilha; nunca para DECIDIR (quem decide é a derivação, sempre).
  passo_ultimo        text,
  ultima_intencao     text,
  esquivas_seguidas   smallint    not null default 0 check (esquivas_seguidas >= 0),
  humano_respondeu_em timestamptz,
  pausado_ate         timestamptz,
  pausado_por         uuid references perfis_equipe(id) on delete set null,
  -- {"documentos":"2026-09-07T12:00:00Z","formulario":"..."} — teto de 1 link
  -- por tipo a cada `agente_whatsapp.intervalo_link_horas`.
  ultimo_link_em      jsonb       not null default '{}'::jsonb,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);

create trigger trg_agente_estado_atualizado_em
  before update on agente_whatsapp_estado
  for each row execute function app.set_atualizado_em();

-- RLS: a equipe LÊ; ninguém logado escreve. Quem escreve é o webhook e as
-- rotas (que já conferem papel no servidor) com `service_role`.
--
-- DIVERGÊNCIA CONSCIENTE do rascunho do §E: o rascunho previa
-- `grant update (pausado_ate, pausado_por) to authenticated`. Não entra, por
-- dois motivos: (1) a linha PODE NÃO EXISTIR quando alguém clica em "Assumir
-- conversa" — UPDATE sozinho não resolve, e um `grant insert` abriria a
-- escrita inteira; (2) com o grant, qualquer sessão da equipe poderia pausar
-- o agente de qualquer jornada por PostgREST direto, fora da rota que registra
-- QUEM pausou e por quanto tempo. A rota `POST /api/jornadas/[id]/agente-whatsapp`
-- exige papel e escreve com service_role — trava de rota + trava de banco.
revoke all on agente_whatsapp_estado from anon, authenticated;
alter table agente_whatsapp_estado enable row level security;
alter table agente_whatsapp_estado force row level security;
create policy awe_sel on agente_whatsapp_estado for select to authenticated
  using ((select app.eh_interno()));
grant select on agente_whatsapp_estado to authenticated;

comment on table agente_whatsapp_estado is
  'Memória curta do agente de WhatsApp por jornada (Fase 9). NÃO é máquina de estados: o passo vem '
  'de derivarProximoPasso(). Escrita só por service_role.';
comment on column agente_whatsapp_estado.ultimo_link_em is
  'Quando cada TIPO de link foi emitido pelo agente. Existe porque emitir um link REVOGA o anterior '
  '(0028): sem teto, o cliente que pede duas vezes derruba o link que a equipe mandou por e-mail.';


-- ===========================================================================
-- (e) `agente_whatsapp_respostas` — append-only, e a CLAIM.
--
--     `unique (mensagem_recebida_id)` não é higiene de dado: é a trava
--     anti-resposta-dupla. O fluxo faz
--     `insert ... on conflict do nothing returning id` ANTES de falar com o
--     provedor; sem linha de volta, outro processo já pegou a mensagem e este
--     sai calado. Garantia do banco, não `if` de aplicação.
-- ===========================================================================
create table agente_whatsapp_respostas (
  id                   uuid primary key default gen_random_uuid(),
  mensagem_recebida_id uuid not null unique references mensagens_recebidas(id) on delete cascade,
  jornada_id           uuid not null references jornadas(id) on delete cascade,
  conversa_externa_id  text not null,
  intencao             text,
  confianca            numeric(3,2) check (confianca is null or (confianca >= 0 and confianca <= 1)),
  acao                 text check (acao is null or acao in ('enviar_link', 'nenhuma', 'encaminhar_humano')),
  -- O texto ENVIADO. NULL quando o agente decidiu não responder (e aí `erro`
  -- ou `intencao` dizem por quê) — nunca texto plausível para "não sei".
  texto                text,
  execucao_ia_id       uuid references execucoes_ia(id) on delete set null,
  custo_usd            numeric(10,6),
  provedor_id          text,
  enviada_em           timestamptz,
  erro                 text,
  criado_em            timestamptz not null default now()
);

create index idx_agente_respostas_jornada on agente_whatsapp_respostas (jornada_id, criado_em desc);
-- Teto de respostas por hora e custo do dia varrem por janela de tempo.
create index idx_agente_respostas_criado_em on agente_whatsapp_respostas (criado_em desc);

revoke all on agente_whatsapp_respostas from anon, authenticated;
alter table agente_whatsapp_respostas enable row level security;
alter table agente_whatsapp_respostas force row level security;
create policy awr_sel on agente_whatsapp_respostas for select to authenticated
  using ((select app.eh_interno()));
grant select on agente_whatsapp_respostas to authenticated;
-- Sem policy de INSERT/UPDATE/DELETE: livro-razão do robô é append-only e
-- quem escreve é service_role.

comment on table agente_whatsapp_respostas is
  'Livro-razão do agente de WhatsApp: uma linha por mensagem recebida que o agente CLAIMOU. '
  'O unique (mensagem_recebida_id) É a trava anti-resposta-dupla (garantia do banco). Append-only.';


-- ===========================================================================
-- (f) Interruptor e tetos. `ativo = false`: o agente nasce desligado e só o
--     João liga, em Admin. Toda trava é configuração (dado), não constante em
--     TS — muda sem deploy.
-- ===========================================================================
insert into configuracoes (chave, valor, descricao) values
 ('agente_whatsapp.ativo', 'false'::jsonb,
  'Liga o agente de WhatsApp de onboarding. FALSE ao nascer: com ele desligado o webhook continua GRAVANDO a mensagem recebida e não responde nada. Ligar exige inbox do WhatsApp criado no Chatwoot e as 5 variáveis CHATWOOT_*.'),
 ('agente_whatsapp.silencio_humano_minutos', '30'::jsonb,
  'Depois que um humano responde na conversa, o agente fica em silêncio por estes minutos. É também a duração da pausa de "Assumir conversa".'),
 ('agente_whatsapp.esquivas_ate_humano', '2'::jsonb,
  'Quantas vezes o agente devolve o cliente ao fluxo antes de encaminhar para a equipe (B57). Na esquiva de número N ele para de insistir e abre tarefa.'),
 ('agente_whatsapp.intervalo_link_horas', '6'::jsonb,
  'Intervalo mínimo entre duas emissões do MESMO tipo de link para a mesma jornada. Existe porque emitir revoga o anterior: sem teto, o cliente que pede duas vezes derruba o próprio link e o que a equipe mandou por e-mail.'),
 ('agente_whatsapp.teto_respostas_hora', '6'::jsonb,
  'Máximo de respostas do agente por jornada por hora. Estourou: o agente cala e abre tarefa para a equipe assumir.'),
 ('agente_whatsapp.teto_ia_jornada_dia', '10'::jsonb,
  'Máximo de execuções de IA do agente por jornada por dia. Orçamento PRÓPRIO: o agente não passa por verificar_cooldown_ia, cujo cooldown de 600 s por jornada o calaria na 2ª mensagem do cliente (C3).'),
 ('agente_whatsapp.teto_ia_dia', '100'::jsonb,
  'Máximo de execuções de IA do agente por dia, somando todas as jornadas. É o teto que impede 10x mensagens virarem 10x conta.')
on conflict (chave) do nothing;
