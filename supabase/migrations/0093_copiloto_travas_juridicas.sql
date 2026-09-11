-- 0093_copiloto_travas_juridicas.sql
-- Fase 10 · Fatia 2 (docs/ARQUITETURA-FASE-10.md §6.2, §6.2.1, §8, §9 C1/C2,
-- §12). A migration MAIS IMPORTANTE desta fatia — é o gate.
--
-- 100% ADITIVA. Nenhuma tabela, coluna, view ou policy é alterada, exceto o
-- CHECK de escopo de `decisoes_juridicas` (ampliação — 0048) e a criação de
-- 3 triggers sobre as tabelas de 0091. Depende de 0092 já aplicada (enum
-- `tipo_consentimento` com o valor 'copiloto_sessao_ao_vivo').
--
-- O QUE ENTRA
--   (a) decisoes_juridicas.escopo — CHECK ampliado, 2º escopo da lista
--       fechada: 'sessao.copiloto_ao_vivo'. NÃO insere nenhuma decisão — é
--       estrutura, igual à 0048. A decisão de mérito (B65) é da Dra. Elaine,
--       pela rota que já existe (POST /api/admin/decisoes-juridicas).
--   (b) app.exige_decisao_copiloto_ao_vivo() — a trava que FALTA (CONFLITO
--       C2 do plano): `app.exige_flag_analise_ia_habilitada` (0048) protege
--       SÓ `analises_transcricao`. O copiloto escreve em OUTRAS tabelas e não
--       herdaria trava nenhuma — a mesma lição do pentest ("a trava é por
--       CAMINHO DE SAÍDA DE DADO, não por feature").
--   (c) TRÊS triggers, não duas — decisão vigente após o achado do Fable na
--       trava da Fatia 1 (§6.2.1 do plano, por extenso):
--         - copiloto_sugestoes                    → INCONDICIONAL
--         - sessoes_copiloto_segmentos             → when (new.origem = 'bot')
--         - sessoes_copiloto.gravacao_externa_id   → when (... is not null)
--       Segmento `origem='manual'` (o campo de digitar da Fatia 1, já em uso)
--       CONTINUA PASSANDO sem decisão nem consentimento — nunca sai do
--       escritório. Ver a tabela completa em (c) abaixo.
--
-- POR QUE A TRIGGER DOS SEGMENTOS NÃO É INCONDICIONAL (§6.2.1 do plano,
-- resumo — a razão inteira está lá, não repetida por completo aqui): a 0092
-- (numeração do plano; nesta entrega é a 0091, já aplicada) grava segmento
-- `origem='manual'` SEM decisão jurídica nem consentimento — é a advogada
-- digitando no sistema dela, sob RLS, dado do escritório em banco do
-- escritório. Se esta trigger travasse TODO insert em
-- `sessoes_copiloto_segmentos`, o campo de digitar da Fatia 1 pararia de
-- funcionar até B65/B67 serem respondidos — e a Fatia 2 estaria matando uma
-- capacidade real da Fatia 1 por um ganho de segurança igual a zero (o texto
-- manual não sai para lugar nenhum). O `when` não é uma promessa de aplicação:
-- `origem` só pode ser 'bot' via `service_role` (RLS de 0091, policy `scs_ins`
-- força `origem='manual'` para `authenticated`) — um atacante com sessão de
-- advogada não forja `origem='bot'` para escapar da checagem, porque
-- `service_role` é quem grava 'bot' (webhook, Fatia 4, ainda não existe).
--
-- ROTEIRO DE VERIFICAÇÃO: `scripts/verificacao-0092-0093.sql`.
--
-- ROLLBACK (ordem inversa):
--   drop trigger if exists trg_copiloto_exige_decisao_bot_pedido on sessoes_copiloto;
--   drop trigger if exists trg_copiloto_exige_decisao_segmentos_bot on sessoes_copiloto_segmentos;
--   drop trigger if exists trg_copiloto_exige_decisao_sugestoes on copiloto_sugestoes;
--   drop function if exists app.exige_decisao_copiloto_ao_vivo();
--   alter table decisoes_juridicas drop constraint decisoes_juridicas_escopo_check;
--   alter table decisoes_juridicas add  constraint decisoes_juridicas_escopo_check
--     check (escopo in ('conhecimento.analise_ia_transcricoes'));
--   -- (o rollback do CHECK só é seguro se nenhuma decisão com o escopo novo
--   -- tiver sido registrada; ver bloco de conferência no roteiro de verificação)
-- ===========================================================================


-- ===========================================================================
-- (a) CHECK de escopo ampliado (CONFLITO C1 do plano: `decisoes_juridicas
-- .escopo` é lista FECHADA por CHECK, 0048:50-51 — registrar a decisão do
-- copiloto não é um INSERT livre, exige migration, por desenho).
-- ===========================================================================
alter table decisoes_juridicas drop constraint decisoes_juridicas_escopo_check;
alter table decisoes_juridicas add  constraint decisoes_juridicas_escopo_check
  check (escopo in ('conhecimento.analise_ia_transcricoes',
                     'sessao.copiloto_ao_vivo'));

comment on column decisoes_juridicas.escopo is
  'Chave fixa do que está sendo decidido — CHECK fecha a lista, igual a '
  'configuracoes.chave. Escopo novo é migration. Ampliado em 0093 com '
  '''sessao.copiloto_ao_vivo'' (Fase 10) — mesma regra da 0048.';


-- ===========================================================================
-- (b) A função-porteiro. `set search_path` fixo (mesma regra de toda função
-- SECURITY DEFINER/trigger desta base — sequestro de schema).
-- ===========================================================================
-- Os DOIS selects abaixo provam o índice existente caractere a caractere
-- (regra da casa — índice novo não é criado aqui, os dois já existem):
--   `where escopo = 'sessao.copiloto_ao_vivo' and revogada_em is null` bate
--   com `uniq_decisao_juridica_ativa on decisoes_juridicas (escopo) where
--   revogada_em is null` (0048:96) — Index Scan sobre índice PARCIAL único.
--   `app.tem_consentimento` (0005) já usa
--   `where pessoa_id = $1 and tipo = $2 order by concedido_em desc limit 1`,
--   que bate com `idx_consent_pessoa_tipo (pessoa_id, tipo, concedido_em desc)`.
create or replace function app.exige_decisao_copiloto_ao_vivo() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v_tem_decisao boolean;
  v_pessoa      uuid;
begin
  select exists (
    select 1 from decisoes_juridicas
     where escopo = 'sessao.copiloto_ao_vivo'
       and revogada_em is null
  ) into v_tem_decisao;

  if not coalesce(v_tem_decisao, false) then
    raise exception 'copiloto_ao_vivo_bloqueado: sem decisao juridica ativa (escopo sessao.copiloto_ao_vivo)'
      using errcode = 'check_violation';
  end if;

  -- 2ª trava, INDEPENDENTE: consentimento do TITULAR, tipo NOVO (0092).
  -- NÃO reaproveita `tratamento_ia` (é consentimento de PREPARAÇÃO da SV) nem
  -- `gravacao_sessao` (autoriza GRAVAR, não transmitir a fala a terceiro ao
  -- vivo — a NOTA da 0030 é explícita: são tipos DIFERENTES, cada um com sua
  -- vigência própria em `app.tem_consentimento`).
  --
  -- `new.sessao_id` resolve nas 3 tabelas-alvo: em `copiloto_sugestoes` e em
  -- `sessoes_copiloto_segmentos` é a FK normal; em `sessoes_copiloto` é a
  -- própria PK (a linha da sessão) — mesma expressão nos dois casos.
  select j.pessoa_id into v_pessoa
    from sessoes_viabilidade s
    join jornadas j on j.id = s.jornada_id
   where s.id = new.sessao_id;

  if v_pessoa is null or not app.tem_consentimento(v_pessoa, 'copiloto_sessao_ao_vivo') then
    raise exception 'copiloto_ao_vivo_bloqueado: titular sem consentimento copiloto_sessao_ao_vivo'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

revoke all on function app.exige_decisao_copiloto_ao_vivo() from public, anon, authenticated;

comment on function app.exige_decisao_copiloto_ao_vivo() is
  'Gate da Fase 10 (Fatia 2): decisão jurídica ATIVA (escopo sessao.copiloto_ao_vivo) '
  'E consentimento do titular (tipo copiloto_sessao_ao_vivo) — as DUAS, nenhuma dispensa '
  'a outra. Ver §6.2.1 do plano para o porquê do `when` em cada trigger que a usa.';


-- ===========================================================================
-- (c) Onde a trigger vai, e por que NÃO vai em toda tabela sem condição —
-- tabela completa, para quem chegar depois (§6.2.1 do plano, "o dado sai do
-- escritório?" aplicado a cada INSERT):
--
--   INSERT                                      | sai do escritório? | trava
--   copiloto_sugestoes                          | SIM, sempre        | incondicional
--   sessoes_copiloto_segmentos, origem='bot'     | SIM                | when
--   sessoes_copiloto.gravacao_externa_id setado  | SIM (pede o bot)   | when
--   sessoes_copiloto_segmentos, origem='manual'  | NÃO                | sem trava
-- ===========================================================================

-- copiloto_sugestoes: nenhuma linha aqui existe sem que a fala do cliente
-- tenha ido a um subprocessador (é o próprio ato de gerar sugestão por IA).
-- É a trava que importa — a que fecha o furo que a opção "só a origem='bot'"
-- sozinha deixaria (texto manual também vira entrada de IA por este caminho).
create trigger trg_copiloto_exige_decisao_sugestoes
  before insert on copiloto_sugestoes
  for each row execute function app.exige_decisao_copiloto_ao_vivo();

-- Segmento vindo do BOT é entrada de dado de um subprocessador que gravou a
-- sala: exige as duas travas. Segmento DIGITADO pela advogada (Fatia 1, já em
-- uso) é a advogada escrevendo no sistema dela, sob RLS e `ve_patrimonio()` —
-- mesma posição, textual, de `POST /api/sessoes/[id]/transcricao`: "PERSISTIR
-- não exige consentimento (é dado do escritório, em banco do escritório, sob
-- RLS); só ANALISAR exige". `origem` não é escolha da tela: a policy `scs_ins`
-- de 0091 já força `origem='manual'` para `authenticated` — `origem='bot'` só
-- é gravável por `service_role` (o webhook da Fatia 4), então o `when` não é
-- uma promessa de aplicação, é uma condição sobre uma coluna que a própria
-- RLS impede o navegador de forjar.
create trigger trg_copiloto_exige_decisao_segmentos_bot
  before insert on sessoes_copiloto_segmentos
  for each row when (new.origem = 'bot')
  execute function app.exige_decisao_copiloto_ao_vivo();

-- Pedir o bot (Fatia 4) é o instante em que a sala passa a ser gravada por
-- terceiro — `gravacao_externa_id` vai de NULL para o id que o provedor
-- devolveu. `before insert or update of` cobre os dois caminhos possíveis
-- (a linha `sessoes_copiloto` já existir da Fatia 1 e só ganhar o id depois,
-- ou nascer com ele já preenchido).
create trigger trg_copiloto_exige_decisao_bot_pedido
  before insert or update of gravacao_externa_id on sessoes_copiloto
  for each row when (new.gravacao_externa_id is not null)
  execute function app.exige_decisao_copiloto_ao_vivo();

comment on trigger trg_copiloto_exige_decisao_sugestoes on copiloto_sugestoes is
  'Fase 10, Fatia 2. INCONDICIONAL: toda sugestão de IA exige decisão jurídica '
  'ativa + consentimento do titular. Ver §6.2.1 do plano (docs/ARQUITETURA-FASE-10.md).';
comment on trigger trg_copiloto_exige_decisao_segmentos_bot on sessoes_copiloto_segmentos is
  'Fase 10, Fatia 2. Só quando origem=bot (webhook, Fatia 4) — segmento manual '
  '(Fatia 1, em uso) continua livre: nunca sai do escritório. Ver §6.2.1 do plano.';
comment on trigger trg_copiloto_exige_decisao_bot_pedido on sessoes_copiloto is
  'Fase 10, Fatia 2. Só quando gravacao_externa_id é setado — é o instante de '
  'pedir o bot (Fatia 4). Ver §6.2.1 do plano.';


-- ===========================================================================
-- Nota de manutenção (fable-orchestrator, Fase 10): o predicado de
-- "consentimento vigente" existe em DUAS cópias — esta função (SQL, 0005) e
-- `temConsentimento()` (TS, src/server/ia/consentimento.ts, usada pelo GATE
-- pré-IA em server/copiloto/gate.ts). Hoje são idênticas. Se a regra de
-- "vigente" mudar aqui um dia (ex.: passar a considerar expiração), o TS
-- precisa mudar JUNTO — senão o gate da rota e a trigger do banco podem
-- decidir coisas diferentes para a mesma pessoa, em silêncio.
-- ===========================================================================
comment on function app.tem_consentimento(uuid, tipo_consentimento) is
  'Consentimento VIGENTE = último registro não revogado daquele tipo. '
  'Replicado em TS por temConsentimento() (src/server/ia/consentimento.ts) — '
  'as DUAS cópias precisam continuar idênticas. Ver nota de manutenção em '
  '0093_copiloto_travas_juridicas.sql.';
