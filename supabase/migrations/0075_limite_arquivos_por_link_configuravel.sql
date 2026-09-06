-- 0075_limite_arquivos_por_link_configuravel.sql
-- Fase 7 (06/09/2026) — UMA fonte só para "quantos arquivos cabem num link de
-- documentos". NÃO aplicada por este agente: o orquestrador aplica e roda
-- `scripts/verificacao-0075.sql`.
--
-- ## O defeito que esta migration corrige
--
-- Em 06/09 o limite foi "mudado" de 5 para 10 — mas só no TypeScript
-- (`src/server/publico/documento.ts:28`, usado como pré-checagem em
-- `src/app/api/publico/[token]/documento/route.ts`). O banco continuou em 5 em
-- DOIS lugares, e o banco é quem manda:
--
--   (a) `app.payload_link_documentos` (0028:461) devolve `'limite_arquivos', 5`
--       no payload de `abrir_link_publico` — é ESSE número que a página do
--       cliente mostra (`src/components/publico/DocumentosPublico.tsx:200,230,237`:
--       "Até N arquivos no total" e o bloqueio do formulário);
--   (b) `registrar_documento_publico` (0068:172) recusa com
--       `limite_arquivos_atingido` quando `v_link.usos >= 5`.
--
-- Resultado medido: o cliente lia "até 5", o TypeScript deixava passar o 6º, o
-- upload ao Storage acontecia e a RPC recusava — a rota apagava o objeto e o
-- cliente recebia um erro que a própria tela dizia não existir. A decisão de
-- 06/09 era inerte.
--
-- ## A forma da correção
--
-- O número deixa de ser literal em três arquivos e passa a ser UMA chave de
-- `configuracoes`, lida por UMA função. Não é "configuração pela configuração":
-- o teto é uma regra de negócio que a Dra. Elaine ajusta (o radar da Fase 6
-- pede 10+ documentos por família, e famílias com muitos imóveis pedem mais),
-- e hoje mudá-lo exigia migration + deploy do Next em sincronia.
--
--   configuracoes['link.limite_arquivos']  ->  app.limite_arquivos_por_link()
--       |                                              |
--       |                                              +-- app.payload_link_documentos  (o que o cliente LÊ)
--       |                                              +-- registrar_documento_publico  (o que o banco APLICA)
--       |
--       +-- src/server/publico/documento.ts#limiteArquivosPorLink (pré-checagem barata da rota)
--
-- ## O código funciona SEM esta migration
--
-- `limiteArquivosPorLink` cai no fallback 10 quando a chave não existe. Nesse
-- estado o TypeScript deixa passar o 6º arquivo e é a RPC que recusa — ou seja,
-- SEM a 0075 o comportamento é exatamente o de hoje (limite real de 5, tela
-- dizendo 5), nunca pior. Com a 0075, os três pontos dizem 10.
--
-- ## O que esta migration NÃO faz, de propósito
--
--   - Não mexe em `links_publicos.usos` nem em nada de dado de cliente: ela só
--     redefine duas funções e insere uma linha de configuração.
--   - Não altera a assinatura de `registrar_documento_publico`. A da 0068
--     (10 argumentos) é mantida byte a byte — é RPC pública `security definer`
--     com EXECUTE de `anon`, e qualquer mudança de forma aqui é buraco. O
--     `drop function` da assinatura ANTIGA (9 argumentos, a da 0028) é repetido
--     por precaução contra a armadilha da sobrecarga ambígua; se a 0068 já
--     rodou, ele não encontra nada e não faz nada.
--   - Não toca `app.limite_token_ok`/`limite_rota_ok` (rate limit por minuto/dia
--     é outro teto, outra chave, `link.limite_por_minuto`).


