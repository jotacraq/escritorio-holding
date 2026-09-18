-- scripts/verificacao-0120.sql — roteiro da MEMÓRIA DO COPILOTO, Fatia A
-- (registrar_resumo_copiloto: CAS de sessoes_copiloto.resumo_acumulado).
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- `postgres`, com 0091 a 0120 APLICADAS. A última instrução devolve
-- `resultado_0120` (ordem, passo, ok, detalhe). `ok = true` em todas prova
-- que o banco faz o que a 0120 promete.
--
-- TUDO COM ROLLBACK, mesmo padrão de `verificacao-0096.sql`/
-- `verificacao-0091.sql`: cada bloco que escreve vive num sub-`begin …
-- exception … end` terminado em `raise exception 'rollback_proposital'`, e o
-- INSERT no resultado acontece FORA dele.
--
-- O QUE ESTE ROTEIRO PROVA
--   0  a função registrar_resumo_copiloto existe com a assinatura certa
--   1  CAS: esperado = estado REAL → aplicado=true, grava o novo valor
--   2  CAS: esperado = jsonb DIFERENTE do real → aplicado=false, devolve o
--        atual (o valor que estava lá ANTES desta chamada, intacto)
--   3  igualdade estrutural de jsonb (reordenar chaves não quebra o CAS)
--   4  privilégios: só service_role executa (anon/authenticated/public fora)
--   5  chave de configuração nasce FALSE (fail-CLOSED, B76)
--   6  teto de bytes: 16 itens de perguntado + 8 de pendente cabem
--        FOLGADAMENTE no CHECK de 4096 da 0091 (medido por pg_column_size,
--        não estimado)
--   7  `explain (analyze)` — A MEDIR
-- ---------------------------------------------------------------------------

drop table if exists resultado_0120;
create temp table resultado_0120 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r120(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0120 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;


-- ===========================================================================
-- 0 · A função existe com a assinatura certa.
-- ===========================================================================
do $$
declare
  v_existe boolean;
begin
  v_existe := exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'registrar_resumo_copiloto'
      and pg_get_function_arguments(p.oid) = 'p_sessao_id uuid, p_resumo_esperado jsonb, p_resumo_novo jsonb'
  );
  perform pg_temp.r120('0 · registrar_resumo_copiloto existe com a assinatura (uuid, jsonb, jsonb)', v_existe,
    'existe=' || v_existe);
end $$;


-- ===========================================================================
-- 1 · CAS com esperado = estado REAL → aplicado=true, grava o novo valor.
--
-- ASSUME: uma sessão real existe para satisfazer a FK de `sessao_id` (criada
-- aqui, não um uuid solto — mesma lição de `verificacao-0096.sql` passo 1).
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_sessao uuid;
  v_atual jsonb;
  v_novo jsonb := '{"v":1,"perguntado":[{"t":"filhos_maiores_menores","em":"2026-09-18T14:00:00Z","n":1}],"pendente":[],"cortado_em":null}'::jsonb;
  v_aplicado boolean;
  v_resumo_devolvido jsonb;
  v_ok boolean;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificação 0120 A', 'verif0120a@example.com', '+5511921970000', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_sessao;
    insert into sessoes_copiloto (sessao_id) values (v_sessao); -- nasce com resumo_acumulado='{}'::jsonb (default 0091)

    select resumo_acumulado into v_atual from sessoes_copiloto where sessao_id = v_sessao;

    select aplicado, resumo into v_aplicado, v_resumo_devolvido
      from registrar_resumo_copiloto(v_sessao, v_atual, v_novo);

    v_ok := v_aplicado = true and v_resumo_devolvido = v_novo;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r120('1 · CAS com esperado correto aplica', false, 'exceção: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r120('1 · CAS esperado=real → aplicado=true, grava p_resumo_novo', coalesce(v_ok, false),
    'aplicado=' || v_aplicado || ' resumo_devolvido=' || v_resumo_devolvido::text);
end $$;


