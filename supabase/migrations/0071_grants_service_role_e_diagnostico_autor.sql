-- 0071_grants_service_role_e_diagnostico_autor.sql — dois achados do agente do
-- mock (05/09/2026, `tmp/squad/mock-exemplo.md` §"Achados desta rodada").
-- Aplicar depois da 0070. **Aditiva e idempotente**: nenhum backfill, nenhum
-- UPDATE em dado de cliente, nenhuma tabela nova, nenhum privilégio novo para
-- `authenticated` ou `anon`. Roda duas vezes sem efeito diferente.
--
-- ===========================================================================
-- O QUE ESTA MIGRATION FECHA
-- ===========================================================================
--
-- [A3] `service_role` NÃO conseguia INSERT em `pagamentos`.
--   `app.regua_boas_vindas()` (0011:104) é trigger COMUM (sem `security
--   definer`) e chama `app.enfileirar_mensagem()`, cujo EXECUTE foi revogado
--   de `public, anon, authenticated` na 0013:90 / 0051:694. Como `service_role`
--   herda de PUBLIC e nunca recebeu grant nomeado, ficou sem EXECUTE também.
--   Medido pelo agente do mock: `insert into pagamentos` →
--   `42501 permission denied for function enfileirar_mensagem`.
--
--   Hoje produção escapa por acidente: o webhook chama
--   `public.processar_pagamento_hotmart`, que é `security definer` e roda como
--   o dono. Qualquer escrita direta futura — "registrar pagamento manual" no
--   admin, job de conciliação, seed, reprocessamento — bate no mesmo muro.
--
--   → **A correção primária é a mesma que a 0020 já aplicou às DUAS IRMÃS
--     desta trigger.** A 0020 converteu `app.regua_agendamento()` e
--     `app.regua_pos_sessao()` para `security definer` exatamente por causa
--     deste erro, e deixou `app.regua_boas_vindas()` de fora — o achado A3 é
--     a ponta solta daquela correção. Com `security definer`, o EXECUTE passa
--     a ser avaliado com o privilégio do dono, e a trigger funciona para
--     QUALQUER escritor (service_role, um job futuro, e `authenticated` no dia
--     em que existir policy de INSERT), sem alargar EXECUTE para ninguém.
--
--   → A correção secundária é o `grant execute … to service_role`, para que a
--     porta não dependa de toda trigger da cadeia ser `definer`. **Não é
--     expansão de privilégio na prática:** `service_role` já ignora RLS e já
--     tem `insert` em `mensagens_agendadas`, isto é, já podia enfileirar à mão.
--     O grant só devolve o caminho correto (com idempotência por
--     `chave_idempotencia` e renderização de template) em vez do INSERT cru.
--     `app` não é exposto pelo PostgREST, então isto não cria superfície HTTP.
--
-- [A5] `registrar_diagnostico_sv` é a única RPC da família que ainda exige
--   SESSÃO. O corpo (0058:165) abre com `if not app.ve_patrimonio()`, e a 0061
--   fez `ve_patrimonio()` devolver `coalesce(…, false)`. Sob `service_role` não
--   existe `auth.uid()` ⇒ `false` ⇒ **42501**. Efeito: nenhum job, cron, seed
--   ou script de servidor monta diagnóstico. As irmãs do croqui
--   (`registrar_croqui_calculo`, `fixar_croqui_calculo`, 0069;
--   `registrar_croqui_narrativa`, 0070) já foram convertidas para AUTOR
--   DECLARADO validado por `app.perfil_ve_patrimonio(uuid)`; esta ficou.
--
--   → `p_criado_por uuid default null` no FIM da assinatura, e o gate passa a
--     ter duas fontes, escolhidas por quem chama:
--       · com sessão (`auth.uid()` não nulo): vale `app.ve_patrimonio()` e o
--         autor é o PERFIL DA SESSÃO. `p_criado_por` é **ignorado** — assim
--         nem um admin legítimo consegue carimbar o diagnóstico no nome de
--         outro. É mais estrito que a 0069, e de graça.
--       · sem sessão (`service_role`): `p_criado_por` é OBRIGATÓRIO (22004) e
--         validado contra `perfis_equipe` ativo admin/advogada (42501). O gate
--         de papel não sai do banco — só troca de fonte.
--
--   → **Diferença deliberada em relação à 0069:** lá o EXECUTE de
--     `authenticated` foi REMOVIDO, porque a rota do croqui passou a chamar com
--     `criarClienteAdmin()`. Aqui **`authenticated` continua com EXECUTE**: a
--     rota `POST /api/jornadas/[id]/diagnostico` chama com
--     `criarClienteServidor()` (sessão) depois de `exigirVePatrimonio()`, e
--     tirar o grant quebraria a tela da advogada hoje. Esta migration não muda
--     quem já podia; só passa a atender também quem não conseguia.
--
-- ===========================================================================
-- O QUE ESTA MIGRATION **NÃO** FAZ — A4, de propósito
-- ===========================================================================
-- `processar_pagamento_hotmart` abre jornada NOVA quando a atual está `ganha`
-- (achado A4). É **decisão de produto** (correto para cliente que volta;
-- armadilha em reprocessamento de webhook de jornada encerrada) e está indo ao
-- João pelo orquestrador. Nenhuma linha aqui encosta nessa função.
--
-- ===========================================================================
-- ARMADILHA 6 (sobrecarga) — a razão do `drop function` explícito
-- ===========================================================================
-- `create or replace function` com um parâmetro NOVO **não substitui**: cria
-- uma SEGUNDA sobrecarga, e a chamada por nome fica ambígua em runtime
-- (`feedback_sobrecarga_sql_ambigua`; mesma precaução de 0043, 0051, 0055,
-- 0068 e 0069). Por isso `drop function if exists` da assinatura de 3
-- argumentos ANTES do `create`, e os grants refeitos de zero na assinatura de
-- 4. O passo 4 do roteiro é o teste de regressão disto.
--
-- ORDEM DOS PARÂMETROS: `p_criado_por` entra no FIM, com default. Toda chamada
-- posicional de 3 argumentos que já existe continua válida — o chamador TS
-- (`src/server/diagnostico/index.ts`, args nomeados),
-- `scripts/verificacao-0061.sql:176` e o seed. Compatibilidade preservada.
--
-- ===========================================================================
-- PRIVILÉGIO: `revoke all` ANTES do `grant` (lição da 0065b)
-- ===========================================================================
-- `create function` em `public` dá EXECUTE a PUBLIC por padrão, e o
-- `alter default privileges` do projeto Supabase ainda alcança `authenticated`.
-- Um `grant` sem o `revoke` anterior não restringe NADA. O passo 3 do roteiro
-- confere `proacl` sem `=X/` (PUBLIC) e sem `anon=X/`.
--
-- ===========================================================================
-- REVERSÃO COMPLETA (copiar e colar; volta ao estado da 0070)
-- ===========================================================================
--   -- 1. A3: trigger de boas-vindas volta a ser comum (e volta a quebrar sob
--   --    escrita direta — é o estado da 0011).
--   create or replace function app.regua_boas_vindas() returns trigger
--   language plpgsql as $$
--   declare v_tipo produto_tipo; v_pessoa record;
--   begin
--     if new.status <> 'aprovado' or new.jornada_id is null then return new; end if;
--     select p.tipo into v_tipo from produtos p where p.id = new.produto_id;
--     if v_tipo is distinct from 'sessao_viabilidade' then return new; end if;
--     select nome, email, telefone into v_pessoa from pessoas where id = new.pessoa_id;
--     perform app.enfileirar_mensagem(new.jornada_id, null, 'boas_vindas', 'email',
--       coalesce(v_pessoa.email, new.comprador_email), now(),
--       coalesce(v_pessoa.nome, new.comprador_nome), null, null);
--     perform app.enfileirar_mensagem(new.jornada_id, null, 'boas_vindas', 'whatsapp',
--       coalesce(v_pessoa.telefone, new.comprador_telefone), now(),
--       coalesce(v_pessoa.nome, new.comprador_nome), null, null);
--     return new;
--   end $$;
--   revoke execute on function app.enfileirar_mensagem(
--     uuid, uuid, text, canal_mensagem, text, timestamptz, text, text, text) from service_role;
--
--   -- 2. A5: assinatura de 3 argumentos da 0058 de volta.
--   drop function if exists public.registrar_diagnostico_sv(uuid, uuid, jsonb, uuid);
--   -- recriar o corpo EXATO de supabase/migrations/0058_diagnostico_sv.sql
--   -- (linhas 154-190), que lê `auth.uid()`, e refazer:
--   --   revoke execute on function public.registrar_diagnostico_sv(uuid, uuid, jsonb) from public, anon;
--   --   grant  execute on function public.registrar_diagnostico_sv(uuid, uuid, jsonb) to authenticated, service_role;
--   -- Nenhuma linha de `diagnosticos_sv` é tocada por esta migration nem pela reversão.
--
-- ===========================================================================
-- ROTEIRO DE VERIFICAÇÃO — harness runnável em `scripts/verificacao-0071.sql`
-- (transacional, tabela `resultado_0071`, nenhuma fixture sobrevive)
-- ===========================================================================
--   0. PRÉ (antes de aplicar; guardar as saídas):
--        select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--         where n.nspname='public' and p.proname='registrar_diagnostico_sv';
--        -- esperado 1. Se der 2+, já existe sobrecarga: derrube TODAS e reaplique.
--        select count(*) from diagnosticos_sv;
--        select count(*) from pagamentos;
--        select count(*) from mensagens_agendadas;
--   1. `app.regua_boas_vindas` é `security definer` com `search_path` fixo, e
--      `service_role` executa `app.enfileirar_mensagem`.
--   2. INSERT de `pagamentos` como `service_role` (produto `sessao_viabilidade`,
--      status `aprovado`) NÃO levanta 42501 e enfileira as boas-vindas.
--      É a prova do A3 fechado — a mesma operação que devolvia 42501.
--   3. Privilégio: `anon` fora das duas funções; `authenticated` fora de
--      `app.enfileirar_mensagem` (não pode ter voltado) e DENTRO de
--      `registrar_diagnostico_sv` (não pode ter saído).
--   4. UMA assinatura de `registrar_diagnostico_sv`, com 4 argumentos.
--   5. Sob `service_role`: `p_criado_por` nulo → 22004, NENHUMA linha gravada;
--      `p_criado_por` de perfil `relacionamento`/inativo → 42501, NENHUMA linha;
--      `p_criado_por` de admin/advogada ativo → grava, `criado_por` = o perfil.
--      É a prova do A5 fechado.
--   6. Chamada POSICIONAL de 3 argumentos continua resolvendo (compatibilidade
--      de `verificacao-0061.sql` e do chamador TS).
--   7. Contagem de `diagnosticos_sv`, `pagamentos` e `mensagens_agendadas`
--      idêntica ao passo 0.
--   8. Informativo (a CLASSE do A3, não só o sintoma): lista as funções de
--      `app` chamadas por trigger que seguem sem EXECUTE para `service_role`.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. [A3] `app.regua_boas_vindas()` — mesma lógica, agora `security definer`.
--
--    LÓGICA INALTERADA, linha por linha, em relação a 0011:104-120. O que muda
--    é só o cabeçalho: `security definer set search_path = public, pg_temp`.
--    `search_path` fixo é obrigatório em toda função `definer` (senão o dono
--    resolve nomes pelo caminho de quem chamou) — mesma regra da 0020.
--
--    Superfície: `pagamentos` tem só a policy `pag_sel` (SELECT, 0011:246) e a
--    0065c revogou INSERT de `authenticated` em toda tabela sem policy de
--    INSERT. Logo `authenticated` não dispara esta trigger, e tornar a função
--    `definer` não abre caminho novo para sessão de usuário — abre para o
--    servidor, que é o ponto.
-- ---------------------------------------------------------------------------
create or replace function app.regua_boas_vindas() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_tipo produto_tipo; v_pessoa record;
begin
  if new.status <> 'aprovado' or new.jornada_id is null then return new; end if;
  select p.tipo into v_tipo from produtos p where p.id = new.produto_id;
  if v_tipo is distinct from 'sessao_viabilidade' then return new; end if;
  select nome, email, telefone into v_pessoa from pessoas where id = new.pessoa_id;
  perform app.enfileirar_mensagem(new.jornada_id, null, 'boas_vindas', 'email',
    coalesce(v_pessoa.email, new.comprador_email), now(),
    coalesce(v_pessoa.nome, new.comprador_nome), null, null);
  perform app.enfileirar_mensagem(new.jornada_id, null, 'boas_vindas', 'whatsapp',
    coalesce(v_pessoa.telefone, new.comprador_telefone), now(),
    coalesce(v_pessoa.nome, new.comprador_nome), null, null);
  return new;
