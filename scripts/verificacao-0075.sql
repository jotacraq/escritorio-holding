-- scripts/verificacao-0075.sql — roteiro da 0075 (limite de arquivos por link
-- público de documentos com UMA fonte só: configuracoes['link.limite_arquivos']).
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- postgres, com a 0075 APLICADA. TEM de ser `postgres`: `documentos`,
-- `links_publicos` e `configuracoes` estão em `force row level security`, e as
-- fixtures dos passos 2 e 4 só passam com um papel que tenha BYPASSRLS. Rodando
-- com outro papel, esses passos falham com 42501 no detalhe — é falha de papel,
-- não da migration.
--
-- Devolve `resultado_0075` (ordem, passo, ok, detalhe) e, se QUALQUER passo
-- falhar, levanta exceção nomeando os passos — o roteiro é trava, não
-- relatório. Idempotente; nenhuma fixture sobrevive.
--
-- Molde: `scripts/verificacao-0074.sql`, inclusive a ARMADILHA dele: em PL/pgSQL
-- o bloco `EXCEPTION` é subtransação, então tudo que o corpo escreveu é desfeito
-- quando o `raise 'rollback_proposital'` estoura. Por isso o padrão é: sub-bloco
-- `begin … exception … end` alimentando só VARIÁVEIS locais, e o
-- `perform pg_temp.r75(...)` FORA dele.
--
-- O QUE ESTE ROTEIRO PROVA
--   1. `app.limite_arquivos_por_link()` existe, é `stable`, tem `search_path`
--      fixo, NÃO é `security definer`, não tem EXECUTE para public/anon/
--      authenticated — e devolve 10, que é o valor semeado pela migration;
--   2. a função é blindada contra lixo em `configuracoes`: `"dez"`, `0`, `51`,
--      `10.5`, `-3`, objeto e chave ausente TODOS caem em 10, sem exceção
--      (um 22P02 aqui derrubaria o upload do cliente por causa de um campo de
--      Admin digitado errado). Tudo revertido;
--   3. `app.payload_link_documentos` — o que o CLIENTE LÊ — devolve
--      `limite_arquivos = 10` (era o literal 5 da 0028), e acompanha a chave
--      quando ela muda;
--   4. `registrar_documento_publico` — o que o banco APLICA — ACEITA o 6º
--      arquivo (`usos = 5`, que era a recusa antiga) e RECUSA o 11º
--      (`usos = 10`) com `limite_arquivos_atingido`. Fixture com `usos`
--      forçado, tudo desfeito;
--   5. a RPC tem UMA assinatura só, de 10 argumentos (armadilha da sobrecarga
--      ambígua), continua `security definer` com `search_path` fixo, e o
--      EXECUTE continua sendo só de `anon` — nem public, nem authenticated;
--   6. contagens intactas (documentos · links_publicos · links_publicos_acessos
--      · configuracoes) — esta migration não escreve em dado de cliente.
--
-- O QUE NÃO DÁ PARA VERIFICAR AQUI: que a página `/p/d` mostra "Até 10
-- arquivos" e libera o 6º envio. Isso é navegador contra o Next, com um link
-- real emitido — o payload que o roteiro confere é a fonte daquele número, não
-- a renderização. E a pré-checagem barata da rota
-- (`src/server/publico/documento.ts#limiteArquivosPorLink`) lê a MESMA chave
-- por PostgREST, com cache de 60 s: depois de mudar o valor em Admin, o Node
-- leva até um minuto para acompanhar o banco.
-- ---------------------------------------------------------------------------