-- ===========================================================================
-- 1. A chave. UPSERT QUE NÃO SOBRESCREVE valor existente (`do nothing`): se a
--    Dra. Elaine já tiver ajustado o número em Admin, reaplicar a migration não
--    pode desfazer a escolha dela.
-- ===========================================================================
insert into configuracoes (chave, valor, descricao) values
 ('link.limite_arquivos', '10'::jsonb,
  'Quantos arquivos o cliente pode enviar por link de documentos. 5 -> 10 em 06/09/2026: o radar de documentos (Fase 6, §8.3) pede 10+ arquivos numa família com imóveis, empresa e veículos, e o teto de 5 recusava envio legítimo. Inteiro entre 1 e 50; fora disso, ou ausente, vale 10. Lido por app.limite_arquivos_por_link() — que é a fonte tanto do que a página do cliente MOSTRA quanto do que a RPC APLICA.')
on conflict (chave) do nothing;


-- ===========================================================================
-- 2. A função. `stable`, `search_path` fixo, e — o ponto — INCAPAZ DE LEVANTAR
--    EXCEÇÃO.
--
--    `configuracoes.valor` é jsonb e a tela de Admin é quem escreve nele. Um
--    `(valor #>> '{}')::int` cru levantaria 22P02 diante de `"dez"` ou de um
--    objeto — dentro de `registrar_documento_publico`, isso derrubaria o upload
--    do cliente por causa de um campo de configuração digitado errado.
--
--    Por isso: filtra por `jsonb_typeof(valor) = 'number'` (o cast para numeric
--    só acontece quando o jsonb JÁ é número), e só depois valida inteiro e
--    faixa. Qualquer coisa fora de 1..50 — inclusive 10.5, 0, -3 e 1e9 — cai no
--    default 10. Ausente cai no default 10. Nunca NULL, nunca erro.
-- ===========================================================================
create or replace function app.limite_arquivos_por_link() returns int
language sql stable set search_path = public, pg_temp as $$
  select case
           when t.n is not null and t.n = trunc(t.n) and t.n between 1 and 50
           then t.n::int
           else 10
         end
    from (
      select (select (valor #>> '{}')::numeric
                from configuracoes
               where chave = 'link.limite_arquivos'
                 and jsonb_typeof(valor) = 'number') as n
    ) t
$$;

-- Ninguém chama esta função de fora: os dois chamadores são `security definer`
-- e rodam como dono. `revoke` antes de qualquer coisa (lição da 0065b: grant sem
-- revoke não restringe nada) e NENHUM grant nomeado — `anon` sequer tem USAGE no
-- schema `app` (0074, passo 4).
revoke all on function app.limite_arquivos_por_link() from public, anon, authenticated;

comment on function app.limite_arquivos_por_link() is
  'Teto de arquivos por link de documentos. Lê configuracoes[''link.limite_arquivos''] '
  '(inteiro 1..50); ausente ou inválido vale 10. Fonte única do número que a página do '
  'cliente mostra (app.payload_link_documentos) e do que a RPC aplica '
  '(registrar_documento_publico). 0075.';


-- ===========================================================================
-- 3. `app.payload_link_documentos` — o número que o CLIENTE LÊ.
--    Corpo idêntico ao da 0028:437-465 (nenhuma migration posterior a
--    redefiniu; a 0068 só trocou o `comment`). Única mudança: o literal 5 do
--    campo `limite_arquivos` vira a chamada da função.
-- ===========================================================================
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
    'limite_arquivos', app.limite_arquivos_por_link(),
    'tamanho_maximo_mb', 20,
    'extensoes_aceitas', jsonb_build_array('pdf', 'jpg', 'jpeg', 'png')
  );
end $$;

-- A 0068 já explicou por que esta função é FALLBACK (a lista de pedidos vem do
-- radar, em `src/server/publico/documentos-pedidos.ts`). O `comment` é repetido
-- porque `create or replace` mantém o anterior, e repetir é mais barato que
-- depender disso.
comment on function app.payload_link_documentos(links_publicos, jornadas) is
  'FALLBACK. A lista de documentos pedidos passou a ser derivada do radar (§8.3) em '
  'src/server/publico/documentos-pedidos.ts e servida por GET /api/publico/[token]. '
  'Esta função só é usada quando o servidor não consegue derivar o radar (sem '
  'service_role, sem a 0065) — e aí devolve os 3 tipos fixos de sempre. 0068. '
  '`limite_arquivos` vem de app.limite_arquivos_por_link() desde a 0075.';