-- ===========================================================================
-- 2 · CAS com esperado DIFERENTE do real → aplicado=false, devolve o atual
-- (o valor real intacto — a escrita NÃO aconteceu).
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_sessao uuid;
  v_real jsonb := '{"v":1,"perguntado":[],"pendente":[],"cortado_em":null}'::jsonb;
  v_esperado_errado jsonb := '{"v":1,"perguntado":[{"t":"nao_e_isso","em":"t","n":9}],"pendente":[],"cortado_em":null}'::jsonb;
  v_novo_tentativa jsonb := '{"v":1,"perguntado":[{"t":"outra_coisa","em":"t","n":1}],"pendente":[],"cortado_em":null}'::jsonb;
  v_aplicado boolean;
  v_resumo_devolvido jsonb;
  v_resumo_apos jsonb;
  v_ok boolean;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificação 0120 B', 'verif0120b@example.com', '+5511921970001', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_sessao;
    insert into sessoes_copiloto (sessao_id, resumo_acumulado) values (v_sessao, v_real);

    select aplicado, resumo into v_aplicado, v_resumo_devolvido
      from registrar_resumo_copiloto(v_sessao, v_esperado_errado, v_novo_tentativa);

    select resumo_acumulado into v_resumo_apos from sessoes_copiloto where sessao_id = v_sessao;

    v_ok := v_aplicado = false and v_resumo_devolvido = v_real and v_resumo_apos = v_real;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r120('2 · CAS com esperado errado recusa', false, 'exceção: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r120('2 · CAS esperado≠real → aplicado=false, devolve o REAL, NADA foi gravado', coalesce(v_ok, false),
    'aplicado=' || v_aplicado || ' devolvido=' || v_resumo_devolvido::text || ' apos=' || v_resumo_apos::text);
end $$;


-- ===========================================================================
-- 3 · Igualdade ESTRUTURAL de jsonb — mesmo conteúdo, chaves em ORDEM
-- DIFERENTE, ainda casa no CAS (prova de que a comparação não é textual).
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_sessao uuid;
  v_gravado jsonb := '{"v":1,"perguntado":[],"pendente":["regimes_casamento"],"cortado_em":null}'::jsonb;
  v_esperado_reordenado jsonb := '{"pendente":["regimes_casamento"],"v":1,"cortado_em":null,"perguntado":[]}'::jsonb;
  v_novo jsonb := '{"v":1,"perguntado":[{"t":"regimes_casamento","em":"t","n":1}],"pendente":[],"cortado_em":null}'::jsonb;
  v_aplicado boolean;
  v_ok boolean;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificação 0120 C', 'verif0120c@example.com', '+5511921970002', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_sessao;
    insert into sessoes_copiloto (sessao_id, resumo_acumulado) values (v_sessao, v_gravado);

    select aplicado into v_aplicado from registrar_resumo_copiloto(v_sessao, v_esperado_reordenado, v_novo);

    v_ok := v_aplicado = true;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r120('3 · igualdade estrutural de jsonb', false, 'exceção: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r120('3 · jsonb com chaves REORDENADAS ainda casa no CAS (comparação estrutural, não textual)',
    coalesce(v_ok, false), 'aplicado=' || v_aplicado);
end $$;


-- ===========================================================================
-- 4 · Privilégios por CATÁLOGO — só service_role executa.
-- ===========================================================================
do $$
declare
  v_erros text := '';
begin
  if has_function_privilege('anon', 'registrar_resumo_copiloto(uuid,jsonb,jsonb)', 'execute') then
    v_erros := v_erros || 'anon_com_execute ';
  end if;
  if has_function_privilege('authenticated', 'registrar_resumo_copiloto(uuid,jsonb,jsonb)', 'execute') then
    v_erros := v_erros || 'authenticated_com_execute ';
  end if;
  if not has_function_privilege('service_role', 'registrar_resumo_copiloto(uuid,jsonb,jsonb)', 'execute') then
    v_erros := v_erros || 'service_role_sem_execute ';
  end if;

  perform pg_temp.r120('4 · GRANT por catálogo: só service_role executa', v_erros = '',
    case when v_erros = '' then 'ok' else 'ACHADOS: ' || v_erros end);
end $$;


-- ===========================================================================
-- 5 · A chave de configuração nasce FALSE (fail-CLOSED, B76).
-- ===========================================================================
do $$
declare
  v_valor jsonb;
  v_descricao text;
