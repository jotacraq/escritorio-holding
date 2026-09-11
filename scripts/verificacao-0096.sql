-- scripts/verificacao-0096.sql — roteiro da Fase 10, Fatia 3 (copiloto_ciclos:
-- a claim atômica do ciclo automático).
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- `postgres`, com 0091 a 0096 APLICADAS. A última instrução devolve
-- `resultado_0096` (ordem, passo, ok, detalhe). `ok = true` em todas prova
-- que o banco faz o que a 0096 promete.
--
-- TUDO COM ROLLBACK, mesmo padrão de `verificacao-0091.sql`/
-- `verificacao-0092-0093.sql`: cada bloco que escreve vive num sub-`begin …
-- exception … end` terminado em `raise exception 'rollback_proposital'`, e o
-- INSERT no resultado acontece FORA dele.
--
-- RELEITURA OBRIGATÓRIA (regra da casa, 4 bugs fatais catalogados em roteiros
-- anteriores desta fase): a cada passo abaixo, a pergunta é "o que este
-- passo ASSUME que já existe no banco, e o que acontece se não existir — ou
-- se existir demais?". As notas ao lado de cada bloco respondem a isso por
-- escrito, não só o código.
--
-- O QUE ESTE ROTEIRO PROVA
--   0  a tabela existe, com as colunas e CHECKs certos
--   1  PK (sessao_id, janela) É a claim: 2ª tentativa da MESMA janela é
--        RECUSADA por unique_violation — nunca dependeu de um SELECT prévio
--   2  janelas DIFERENTES da mesma sessão coexistem (a PK não é over-broad:
--        não trava a sessão inteira, só a janela)
--   3  on delete cascade: apagar a sessão apaga os ciclos dela
--   4  CHECK de gatilho recusa valor fora da lista fechada; CHECK de
--        janela >= 0 recusa negativo
--   5  RLS: anon (sem sessão) não lê nem escreve
--   6  RLS: authenticated LÊ mas NÃO ESCREVE (nem INSERT, nem UPDATE, nem
--        DELETE) — a claim é sempre do servidor (service_role), nunca da tela
--   7  privilégios: `has_table_privilege` confirma o GRANT exato (select+
--        insert para service_role; só select para authenticated; nada para
--        anon) — prova por CATÁLOGO, não só por tentativa de acesso (a 5/6
--        já provam por tentativa; esta prova por definição, cobrindo o caso
--        de RLS estar correta mas o GRANT ter sido esquecido, ou vice-versa)
--   8  `explain (analyze)` — A MEDIR, 6 comandos: (a) a CLAIM
--        (insert...on conflict), (b) a leitura "última janela da sessão"
--        (order by janela desc limit 1), (c) a query de SUGESTÕES do
--        polling coalescido (armadilha do cursor-uuid, §2.2 do plano — é a
--        que MAIS precisa do plano medido), (d1)/(d2) as duas leituras de
--        `avaliarGatilho` em sessoes_copiloto_segmentos (com/sem ciclo
--        anterior). CORREÇÃO (achado do Fable, 2ª rodada): (c) e (d1)/(d2)
--        não existiam em roteiro nenhum — o aceite do plano (§12) exige as
--        DUAS queries de polling, e só a de segmentos tinha comando (em
--        verificacao-0091.sql §7, não aqui).
--   9  descrições de polling_ms/duracao_maxima_minutos corrigidas pelo
--        UPDATE aditivo desta migration (achado do frontend/coordenador)
-- ---------------------------------------------------------------------------

drop table if exists resultado_0096;
create temp table resultado_0096 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r96(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0096 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;


-- ===========================================================================
-- 0 · A tabela existe, com as colunas certas.
--
-- ASSUME: 0096 aplicada. Se NÃO estiver, `to_regclass` devolve NULL e o passo
-- reporta `ok=false` com detalhe claro — não lança exceção que derrubaria o
-- roteiro inteiro (mesma prevenção do achado do Fable em 0091, passo 0).
-- ===========================================================================
do $$
declare
  v_existe boolean;
  v_colunas_faltando text := '';
  v_col text;
  v_esperadas text[] := array['sessao_id', 'janela', 'gatilho', 'bloco_indice', 'criado_em'];
begin
  v_existe := to_regclass('public.copiloto_ciclos') is not null;

  if v_existe then
    foreach v_col in array v_esperadas loop
      if not exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'copiloto_ciclos' and column_name = v_col
      ) then
        v_colunas_faltando := v_colunas_faltando || v_col || ' ';
      end if;
    end loop;
  end if;

  perform pg_temp.r96('0 · tabela copiloto_ciclos existe com as colunas certas',
    v_existe and v_colunas_faltando = '',
    'existe=' || v_existe || ' colunas_faltando=[' || v_colunas_faltando || ']');