-- ===========================================================================
-- 4. `registrar_documento_publico` — o número que o BANCO APLICA.
--
--    Corpo idêntico ao da 0068:125-239 (nenhuma migration posterior a
--    redefiniu — a 0069 e a 0074 só a citam em comentário). Únicas mudanças: o
--    comentário "5 arquivos por link" e `v_link.usos >= 5` viram a função.
--    Assinatura, `security definer`, `search_path`, ordem das travas, códigos
--    de erro e resposta: tudo igual.
--
--    O `drop` abaixo é da assinatura de 9 argumentos (a da 0028), não da atual.
--    Se a 0068 rodou, não existe mais e o comando é no-op. Se por algum motivo
--    ela não rodou, isto evita as DUAS sobrecargas coexistindo e a chamada do
--    PostgREST ficando ambígua (armadilha catalogada, 0068:52 e 0071:83).
-- ===========================================================================
drop function if exists public.registrar_documento_publico(
  text, text, text, text, text, bigint, text, text, text);

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

  -- Teto de arquivos por link (§2.4), configurável desde a 0075:
  -- `configuracoes['link.limite_arquivos']`, default 10. `usos` também conta
  -- remarcação/formulário noutros tipos de link — aqui só cresce por documento,
  -- porque cada link é de um tipo só. A função nunca levanta exceção: valor
  -- ausente ou inválido vira 10, jamais NULL (`usos >= NULL` é NULL, e
  -- `if not NULL` em plpgsql é false — seria fail-OPEN, sem teto nenhum).
  if v_link.usos >= app.limite_arquivos_por_link() then
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
-- 5. Privilégios reafirmados, na MESMA ordem e com a MESMA forma da 0068.
--
--    `create or replace function` PRESERVA a ACL existente — ou seja, isto é
--    reafirmação, não mudança. Está aqui porque o roteiro compara `proacl`
--    antes e depois: o valor tem de ser idêntico, e a forma mais segura de
--    garantir isso é reescrevê-lo exatamente como estava.
--
--    `anon` é o único: esta é uma das cinco RPCs públicas do banco.
-- ---------------------------------------------------------------------------
revoke all on function public.registrar_documento_publico(
  text, text, text, text, text, bigint, text, text, text, text) from public, anon, authenticated;

grant execute on function public.registrar_documento_publico(
  text, text, text, text, text, bigint, text, text, text, text) to anon;

comment on function public.registrar_documento_publico(
  text, text, text, text, text, bigint, text, text, text, text) is
  'RPC pública do /p/d. `p_item_ref` é VALIDADO contra a pessoa da jornada do link '
  '(patrimonio_itens/familiares ativos); qualquer outra coisa grava NULL e deixa warning '
  'no log — nunca erro, para não virar oráculo de existência de id. 0068. O teto de '
  'arquivos por link vem de app.limite_arquivos_por_link() desde a 0075.';


-- ===========================================================================
-- ROTEIRO DE VERIFICAÇÃO: scripts/verificacao-0075.sql (idempotente, com
-- `raise exception` em falha). O orquestrador aplica esta migration e roda o
-- roteiro; nenhum agente aplica migration.
--
-- REVERSÃO (volta ao estado da 0028/0068, com o teto cravado em 5):
--   -- 1. reaplicar o corpo de app.payload_link_documentos da 0028:437-465
--   --    (com 'limite_arquivos', 5) e o de registrar_documento_publico da
--   --    0068:125-239 (com `if v_link.usos >= 5`);
--   -- 2. drop function if exists app.limite_arquivos_por_link();
--   -- 3. delete from configuracoes where chave = 'link.limite_arquivos';
-- Reverter NÃO perde dado: nenhuma linha de cliente é tocada por esta migration.
-- O que se perde é o número que a Dra. Elaine tiver ajustado em Admin.
--
-- MENOS INVASIVO que reverter, se o teto novo incomodar: mudar o VALOR da chave
-- (`update configuracoes set valor = '5'::jsonb where chave = 'link.limite_arquivos'`)
-- — os três pontos passam a dizer 5 no mesmo instante, sem deploy.
-- ===========================================================================
