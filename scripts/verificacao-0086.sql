-- scripts/verificacao-0086.sql — roteiro da Frente B da Fase 8.
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- postgres, com a 0086 APLICADA. A última instrução devolve `resultado_0086`
-- (ordem, passo, ok, detalhe). `ok = true` em todas significa que o banco faz
-- o que a migration promete.
--
-- TUDO COM ROLLBACK, mesmo padrão do `verificacao-0083-0085.sql`: cada bloco
-- que escreve vive dentro de um sub-`begin … exception … end` terminado em
-- `raise 'rollback_proposital'`, e o INSERT no resultado acontece FORA dele —
-- em PL/pgSQL o bloco EXCEPTION é uma subtransação, então gravar o resultado
-- lá dentro o desfaria junto com a fixture.
--
-- O PAPEL: `arquivar_jornada`/`desarquivar_jornada` conferem `auth.uid()`
-- contra `perfis_equipe`. Aqui isso é simulado com
-- `set_config('request.jwt.claims', …, true)` apontando para um perfil ativo
-- REAL — é o mesmo caminho que `auth.uid()` lê em produção. O `is_local` do
-- set_config garante que o "login" morre junto com a subtransação.
--
-- O QUE ESTE ROTEIRO PROVA (7 asserções, §B2 do plano)
--   0  medição ANTES (não escreve nada)
--   1  arquivar: desfecho + régua cancelada + fila fora + andamento contado
--   2  desarquivar: desfecho volta, mensagem FUTURA volta, mensagem VENCIDA
--      não volta, ligação não volta (D17) e o andamento diz isso
--   3  o índice único de "1 processo aberto por pessoa" é respeitado no
--      desarquivar — com mensagem legível, não 23505 cru
--   4  a fase de `vw_croqui_estado` é a MESMA que a Ficha e a lista mostram,
--      nos 4 croquis reais, e `vw_jornada_kanban.croqui_fase` casa com ela
--   5  B51: sem pedir, link público NÃO é revogado; pedindo, é — e contado
--   6  a fila do BANCO ignora processo fechado (régua e discagem), que era o
--      furo do reconhecimento
--   7  privilégios: anon fora de tudo; sem perfil interno, 42501; e as duas
--      RPCs de fila continuam só para service_role
--
-- O QUE NÃO DÁ PARA VERIFICAR AQUI: que a TELA mostra o selo certo e que o
-- toast "Desfazer" chama a rota. Isso é captura de navegador + vitest, no
-- relatório do agente.
-- ---------------------------------------------------------------------------