end $$;


-- ===========================================================================
-- 1 · A PK (sessao_id, janela) É A CLAIM — a 2ª tentativa da MESMA janela
-- falha por unique_violation, sem depender de um SELECT antes (é
-- exatamente o padrão `insert ... on conflict do nothing returning` que
-- `server/copiloto/ciclo.ts::reivindicarJanela` usa).
--
-- ASSUME: uma sessão real existe para satisfazer a FK de `sessao_id`
-- (criada aqui, não um uuid solto — mesma lição do passo 4 de
-- `verificacao-0091.sql`: uuid que não existe quebraria por
-- foreign_key_violation, não pelo unique_violation que este passo quer
-- provar, e o erro sem handler mataria o roteiro).
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_sessao uuid;
  v_primeira_ok boolean := false;
  v_segunda_recusada boolean := false;
  v_ok boolean;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificação 0096 A', 'verif0096a@example.com', '+5511921960000', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_sessao;

    insert into copiloto_ciclos (sessao_id, janela, gatilho, bloco_indice) values (v_sessao, 0, 'intervalo', 0);
    v_primeira_ok := true;

    begin
      insert into copiloto_ciclos (sessao_id, janela, gatilho, bloco_indice) values (v_sessao, 0, 'virada_bloco', 1);
    exception when unique_violation then v_segunda_recusada := true;
    end;

    v_ok := v_primeira_ok and v_segunda_recusada;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r96('1 · PK (sessao_id,janela) é a claim', false, 'exceção: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r96('1 · 2ª tentativa da MESMA janela é recusada por unique_violation (a claim)', coalesce(v_ok, false),
    'primeira_ok=' || v_primeira_ok || ' segunda_recusada=' || v_segunda_recusada);
end $$;


-- ===========================================================================
-- 2 · Janelas DIFERENTES da mesma sessão coexistem — a PK não é ampla demais
-- (não trava a sessão inteira, só aquela janela específica). Prova que o
-- passo 1 não "passaria à toa" por um índice único em `sessao_id` sozinho.
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_sessao uuid;
  v_qtd int;
  v_ok boolean;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificação 0096 B', 'verif0096b@example.com', '+5511921960001', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_sessao;

    insert into copiloto_ciclos (sessao_id, janela, gatilho) values (v_sessao, 0, 'intervalo');
    insert into copiloto_ciclos (sessao_id, janela, gatilho) values (v_sessao, 1, 'intervalo');
    insert into copiloto_ciclos (sessao_id, janela, gatilho) values (v_sessao, 2, 'virada_bloco');

    select count(*) into v_qtd from copiloto_ciclos where sessao_id = v_sessao;

    v_ok := v_qtd = 3;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r96('2 · janelas diferentes coexistem', false, 'exceção: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r96('2 · 3 janelas diferentes da mesma sessão coexistem (PK não é over-broad)', coalesce(v_ok, false),
    'qtd_inserida=' || coalesce(v_qtd::text, '?') || ' (esperado 3)');
end $$;


-- ===========================================================================
-- 3 · on delete cascade — apagar a sessão apaga os ciclos dela.
--
-- ASSUME: a FK foi declarada com `on delete cascade` (0096). Se a migration
-- tiver sido alterada sem essa cláusula, o DELETE da sessão abaixo falharia
-- por foreign_key_violation ANTES de chegar no `raise exception
-- 'rollback_proposital'` — o handler `when others` captura isso e reporta
-- `ok=false` com a mensagem real, não mascara como sucesso.
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_sessao uuid;
  v_qtd_antes int; v_qtd_depois int;
  v_ok boolean;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificação 0096 C', 'verif0096c@example.com', '+5511921960002', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_sessao;

    insert into copiloto_ciclos (sessao_id, janela, gatilho) values (v_sessao, 0, 'intervalo');
    select count(*) into v_qtd_antes from copiloto_ciclos where sessao_id = v_sessao;

    delete from sessoes_viabilidade where id = v_sessao;
    select count(*) into v_qtd_depois from copiloto_ciclos where sessao_id = v_sessao;

    v_ok := v_qtd_antes = 1 and v_qtd_depois = 0;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r96('3 · on delete cascade', false, 'exceção: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r96('3 · apagar a sessão apaga os ciclos (on delete cascade)', coalesce(v_ok, false),
    'qtd_antes=' || coalesce(v_qtd_antes::text, '?') || ' qtd_depois=' || coalesce(v_qtd_depois::text, '?'));