begin
  select valor, descricao into v_valor, v_descricao
    from configuracoes where chave = 'copiloto_sessao.resumo_acumulado';

  perform pg_temp.r120('5 · copiloto_sessao.resumo_acumulado existe e nasce FALSE (fail-CLOSED)',
    v_valor is not null and v_valor = 'false'::jsonb and v_descricao is not null,
    'valor=' || coalesce(v_valor::text, 'AUSENTE'));
end $$;


-- ===========================================================================
-- 6 · TETO DE BYTES — 16 itens de perguntado + 8 de pendente cabem
-- FOLGADAMENTE no CHECK de 4096 (0091). Medido por `pg_column_size`, a
-- MESMA função que o CHECK usa — não uma aproximação em outra linguagem.
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_sessao uuid;
  v_perguntado jsonb;
  v_pendente jsonb;
  v_resumo jsonb;
  v_tamanho int;
  v_ok boolean;
  i int;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificação 0120 D', 'verif0120d@example.com', '+5511921970003', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_sessao;

    v_perguntado := '[]'::jsonb;
    for i in 1..16 loop
      v_perguntado := v_perguntado || jsonb_build_array(
        jsonb_build_object('t', 'tema_bem_especifico_numero_' || i, 'em', '2026-09-18T14:00:00Z', 'n', i)
      );
    end loop;

    v_pendente := '[]'::jsonb;
    for i in 1..8 loop
      v_pendente := v_pendente || jsonb_build_array('pendente_campo_bem_especifico_' || i);
    end loop;

    v_resumo := jsonb_build_object('v', 1, 'perguntado', v_perguntado, 'pendente', v_pendente, 'cortado_em', null);

    -- Grava DE VERDADE (dentro da transação com rollback) para medir
    -- `pg_column_size` como o CHECK da 0091 mede — não uma estimativa.
    insert into sessoes_copiloto (sessao_id, resumo_acumulado) values (v_sessao, v_resumo);
    select pg_column_size(resumo_acumulado) into v_tamanho from sessoes_copiloto where sessao_id = v_sessao;

    v_ok := v_tamanho < 4096;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      -- Se o CHECK da 0091 disparar aqui, é achado real — não mascarar.
      perform pg_temp.r120('6 · teto de bytes (16 perguntado + 8 pendente)', false, 'exceção: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r120('6 · pg_column_size(16 perguntado + 8 pendente) < 4096 (CHECK da 0091)',
    coalesce(v_ok, false), 'tamanho_bytes=' || coalesce(v_tamanho::text, '?') || ' (teto CHECK=4096, alvo produto=3500)');
end $$;


-- ===========================================================================
-- 7 · `explain (analyze)` — A MEDIR contra o banco real. Sem `.env` nesta
-- máquina não há como rodar (mesmo aviso de honestidade dos demais roteiros
-- desta fase — 0096/0105/0111/0119). Comando exato, para colar no MCP/SQL
-- Editor com uma sessão real populada:
--
--   begin;
--   explain (analyze, buffers)
--   select * from registrar_resumo_copiloto(
--     '<uuid de uma sessao real>'::uuid,
--     (select resumo_acumulado from sessoes_copiloto where sessao_id = '<mesmo uuid>'),
--     '{"v":1,"perguntado":[{"t":"filhos_maiores_menores","em":"2026-09-18T14:00:00Z","n":1}],"pendente":[],"cortado_em":null}'::jsonb
--   );
--   rollback;
--
-- Esperado: `LockRows` sobre `Index Scan using sessoes_copiloto_pkey` — mesmo
-- padrão já medido e colado em 0105 (cópia estrutural desta função), tempo
-- sub-ms (a query é por PK, uma linha).
-- ===========================================================================
do $$
begin
  -- `ok=false`, NUNCA `null`: a coluna `ok` é `not null` — mesma prevenção
  -- de bug catalogada no passo 8 de `verificacao-0096.sql`/passo 7 de
  -- `verificacao-0091.sql`.
  perform pg_temp.r120('7 · explain (analyze): registrar_resumo_copiloto', false,
    'A MEDIR — sem banco nesta máquina. Comando exato no comentário acima deste bloco.');
end $$;


select * from resultado_0120 order by ordem;