drop table if exists resultado_0086;
create temp table resultado_0086 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r86(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0086 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;

-- Fixture: pessoa + processo aberto + 1 mensagem pendente no FUTURO + 1
-- mensagem pendente VENCIDA + 1 ligação na fila + 1 link público ativo.
-- Tudo com `origem_dado = 'exemplo'`: nada aqui se confunde com cliente real.
create or replace function pg_temp.fixture86(p_tag text)
returns table (pessoa uuid, jornada uuid, msg_futura uuid, msg_vencida uuid, ligacao uuid, link uuid)
language plpgsql as $$
declare
  v_pessoa uuid; v_jornada uuid; v_tpl uuid;
  v_mf uuid; v_mv uuid; v_lig uuid; v_link uuid;
begin
  insert into pessoas (nome, email, telefone, cidade, uf, origem_dado)
  values ('Verificação 0086 ' || p_tag, 'verif86.' || p_tag || '@example.com',
          '+5511900' || lpad((random()*999999)::int::text, 6, '0'), 'São Paulo', 'SP', 'exemplo')
  returning id into v_pessoa;

  insert into jornadas (pessoa_id, origem, trilha, etapa, origem_dado)
  values (v_pessoa, 'outro', 'seminario', 'captado', 'exemplo')
  returning id into v_jornada;

  select id into v_tpl from mensagens_templates where ativo and canal = 'email' order by chave limit 1;

  insert into mensagens_agendadas (jornada_id, template_id, canal, destinatario, agendada_para,
                                   status, chave_idempotencia, assunto_renderizado, corpo_renderizado)
  values (v_jornada, v_tpl, 'email', 'verif86.' || p_tag || '@example.com', now() + interval '3 days',
          'pendente', v_jornada::text || ':verif86-futura', 'Futura', 'corpo')
  returning id into v_mf;

  insert into mensagens_agendadas (jornada_id, template_id, canal, destinatario, agendada_para,
                                   status, chave_idempotencia, assunto_renderizado, corpo_renderizado)
  values (v_jornada, v_tpl, 'email', 'verif86.' || p_tag || '@example.com', now() - interval '2 days',
          'pendente', v_jornada::text || ':verif86-vencida', 'Vencida', 'corpo')
  returning id into v_mv;

  insert into ligacoes_ia (jornada_id, provedor, telefone, origem, status)
  values (v_jornada, 'manual', '+5511900000000', 'automatica', 'na_fila')
  returning id into v_lig;

  insert into links_publicos (jornada_id, tipo, token_hash, token_prefixo, expira_em, origem_dado)
  values (v_jornada, 'formulario', 'verif86-' || p_tag || '-' || md5(random()::text),
          'v86' || substr(md5(random()::text), 1, 3), now() + interval '14 days', 'exemplo')
  returning id into v_link;

  return query select v_pessoa, v_jornada, v_mf, v_mv, v_lig, v_link;
end $$;

-- "Entra" como um perfil interno ativo REAL (o mesmo caminho de `auth.uid()`).
create or replace function pg_temp.entrar86(p_papel text) returns uuid
language plpgsql as $$
declare v_uid uuid;
begin
  select auth_user_id into v_uid from perfis_equipe
   where ativo and auth_user_id is not null and papel::text = p_papel
   order by criado_em limit 1;
  if v_uid is null then
    raise exception 'sem_perfil_%: o roteiro precisa de um perfil ativo com papel %', p_papel, p_papel;
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid)::text, true);
  return v_uid;
end $$;

create or replace function pg_temp.sair86() returns void
language sql as $$ select set_config('request.jwt.claims', '', true) $$;


-- ===========================================================================
-- 0. MEDIÇÃO ANTES (não escreve nada)
-- ===========================================================================
do $$
declare v_j int; v_c int; v_congeladas int; v_msg int; v_lig int; v_marcador int;
begin
  select count(*) into v_j from jornadas;
  select count(*) into v_congeladas from jornadas where desfecho = 'congelada';
  select count(*) into v_c from croquis;
  select count(*) into v_msg from mensagens_agendadas where status = 'pendente';
  select count(*) into v_lig from ligacoes_ia where status = 'na_fila';
  select count(*) into v_marcador from mensagens_agendadas where motivo_cancelamento is not null;
  perform pg_temp.r86('0 · medição ANTES', true,
    'jornadas=' || v_j || ' congeladas=' || v_congeladas || ' croquis=' || v_c ||
    ' msgs_pendentes=' || v_msg || ' ligacoes_na_fila=' || v_lig ||
    ' linhas_com_motivo_cancelamento=' || v_marcador || ' (esperado 0: campo novo nasce vazio)');
end $$;


-- ===========================================================================
-- 1. ARQUIVAR — desfecho, régua calada, fila fora, andamento contado
-- ===========================================================================
do $$
declare
  f record; r jsonb; ok boolean := true; det text := '';
  v_desfecho text; v_motivo text; v_msg_canc int; v_lig_canc int; v_evt int; v_link_estado text;