end $$;


-- ===========================================================================
-- 4 · CHECK de gatilho recusa valor fora da lista fechada; CHECK de janela
-- recusa negativo.
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_sessao uuid;
  v_gatilho_recusou boolean := false;
  v_janela_recusou boolean := false;
  v_ok boolean;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificação 0096 D', 'verif0096d@example.com', '+5511921960003', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_sessao;

    begin
      insert into copiloto_ciclos (sessao_id, janela, gatilho) values (v_sessao, 0, 'lixo');
    exception when check_violation then v_gatilho_recusou := true;
    end;

    begin
      insert into copiloto_ciclos (sessao_id, janela, gatilho) values (v_sessao, -1, 'intervalo');
    exception when check_violation then v_janela_recusou := true;
    end;

    v_ok := v_gatilho_recusou and v_janela_recusou;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r96('4 · CHECKs de gatilho/janela', false, 'exceção: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r96('4 · CHECK gatilho fecha lista + CHECK janela>=0', coalesce(v_ok, false),
    'gatilho_recusou=' || v_gatilho_recusou || ' janela_recusou=' || v_janela_recusou);
end $$;


-- ===========================================================================
-- 5 · RLS — anon (sem sessão) não lê nem escreve.
--
-- ASSUME: uma sessão REAL existe para o INSERT de teste referenciar (mesma
-- lição do passo 4 de verificacao-0091.sql — uuid solto quebraria por
-- foreign_key_violation, não capturado por `insufficient_privilege`, e
-- mataria o roteiro antes do passo 6).
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_sessao uuid;
  v_ok boolean;
  v_erro_sel text := ''; v_erro_ins text := '';
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificação 0096 E', 'verif0096e@example.com', '+5511921960004', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_sessao;

    set local role anon;
    begin
      perform 1 from copiloto_ciclos limit 1;
      v_erro_sel := v_erro_sel || 'copiloto_ciclos_leu ';
    exception when insufficient_privilege then null;
    end;
    begin
      insert into copiloto_ciclos (sessao_id, janela, gatilho) values (v_sessao, 999, 'intervalo');
      v_erro_ins := v_erro_ins || 'copiloto_ciclos_inseriu ';
    exception
      when insufficient_privilege then null;
      when others then v_erro_ins := v_erro_ins || ('erro_inesperado:' || sqlerrm) || ' ';
    end;
    reset role;

    v_ok := v_erro_sel = '' and v_erro_ins = '';
    raise exception 'rollback_proposital';
  exception when others then
    reset role; -- garante que `set local role anon` não vaza se algo estourou antes do reset de cima
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r96('5 · RLS: anon fora', false, 'exceção: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r96('5 · RLS: anon não lê nem escreve em copiloto_ciclos', coalesce(v_ok, false),
    'vazamentos_select=[' || v_erro_sel || '] vazamentos_insert=[' || v_erro_ins || ']');
end $$;


-- ===========================================================================
-- 6 · RLS — `authenticated` (via has_table_privilege, sem depender de
-- app.ve_patrimonio()=true, que exigiria um perfis_equipe real vinculado a
-- auth.uid() — mesma limitação já documentada no passo 5 de
-- verificacao-0091.sql) NÃO tem INSERT/UPDATE/DELETE, só SELECT.
--
-- ASSUME: o GRANT da 0096 foi aplicado exatamente como o arquivo descreve
-- (`grant select on copiloto_ciclos to authenticated`, nada mais). Se um
-- GRANT futuro adicionar INSERT "para conveniência", este passo pega —
-- é o tipo de regressão silenciosa que só um roteiro específico vê.
-- ===========================================================================
do $$
declare
  v_erros text := '';
