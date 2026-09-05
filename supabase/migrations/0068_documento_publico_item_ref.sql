-- 0068_documento_publico_item_ref.sql — Fase 5 · costura C1 (05/09/2026).
-- Aplicar depois da 0065 (que criou `documentos.item_ref` e alargou
-- `documentos.tipo` para 10 valores) e da 0066. Aditivo. Nenhum backfill,
-- nenhum UPDATE em dado de cliente, nenhuma linha alterada.
--
-- ===========================================================================
-- O QUE É
-- ===========================================================================
-- O link público de documentos (`/p/d`) nasceu na 0028 pedindo TRÊS tipos
-- fixos (`imposto_renda`, `contrato_social`, `matricula_imovel`) e gravando
-- sem `item_ref`. Depois da 0065 isso passou a ter uma consequência concreta:
-- o radar (§8.3) casa documento com item por `item_ref` EXATO ou não casa
-- (`src/lib/radar/derivar.ts#acharDocumento` — distribuir "3 matrículas
-- soltas" entre 3 imóveis marcaria o imóvel ERRADO como resolvido). Resultado:
-- a família com três imóveis mandava três matrículas pelo link e os três
-- imóveis continuavam `a_pedir` para sempre.
--
-- Esta migration fecha os dois buracos do lado do banco:
--
--   (a) `registrar_documento_publico` aceita `p_item_ref` — e o VALIDA contra a
--       jornada do próprio link. O item precisa ser um `patrimonio_itens` ou um
--       `familiares` ATIVO da pessoa daquela jornada. Qualquer outra coisa
--       (uuid de outro cliente, uuid inventado, string que não é uuid) grava
--       NULL e deixa um `warning` no log do Postgres. **Nunca** confia no
--       valor que chegou; nunca levanta erro que vaze a existência do id.
--
--   (b) o `check` de tipo dentro da RPC vai de 4 para os 10 valores da 0065.
--       Sem isso, o CRLV, a certidão de casamento, o extrato e o comprovante de
--       residência que o radar PEDE não podiam ser enviados pelo link — o
--       cliente recebia `arquivo_invalido` e o item ficava `a_pedir` para
--       sempre, mesmo com o cliente tendo mandado o arquivo.
--
-- A LISTA do que se pede continua NÃO morando aqui. `app.payload_link_documentos`
-- segue existindo como fallback; quem monta a lista de verdade é o radar, em
-- código puro, servido por `GET /api/publico/[token]`
-- (`src/server/publico/documentos-pedidos.ts`). Uma lista só de "o que falta"
-- para o mesmo cliente, na Ficha e no link.
--
-- ARMADILHA 6 (assinatura nova): `create or replace function` com um parâmetro
-- novo NÃO substitui a função — cria uma SEGUNDA sobrecarga, e a chamada por
-- nome fica ambígua em runtime (a lição de `feedback_sobrecarga_sql_ambigua`).
-- Por isso `drop function` da assinatura antiga ANTES do create, e os grants
-- refeitos de zero na assinatura nova.
--
-- ORDEM DOS PARÂMETROS: `p_item_ref` entra no FIM, depois de `p_user_agent`.
-- Assim toda chamada posicional existente continua válida e a chamada nomeada
-- do PostgREST não muda de forma.
--
-- ===========================================================================
-- REVERSÃO COMPLETA (copiar e colar; volta ao estado da 0028)
-- ===========================================================================
--   drop function if exists public.registrar_documento_publico(
--     text, text, text, text, text, bigint, text, text, text, text);
--
--   create or replace function public.registrar_documento_publico(
--     p_hash text, p_tipo text, p_nome text, p_caminho text, p_mime text,
--     p_bytes bigint, p_sha256 text, p_ip_hash text default null, p_user_agent text default null
--   ) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $rev$
--   ... (corpo idêntico ao da 0028, linhas 733-800) ...
--   $rev$;
--   revoke all on function public.registrar_documento_publico(
--     text, text, text, text, text, bigint, text, text, text) from public, anon, authenticated;
--   grant execute on function public.registrar_documento_publico(
--     text, text, text, text, text, bigint, text, text, text) to anon;
--
--   -- os documentos já gravados com item_ref continuam válidos; para zerar:
--   --   update documentos set item_ref = null where item_ref is not null;  -- NÃO recomendado
--
-- ===========================================================================
-- ROTEIRO DE VERIFICAÇÃO (harness runnável em scripts/verificacao-0063-0068.sql;
-- transacional, cada passo termina em `raise 'rollback_proposital'`)
-- ===========================================================================
--
--  0. PRÉ (antes de aplicar):
--       select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--        where n.nspname='public' and p.proname='registrar_documento_publico';
--       -- esperado 1. Se der 2, alguém já criou a sobrecarga: derrube as duas
--       -- e recrie só esta.
--       select count(*), count(item_ref) from documentos;   -- guardar a saída
--
--  1. Continua existindo UMA função só, com 10 parâmetros:
--       select p.pronargs, pg_get_function_identity_arguments(p.oid)
--         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--        where n.nspname='public' and p.proname='registrar_documento_publico';
--       -- esperado: 1 linha, pronargs = 10.
--
--  2. Privilégio: `anon` executa, mais ninguém.
--       select p.proacl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--        where n.nspname='public' and p.proname='registrar_documento_publico';
--       -- esperado: contém 'anon=X/postgres'; NÃO contém '=X/' (PUBLIC)
--       --           e NÃO contém 'authenticated=X/'.
--
--  3. `item_ref` de OUTRA jornada vira NULL (o teste que dá nome a esta
--     migration): emitir link de documentos para a jornada A, chamar a RPC
--     passando `p_item_ref` = id de um `patrimonio_itens` da pessoa B.
--       -> retorna {"ok": true, ...}
--       -> `select item_ref from documentos where sha256 = ...` => NULL
--       -> log do Postgres tem o `warning`.
--
--  4. `item_ref` da PRÓPRIA jornada grava:
--       -> `select item_ref from documentos where sha256 = ...` => o uuid passado.
--
--  5. `item_ref` que não é uuid ('cofre', 'a; drop table') vira NULL, sem erro.
--
--  6. Tipo novo da 0065 passa (`crlv`), tipo inventado é recusado:
--       -> {"erro": "arquivo_invalido"} e NENHUMA linha em `documentos`.
--
--  7. Contagem de `documentos` idêntica ao passo 0 (esta migration não escreve
--     em dado de cliente).
--
--  8. Regressão: chamada SEM `p_item_ref` (a forma da 0028) continua gravando,
--     com `item_ref` NULL.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Fora a assinatura antiga (armadilha 6: `create or replace` criaria uma
--    segunda sobrecarga e a chamada nomeada ficaria ambígua).
-- ---------------------------------------------------------------------------
drop function if exists public.registrar_documento_publico(
  text, text, text, text, text, bigint, text, text, text);

-- ---------------------------------------------------------------------------
-- 2. A assinatura nova.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_documento_publico(
  p_hash text, p_tipo text, p_nome text, p_caminho text, p_mime text, p_bytes bigint, p_sha256 text,
  p_ip_hash text default null, p_user_agent text default null, p_item_ref text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_link      links_publicos;
  v_jornada   jornadas%rowtype;
  v_item_uuid uuid;
  v_item_ref  text := null;
  v_item_ok   boolean := false;
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

  -- 'arquivo_invalido' é o código do F-1A (src/types/publico.ts) para todo
  -- problema de arquivo — tipo, mime, tamanho. Tipo é validado aqui; mime e
  -- tamanho já foram validados na rota antes do upload.
  --
  -- A lista é a MESMA de `ck_documentos_tipo` (0065). Antes desta migration
  -- eram só os 4 originais, e os 6 que o radar pede (CRLV, certidões, extrato,
  -- balanço, comprovante de residência) eram recusados no link público — o
  -- cliente mandava o arquivo certo e recebia "arquivo inválido".
  if p_tipo not in (
    'imposto_renda', 'contrato_social', 'matricula_imovel',
    'certidao_casamento', 'certidao_nascimento', 'crlv',
    'extrato_investimento', 'balanco', 'comprovante_residencia', 'outro'
  ) then
    perform app.registrar_acesso_publico(v_link.id, 'enviar_documento', 'erro', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'arquivo_invalido');
  end if;

  -- 5 arquivos por link (§2.4). `usos` também conta remarcação/formulário noutros
  -- tipos de link — aqui só cresce por documento, porque cada link é de um tipo só.
  if v_link.usos >= 5 then
    perform app.registrar_acesso_publico(v_link.id, 'enviar_documento', 'limite', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'limite_arquivos_atingido');
  end if;

  select * into v_jornada from jornadas where id = v_link.jornada_id;

  -- -------------------------------------------------------------------------
  -- `item_ref`: a qual bem/familiar este documento pertence.
  --
  -- A rota já resolve o item a partir do radar do SERVIDOR (o navegador manda
  -- uma chave opaca, não um id). Isto aqui é a SEGUNDA trava, e ela existe
  -- porque a primeira mora fora do banco: se amanhã outro chamador passar um
  -- uuid vindo do cliente, o item continua tendo de pertencer à pessoa da
  -- jornada DESTE link.
  --
  -- Falha em NULL, nunca em erro: erro diria ao chamador anônimo se aquele uuid
  -- existe ou não (oráculo de existência), e derrubaria um upload legítimo por
  -- causa de um campo acessório. NULL é o estado seguro — o radar simplesmente
  -- não casa o documento com nenhum item, que é exatamente o comportamento de
  -- antes desta migration.
  -- -------------------------------------------------------------------------
  if p_item_ref is not null and p_item_ref <> '' then
    -- Regex antes do cast: `'cofre'::uuid` levantaria 22P02 e derrubaria a RPC.
    if p_item_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_item_uuid := p_item_ref::uuid;
      select exists (
               select 1 from patrimonio_itens
                where id = v_item_uuid and pessoa_id = v_jornada.pessoa_id and ativo
             )
             or exists (
               select 1 from familiares
                where id = v_item_uuid and pessoa_id = v_jornada.pessoa_id and ativo
             )
        into v_item_ok;
    end if;

    if v_item_ok then
      v_item_ref := p_item_ref;
    else
      -- Log do servidor, não resposta ao cliente. Se isto aparecer, ou a rota
      -- está resolvendo o item errado, ou alguém está sondando ids.
      raise warning 'registrar_documento_publico: item_ref % nao pertence a jornada % — gravando NULL',
        p_item_ref, v_jornada.id;
    end if;
  end if;

  begin
    insert into documentos (
      pessoa_id, jornada_id, tipo, item_ref, nome_arquivo, caminho, mime, tamanho_bytes, sha256, origem, enviado_por
    )
    values (
      v_jornada.pessoa_id, v_jornada.id, p_tipo, v_item_ref, p_nome, p_caminho, p_mime, p_bytes, p_sha256, 'cliente', null
    );
  exception when unique_violation then
    -- `uniq_documentos_jornada_sha256`: mesmo arquivo, mesma jornada, de novo.
    perform app.registrar_acesso_publico(v_link.id, 'enviar_documento', 'erro', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'arquivo_duplicado');
  end;

  update links_publicos set usos = usos + 1 where id = v_link.id;

  perform app.registrar_acesso_publico(v_link.id, 'enviar_documento', 'ok', p_ip_hash, p_user_agent);

  -- Nunca `documento_id` nem `item_ref` na resposta pública (regra dura 4,
  -- §2.2) — só o que o cliente já podia ver na lista `recebidos` do payload.
  return jsonb_build_object('ok', true, 'documento', jsonb_build_object(
    'tipo', p_tipo, 'nome_arquivo', p_nome, 'enviado_em', now()
  ));
end $$;

-- ---------------------------------------------------------------------------
-- 3. Privilégios: revogar TUDO primeiro, conceder um por um.
--
--    `create function` em `public` dá EXECUTE a PUBLIC por padrão, e no
--    Supabase o `alter default privileges` do projeto ainda alcança
--    `authenticated`. A 0065b existe exatamente porque um `grant` sem o
--    `revoke` anterior não restringe nada. Aqui: revoke de public, anon E
--    authenticated, e só depois o grant nomeado.
--
--    `anon` é o único: esta é uma das cinco RPCs públicas do banco. Um usuário
--    logado que queira gravar documento usa `POST /api/documentos`, que passa
--    por `exigirVePatrimonio` e pela RLS de `documentos`.
-- ---------------------------------------------------------------------------
revoke all on function public.registrar_documento_publico(
  text, text, text, text, text, bigint, text, text, text, text) from public, anon, authenticated;

grant execute on function public.registrar_documento_publico(
  text, text, text, text, text, bigint, text, text, text, text) to anon;

comment on function public.registrar_documento_publico(
  text, text, text, text, text, bigint, text, text, text, text) is
  'RPC pública do /p/d. `p_item_ref` é VALIDADO contra a pessoa da jornada do link '
  '(patrimonio_itens/familiares ativos); qualquer outra coisa grava NULL e deixa warning '
  'no log — nunca erro, para não virar oráculo de existência de id. 0068.';

comment on function app.payload_link_documentos(links_publicos, jornadas) is
  'FALLBACK. A lista de documentos pedidos passou a ser derivada do radar (§8.3) em '
  'src/server/publico/documentos-pedidos.ts e servida por GET /api/publico/[token]. '
  'Esta função só é usada quando o servidor não consegue derivar o radar (sem '
  'service_role, sem a 0065) — e aí devolve os 3 tipos fixos de sempre. 0068.';