begin
  begin
    select * into f from pg_temp.fixture86('arq') as t;
    perform pg_temp.entrar86('admin');

    r := public.arquivar_jornada(f.jornada, 'Cliente parou de responder desde julho.');

    select desfecho::text, motivo_desfecho into v_desfecho, v_motivo from jornadas where id = f.jornada;
    select count(*) into v_msg_canc from mensagens_agendadas
     where jornada_id = f.jornada and status = 'cancelada' and motivo_cancelamento = 'jornada_arquivada';
    select count(*) into v_lig_canc from ligacoes_ia
     where jornada_id = f.jornada and status = 'cancelada' and motivo_cancelamento = 'jornada_arquivada';
    select count(*) into v_evt from eventos_timeline
     where jornada_id = f.jornada and tipo = 'arquivamento' and titulo = 'Processo arquivado';
    select estado::text into v_link_estado from links_publicos where id = f.link;

    ok := v_desfecho = 'congelada'
      and v_motivo = 'Cliente parou de responder desde julho.'
      and v_msg_canc = 2                    -- as duas pendentes (futura e vencida)
      and v_lig_canc = 1
      and v_evt = 1
      and v_link_estado = 'ativo'           -- B51: sem pedir, não revoga
      and (r->>'mensagens_canceladas')::int = 2
      and (r->>'ligacoes_canceladas')::int = 1
      and (r->>'links_revogados')::int = 0;

    det := 'desfecho=' || v_desfecho || ' msgs_canceladas=' || v_msg_canc ||
           ' ligacoes_canceladas=' || v_lig_canc || ' andamentos=' || v_evt ||
           ' link=' || v_link_estado || ' retorno=' || r::text;

    perform pg_temp.sair86();
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then ok := false; det := 'erro: ' || sqlerrm; end if;
  end;
  perform pg_temp.r86('1 · arquivar cala régua e fila, e conta o que fez', ok, det);
end $$;


-- ===========================================================================
-- 2. DESARQUIVAR — o Desfazer, e o que de propósito NÃO volta
-- ===========================================================================
do $$
declare
  f record; r jsonb; ok boolean := true; det text := '';
  v_desfecho text; v_motivo text; v_futura text; v_vencida text; v_lig text; v_evt int;
begin
  begin
    select * into f from pg_temp.fixture86('des') as t;
    perform pg_temp.entrar86('admin');

    perform public.arquivar_jornada(f.jornada, 'Arquivado para testar o desfazer.');
    r := public.desarquivar_jornada(f.jornada);

    select desfecho::text, motivo_desfecho into v_desfecho, v_motivo from jornadas where id = f.jornada;
    select status::text into v_futura  from mensagens_agendadas where id = f.msg_futura;
    select status::text into v_vencida from mensagens_agendadas where id = f.msg_vencida;
    select status::text into v_lig     from ligacoes_ia where id = f.ligacao;
    select count(*) into v_evt from eventos_timeline
     where jornada_id = f.jornada and tipo = 'arquivamento' and titulo = 'Processo reaberto';

    ok := v_desfecho = 'aberta'
      and v_motivo is null
      and v_futura = 'pendente'             -- volta: ainda dá tempo
      and v_vencida = 'cancelada'           -- não volta: a hora já passou
      and v_lig = 'cancelada'               -- D17: ligação não é refeita
      and v_evt = 1
      and (r->>'mensagens_reagendadas')::int = 1
      and (r->>'ligacoes_nao_refeitas')::int = 1;

    det := 'desfecho=' || v_desfecho || ' motivo=' || coalesce(v_motivo, '∅') ||
           ' msg_futura=' || v_futura || ' msg_vencida=' || v_vencida ||
           ' ligacao=' || v_lig || ' andamentos=' || v_evt || ' retorno=' || r::text;

    perform pg_temp.sair86();
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then ok := false; det := 'erro: ' || sqlerrm; end if;
  end;
  perform pg_temp.r86('2 · desarquivar devolve o que dá para devolver', ok, det);
end $$;


-- ===========================================================================
-- 3. "1 PROCESSO ABERTO POR PESSOA" — o índice parcial da 0004 respeitado
-- ===========================================================================
do $$
declare
  f record; ok boolean := true; det text := ''; v_recusou boolean := false;
  v_erro text := '(nenhum)'; v_desfecho text; v_outra uuid;
