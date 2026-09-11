-- scripts/verificacao-0091.sql — roteiro da Fase 10, Fatia 1 (copiloto sem
-- áudio, determinístico puro).
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- `postgres`, com 0091 APLICADA. A última instrução devolve `resultado_0091`
-- (ordem, passo, ok, detalhe). `ok = true` em todas prova que o banco faz o
-- que a migration promete.
--
-- TUDO COM ROLLBACK, mesmo padrão de `verificacao-0088-0090.sql`: cada bloco
-- que escreve vive num sub-`begin … exception … end` terminado em
-- `raise 'rollback_proposital'`, e o INSERT no resultado acontece FORA dele.
--
-- O QUE ESTE ROTEIRO PROVA
--   0  as 3 tabelas e as 10 chaves de configuracoes existem, com o valor inicial certo
--   1  sessoes_copiloto: estado nasce 'aguardando'; CHECK de estado recusa lixo
--   2  resumo_acumulado: CHECK de 4096 bytes recusa jsonb maior
--   3  sessoes_copiloto_segmentos: idempotência (sessao_id,ordem) e CHECK de texto vazio
--   4  RLS: authenticated sem sessão (anon) não lê nem escreve nas 3 tabelas
--   5  RLS: policy de INSERT em segmentos exige origem='manual' para authenticated
--   6  privilégios: anon fora das 3 tabelas; authenticated sem DELETE em nenhuma
--   7  `explain (analyze)` da query de polling (índice composto) — A MEDIR.
--       Registra `ok=false` de propósito (não é falha de teste, é "não
--       verificado nesta rodada"; comando pronto no comentário do bloco —
--       sem `.env` nesta máquina não há como rodar aqui)
-- ---------------------------------------------------------------------------

