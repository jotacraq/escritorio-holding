-- scripts/verificacao-0125.sql — roteiro do RETROSPECTO DA SESSÃO (0125):
-- tabela `copiloto_retrospectos` + 2 chaves novas de `configuracoes` + a
-- depreciação por descrição de `copiloto_sessao.rodape_transcricao`.
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- `postgres`, com 0091 a 0125 APLICADAS. A última instrução devolve
-- `resultado_0125` (ordem, passo, ok, detalhe). `ok = true` em TODAS prova
-- que o banco faz o que a 0125 promete.
--
-- TUDO COM ROLLBACK, mesmo padrão de `verificacao-0120.sql`/`0122.sql`: cada
-- bloco que ESCREVE vive num sub-`begin … exception … end` terminado em
-- `raise exception 'rollback_proposital'`, e o INSERT no resultado acontece
-- FORA dele. Nenhuma linha sobrevive a este roteiro.
--
-- 🔴 POR QUE ESTE ROTEIRO EXISTE: build verde não vê regra que mora no banco.
-- `npx tsc` e `npx vitest` não sabem se `force row level security` está
-- ligado, se o `proacl` da tabela nova deixou `authenticated` com INSERT por
-- default privilege, nem se o CHECK de 32 KB é real ou decorativo.
--
-- O QUE ESTE ROTEIRO PROVA
--   0  a tabela existe, com PK = sessao_id e as FKs com ON DELETE CASCADE
--   1  relrowsecurity E relforcerowsecurity = true (service_role NÃO dispensa)
--   2  proacl: authenticated só com SELECT; anon/public com NADA;
--      service_role com select/insert/update/delete — e NENHUM privilégio de
--      escrita para authenticated vindo de default privilege
--      ("função/tabela nova nasce exposta a authenticated" já mordeu esta base)
--   3  policies: exatamente 1, de SELECT, com app.ve_patrimonio()
--   4  🔴 ENCERRAR 2× → 1 LINHA (a PK é o invariante), com DO…INSERT…RAISE
--   5  INSERT como `authenticated` é NEGADO (sem policy de escrita)
--   6  CHECK de 32 KB em `conteudo` recusa documento maior
--   7  CHECK `blocos_com_atividade <= blocos_no_roteiro` e `blocos_no_roteiro > 0`
--   8  CHECK `origem='ia'` exige `execucao_ia_id` (prompt versionado é regra)
--   9  as 2 chaves novas existem com o valor de nascença (true)
--  10  `rodape_transcricao` continua EXISTINDO, com descrição de DEPRECADA
--  11  índice `idx_copiloto_retrospectos_jornada` existe
--  12  reaplicar a migration inteira não duplica chave nem falha
--  13  🔴 COBERTURA MEDIDA nas 3 sessões reais: 4/13, 9/13, 6/13 (só leitura)
-- ---------------------------------------------------------------------------