end $$;

comment on function app.regua_boas_vindas() is
  'Enfileira as boas-vindas quando um pagamento de Sessão de Viabilidade é aprovado. '
  'SECURITY DEFINER desde a 0071 pelo MESMO motivo da 0020 (que corrigiu as irmãs '
  'regua_agendamento e regua_pos_sessao e deixou esta de fora): sem definer, o EXECUTE de '
  'app.enfileirar_mensagem é avaliado no role de quem escreveu em `pagamentos`, e toda '
  'escrita direta morre com 42501 (achado A3, tmp/squad/mock-exemplo.md).';

-- O trigger continua o mesmo objeto (`create or replace function` não o
-- recria); nenhum `create trigger` aqui, de propósito — repetir criaria um
-- segundo trigger com nome diferente ou falharia com "already exists".


-- ---------------------------------------------------------------------------
-- 2. [A3] `app.enfileirar_mensagem` — EXECUTE nomeado para `service_role`.
--
--    O `revoke` vem ANTES e é reafirmação, não mudança: `public, anon,
--    authenticated` continuam fora (0013:90, 0051:694). Repetir aqui é o que
--    torna o arquivo auto-contido — quem lê a 0071 vê o estado final inteiro,
--    sem precisar reconstruir a história em três migrations.
--
--    `service_role` não ganha capacidade nova: já ignora RLS e já tem INSERT em
--    `mensagens_agendadas`. Ganha o caminho CORRETO — com template renderizado
--    e `chave_idempotencia` — em vez do INSERT cru.
--
--    Assinatura única (0013:58 e 0051:660 são a MESMA; a 0051 substituiu, não
--    sobrecarregou). O passo 1 do roteiro confere que continua sendo uma só.
-- ---------------------------------------------------------------------------
revoke execute on function app.enfileirar_mensagem(
  uuid, uuid, text, canal_mensagem, text, timestamptz, text, text, text)
  from public, anon, authenticated;