drop table if exists resultado_0091;
create temp table resultado_0091 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r91(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0091 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;


-- ===========================================================================
-- 0 · Tabelas e configurações existem, com o valor inicial certo.
-- ===========================================================================
do $$
declare
  v_tabelas_faltando text := '';
  v_tabela text;
  v_esperadas text[] := array['sessoes_copiloto', 'sessoes_copiloto_segmentos', 'copiloto_sugestoes'];
  v_chaves_erradas text := '';
  v_ativo jsonb; v_audio jsonb;
  v_qtd_chaves int;
begin
  foreach v_tabela in array v_esperadas loop
    if to_regclass('public.' || v_tabela) is null then
      v_tabelas_faltando := v_tabelas_faltando || v_tabela || ' ';
    end if;
  end loop;

  select valor into v_ativo from configuracoes where chave = 'copiloto_sessao.ativo';
  select valor into v_audio from configuracoes where chave = 'copiloto_sessao.audio_ao_vivo';
  select count(*) into v_qtd_chaves from configuracoes where chave like 'copiloto_sessao.%';

  if v_ativo is distinct from 'false'::jsonb then v_chaves_erradas := v_chaves_erradas || 'ativo=' || coalesce(v_ativo::text, 'AUSENTE') || ' '; end if;
  if v_audio is distinct from 'false'::jsonb then v_chaves_erradas := v_chaves_erradas || 'audio_ao_vivo=' || coalesce(v_audio::text, 'AUSENTE') || ' '; end if;

  perform pg_temp.r91('0 · tabelas + configuracoes',
    v_tabelas_faltando = '' and v_chaves_erradas = '' and v_qtd_chaves = 10,
    'tabelas_faltando=[' || v_tabelas_faltando || '] chaves_erradas=[' || v_chaves_erradas ||
    '] qtd_chaves_copiloto_sessao=' || v_qtd_chaves || ' (esperado 10)');
end $$;


-- ===========================================================================
-- 1 · sessoes_copiloto — estado nasce 'aguardando'; CHECK recusa estado fora
-- da lista fechada.
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_sessao uuid;
  v_estado_nascido text;
  v_check_recusou boolean := false;
  v_ok boolean;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificação 0091 A', 'verif0091a@example.com', '+5511921110000', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_sessao;

    insert into sessoes_copiloto (sessao_id) values (v_sessao);
    select estado into v_estado_nascido from sessoes_copiloto where sessao_id = v_sessao;

    begin
      update sessoes_copiloto set estado = 'lixo' where sessao_id = v_sessao;
    exception when check_violation then v_check_recusou := true;
    end;

    v_ok := v_estado_nascido = 'aguardando' and v_check_recusou;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r91('1 · sessoes_copiloto estado', false, 'exceção: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r91('1 · sessoes_copiloto estado nasce aguardando + CHECK fecha lista', coalesce(v_ok, false),
    'estado_nascido=' || coalesce(v_estado_nascido, '?') || ' check_recusou_lixo=' || v_check_recusou);
end $$;


-- ===========================================================================
-- 2 · resumo_acumulado — CHECK de 4096 bytes recusa jsonb maior (prova o teto
-- que sustenta o contexto O(1) da fatia 2 — nesta fatia ninguém escreve aqui,
-- mas o CHECK precisa estar de pé desde já).
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_sessao uuid;
  v_grande jsonb;
  v_recusou boolean := false;
  v_ok boolean;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificação 0091 B', 'verif0091b@example.com', '+5511921110001', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_sessao;

    v_grande := jsonb_build_object('x', repeat('a', 5000));
    begin
      insert into sessoes_copiloto (sessao_id, resumo_acumulado) values (v_sessao, v_grande);
    exception when check_violation then v_recusou := true;
    end;

    v_ok := v_recusou;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r91('2 · resumo_acumulado teto 4096B', false, 'exceção: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r91('2 · resumo_acumulado teto 4096B recusa jsonb maior', coalesce(v_ok, false),
    'recusou_5000_bytes=' || v_recusou);
end $$;


-- ===========================================================================
-- 3 · sessoes_copiloto_segmentos — idempotência (sessao_id,ordem) e CHECK de
-- texto vazio.
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_sessao uuid;
  v_dup_recusou boolean := false;
  v_vazio_recusou boolean := false;
  v_ok boolean;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificação 0091 C', 'verif0091c@example.com', '+5511921110002', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_sessao;

    insert into sessoes_copiloto_segmentos (sessao_id, ordem, texto, origem)
    values (v_sessao, 1, 'Primeira fala digitada pela advogada.', 'manual');

    begin
      insert into sessoes_copiloto_segmentos (sessao_id, ordem, texto, origem)
      values (v_sessao, 1, 'Reentrega com a mesma ordem.', 'manual');
    exception when unique_violation then v_dup_recusou := true;
    end;

    begin
      insert into sessoes_copiloto_segmentos (sessao_id, ordem, texto, origem)
      values (v_sessao, 2, '   ', 'manual');
    exception when check_violation then v_vazio_recusou := true;
    end;

    v_ok := v_dup_recusou and v_vazio_recusou;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r91('3 · segmentos idempotência + CHECK texto', false, 'exceção: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r91('3 · segmentos: unique(sessao_id,ordem) + CHECK texto não-vazio', coalesce(v_ok, false),
    'dup_recusou=' || v_dup_recusou || ' vazio_recusou=' || v_vazio_recusou);
end $$;


-- ===========================================================================
-- 4 · RLS — anon (sem sessão) não lê nem escreve nas 3 tabelas.
--
-- O INSERT de teste referencia uma sessão REAL (criada aqui, ANTES de trocar
-- de role) — não um `gen_random_uuid()` solto. Um uuid que não existe em
-- `sessoes_viabilidade` quebraria por `foreign_key_violation`, que o
-- `exception when insufficient_privilege` NÃO captura, e o erro sem handler
-- mataria o roteiro inteiro antes do passo 5 (mesma classe do achado do
-- Fable no passo 7 — corrigido aqui por prevenção, releitura pedida na
-- correção). Mesmo padrão de rollback controlado dos passos 1-3
-- (sub-begin/exception + `raise 'rollback_proposital'`), não DELETE manual —
-- um DELETE fora de exceção controlada seria mais um ponto sem rede de
-- segurança se algo além do esperado falhar no meio do bloco.
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_sessao uuid;
  v_ok boolean;
  v_erro_sel text := ''; v_erro_ins text := '';
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificação 0091 D', 'verif0091d@example.com', '+5511921110003', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_sessao;

    set local role anon;
    begin
      perform 1 from sessoes_copiloto limit 1;
      v_erro_sel := v_erro_sel || 'sessoes_copiloto_leu ';
    exception when insufficient_privilege then null;
    end;
    begin
      perform 1 from sessoes_copiloto_segmentos limit 1;
      v_erro_sel := v_erro_sel || 'segmentos_leu ';
    exception when insufficient_privilege then null;
    end;
    begin
      perform 1 from copiloto_sugestoes limit 1;
      v_erro_sel := v_erro_sel || 'sugestoes_leu ';
    exception when insufficient_privilege then null;
    end;
    begin
      insert into sessoes_copiloto_segmentos (sessao_id, ordem, texto, origem)
      values (v_sessao, 999, 'x', 'manual');
      v_erro_ins := v_erro_ins || 'segmentos_inseriu ';
    exception
      when insufficient_privilege then null;
      when others then v_erro_ins := v_erro_ins || ('erro_inesperado:' || sqlerrm) || ' ';
    end;
    reset role;

    v_ok := v_erro_sel = '' and v_erro_ins = '';
    raise exception 'rollback_proposital';
  exception when others then
    reset role; -- garante que o `set local role anon` não vaza para o resto da sessão se algo estourou antes do `reset role` de cima
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r91('4 · RLS: anon fora das 3 tabelas', false, 'exceção: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r91('4 · RLS: anon fora das 3 tabelas', coalesce(v_ok, false),
    'vazamentos_select=[' || v_erro_sel || '] vazamentos_insert=[' || v_erro_ins || ']');
end $$;


-- ===========================================================================
-- 5 · RLS: a policy de INSERT em segmentos para `authenticated` exige
-- origem='manual' — provado pela LEITURA da definição da policy (não dá para
-- simular `app.ve_patrimonio()=true` sem um perfis_equipe real vinculado a
-- auth.uid(); a prova funcional de origem='bot' recusada é objeto da fatia 4,
-- quando o service_role do webhook existir).
-- ===========================================================================
do $$
declare
  v_qual text;
  v_ok boolean;
begin
  select pg_get_expr(polwithcheck, polrelid) into v_qual
    from pg_policy where polname = 'scs_ins' and polrelid = 'sessoes_copiloto_segmentos'::regclass;

  v_ok := v_qual is not null and position('manual' in v_qual) > 0;
  perform pg_temp.r91('5 · policy scs_ins exige origem=manual', v_ok, 'with_check=' || coalesce(v_qual, 'NULL'));
end $$;


-- ===========================================================================
-- 6 · Privilégios: anon fora; authenticated sem DELETE em nenhuma das 3.
-- ===========================================================================
do $$
declare
  v_erros text := '';
begin
  if has_table_privilege('anon', 'sessoes_copiloto', 'select') then v_erros := v_erros || 'anon_le_sessoes_copiloto '; end if;
  if has_table_privilege('anon', 'sessoes_copiloto_segmentos', 'select') then v_erros := v_erros || 'anon_le_segmentos '; end if;
  if has_table_privilege('anon', 'copiloto_sugestoes', 'select') then v_erros := v_erros || 'anon_le_sugestoes '; end if;

  if has_table_privilege('authenticated', 'sessoes_copiloto', 'delete') then v_erros := v_erros || 'authenticated_deleta_sessoes_copiloto '; end if;
  if has_table_privilege('authenticated', 'sessoes_copiloto_segmentos', 'delete') then v_erros := v_erros || 'authenticated_deleta_segmentos '; end if;
  if has_table_privilege('authenticated', 'copiloto_sugestoes', 'delete') then v_erros := v_erros || 'authenticated_deleta_sugestoes '; end if;
  if has_table_privilege('authenticated', 'copiloto_sugestoes', 'insert') then v_erros := v_erros || 'authenticated_insere_sugestoes '; end if;

  perform pg_temp.r91('6 · privilégios: anon fora, authenticated sem DELETE/sem INSERT em sugestões', v_erros = '',
    case when v_erros = '' then 'ok' else 'ACHADOS: ' || v_erros end);
end $$;


-- ===========================================================================
-- 7 · explain (analyze) da query de polling — A MEDIR contra o banco real.
-- Sem `.env` nesta máquina não há como rodar. Comando exato, para colar no
-- MCP/SQL Editor com dado de exemplo populado:
--
--   explain (analyze, buffers)
--   select id, ordem, falante, texto, criado_em
--     from sessoes_copiloto_segmentos
--    where sessao_id = '<uuid de uma sessão com segmentos>'
--      and ordem > 0
--    order by ordem;
--
-- Esperado: "Index Scan using idx_copiloto_segmentos_polling" (ou
-- "Index Only Scan"), NUNCA "Seq Scan" — e um tempo de execução na casa de
-- fração de milissegundo com poucas centenas de linhas por sessão (§2.2/§4.1
-- do plano). Colar a saída crua na entrega — não estimar.
-- ===========================================================================
do $$
begin
  -- `ok=false`, NUNCA `null`: a coluna é `not null` (linha 27) — um `null`
  -- aqui violava a constraint e MATAVA O ROTEIRO INTEIRO antes do `select`
  -- final, derrubando os passos 0-6 junto (achado do Fable: o único
  -- instrumento que sustenta o "A MEDIR" não sobrevivia à primeira execução
  -- real). `false` aqui significa "não verificado nesta rodada", nunca
  -- "passou" — não confundir com um passo que rodou e falhou.
  perform pg_temp.r91('7 · explain (analyze) do polling', false,
    'A MEDIR — sem banco nesta máquina. Comando exato no comentário acima deste bloco.');
end $$;


select * from resultado_0091 order by ordem;