begin
  if not has_table_privilege('authenticated', 'copiloto_ciclos', 'select') then v_erros := v_erros || 'authenticated_sem_select '; end if;
  if has_table_privilege('authenticated', 'copiloto_ciclos', 'insert') then v_erros := v_erros || 'authenticated_com_insert '; end if;
  if has_table_privilege('authenticated', 'copiloto_ciclos', 'update') then v_erros := v_erros || 'authenticated_com_update '; end if;
  if has_table_privilege('authenticated', 'copiloto_ciclos', 'delete') then v_erros := v_erros || 'authenticated_com_delete '; end if;

  perform pg_temp.r96('6 · authenticated: só SELECT, nunca escrita', v_erros = '',
    case when v_erros = '' then 'ok' else 'ACHADOS: ' || v_erros end);
end $$;


-- ===========================================================================
-- 7 · Privilégios por CATÁLOGO — anon fora de tudo; service_role com
-- select+insert, sem update/delete (append-only, comentário de topo da 0096).
--
-- Esta prova é DIFERENTE da 5/6 (que provam por TENTATIVA de acesso): aqui
-- provamos por DEFINIÇÃO do GRANT, o que cobre o caso em que a RLS está
-- correta mas o GRANT foi esquecido (ou vice-versa) — os dois têm que
-- casar, "service_role não dispensa nenhum dos dois" (regra da casa).
-- ===========================================================================
do $$
declare
  v_erros text := '';
begin
  if has_table_privilege('anon', 'copiloto_ciclos', 'select') then v_erros := v_erros || 'anon_com_select '; end if;
  if has_table_privilege('anon', 'copiloto_ciclos', 'insert') then v_erros := v_erros || 'anon_com_insert '; end if;

  if not has_table_privilege('service_role', 'copiloto_ciclos', 'select') then v_erros := v_erros || 'service_role_sem_select '; end if;
  if not has_table_privilege('service_role', 'copiloto_ciclos', 'insert') then v_erros := v_erros || 'service_role_sem_insert '; end if;
  if has_table_privilege('service_role', 'copiloto_ciclos', 'update') then v_erros := v_erros || 'service_role_com_update '; end if;
  if has_table_privilege('service_role', 'copiloto_ciclos', 'delete') then v_erros := v_erros || 'service_role_com_delete '; end if;

  perform pg_temp.r96('7 · GRANT por catálogo: anon fora, service_role select+insert só', v_erros = '',
    case when v_erros = '' then 'ok' else 'ACHADOS: ' || v_erros end);
end $$;


