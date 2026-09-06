-- scripts/verificacao-0073.sql — roteiro da 0073 (janela de discagem, retenção
-- de voz e token cifrado do link de agendamento). Fase 7 · agente LIG.
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- `postgres`, com a 0073 APLICADA. Devolve `resultado_0073` (ordem, passo, ok,
-- detalhe) e, se QUALQUER passo falhar, levanta `verificacao_0073_falhou` com a
-- lista — falha barulhenta, nunca tabela verde com linha vermelha no meio.
--
-- IDEMPOTENTE: toda fixture nasce e morre dentro de um `rollback_proposital`.
-- Rodar duas vezes dá o mesmo resultado e não deixa linha nenhuma.
--
-- ARMADILHA HERDADA DA 0069/0070 (não reintroduzir): em PL/pgSQL o bloco
-- `EXCEPTION` é uma subtransação — tudo que o corpo escreveu é desfeito quando
-- o `raise 'rollback_proposital'` estoura, INCLUSIVE o INSERT no resultado. Por
-- isso o padrão é sempre: sub-bloco `begin … exception … end` que só alimenta
-- VARIÁVEIS locais, e o `perform pg_temp.r73(...)` FORA dele.
--
-- O QUE ESTE ROTEIRO PROVA
--   1. as duas colunas novas existem, com o tipo certo;
--   2. `token_link_cifrado` NÃO é legível por `authenticated` (é segredo
--      derivado; `expurgado_em` continua legível, porque a tela mostra);
--   3. `authenticated` continua sem INSERT/UPDATE em `ligacoes_ia` além de
--      `status` (a 0053 não foi afrouxada);
--   4. o índice parcial do expurgo existe com o predicado certo;
--   5. as duas chaves de configuração existem, com a FORMA que o código lê, e o
--      upsert da migration NÃO sobrescreve valor já ajustado pela Dra. Elaine;
--   6. o expurgo apaga transcrição e gravação, MANTÉM resumo/custo/duração/
--      resultado, carimba `expurgado_em`, não muda o status e não polui a
--      timeline;
--   7. o expurgo não toca ligação recente, não toca ligação ainda em andamento
--      e não reexpurga o que já foi expurgado.
--
-- O QUE NÃO DÁ PARA VERIFICAR AQUI: o cálculo da janela (é TypeScript puro —
-- `npx vitest run src/server/ligacao-ia/janela.test.ts`, 23 casos) e a cifra do
-- token (idem, `token-cifrado.ts`, sem o pepper o banco não decifra nada).
-- ---------------------------------------------------------------------------