begin
  begin
    select * into f from pg_temp.fixture86('uniq') as t;
    perform pg_temp.entrar86('admin');

    perform public.arquivar_jornada(f.jornada, 'Arquivado para abrir outro processo.');
    -- Com o primeiro arquivado, a MESMA pessoa pode ter outro aberto.
    insert into jornadas (pessoa_id, origem, trilha, etapa, origem_dado)
    values (f.pessoa, 'outro', 'seminario', 'captado', 'exemplo') returning id into v_outra;

    begin
      perform public.desarquivar_jornada(f.jornada);
    exception when others then
      v_recusou := true; v_erro := sqlerrm;
    end;

    select desfecho::text into v_desfecho from jornadas where id = f.jornada;
    ok := v_recusou and v_erro like 'jornada_aberta_existente%' and v_desfecho = 'congelada';
    det := 'recusou=' || v_recusou || ' erro=' || v_erro || ' desfecho_final=' || v_desfecho;

    perform pg_temp.sair86();
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then ok := false; det := 'erro: ' || sqlerrm; end if;
  end;
  perform pg_temp.r86('3 · desarquivar recusa se a pessoa já tem outro processo aberto', ok, det);
end $$;


-- ===========================================================================
-- 4. A FASE É A MESMA NA VIEW, NA FICHA E NA LISTA (D12) — sem escrever nada
--
--    A Ficha 360 abre o croqui apontado pelo evento `tipo='croqui'` MAIS
--    RECENTE (`acharCroquiIdNaTimeline`, timeline em ordem decrescente); a
--    lista lia `order by versao desc limit 1`. As duas convergem no croqui de
--    MAIOR VERSÃO — que é exatamente `vw_croqui_estado.mais_recente`. Este
--    passo confere: (a) a fase de cada um dos croquis reais contra a regra de
--    precedência calculada aqui do zero, e (b) `vw_jornada_kanban.croqui_fase`
--    contra a fase da linha `mais_recente`.
-- ===========================================================================
do $$
declare
  ok boolean := true; det text := ''; v_div int; v_kanban_div int; v_total int; v_linhas text;
begin
  select count(*) into v_total from vw_croqui_estado;

  -- (a) precedência recalculada de forma independente da view
  select count(*) into v_div
    from vw_croqui_estado v
    join croquis c on c.id = v.croqui_id
   where v.fase <> (
     case when c.status = 'apresentado' then 'apresentado'
          when c.status = 'pronto'      then 'pronto'
          when exists (select 1 from croqui_calculos cc where cc.jornada_id = c.jornada_id and cc.atual) then 'fixado'
          when exists (select 1 from croqui_calculos cc where cc.jornada_id = c.jornada_id)              then 'calculado'
          else 'rascunho' end);

  -- (b) lista × Ficha: a coluna do kanban é a fase do croqui mais recente.
  --     `app.ve_patrimonio()` é false para o papel que roda este roteiro
  --     (postgres sem perfil), então `croqui_fase` vem NULL de propósito —
  --     "sem informação", nunca "sem croqui". O que se confere aqui é que,
  --     COM permissão, os dois lados dão o mesmo valor.
  perform pg_temp.entrar86('admin');
  select count(*) into v_kanban_div
    from vw_jornada_kanban k
    left join vw_croqui_estado v on v.jornada_id = k.id and v.mais_recente
   where coalesce(k.croqui_fase, '∅') <> coalesce(v.fase, 'sem_croqui');
  perform pg_temp.sair86();

  select string_agg(croqui_versao || ':' || status_editorial || '→' || fase ||
                    case when mais_recente then '*' else '' end, ' · ' order by jornada_id, croqui_versao)
    into v_linhas from vw_croqui_estado;

  ok := v_div = 0 and v_kanban_div = 0 and v_total = 4;
  det := 'croquis_na_view=' || v_total || ' divergencias_de_precedencia=' || v_div ||
         ' divergencias_kanban_x_ficha=' || v_kanban_div || ' · ' || coalesce(v_linhas, '∅') ||
         ' (* = o que a Ficha e a lista mostram)';
  perform pg_temp.r86('4 · fase idêntica na view, na Ficha e na lista', ok, det);
end $$;


-- ===========================================================================
-- 5. B51 — link público só é revogado se PEDIREM
-- ===========================================================================
do $$
declare
  f record; r jsonb; ok boolean := true; det text := '';
  v_estado text; v_revogado_em timestamptz;