-- ===========================================================================
-- 8 · `explain (analyze)` — A MEDIR contra o banco real. Sem `.env` nesta
-- máquina não há como rodar (mesmo aviso de honestidade do plano/§ demais
-- roteiros desta fase). Comandos exatos, para colar no MCP/SQL Editor com
-- dado de exemplo populado (uma sessão com algumas dezenas de janelas e
-- algumas sugestões):
--
--   -- (a) a CLAIM (o INSERT que server/copiloto/ciclo.ts::reivindicarJanela
--   -- faz a cada avaliação de gatilho positiva — a query em si não tem
--   -- `explain` de INSERT direto e simples, mas o CONFLITO é resolvido via
--   -- Index Scan sobre a PK; medir com uma janela JÁ EXISTENTE, que é o
--   -- caso que precisa ser rápido (a claim perdida, N vezes por sessão se
--   -- N abas estiverem abertas):
--   explain (analyze, buffers)
--   insert into copiloto_ciclos (sessao_id, janela, gatilho, bloco_indice)
--   values ('<uuid de uma sessão com ciclo já existente na janela 5>', 5, 'intervalo', 2)
--   on conflict (sessao_id, janela) do nothing;
--
--   -- (b) a leitura "última janela desta sessão" (server/copiloto/
--   -- gatilho.ts::avaliarGatilho — `order by janela desc limit 1`, sobre a
--   -- PK, que já ordena):
--   explain (analyze, buffers)
--   select janela, criado_em, bloco_indice
--     from copiloto_ciclos
--    where sessao_id = '<uuid de uma sessão com várias janelas>'
--    order by janela desc
--    limit 1;
--
-- Esperado em (a)/(b): "Index Scan" (ou "Index Only Scan") sobre a PK
-- `copiloto_ciclos_pkey`, NUNCA "Seq Scan" — e tempo de execução na casa de
-- fração de milissegundo, dado que uma sessão tem no máximo ~120 janelas
-- possíveis (90min / 45s, §4.4 do plano).
--
--   -- (c) a query de SUGESTÕES do polling coalescido
--   -- (route.ts::buscarSugestoesNovas) — é a que o §2.2 do plano marca
--   -- explicitamente com "a armadilha do cursor-uuid": o cursor É
--   -- `ordem_evento` (bigint identity, que ORDENA), nunca `id` (uuid, que
--   -- NÃO ordena). Se este `explain` um dia mostrar a query filtrando por
--   -- `id` em vez de `ordem_evento`, é a armadilha tendo acontecido de
--   -- verdade — não um detalhe cosmético:
--   explain (analyze, buffers)
--   select id, ordem_evento, gatilho, conteudo, confianca, desfecho, criado_em
--     from copiloto_sugestoes
--    where sessao_id = '<uuid de uma sessão com sugestões>'
--      and ordem_evento > 0
--    order by ordem_evento
--    limit 20;
--
-- Esperado em (c): "Index Scan" (ou "Index Only Scan") usando
-- `idx_copiloto_sugestoes_polling (sessao_id, ordem_evento)` (0091), NUNCA
-- "Seq Scan" e NUNCA um "Sort" separado (a ordem já vem do índice) — poucas
-- dezenas de linhas por sessão no máximo (teto de 30 execuções de IA/sessão,
-- §4.4).
--
--   -- (d) as DUAS leituras de `sessoes_copiloto_segmentos` dentro de
--   -- `server/copiloto/gatilho.ts::avaliarGatilho` — predicado REAL
--   -- (corrigido no comentário de `gatilho.ts`, achado do Fable: a versão
--   -- anterior descrevia `ordem > $2`, que NÃO é o que o código roda):
--
--   -- (d1) COM ciclo anterior — where sessao_id=$1 and criado_em>$2 limit 1:
--   explain (analyze, buffers)
--   select ordem
--     from sessoes_copiloto_segmentos
--    where sessao_id = '<uuid de uma sessão com segmentos>'
--      and criado_em > now() - interval '1 minute'
--    limit 1;
--
--   -- (d2) SEM ciclo anterior (1ª avaliação da sessão) — where sessao_id=$1 limit 1:
--   explain (analyze, buffers)
--   select ordem
--     from sessoes_copiloto_segmentos
--    where sessao_id = '<uuid de uma sessão com segmentos>'
--    limit 1;
--
-- Esperado em (d1)/(d2): "Index Scan" sobre `idx_copiloto_segmentos_polling
-- (sessao_id, ordem)` — a `criado_em` de (d1) NÃO tem índice próprio e vira
-- filtro RESIDUAL dentro do Index Scan já restrito por `sessao_id` (aceitável
-- pela cardinalidade pequena por sessão, ~180 segmentos no teto do desenho,
-- §2.1 do plano — o `explain` aqui é o que PROVA essa aceitação, não uma
-- suposição). `.limit(1)` faz o planner parar assim que achar a 1ª linha —
-- não deveria variar com o tamanho da sessão.
--
-- Colar a saída CRUA de (a)-(d2) na entrega — não estimar nenhuma.
-- ===========================================================================
do $$
begin
  -- `ok=false`, NUNCA `null`: a coluna `ok` é `not null` — um `null` aqui
  -- violaria a constraint e MATARIA O ROTEIRO INTEIRO antes do `select`
  -- final (o mesmo bug catalogado no passo 7 de verificacao-0091.sql,
  -- prevenido aqui desde a primeira versão deste arquivo).
  perform pg_temp.r96('8 · explain (analyze): claim, última janela, sugestões do polling, 2 leituras do gatilho', false,
    'A MEDIR — sem banco nesta máquina. Comandos exatos (a)-(d2) no comentário acima deste bloco.');
end $$;


-- ===========================================================================
-- 9 · Descrições de `polling_ms`/`duracao_maxima_minutos` foram corrigidas
-- pelo UPDATE aditivo desta migration (achado do coordenador/frontend: as
-- duas chaves tinham descrição prometendo leitura que o código não fazia).
--
-- ASSUME: a 0091 aplicada primeiro (as linhas existem) e o UPDATE desta
-- migration rodou depois — se a 0091 não estiver aplicada, `v_desc_polling`/
-- `v_desc_duracao` vêm NULL e o passo reporta `ok=false` com detalhe, nunca
-- lança (mesma prevenção do passo 0).
-- ===========================================================================
do $$
declare
  v_desc_polling text;
  v_desc_duracao text;
  v_ok boolean;
begin
  select descricao into v_desc_polling from configuracoes where chave = 'copiloto_sessao.polling_ms';
  select descricao into v_desc_duracao from configuracoes where chave = 'copiloto_sessao.duracao_maxima_minutos';

  v_ok := v_desc_polling is not null and v_desc_polling like '%lerConfigPollingCopiloto%'
      and v_desc_duracao is not null and v_desc_duracao like '%executarCicloCopiloto%';

  perform pg_temp.r96('9 · descrições de polling_ms/duracao_maxima_minutos corrigidas (UPDATE aditivo)',
    coalesce(v_ok, false),
    'polling_ms_aponta_pro_codigo=' || (v_desc_polling like '%lerConfigPollingCopiloto%') ||
    ' duracao_maxima_aponta_pro_codigo=' || (v_desc_duracao like '%executarCicloCopiloto%'));
end $$;


-- ===========================================================================
-- NOTA NÃO BLOQUEANTE (Fable, 2ª rodada) — "que a medição decida, não eu".
--
-- `GET /api/sessoes/[id]/copiloto` lê `configuracoes` por CHAVE separada em
-- cada chamada: `copiloto_sessao.ativo` (kill-switch), `.confianca_minima`
-- (visibilidade das sugestões novas do polling) e `.polling_ms` (esta
-- correção) — 3 leituras SEMPRE. `executarCicloCopiloto` soma pelo menos
-- mais 1 (`.duracao_maxima_minutos`, checado antes do gatilho, sempre) e,
-- só quando o gatilho dispara, mais `.intervalo_segundos`,
-- `.confianca_minima` (2ª vez, dentro do ciclo) e os 2 tetos de orçamento
-- (`conferirOrcamentoCopiloto`) — até 8 no caminho raro, 4 no caminho comum
-- (silêncio, sem disparo).
--
-- A 1.800 chamadas/sessão (90min / 3s, §4.1 do plano), coalescer as leituras
-- SEMPRE-executadas (`ativo`+`confianca_minima`+`polling_ms`+
-- `duracao_maxima_minutos`) numa única `where chave = any(array[...])` é a
-- primeira otimização candidata — mas NÃO foi feita nesta entrega: `chave`
-- é PK (0027), cada leitura isolada já é um Index Scan trivial sobre uma
-- tabela pequena (10-15 linhas), e a decisão de coalescer ou não deve vir
-- de MEDIÇÃO, não de intuição (Fable: "não otimize agora às cegas").
--
-- COMANDO DE MEDIÇÃO — A RODAR quando houver banco/uso real, para decidir
-- com número, não com palpite:
--
--   -- custo de 4 SELECTs isolados por PK (o caminho comum, hoje):
--   explain (analyze, buffers)
--   select valor from configuracoes where chave = 'copiloto_sessao.ativo';
--   explain (analyze, buffers)
--   select valor from configuracoes where chave = 'copiloto_sessao.confianca_minima';
--   explain (analyze, buffers)
--   select valor from configuracoes where chave = 'copiloto_sessao.polling_ms';
--   explain (analyze, buffers)
--   select valor from configuracoes where chave = 'copiloto_sessao.duracao_maxima_minutos';
--
--   -- custo do MESMO resultado coalescido num SELECT só (o candidato):
--   explain (analyze, buffers)
--   select chave, valor from configuracoes
--    where chave = any(array[
--      'copiloto_sessao.ativo', 'copiloto_sessao.confianca_minima',
--      'copiloto_sessao.polling_ms', 'copiloto_sessao.duracao_maxima_minutos'
--    ]);
--
-- Se a SOMA dos 4 primeiros for materialmente maior que o único (não
-- fração de ms contra fração de ms — RTT de rede real, se o Postgres não
-- estiver na mesma região do app), a coalescência se paga; senão, é troca
-- de 1 função nova (`lerConfiguracoesEmLote`, chamador em 2 módulos
-- diferentes) por ganho que não aparece no p95. Este roteiro não decide —
-- só deixa o comando pronto.
-- ===========================================================================


select * from resultado_0096 order by ordem;