drop table if exists resultado_0073;
create temp table resultado_0073 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r73(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0073 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;


-- ===========================================================================
-- 1. As colunas novas existem, com o tipo certo.
-- ===========================================================================
do $$
declare v_exp text; v_tok text; ok boolean; det text;
begin
  select data_type into v_exp from information_schema.columns
   where table_schema = 'public' and table_name = 'ligacoes_ia' and column_name = 'expurgado_em';
  select data_type into v_tok from information_schema.columns
   where table_schema = 'public' and table_name = 'ligacoes_ia' and column_name = 'token_link_cifrado';

  ok := v_exp = 'timestamp with time zone' and v_tok = 'text';
  det := format('expurgado_em = %s · token_link_cifrado = %s',
                coalesce(v_exp, '(ausente)'), coalesce(v_tok, '(ausente)'));
  perform pg_temp.r73('1 colunas expurgado_em (timestamptz) e token_link_cifrado (text)', ok, det);
end $$;


-- ===========================================================================
-- 2. `token_link_cifrado` é invisível para quem está logado; `expurgado_em` não.
--    O `select *` da Ficha e do histórico NÃO pode trazer o token de volta.
-- ===========================================================================
do $$
declare v_tok boolean; v_exp boolean; v_anon boolean; ok boolean; det text;
begin
  v_tok  := has_column_privilege('authenticated', 'ligacoes_ia', 'token_link_cifrado', 'SELECT');
  v_exp  := has_column_privilege('authenticated', 'ligacoes_ia', 'expurgado_em', 'SELECT');
  v_anon := has_table_privilege('anon', 'ligacoes_ia', 'SELECT');

  ok := (v_tok = false) and (v_exp = true) and (v_anon = false);
  det := format('authenticated SELECT: token_link_cifrado=%s (esperado false) · expurgado_em=%s (esperado true) · anon SELECT na tabela=%s (esperado false)',
                v_tok, v_exp, v_anon);
  perform pg_temp.r73('2 token cifrado não é legível por authenticated; expurgado_em é', ok, det);
end $$;


-- ===========================================================================
-- 3. A 0053 não foi afrouxada: authenticated não insere, e só atualiza `status`.
-- ===========================================================================
do $$
declare v_ins boolean; v_upd_status boolean; v_upd_tok boolean; v_upd_exp boolean; v_upd_transc boolean;
        ok boolean; det text;
begin
  v_ins        := has_table_privilege('authenticated', 'ligacoes_ia', 'INSERT');
  v_upd_status := has_column_privilege('authenticated', 'ligacoes_ia', 'status', 'UPDATE');
  v_upd_tok    := has_column_privilege('authenticated', 'ligacoes_ia', 'token_link_cifrado', 'UPDATE');
  v_upd_exp    := has_column_privilege('authenticated', 'ligacoes_ia', 'expurgado_em', 'UPDATE');
  v_upd_transc := has_column_privilege('authenticated', 'ligacoes_ia', 'transcricao', 'UPDATE');

  ok := v_ins = false and v_upd_status = true and v_upd_tok = false and v_upd_exp = false and v_upd_transc = false;
  det := format('INSERT=%s (false) · UPDATE status=%s (true) · token=%s exp=%s transcricao=%s (todos false)',
                v_ins, v_upd_status, v_upd_tok, v_upd_exp, v_upd_transc);
  perform pg_temp.r73('3 grants da 0053 intactos: sem INSERT, UPDATE só de status', ok, det);
end $$;


-- ===========================================================================
-- 4. Índice parcial do expurgo.
-- ===========================================================================
do $$
declare v_def text; ok boolean; det text;
begin
  select indexdef into v_def from pg_indexes
   where schemaname = 'public' and tablename = 'ligacoes_ia' and indexname = 'idx_ligacoes_ia_expurgo';

  ok := v_def is not null
    and v_def like '%encerrada_em%'
    and v_def like '%expurgado_em IS NULL%'
    and v_def like '%status%';
  det := coalesce(v_def, '(índice ausente)');
  perform pg_temp.r73('4 idx_ligacoes_ia_expurgo parcial (encerrada_em, expurgado_em is null, status terminal)', ok, det);
end $$;


-- ===========================================================================
-- 5. Configuração: as duas chaves com a FORMA que o código lê, e o upsert que
--    NÃO sobrescreve. O segundo `insert … on conflict do nothing` roda de novo
--    dentro do fixture e o valor ajustado tem de sobreviver.
-- ===========================================================================
do $$
declare
  v_janela jsonb; v_ret jsonb; v_depois jsonb;
  ok boolean := false; det text;
begin
  begin
    select valor into v_janela from configuracoes where chave = 'ligacao_ia.janela';
    select valor into v_ret    from configuracoes where chave = 'ligacao_ia.retencao_dias';

    if v_janela is null or v_ret is null then
      det := format('chaves ausentes: janela=%s retencao=%s', v_janela is not null, v_ret is not null);
      raise exception 'rollback_proposital';
    end if;

    -- Simula a Dra. Elaine ajustando a janela e a migration sendo reaplicada.
    update configuracoes
       set valor = '{"dias":[2,4],"inicio":"14:00","fim":"17:30","fuso":"America/Sao_Paulo"}'::jsonb
     where chave = 'ligacao_ia.janela';

    insert into configuracoes (chave, valor, descricao) values
     ('ligacao_ia.janela', '{"dias":[1,2,3,4,5],"inicio":"09:00","fim":"19:00","fuso":"America/Sao_Paulo"}'::jsonb, 'reaplicação'),
     ('ligacao_ia.retencao_dias', 'null'::jsonb, 'reaplicação')
    on conflict (chave) do nothing;

    select valor into v_depois from configuracoes where chave = 'ligacao_ia.janela';

    ok := jsonb_typeof(v_janela -> 'dias') = 'array'
      and jsonb_typeof(v_janela -> 'inicio') = 'string'
      and jsonb_typeof(v_janela -> 'fim') = 'string'
      and jsonb_typeof(v_janela -> 'fuso') = 'string'
      and jsonb_typeof(v_ret) in ('null', 'number')
      and v_depois ->> 'inicio' = '14:00';   -- a reaplicação NÃO sobrescreveu

    det := format('janela original = %s · retencao = %s (tipo %s) · após reaplicar a migration a janela ajustada continua = %s',
                  v_janela::text, v_ret::text, jsonb_typeof(v_ret), v_depois::text);
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.r73('5 configuracoes: forma da janela, retencao null e upsert que não sobrescreve', ok, det);
end $$;


-- ===========================================================================
-- 6. O expurgo faz exatamente o que a 0073 promete — e nada além disso.
--    Fixture: jornada + ligação encerrada há 400 dias, com transcrição,
--    gravação, resumo, custo e duração. Tudo revertido no fim.
-- ===========================================================================
do $$
declare
  v_tag     text := left(gen_random_uuid()::text, 8);
  v_pessoa  uuid; v_jornada uuid; v_lig uuid;
  v_evt_antes int; v_evt_depois int;
  r         record;
  ok boolean := false; det text;
begin
  begin
    insert into pessoas (nome, email, telefone, cidade, uf, origem_dado)
    values ('Verificação 0073 ' || v_tag, 'verif73.' || v_tag || '@example.com',
            '+55219' || lpad((random() * 99999999)::bigint::text, 8, '0'), 'Rio de Janeiro', 'RJ', 'exemplo')
    returning id into v_pessoa;

    insert into jornadas (pessoa_id, origem, etapa, origem_dado)
    values (v_pessoa, 'outro', 'sessao_agendada', 'exemplo') returning id into v_jornada;

    insert into ligacoes_ia (jornada_id, provedor, status, telefone, origem,
                             encerrada_em, duracao_segundos, resultado,
                             transcricao, resumo, gravacao_url, custo_usd)
    values (v_jornada, 'n8n', 'concluida', '+5521999999999', 'equipe',
            now() - interval '400 days', 62, 'recusou',
            'AI: Olá. USER: Não quero agora.', 'Cliente recusou marcar agora.',
            'https://storage.vapi.ai/verif73.wav', 0.0731)
    returning id into v_lig;

    select count(*) into v_evt_antes from eventos_timeline where jornada_id = v_jornada;

    -- Exatamente o UPDATE de `etapaExpurgoLigacoesIa` (retenção de 90 dias).
    update ligacoes_ia
       set transcricao = null, gravacao_url = null, expurgado_em = now()
     where id = v_lig
       and status in ('concluida', 'sem_resposta', 'falhou', 'cancelada')
       and encerrada_em < now() - (90 || ' days')::interval
       and expurgado_em is null;

    select count(*) into v_evt_depois from eventos_timeline where jornada_id = v_jornada;
    select * into r from ligacoes_ia where id = v_lig;

    ok := r.transcricao is null
      and r.gravacao_url is null
      and r.expurgado_em is not null
      and r.resumo = 'Cliente recusou marcar agora.'
      and r.custo_usd = 0.0731
      and r.duracao_segundos = 62
      and r.resultado = 'recusou'
      and r.status = 'concluida'
      and v_evt_depois = v_evt_antes;   -- expurgo não é evento de jornada

    det := format('transcricao=%s gravacao=%s expurgado_em=%s · preservados: resumo=%s custo=%s duracao=%s resultado=%s status=%s · eventos timeline antes/depois=%s/%s',
                  coalesce(r.transcricao, 'NULL'), coalesce(r.gravacao_url, 'NULL'),
                  coalesce(r.expurgado_em::text, 'NULL'), coalesce(r.resumo, 'NULL'),
                  coalesce(r.custo_usd::text, 'NULL'), coalesce(r.duracao_segundos::text, 'NULL'),
                  coalesce(r.resultado, 'NULL'), r.status, v_evt_antes, v_evt_depois);
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.r73('6 expurgo apaga voz, preserva registro, não muda status nem timeline', ok, det);
end $$;


-- ===========================================================================
-- 7. O expurgo NÃO pega quem não deve: ligação recente, ligação em andamento,
--    ligação já expurgada.
-- ===========================================================================
do $$
declare
  v_tag     text := left(gen_random_uuid()::text, 8);
  v_pessoa  uuid; v_jornada uuid;
  v_recente uuid; v_andamento uuid; v_ja uuid;
  v_atingidas int;
  ok boolean := false; det text;
begin
  begin
    insert into pessoas (nome, email, telefone, cidade, uf, origem_dado)
    values ('Verificação 0073b ' || v_tag, 'verif73b.' || v_tag || '@example.com',
            '+55219' || lpad((random() * 99999999)::bigint::text, 8, '0'), 'Rio de Janeiro', 'RJ', 'exemplo')
    returning id into v_pessoa;
    insert into jornadas (pessoa_id, origem, etapa, origem_dado)
    values (v_pessoa, 'outro', 'sessao_agendada', 'exemplo') returning id into v_jornada;

    -- Encerrada ontem: dentro da retenção.
    insert into ligacoes_ia (jornada_id, provedor, status, telefone, encerrada_em, transcricao)
    values (v_jornada, 'n8n', 'concluida', '+5521999999991', now() - interval '1 day', 'recente')
    returning id into v_recente;

    -- Em andamento: nunca se apaga o que ainda está acontecendo. (O índice
    -- único de ligação ativa por jornada obriga a usar outra jornada.)
    insert into ligacoes_ia (jornada_id, provedor, status, telefone, disparada_em, transcricao)
    values (v_jornada, 'n8n', 'em_ligacao', '+5521999999992', now() - interval '400 days', 'em andamento')
    returning id into v_andamento;

    -- Já expurgada: não entra de novo no lote.
    insert into ligacoes_ia (jornada_id, provedor, status, telefone, encerrada_em, expurgado_em, transcricao)
    values (v_jornada, 'n8n', 'falhou', '+5521999999993', now() - interval '400 days', now() - interval '10 days', null)
    returning id into v_ja;

    with alvo as (
      select id from ligacoes_ia
       where id in (v_recente, v_andamento, v_ja)
         and status in ('concluida', 'sem_resposta', 'falhou', 'cancelada')
         and encerrada_em < now() - (90 || ' days')::interval
         and expurgado_em is null
         and (transcricao is not null or gravacao_url is not null)
    )
    select count(*) into v_atingidas from alvo;

    ok := v_atingidas = 0;
    det := format('linhas que o filtro do expurgo pegaria entre recente/em-andamento/já-expurgada = %s (esperado 0)', v_atingidas);
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.r73('7 expurgo não toca recente, em andamento nem já expurgada', ok, det);
end $$;


-- ===========================================================================
-- Veredito: falha barulhenta.
-- ===========================================================================
do $$
declare v_falhas text;
begin
  select string_agg(format('#%s %s — %s', ordem, passo, coalesce(detalhe, '')), E'\n')
    into v_falhas from resultado_0073 where not ok;
  if v_falhas is not null then
    raise exception E'verificacao_0073_falhou:\n%', v_falhas;
  end if;
end $$;

select * from resultado_0073 order by ordem;