drop table if exists resultado_0075;
create temp table resultado_0075 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r75(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0075 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;

create temp table contagem_0075 on commit drop as
select (select count(*) from documentos)              as documentos,
       (select count(*) from links_publicos)          as links,
       (select count(*) from links_publicos_acessos)  as acessos,
       (select count(*) from configuracoes)           as configs;


-- ===========================================================================
-- 1. A chave, a função, e o catálogo dela. Leitura pura.
-- ===========================================================================
do $$
declare
  v_valor jsonb; v_desc text;
  v_n int; v_stable boolean; v_definer boolean; v_path text[]; v_acl text;
  v_fn int; ok boolean; det text;
begin
  select valor, descricao into v_valor, v_desc
    from configuracoes where chave = 'link.limite_arquivos';

  -- `max(p.provolatile)` NÃO existe: `provolatile` é do tipo interno "char" e não
  -- tem agregado max. `bool_and` sobre a comparação é o jeito correto.
  select count(*), bool_and(p.provolatile = 's'), bool_and(p.prosecdef), max(p.proconfig),
         coalesce(max(p.proacl::text), '(padrão: só o dono)')
    into v_n, v_stable, v_definer, v_path, v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'limite_arquivos_por_link';

  if v_n = 1 then
    select app.limite_arquivos_por_link() into v_fn;
  end if;

  -- `coalesce(..., false)`: com a função ausente os agregados voltam NULL, e
  -- `ok` NULL estouraria o `not null` de `resultado_0075` em vez de reprovar.
  ok := coalesce(
    v_valor = '10'::jsonb
    and v_desc is not null
    and v_n = 1
    and v_stable                   -- stable
    and v_definer is false         -- invoker: os chamadores é que são definer
    and v_path @> array['search_path=public, pg_temp']
    and v_fn = 10
    -- Ninguém de fora executa: `revoke all from public, anon, authenticated`
    -- deixa o ACL sem nenhum desses três (e `anon` nem tem USAGE no schema app).
    and v_acl not like '%anon=%'
    and v_acl not like '%authenticated=%'
    and v_acl !~ '(^|\{|,)=X/', false);

  det := format('configuracoes[link.limite_arquivos] = %s · overloads = %s · stable = %s · definer = %s · proconfig = %s · retorno = %s · acl = %s',
                coalesce(v_valor::text, '(AUSENTE)'), v_n, v_stable, v_definer, v_path, coalesce(v_fn::text, '(não chamada)'), v_acl);

  perform pg_temp.r75('1 chave semeada em 10 e app.limite_arquivos_por_link() stable/invoker/sem grant devolvendo 10', ok, det);
end $$;


-- ===========================================================================
-- 2. Blindagem contra lixo em `configuracoes`. A função NÃO pode levantar
--    exceção: ela roda dentro de `registrar_documento_publico`, e um 22P02
--    derrubaria o upload do cliente por causa de um campo digitado errado em
--    Admin. Todo valor inválido tem de virar 10, calado.
--
--    ARMADILHA (0074): o `raise 'rollback_proposital'` desfaz os UPDATEs; por
--    isso o resultado sai daqui em VARIÁVEL e o `r75` vem depois do `end`.
-- ===========================================================================
do $$
declare
  v_res text := ''; v_um int; ok boolean := true; det text := null;
  v_caso record;
begin
  begin
    for v_caso in
      select * from (values
        ('"dez"'::jsonb,          'texto'),
        ('0'::jsonb,              'zero'),
        ('-3'::jsonb,             'negativo'),
        ('51'::jsonb,             'acima da faixa'),
        ('10.5'::jsonb,           'fracionário'),
        ('{"a":1}'::jsonb,        'objeto'),
        ('[10]'::jsonb,           'array'),
        ('null'::jsonb,           'json null'),
        ('1e9'::jsonb,            'absurdo')
      ) as t(v, rotulo)
    loop
      update configuracoes set valor = v_caso.v where chave = 'link.limite_arquivos';
      select app.limite_arquivos_por_link() into v_um;
      if v_um <> 10 then ok := false; end if;
      v_res := v_res || format('%s->%s ', v_caso.rotulo, v_um);
    end loop;

    -- Chave AUSENTE (o estado de um banco sem a 0075): também 10.
    delete from configuracoes where chave = 'link.limite_arquivos';
    select app.limite_arquivos_por_link() into v_um;
    if v_um <> 10 then ok := false; end if;
    v_res := v_res || format('ausente->%s ', v_um);

    -- Valor VÁLIDO diferente do default: a função tem de OBEDECER, senão a
    -- chave seria decorativa.
    insert into configuracoes (chave, valor, descricao) values ('link.limite_arquivos', '7'::jsonb, 'fixture 0075');
    select app.limite_arquivos_por_link() into v_um;
    if v_um <> 7 then ok := false; end if;
    v_res := v_res || format('sete->%s', v_um);

    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      ok := false;
      det := format('EXCEÇÃO onde não podia haver: %s %s', sqlstate, sqlerrm);
    end if;
  end;

  perform pg_temp.r75(
    '2 valor inválido/ausente cai em 10 sem exceção e valor válido é obedecido',
    ok, coalesce(det, v_res));
end $$;


-- ===========================================================================
-- 3. O que o CLIENTE LÊ: `app.payload_link_documentos` (era o literal 5).
--    `p_link` não é dereferenciado pela função — só `p_jornada.id` é — então
--    passar NULL ali é legítimo e evita fabricar link só para ler o payload.
-- ===========================================================================
do $$
declare
  v_j jornadas%rowtype; v_payload jsonb; v_limite int; v_apos int;
  ok boolean := true; det text := null;
begin
  select * into v_j from jornadas order by criado_em limit 1;

  v_payload := app.payload_link_documentos(null::links_publicos, v_j);
  v_limite  := (v_payload -> 'limite_arquivos')::int;

  -- Acompanha a chave, não é outro literal: muda o valor, muda o payload.
  begin
    update configuracoes set valor = '23'::jsonb where chave = 'link.limite_arquivos';
    v_apos := ((app.payload_link_documentos(null::links_publicos, v_j)) -> 'limite_arquivos')::int;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if;
  end;

  ok := coalesce(ok and v_limite = 10 and v_apos = 23
        and v_payload ? 'tipos_pedidos' and v_payload ? 'tamanho_maximo_mb', false);

  perform pg_temp.r75(
    '3 payload do link de documentos traz limite_arquivos = 10 e segue a chave',
    ok,
    coalesce(det, format('limite_arquivos = %s (esp. 10) · com a chave em 23 = %s · tamanho_maximo_mb = %s · jornada = %s',
                         v_limite, v_apos, v_payload -> 'tamanho_maximo_mb', coalesce(v_j.id::text, '(nenhuma no banco)'))));
end $$;


-- ===========================================================================
-- 4. O que o BANCO APLICA: `registrar_documento_publico` aceita o 6º arquivo
--    (`usos = 5` — a recusa antiga) e recusa o 11º (`usos = 10`).
--
--    Fixture: um link 'documentos' novo numa jornada aberta que ainda não tem
--    link ativo desse tipo (o índice `uniq_link_ativo` proíbe dois). `usos` é
--    forçado direto na tabela — é justamente o contador que a RPC lê.
--    TUDO desfeito pelo `rollback_proposital`: link, documentos, acessos,
--    `usos` e as linhas de `publico_rate_limit` que as chamadas consumirem.
-- ===========================================================================
do $$
declare
  v_jid uuid; v_hash text; v_r1 jsonb; v_r2 jsonb; v_docs int := 0;
  ok boolean := true; det text := null;
begin
  select j.id into v_jid
    from jornadas j
   where j.desfecho = 'aberta'
     and not exists (select 1 from links_publicos l
                      where l.jornada_id = j.id and l.tipo = 'documentos' and l.estado = 'ativo')
   order by j.criado_em
   limit 1;

  if v_jid is null then
    -- Sem fixture possível não se inventa resultado: o passo falha e diz por quê.
    perform pg_temp.r75('4 RPC aceita o 6º arquivo e recusa o 11º', false,
      'nenhuma jornada aberta sem link de documentos ativo — rode `scripts/seed-exemplo-completo.ts` e repita');
    return;
  end if;

  v_hash := 'verif0075_' || encode(gen_random_bytes(24), 'hex');

  begin
    insert into links_publicos (jornada_id, tipo, token_hash, token_prefixo, estado, expira_em, usos, origem_dado)
    values (v_jid, 'documentos', v_hash, 'vf0075', 'ativo', now() + interval '1 day', 5, 'exemplo');

    -- 6º arquivo: com o teto em 10, PASSA. (Antes da 0075 devolvia
    -- limite_arquivos_atingido — é este o defeito que a migration corrige.)
    v_r1 := public.registrar_documento_publico(
      v_hash, 'outro', 'verif0075-a.pdf',
      'pessoas/verificacao-0075/' || encode(gen_random_bytes(8), 'hex') || '/documento.pdf',
      'application/pdf', 1024, encode(gen_random_bytes(32), 'hex'));

    -- 11º arquivo: `usos` no teto, RECUSA.
    update links_publicos set usos = 10 where token_hash = v_hash;
    v_r2 := public.registrar_documento_publico(
      v_hash, 'outro', 'verif0075-b.pdf',
      'pessoas/verificacao-0075/' || encode(gen_random_bytes(8), 'hex') || '/documento.pdf',
      'application/pdf', 1024, encode(gen_random_bytes(32), 'hex'));

    select count(*) into v_docs from documentos where caminho like 'pessoas/verificacao-0075/%';

    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if;
  end;

  ok := coalesce(ok
    and (v_r1 -> 'ok')::boolean is true
    and v_r2 ->> 'erro' = 'limite_arquivos_atingido'
    and v_docs = 1, false);   -- só o 6º gravou; o 11º foi recusado antes do INSERT

  perform pg_temp.r75(
    '4 RPC aceita o 6º arquivo (usos=5) e recusa o 11º (usos=10)',
    ok,
    coalesce(det, format('jornada = %s · 6º -> %s · 11º -> %s · documentos gravados na fixture = %s (esp. 1)',
                         v_jid, v_r1, v_r2, v_docs)));
end $$;


-- ===========================================================================
-- 5. A RPC não mudou de forma: uma assinatura, definer, search_path, e EXECUTE
--    só de `anon` (regra dura da §2.2 — é uma das cinco RPCs públicas).
--    `create or replace` PRESERVA a ACL; a 0075 reafirma o mesmo revoke/grant
--    da 0068, e este passo é a prova de que o valor não mudou.
-- ===========================================================================
do $$
declare
  v_n int; v_args text; v_definer boolean; v_path text[]; v_acl text; v_oid oid;
  v_anon boolean; v_auth boolean; ok boolean;
begin
  select count(*), string_agg(pg_get_function_identity_arguments(p.oid), ' | '),
         bool_and(p.prosecdef), max(p.proconfig), max(p.oid)
    into v_n, v_args, v_definer, v_path, v_oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'registrar_documento_publico';

  if v_n = 1 then
    v_acl  := coalesce((select proacl::text from pg_proc where oid = v_oid), '(padrão)');
    v_anon := has_function_privilege('anon', v_oid, 'EXECUTE');
    v_auth := has_function_privilege('authenticated', v_oid, 'EXECUTE');
  end if;

  ok := coalesce(v_n = 1
    and v_args = 'p_hash text, p_tipo text, p_nome text, p_caminho text, p_mime text, p_bytes bigint, p_sha256 text, p_ip_hash text, p_user_agent text, p_item_ref text'
    and v_definer
    and v_path @> array['search_path=public, pg_temp']
    and v_anon
    and not v_auth
    and v_acl !~ '(^|\{|,)=X/', false);   -- nada para PUBLIC

  perform pg_temp.r75(
    '5 registrar_documento_publico: 1 assinatura (10 args), definer, EXECUTE só de anon',
    ok,
    format('overloads = %s · args = %s · definer = %s · proconfig = %s · anon = %s · authenticated = %s · acl = %s',
           v_n, coalesce(v_args, '(nenhuma)'), v_definer, v_path, v_anon, v_auth, coalesce(v_acl, '-')));
end $$;


-- ===========================================================================
-- 6. Nenhuma fixture sobreviveu.
-- ===========================================================================
do $$
declare v_docs int; v_links int; v_ac int; v_cfg int; c record;
begin
  select * into c from contagem_0075;
  select count(*) into v_docs  from documentos;
  select count(*) into v_links from links_publicos;
  select count(*) into v_ac    from links_publicos_acessos;
  select count(*) into v_cfg   from configuracoes;

  perform pg_temp.r75(
    '6 contagens intactas (documentos · links_publicos · acessos · configuracoes)',
    v_docs = c.documentos and v_links = c.links and v_ac = c.acessos and v_cfg = c.configs,
    format('documentos %s→%s · links %s→%s · acessos %s→%s · configuracoes %s→%s',
           c.documentos, v_docs, c.links, v_links, c.acessos, v_ac, c.configs, v_cfg));
end $$;


select * from resultado_0075 order by ordem;

-- Trava: qualquer passo em `ok = false` derruba o roteiro nomeando os passos.
do $$
declare v_falhas text;
begin
  select string_agg(passo || ' [' || coalesce(detalhe, '') || ']', ' ;; ' order by ordem)
    into v_falhas from resultado_0075 where not ok;
  if v_falhas is not null then
    raise exception 'verificacao_0075_falhou: %', v_falhas;
  end if;
end $$;