grant execute on function app.enfileirar_mensagem(
  uuid, uuid, text, canal_mensagem, text, timestamptz, text, text, text)
  to service_role;


-- ---------------------------------------------------------------------------
-- 3. [A5] `registrar_diagnostico_sv` — autor declarado, como as irmãs.
--
--    Drop explícito da assinatura de 3 argumentos: armadilha 6.
-- ---------------------------------------------------------------------------
drop function if exists public.registrar_diagnostico_sv(uuid, uuid, jsonb);

create or replace function public.registrar_diagnostico_sv(
  p_jornada_id uuid,
  p_analise_id uuid,
  p_blocos     jsonb,
  p_criado_por uuid default null
) returns diagnosticos_sv
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_versao    smallint;
  v_linha     diagnosticos_sv;
  v_perfil_id uuid;
begin
  -- Duas fontes para a MESMA pergunta ("quem está montando vê patrimônio?"),
  -- escolhidas por quem chama. Nunca as duas ao mesmo tempo.
  if auth.uid() is not null then
    -- Caminho da tela (rota POST /api/jornadas/[id]/diagnostico com
    -- criarClienteServidor). `coalesce(..., false)`: `if not NULL then` em
    -- plpgsql NÃO entra no `then` — foi assim que a 0061 achou um intruso
    -- gravando linha.
    if not coalesce(app.ve_patrimonio(), false) then
      raise exception 'sem_permissao: só admin/advogada monta o diagnóstico' using errcode = '42501';
    end if;
    -- O autor é a SESSÃO, sempre. `p_criado_por` é ignorado de propósito:
    -- nem um admin legítimo assina o diagnóstico no nome de outra pessoa.
    select id into v_perfil_id from perfis_equipe
     where auth_user_id = auth.uid() and ativo limit 1;
  else
    -- Caminho do servidor (service_role: job, cron, seed, script). Sem
    -- `auth.uid()`, o gate de papel só existe se o autor for declarado.
    if p_criado_por is null then
      raise exception 'criado_por_ausente: informe o perfil de quem está montando o diagnóstico'
        using errcode = '22004';
    end if;
    if not coalesce(app.perfil_ve_patrimonio(p_criado_por), false) then
      raise exception 'sem_permissao: só admin/advogada ativo monta o diagnóstico' using errcode = '42501';
    end if;
    v_perfil_id := p_criado_por;
  end if;

  -- Daqui para baixo, idêntico à 0058: mesmas validações, mesma troca atômica
  -- do `atual`, mesma numeração de versão. Nada de negócio mudou.
  if not exists (select 1 from jornadas where id = p_jornada_id) then
    raise exception 'jornada_nao_encontrada: %', p_jornada_id using errcode = 'P0002';
  end if;
  if p_analise_id is not null and not exists (
       select 1 from croqui_analises a join croquis c on c.id = a.croqui_id
        where a.id = p_analise_id and c.jornada_id = p_jornada_id) then
    raise exception 'analise_de_outra_jornada: %', p_analise_id using errcode = '23514';
  end if;
  if not app.blocos_diagnostico_validos(p_blocos) then
    raise exception 'blocos_invalidos: forma dos blocos do diagnóstico inválida' using errcode = '23514';
  end if;

  update diagnosticos_sv set atual = false where jornada_id = p_jornada_id and atual;
  select coalesce(max(versao), 0) + 1 into v_versao from diagnosticos_sv where jornada_id = p_jornada_id;

  insert into diagnosticos_sv (jornada_id, versao, analise_id, blocos, atual, criado_por, atualizado_por)
  values (p_jornada_id, v_versao, p_analise_id, p_blocos, true, v_perfil_id, v_perfil_id)
  returning * into v_linha;

  return v_linha;
end $$;

revoke all on function public.registrar_diagnostico_sv(uuid, uuid, jsonb, uuid)
  from public, anon;
grant execute on function public.registrar_diagnostico_sv(uuid, uuid, jsonb, uuid)
  to authenticated, service_role;

comment on function public.registrar_diagnostico_sv(uuid, uuid, jsonb, uuid) is
  'Grava versão nova do Diagnóstico da SV, trocando o `atual` na mesma transação. '
  'Com sessão: exige app.ve_patrimonio() e o autor é o perfil da sessão (p_criado_por é '
  'IGNORADO — não se assina no nome de outro). Sem sessão (service_role): p_criado_por é '
  'obrigatório e validado por app.perfil_ve_patrimonio, como as RPCs de croqui da 0069/0070. '
  'Antes da 0071 esta era a única da família que respondia 42501 sob service_role, e nenhum '
  'job montava diagnóstico (achado A5, tmp/squad/mock-exemplo.md).';