begin
  begin
    select * into f from pg_temp.fixture86('link') as t;
    perform pg_temp.entrar86('admin');

    r := public.arquivar_jornada(f.jornada, 'Arquivado revogando os links.', true);
    select estado::text, revogado_em into v_estado, v_revogado_em from links_publicos where id = f.link;

    ok := v_estado = 'revogado' and v_revogado_em is not null and (r->>'links_revogados')::int = 1;
    det := 'com p_revogar_links=true → estado=' || v_estado ||
           ' revogado_em=' || coalesce(v_revogado_em::text, '∅') ||
           ' contados=' || (r->>'links_revogados') ||
           ' | no passo 1, com o default false, o MESMO link ficou ativo';

    perform pg_temp.sair86();
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then ok := false; det := 'erro: ' || sqlerrm; end if;
  end;
  perform pg_temp.r86('5 · revogar link é escolha (B51), nunca efeito colateral', ok, det);
end $$;


-- ===========================================================================
-- 6. A FILA DO BANCO IGNORA PROCESSO FECHADO (o furo do reconhecimento)
--
--    Antes da 0086, `processarFilaRegua` não filtrava por desfecho (grep = 0)
--    e o cron de ligação só recusava disparo NOVO. Aqui a trava é conferida
--    no BANCO — o único lugar em que vale para todos os chamadores.
-- ===========================================================================
do $$
declare
  f record; ok boolean := true; det text := '';
  v_antes int; v_depois int; v_lig_antes int; v_lig_depois int;
begin
  begin
    select * into f from pg_temp.fixture86('fila') as t;

    -- A mensagem VENCIDA está pendente e na hora: com o processo aberto, sai.
    select count(*) into v_antes from public.reivindicar_mensagens_pendentes(50, array['email']::canal_mensagem[]) q
     where q.jornada_id = f.jornada;
    -- Devolve para a fila e fecha o processo.
    update mensagens_agendadas set status = 'pendente', tentativas = 0 where id = f.msg_vencida;
    update jornadas set desfecho = 'congelada', motivo_desfecho = 'fechado no roteiro' where id = f.jornada;
    select count(*) into v_depois from public.reivindicar_mensagens_pendentes(50, array['email']::canal_mensagem[]) q
     where q.jornada_id = f.jornada;

    -- Mesma prova na discagem.
    update jornadas set desfecho = 'aberta', motivo_desfecho = null where id = f.jornada;
    select count(*) into v_lig_antes from public.reivindicar_ligacoes_ia(10) q where q.jornada_id = f.jornada;
    update ligacoes_ia set status = 'na_fila', disparada_em = null where id = f.ligacao;
    update jornadas set desfecho = 'congelada', motivo_desfecho = 'fechado no roteiro' where id = f.jornada;
    select count(*) into v_lig_depois from public.reivindicar_ligacoes_ia(10) q where q.jornada_id = f.jornada;

    ok := v_antes = 1 and v_depois = 0 and v_lig_antes = 1 and v_lig_depois = 0;
    det := 'régua: aberta=' || v_antes || ' fechada=' || v_depois ||
           ' · discagem: aberta=' || v_lig_antes || ' fechada=' || v_lig_depois;

    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then ok := false; det := 'erro: ' || sqlerrm; end if;
  end;
  perform pg_temp.r86('6 · régua e discagem não falam com processo fechado', ok, det);
end $$;


-- ===========================================================================
-- 7. PRIVILÉGIOS — anon fora de tudo, sem perfil interno 42501, filas só
--    para service_role, e motivo obrigatório
-- ===========================================================================
do $$
declare
  f record; ok boolean := true; det text := '';
  v_anon_view boolean; v_anon_arq boolean; v_anon_des boolean;
  v_auth_arq boolean; v_auth_fila_msg boolean; v_auth_fila_lig boolean;
  v_sr_fila_msg boolean; v_sr_fila_lig boolean;
  v_sem_papel boolean := false; v_sem_motivo boolean := false; v_e1 text := ''; v_e2 text := '';