drop table if exists resultado_0125;
create temp table resultado_0125 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r125(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0125 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;


-- ===========================================================================
-- 0 · A tabela existe, PK = sessao_id, FKs com ON DELETE CASCADE.
-- ===========================================================================
do $$
declare
  v_pk text;
  v_fk_sessao text;
  v_fk_jornada text;
  v_fk_criado_por text;
begin
  select pg_get_constraintdef(oid) into v_pk
    from pg_constraint where conrelid = 'public.copiloto_retrospectos'::regclass and contype = 'p';

  select pg_get_constraintdef(oid) into v_fk_sessao
    from pg_constraint
   where conrelid = 'public.copiloto_retrospectos'::regclass and contype = 'f'
     and pg_get_constraintdef(oid) ilike '%sessoes_copiloto%';

  select pg_get_constraintdef(oid) into v_fk_jornada
    from pg_constraint
   where conrelid = 'public.copiloto_retrospectos'::regclass and contype = 'f'
     and pg_get_constraintdef(oid) ilike '%jornadas%';

  select pg_get_constraintdef(oid) into v_fk_criado_por
    from pg_constraint
   where conrelid = 'public.copiloto_retrospectos'::regclass and contype = 'f'
     and pg_get_constraintdef(oid) ilike '%perfis_equipe%';

  perform pg_temp.r125('0 · tabela existe; PK=(sessao_id); FK sessao/jornada com ON DELETE CASCADE; FK criado_por em perfis_equipe',
    coalesce(v_pk,'') ilike '%(sessao_id)%'
      and coalesce(v_fk_sessao,'') ilike '%on delete cascade%'
      and coalesce(v_fk_jornada,'') ilike '%on delete cascade%'
      and coalesce(v_fk_criado_por,'') ilike '%perfis_equipe%',
    'pk=' || coalesce(v_pk,'AUSENTE') || ' | fk_sessao=' || coalesce(v_fk_sessao,'AUSENTE') ||
    ' | fk_jornada=' || coalesce(v_fk_jornada,'AUSENTE') || ' | fk_criado_por=' || coalesce(v_fk_criado_por,'AUSENTE'));
exception when undefined_table then
  perform pg_temp.r125('0 · tabela copiloto_retrospectos existe', false, 'TABELA AUSENTE — a 0125 nao foi aplicada');
end $$;


-- ===========================================================================
-- 1 · relrowsecurity E relforcerowsecurity. 🔴 As DUAS: sem `force`, o DONO
-- da tabela (e qualquer papel com BYPASSRLS) lê tudo, e a policy vira
-- decoração para metade dos caminhos.
-- ===========================================================================
do $$
declare v_enable boolean; v_force boolean;
begin
  select relrowsecurity, relforcerowsecurity into v_enable, v_force
    from pg_class where oid = 'public.copiloto_retrospectos'::regclass;

  perform pg_temp.r125('1 · RLS enable=true E force=true em copiloto_retrospectos',
    coalesce(v_enable,false) and coalesce(v_force,false),
    'relrowsecurity=' || coalesce(v_enable::text,'?') || ' relforcerowsecurity=' || coalesce(v_force::text,'?'));
exception when undefined_table then
  perform pg_temp.r125('1 · RLS enable=true E force=true', false, 'TABELA AUSENTE');
end $$;


-- ===========================================================================
-- 2 · 🔴 PROACL/RELACL — a armadilha catalogada desta base ("nova nasce
-- exposta a authenticated"). `authenticated` só pode ter SELECT; `anon` e
-- `public` NADA; `service_role` com as 4. O `revoke all ... from public,
-- anon, authenticated` da 0125 é o que garante isso mesmo com a 0065b já
-- tendo revogado os default privileges.
-- ===========================================================================
do $$
declare
  v_acl text;
  v_auth_escreve boolean;
  v_auth_le boolean;
  v_anon boolean;
  v_public boolean;
  v_service boolean;
begin
  select coalesce(array_to_string(relacl, ' '), '') into v_acl
    from pg_class where oid = 'public.copiloto_retrospectos'::regclass;

  v_auth_le   := has_table_privilege('authenticated', 'public.copiloto_retrospectos', 'SELECT');
  v_auth_escreve := has_table_privilege('authenticated', 'public.copiloto_retrospectos', 'INSERT')
                 or has_table_privilege('authenticated', 'public.copiloto_retrospectos', 'UPDATE')
                 or has_table_privilege('authenticated', 'public.copiloto_retrospectos', 'DELETE');
  v_anon := has_table_privilege('anon', 'public.copiloto_retrospectos', 'SELECT')
         or has_table_privilege('anon', 'public.copiloto_retrospectos', 'INSERT');
  v_public := v_acl like '%=%/%' and v_acl ~ '(^| )=[a-zA-Z]';
  v_service := has_table_privilege('service_role', 'public.copiloto_retrospectos', 'INSERT')
           and has_table_privilege('service_role', 'public.copiloto_retrospectos', 'SELECT')
           and has_table_privilege('service_role', 'public.copiloto_retrospectos', 'UPDATE')
           and has_table_privilege('service_role', 'public.copiloto_retrospectos', 'DELETE');

  perform pg_temp.r125('2 · GRANTs: authenticated SÓ select; anon NADA; public NADA; service_role select/insert/update/delete',
    v_auth_le and not v_auth_escreve and not v_anon and not v_public and v_service,
    'relacl=' || v_acl || ' | auth_select=' || v_auth_le::text || ' auth_escreve=' || v_auth_escreve::text ||
    ' anon=' || v_anon::text || ' public=' || v_public::text || ' service_role_4=' || v_service::text);
exception when undefined_table then
  perform pg_temp.r125('2 · GRANTs corretos', false, 'TABELA AUSENTE');
end $$;


-- ===========================================================================
-- 3 · Policies — exatamente UMA, de SELECT, para `authenticated`, usando
-- `app.ve_patrimonio()` (o recorte ESTREITO) e NÃO `eh_interno()`.
-- ===========================================================================
do $$
declare
  v_total int;
  v_sel int;
  v_qual text;
  v_escrita int;
begin
  select count(*) into v_total from pg_policies
   where schemaname = 'public' and tablename = 'copiloto_retrospectos';

  select count(*) into v_sel from pg_policies
   where schemaname = 'public' and tablename = 'copiloto_retrospectos' and cmd = 'SELECT';

  select count(*) into v_escrita from pg_policies
   where schemaname = 'public' and tablename = 'copiloto_retrospectos' and cmd in ('INSERT','UPDATE','DELETE','ALL');

  select qual into v_qual from pg_policies
   where schemaname = 'public' and tablename = 'copiloto_retrospectos' and cmd = 'SELECT' limit 1;

  perform pg_temp.r125('3 · 1 policy só, de SELECT, com app.ve_patrimonio(); ZERO policy de escrita para authenticated',
    v_total = 1 and v_sel = 1 and v_escrita = 0
      and coalesce(v_qual,'') ilike '%ve_patrimonio%' and coalesce(v_qual,'') not ilike '%eh_interno%',
    'total=' || v_total || ' select=' || v_sel || ' escrita=' || v_escrita || ' qual=' || coalesce(v_qual,'AUSENTE'));
end $$;


-- ===========================================================================
-- 4 · 🔴 ENCERRAR 2× → 1 LINHA. O teste que justifica a PK ser `sessao_id`:
-- a idempotência é INVARIANTE DE BANCO, não disciplina de código. Simula as
-- DUAS formas que o encerramento pode ser chamado em corrida:
--   (a) o `insert ... on conflict (sessao_id) do nothing` que o código faz —
--       2 chamadas, 1 linha, ZERO erro;
--   (b) um `insert` CRU (código futuro que esqueça o on conflict) — tem de
--       explodir com 23505, nunca criar a 2ª linha.
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_sessao uuid;
  v_linhas int;
  v_afetadas1 int; v_afetadas2 int;
  v_cru_recusou boolean := false;
  v_ok boolean;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificacao 0125 A', 'verif0125a@example.com', '+5511921970125', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_sessao;
    insert into sessoes_copiloto (sessao_id) values (v_sessao);

    -- (a) 1ª "encerrada": grava.
    insert into copiloto_retrospectos (sessao_id, jornada_id, blocos_com_atividade, blocos_no_roteiro, conteudo)
    values (v_sessao, v_j, 9, 13, '{"versao":1,"origem":"primeira"}'::jsonb)
    on conflict (sessao_id) do nothing;
    get diagnostics v_afetadas1 = row_count;

    -- (a) 2ª "encerrada" (clique duplo / ciclo automático no mesmo segundo):
    -- NÃO grava, NÃO sobrescreve, NÃO levanta.
    insert into copiloto_retrospectos (sessao_id, jornada_id, blocos_com_atividade, blocos_no_roteiro, conteudo)
    values (v_sessao, v_j, 1, 13, '{"versao":1,"origem":"SEGUNDA-NAO-PODE-EXISTIR"}'::jsonb)
    on conflict (sessao_id) do nothing;
    get diagnostics v_afetadas2 = row_count;

    select count(*) into v_linhas from copiloto_retrospectos where sessao_id = v_sessao;

    -- (b) INSERT cru: a PK tem de recusar, mesmo sem `on conflict`.
    begin
      insert into copiloto_retrospectos (sessao_id, jornada_id, blocos_com_atividade, blocos_no_roteiro, conteudo)
      values (v_sessao, v_j, 2, 13, '{"versao":1}'::jsonb);
    exception when unique_violation then
      v_cru_recusou := true;
    end;

    v_ok := v_afetadas1 = 1 and v_afetadas2 = 0 and v_linhas = 1 and v_cru_recusou;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r125('4 · encerrar 2x gera 1 linha só (PK = invariante de banco)', false, 'excecao: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r125('4 · 🔴 ENCERRAR 2x → 1 LINHA (on conflict do nothing nao grava a 2a; insert cru e recusado por PK)',
    coalesce(v_ok,false),
    'afetadas_1a=' || coalesce(v_afetadas1::text,'?') || ' afetadas_2a=' || coalesce(v_afetadas2::text,'?') ||
    ' linhas=' || coalesce(v_linhas::text,'?') || ' insert_cru_recusado=' || coalesce(v_cru_recusou::text,'?'));
end $$;


-- ===========================================================================
-- 5 · INSERT como `authenticated` é NEGADO. Duas travas somadas: não há
-- GRANT de INSERT (erro 42501) e não há policy de INSERT. Qualquer uma que
-- falte já abriria a escrita para a tela.
-- ===========================================================================
do $$
declare
  v_negou boolean := false;
  v_sqlstate text;
begin
  begin
    set local role authenticated;
    insert into copiloto_retrospectos (sessao_id, jornada_id, blocos_com_atividade, blocos_no_roteiro, conteudo)
    values (gen_random_uuid(), gen_random_uuid(), 1, 13, '{"versao":1}'::jsonb);
    reset role;
  exception when others then
    v_sqlstate := sqlstate;
    v_negou := sqlstate in ('42501', '23503'); -- sem privilegio OU barrado antes pela FK
    begin reset role; exception when others then null; end;
  end;
  perform pg_temp.r125('5 · INSERT como authenticated e NEGADO (sem grant e sem policy de escrita)',
    coalesce(v_negou,false), 'sqlstate=' || coalesce(v_sqlstate,'NENHUM ERRO — ESCRITA PASSOU!'));
end $$;


-- ===========================================================================
-- 6 · CHECK de 32 KB em `conteudo` — backstop REAL, não decorativo (a poda
-- em TypeScript tem alvo 28.000 B; este CHECK é o que segura se ela quebrar).
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_sessao uuid;
  v_grande jsonb;
  v_recusou boolean := false;
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conname = 'copiloto_retrospectos_conteudo_teto';

  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificacao 0125 B', 'verif0125b@example.com', '+5511921970126', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_sessao;
    insert into sessoes_copiloto (sessao_id) values (v_sessao);

    -- ~60 KB de texto incompressível o bastante para estourar o CHECK.
    select jsonb_build_object('versao', 1, 'lixo', string_agg(md5(random()::text), ''))
      into v_grande from generate_series(1, 2000);

    begin
      insert into copiloto_retrospectos (sessao_id, jornada_id, blocos_com_atividade, blocos_no_roteiro, conteudo)
      values (v_sessao, v_j, 1, 13, v_grande);
    exception when check_violation then
      v_recusou := true;
    end;

    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r125('6 · CHECK de 32 KB em conteudo recusa documento grande', false, 'excecao: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r125('6 · CHECK de 32 KB em conteudo recusa documento grande (backstop real)',
    coalesce(v_recusou,false) and coalesce(v_def,'') ilike '%pg_column_size%32768%',
    'recusou=' || coalesce(v_recusou::text,'?') || ' def=' || coalesce(v_def,'AUSENTE'));
end $$;


-- ===========================================================================
-- 7 · CHECKs da COBERTURA. `blocos_no_roteiro > 0` (denominador zero seria
-- uma fração sem sentido) e `blocos_com_atividade <= blocos_no_roteiro`
-- (cobertura acima de 100% seria dado sujo entrando como fato).
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_sessao uuid;
  v_denominador_zero boolean := false;
  v_acima_de_100 boolean := false;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificacao 0125 C', 'verif0125c@example.com', '+5511921970127', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_sessao;
    insert into sessoes_copiloto (sessao_id) values (v_sessao);

    begin
      insert into copiloto_retrospectos (sessao_id, jornada_id, blocos_com_atividade, blocos_no_roteiro, conteudo)
      values (v_sessao, v_j, 0, 0, '{"versao":1}'::jsonb);
    exception when check_violation then v_denominador_zero := true; end;

    begin
      insert into copiloto_retrospectos (sessao_id, jornada_id, blocos_com_atividade, blocos_no_roteiro, conteudo)
      values (v_sessao, v_j, 14, 13, '{"versao":1}'::jsonb);
    exception when check_violation then v_acima_de_100 := true; end;

    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r125('7 · CHECKs da cobertura', false, 'excecao: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r125('7 · CHECKs da cobertura: denominador 0 recusado E numerador > denominador recusado',
    coalesce(v_denominador_zero,false) and coalesce(v_acima_de_100,false),
    'denominador_zero_recusado=' || coalesce(v_denominador_zero::text,'?') ||
    ' acima_de_100_recusado=' || coalesce(v_acima_de_100::text,'?'));
end $$;


-- ===========================================================================
-- 8 · `origem='ia'` SEM `execucao_ia_id` e recusado — prompt versionado e
-- regra nao negociavel do CLAUDE.md. A v1 e toda 'derivado'; este CHECK
-- existe para o dia em que a v2 ligar a IA.
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_sessao uuid;
  v_recusou boolean := false;
  v_derivado_ok boolean := false;
begin
  begin
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificacao 0125 D', 'verif0125d@example.com', '+5511921970128', 'exemplo') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'exemplo') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_sessao;
    insert into sessoes_copiloto (sessao_id) values (v_sessao);

    begin
      insert into copiloto_retrospectos (sessao_id, jornada_id, origem, blocos_com_atividade, blocos_no_roteiro, conteudo)
      values (v_sessao, v_j, 'ia', 9, 13, '{"versao":1}'::jsonb);
    exception when check_violation then v_recusou := true; end;

    -- 'derivado' sem execucao_ia_id e o caminho NORMAL da v1 — tem de passar.
    insert into copiloto_retrospectos (sessao_id, jornada_id, origem, blocos_com_atividade, blocos_no_roteiro, conteudo)
    values (v_sessao, v_j, 'derivado', 9, 13, '{"versao":1}'::jsonb);
    v_derivado_ok := true;

    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r125('8 · origem=ia exige execucao_ia_id', false, 'excecao: ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r125('8 · origem=''ia'' SEM execucao_ia_id e RECUSADO; origem=''derivado'' sem ela PASSA (caminho da v1)',
    coalesce(v_recusou,false) and coalesce(v_derivado_ok,false),
    'ia_sem_execucao_recusado=' || coalesce(v_recusou::text,'?') || ' derivado_ok=' || coalesce(v_derivado_ok::text,'?'));
end $$;


-- ===========================================================================
-- 9 · As 2 chaves novas de configuracoes, com o valor de nascenca.
-- ===========================================================================
do $$
declare v_saude jsonb; v_retro jsonb;
begin
  select valor into v_saude from configuracoes where chave = 'copiloto_sessao.saude_captura';
  select valor into v_retro from configuracoes where chave = 'copiloto_sessao.retrospecto_ativo';

  perform pg_temp.r125('9 · copiloto_sessao.saude_captura=true e copiloto_sessao.retrospecto_ativo=true',
    v_saude = 'true'::jsonb and v_retro = 'true'::jsonb,
    'saude_captura=' || coalesce(v_saude::text,'AUSENTE') || ' retrospecto_ativo=' || coalesce(v_retro::text,'AUSENTE'));
end $$;


-- ===========================================================================
-- 10 · `rodape_transcricao` NAO foi apagada (regra da casa: historico se
-- preserva) e a descricao diz que esta DEPRECADA e qual e a substituta.
-- ===========================================================================
do $$
declare v_existe boolean; v_desc text;
begin
  select true, descricao into v_existe, v_desc
    from configuracoes where chave = 'copiloto_sessao.rodape_transcricao';

  perform pg_temp.r125('10 · rodape_transcricao PRESERVADA (nunca delete) e marcada DEPRECADA, apontando saude_captura',
    coalesce(v_existe,false) and coalesce(v_desc,'') ilike '%DEPRECADA%' and coalesce(v_desc,'') ilike '%saude_captura%',
    'existe=' || coalesce(v_existe::text,'false') || ' descricao=' || left(coalesce(v_desc,'AUSENTE'), 200));
end $$;


-- ===========================================================================
-- 11 · Indice da OUTRA pergunta (Ficha 360: "os retrospectos deste cliente").
-- ===========================================================================
do $$
declare v_def text;
begin
  select indexdef into v_def from pg_indexes
   where schemaname = 'public' and indexname = 'idx_copiloto_retrospectos_jornada';

  perform pg_temp.r125('11 · idx_copiloto_retrospectos_jornada (jornada_id, criado_em desc) existe',
    coalesce(v_def,'') ilike '%jornada_id%' and coalesce(v_def,'') ilike '%criado_em DESC%',
    coalesce(v_def,'AUSENTE'));
end $$;


-- ===========================================================================
-- 12 · Reaplicar a migration nao duplica chave nem falha (todo `insert ...
-- on conflict do nothing` / `create table if not exists` desta base tem de
-- ser reexecutavel).
-- ===========================================================================
do $$
declare v_antes int; v_depois int;
begin
  select count(*) into v_antes from configuracoes
   where chave in ('copiloto_sessao.saude_captura', 'copiloto_sessao.retrospecto_ativo');

  insert into configuracoes (chave, valor, descricao) values
   ('copiloto_sessao.saude_captura', 'true'::jsonb, 'reaplicacao'),
   ('copiloto_sessao.retrospecto_ativo', 'true'::jsonb, 'reaplicacao')
  on conflict (chave) do nothing;

  select count(*) into v_depois from configuracoes
   where chave in ('copiloto_sessao.saude_captura', 'copiloto_sessao.retrospecto_ativo');

  perform pg_temp.r125('12 · reaplicar a 0125 nao duplica chave (on conflict do nothing)',
    v_antes = 2 and v_depois = 2, 'antes=' || v_antes || ' depois=' || v_depois);
end $$;


-- ===========================================================================
-- 13 · 🔴 COBERTURA MEDIDA nas 3 sessoes reais — SO LEITURA, nenhuma escrita,
-- nenhuma evidencia literal impressa. Esta e a MESMA conta que
-- `server/copiloto/retrospecto.ts::calcularCobertura` faz em TypeScript:
-- `count(distinct bloco_id)` restrito aos blocos que existem no roteiro
-- DAQUELA sessao, sobre o total de blocos do mesmo roteiro (com fallback
-- para o roteiro ativo quando `roteiro_versao_id` e nulo).
--
-- ESPERADO (medido em 19/09/2026): 4/13, 9/13 e 6/13.
-- ===========================================================================
do $$
declare
  v_linha record;
  v_detalhe text := '';
  v_pares text[] := '{}';
begin
  for v_linha in
    with roteiro as (
      select sv.id as sessao_id,
             coalesce(
               rv.definicao,
               (select definicao from roteiros_versoes where chave = 'sessao_viabilidade' and ativo limit 1)
             ) as definicao
        from sessoes_viabilidade sv
        left join roteiros_versoes rv on rv.id = sv.roteiro_versao_id
    ),
    blocos as (
      select r.sessao_id,
             b->>'id' as bloco_id
        from roteiro r
        cross join lateral jsonb_array_elements(r.definicao->'blocos') b
    ),
    denominador as (
      select sessao_id, count(*)::int as total from blocos group by sessao_id
    ),
    numerador as (
      select cs.sessao_id, count(distinct cs.bloco_id)::int as com_atividade
        from copiloto_sugestoes cs
        join blocos b on b.sessao_id = cs.sessao_id and b.bloco_id = cs.bloco_id
       group by cs.sessao_id
    )
    select d.sessao_id, coalesce(n.com_atividade, 0) as com_atividade, d.total
      from denominador d
      left join numerador n on n.sessao_id = d.sessao_id
     where exists (select 1 from copiloto_sugestoes cs where cs.sessao_id = d.sessao_id)
     order by d.sessao_id
  loop
    v_pares := v_pares || (v_linha.com_atividade || '/' || v_linha.total);
    v_detalhe := v_detalhe || left(v_linha.sessao_id::text, 8) || '=' ||
                 v_linha.com_atividade || '/' || v_linha.total || ' ';
  end loop;

  -- A ordem por `sessao_id` (uuid) nas 3 sessoes reais de 19/09/2026 e:
  --   755d87d7 → 4/13 · b3eca233 → 9/13 · ebbf08d4 → 6/13
  perform pg_temp.r125('13 · 🔴 COBERTURA nas sessoes reais = 4/13, 9/13, 6/13 (mesma conta de retrospecto.ts)',
    v_pares @> array['4/13'] and v_pares @> array['9/13'] and v_pares @> array['6/13'] and array_length(v_pares, 1) = 3,
    coalesce(v_detalhe, 'NENHUMA SESSAO COM SUGESTAO'));
end $$;


-- ===========================================================================
-- RESULTADO
-- ===========================================================================
select ordem, passo, ok, detalhe from resultado_0125 order by ordem;