begin
  v_anon_view     := has_table_privilege('anon', 'vw_croqui_estado', 'select');
  v_anon_arq      := has_function_privilege('anon', 'public.arquivar_jornada(uuid,text,boolean)', 'execute');
  v_anon_des      := has_function_privilege('anon', 'public.desarquivar_jornada(uuid)', 'execute');
  v_auth_arq      := has_function_privilege('authenticated', 'public.arquivar_jornada(uuid,text,boolean)', 'execute');
  v_auth_fila_msg := has_function_privilege('authenticated', 'public.reivindicar_mensagens_pendentes(int,canal_mensagem[])', 'execute');
  v_auth_fila_lig := has_function_privilege('authenticated', 'public.reivindicar_ligacoes_ia(int)', 'execute');
  v_sr_fila_msg   := has_function_privilege('service_role', 'public.reivindicar_mensagens_pendentes(int,canal_mensagem[])', 'execute');
  v_sr_fila_lig   := has_function_privilege('service_role', 'public.reivindicar_ligacoes_ia(int)', 'execute');

  begin
    select * into f from pg_temp.fixture86('priv') as t;

    -- (a) sem perfil interno: `auth.uid()` de um usuário que não é da equipe.
    perform set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid())::text, true);
    begin
      perform public.arquivar_jornada(f.jornada, 'tentativa de fora');
    exception when others then
      v_sem_papel := sqlerrm like 'sem_permissao%'; v_e1 := sqlerrm;
    end;

    -- (b) motivo em branco não passa (mesma regra do `ck_desfecho_motivo`).
    perform pg_temp.entrar86('admin');
    begin
      perform public.arquivar_jornada(f.jornada, '   ');
    exception when others then
      v_sem_motivo := sqlerrm like 'motivo_obrigatorio%'; v_e2 := sqlerrm;
    end;

    perform pg_temp.sair86();
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then ok := false; det := 'erro: ' || sqlerrm; end if;
  end;

  ok := ok and not v_anon_view and not v_anon_arq and not v_anon_des
    and v_auth_arq and not v_auth_fila_msg and not v_auth_fila_lig
    and v_sr_fila_msg and v_sr_fila_lig and v_sem_papel and v_sem_motivo;

  det := coalesce(nullif(det, ''), '') ||
         'anon{view=' || v_anon_view || ' arquivar=' || v_anon_arq || ' desarquivar=' || v_anon_des ||
         '} authenticated{arquivar=' || v_auth_arq || ' fila_msg=' || v_auth_fila_msg ||
         ' fila_lig=' || v_auth_fila_lig || '} service_role{fila_msg=' || v_sr_fila_msg ||
         ' fila_lig=' || v_sr_fila_lig || '} sem_perfil→' || v_e1 || ' · motivo_vazio→' || v_e2;
  perform pg_temp.r86('7 · privilégios e motivo obrigatório', ok, det);
end $$;


-- ===========================================================================
-- MEDIÇÃO DEPOIS + resultado. O estado do banco tem de ser IDÊNTICO ao do
-- passo 0: se alguma fixture sobreviveu, o rollback falhou.
-- ===========================================================================
do $$
declare v_j int; v_c int; v_congeladas int; v_msg int; v_lig int; v_marcador int; v_p int;
begin
  select count(*) into v_j from jornadas;
  select count(*) into v_congeladas from jornadas where desfecho = 'congelada';
  select count(*) into v_c from croquis;
  select count(*) into v_msg from mensagens_agendadas where status = 'pendente';
  select count(*) into v_lig from ligacoes_ia where status = 'na_fila';
  select count(*) into v_marcador from mensagens_agendadas where motivo_cancelamento is not null;
  select count(*) into v_p from pessoas;
  perform pg_temp.r86('8 · medição DEPOIS (tem de bater com o passo 0)', true,
    'jornadas=' || v_j || ' congeladas=' || v_congeladas || ' croquis=' || v_c ||
    ' msgs_pendentes=' || v_msg || ' ligacoes_na_fila=' || v_lig ||
    ' linhas_com_motivo_cancelamento=' || v_marcador || ' pessoas=' || v_p);
end $$;

select ordem, passo, ok, detalhe from resultado_0086 order by ordem;
