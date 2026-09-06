-- 0074_autoria_link_confirmacao_e_revoga_anon_timeline.sql
-- Fase 7 (06/09/2026) — as duas pendências de BANCO que a trava do Fable e o
-- pentest da Fase 6 deixaram abertas. NÃO aplicada por este agente: o
-- orquestrador aplica e roda `scripts/verificacao-0074.sql`.
--
-- O código do repositório funciona COM ou SEM esta migration:
--   - `src/server/regua/links.ts` chama a assinatura de 4 argumentos e, se o
--     PostgREST responder PGRST202 (função ainda de 3), refaz a chamada na
--     assinatura antiga. Sem a migration o link de confirmação continua saindo
--     como sempre saiu — só que sem autor.
--   - O item 3 abaixo é só revogação de um privilégio inerte: nada no código
--     depende dele.
--
-- O que esta migration NÃO faz, de propósito:
--   - `eventos_timeline.tipo = 'link'` (evento novo da Fase 7, gravado por
--     `src/server/publico/timeline-links.ts`) NÃO precisa de migration:
--     `eventos_timeline.tipo` é `text` SEM CHECK (0014:10), como a 0070:34 já
--     havia confirmado ao criar `croqui_calculo`/`croqui_exportacao`/
--     `croqui_narrativa`. Nenhum `alter table` aqui é a decisão certa, não um
--     esquecimento.


-- ---------------------------------------------------------------------------
-- 1. Autoria no link de confirmação emitido por GENTE.
--
--    Achado BAIXO do pentest da Fase 6 (CWE-778, OWASP A09), reaberto pela
--    trava do Fable: até a Fase 5, `links_publicos.tipo='confirmacao'` só
--    nascia dentro da régua (D-7), e `criado_por = null` era a verdade — quem
--    emitia era o cron. A Fase 6 (§5.3) ligou a barra "Enviar" da Ficha nesta
--    MESMA RPC: advogada e relacionamento passaram a emitir o link com o dedo,
--    e a trilha continuou dizendo "sistema". A irmã `emitir_link_publico`
--    (0028:829-836) carimba `v_perfil_id` desde sempre; esta ficou para trás.
--
--    Duas colunas, não uma: emitir REVOGA o link ativo anterior do mesmo tipo,
--    e essa revogação também não dizia quem a causou (`revogado_por` null).
--
--    `drop function` explícito ANTES do `create or replace`: `create or
--    replace` com parâmetro novo NÃO substitui a função — cria uma SEGUNDA
--    sobrecarga, as duas passam a existir e a chamada do PostgREST fica
--    ambígua (armadilha já catalogada; mesmo cuidado da 0071 com
--    `registrar_diagnostico_sv`).
--
--    `p_criado_por` é VALIDADO, nunca aceito de olhos fechados: quem chama é
--    `service_role` (sem `auth.uid()` para conferir), então a função é a única
--    barreira. Perfil inexistente, inativo ou de papel que não pode emitir link
--    derruba a emissão — fail-closed. A rota já filtra os mesmos três papéis
--    (`exigirPapel("admin","advogada","relacionamento")`) e só lê perfil
--    `ativo` (`usuarioAtual`), então esta checagem só dispara em bug real.
--    Sem `p_criado_por` (o caso da régua/cron) nada muda: autor null, como hoje.
-- ---------------------------------------------------------------------------
drop function if exists public.emitir_link_confirmacao_sistema(uuid, text, text);

create or replace function public.emitir_link_confirmacao_sistema(
  p_agendamento_id uuid,
  p_token_hash     text,
  p_token_prefixo  text,
  p_criado_por     uuid default null
) returns links_publicos
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ag        agendamentos%rowtype;
  v_jornada_id uuid;
  v_dias      int;
  v_link      links_publicos;
begin
  if p_criado_por is not null and not exists (
       select 1 from perfis_equipe
        where id = p_criado_por and ativo
          and papel in ('admin', 'advogada', 'relacionamento')
     ) then
    raise exception 'autor_invalido: perfil % não é da equipe ativa com permissão de emitir link', p_criado_por
      using errcode = '42501';
  end if;

  select * into v_ag from agendamentos where id = p_agendamento_id and status in ('agendado', 'confirmado');
  if not found then
    raise exception 'agendamento_indisponivel: agendamento % não está ativo', p_agendamento_id using errcode = 'P0002';
  end if;
  select s.jornada_id into v_jornada_id from sessoes_viabilidade s where s.id = v_ag.sessao_id;
  if not exists (select 1 from jornadas where id = v_jornada_id and desfecho = 'aberta') then
    raise exception 'jornada_invalida: jornada nao encontrada ou fechada' using errcode = 'P0002';
  end if;

  select (valor ->> 'confirmacao')::int into v_dias from configuracoes where chave = 'link.validade_dias';
  v_dias := coalesce(v_dias, 14);

  -- `revogado_por` acompanha `criado_por`: quem derruba o link anterior é quem
  -- emitiu o novo. Null quando quem emite é a régua — e null ali quer dizer
  -- "sistema", não "não sei".
  update links_publicos
     set estado = 'revogado', revogado_em = now(), revogado_por = p_criado_por
   where jornada_id = v_jornada_id and tipo = 'confirmacao' and estado = 'ativo';

  -- Vale pelo menos até o fim da sessão: confirmar na véspera não pode dar "expirado".
  insert into links_publicos (jornada_id, tipo, token_hash, token_prefixo, expira_em, criado_por, agendamento_id)
  values (v_jornada_id, 'confirmacao', p_token_hash, p_token_prefixo,
          greatest(now() + (v_dias * interval '1 day'), v_ag.fim_em + interval '1 hour'), p_criado_por, v_ag.id)
  returning * into v_link;
  return v_link;
end $$;

revoke all on function public.emitir_link_confirmacao_sistema(uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.emitir_link_confirmacao_sistema(uuid, text, text, uuid)
  to service_role;

comment on function public.emitir_link_confirmacao_sistema(uuid, text, text, uuid) is
  'Emite o link /p/c de confirmação de presença, revogando o ativo anterior da jornada na '
  'mesma transação. service_role only (sem auth.uid(): quem chama é a régua/cron ou a rota '
  'POST /api/jornadas/[id]/links, que já conferiu papel). p_criado_por, desde a 0074, carimba '
  'criado_por E revogado_por quando o ato é humano (barra "Enviar" da Ficha); validado contra '
  'perfis_equipe ativo com papel admin/advogada/relacionamento. Null = a régua emitiu, e o '
  'autor é o sistema. Antes da 0074 todo link deste tipo nascia sem autor — achado BAIXO do '
  'pentest da Fase 6 (CWE-778/OWASP A09).';


-- ---------------------------------------------------------------------------
-- 2. `app.registrar_evento_timeline` — EXECUTE de `anon` revogado.
--
--    A 0038:18 concedeu esse EXECUTE para curar o 500 do formulário público.
--    A 0039 provou, com o erro real do Postgres, que a causa era OUTRA (um
--    CHECK de `formularios_respostas.origem`), e deixou o grant "porque é
--    correto por si". Não é: é privilégio concedido a um papel anônimo com
--    base em diagnóstico errado, e privilégio que ninguém usa é superfície.
--
--    Prova de que é INERTE — três travas independentes, qualquer uma sozinha
--    já basta:
--
--    (a) `anon` não tem USAGE no schema `app` (0018:9, `revoke usage on schema
--        app from anon`). Sem USAGE, nenhuma função de `app` é sequer
--        resolvível — o EXECUTE nunca chega a ser consultado. E `app` não é
--        schema exposto ao PostgREST (0051:603), então não há rota até ele.
--    (b) Nenhum caminho público chega nesta função com `anon` como
--        `current_user`. As 5 RPCs com EXECUTE para `anon`
--        (`abrir_link_publico` 0028:492/0031:446/0051:396,
--        `responder_formulario_publico`, `escolher_horario_publico`,
--        `registrar_documento_publico` 0068:58, `confirmar_presenca_publico`
--        0051:448) são TODAS `security definer`: dentro delas — e nos triggers
--        que o DML delas dispara — `current_user` é o dono da função, não
--        `anon`. É exatamente por isso que o grant da 0038 não curou nada.
--    (c) Mesmo que (a) e (b) caíssem, o INSERT morreria na RLS: a policy
--        `tl_ins` de `eventos_timeline` (0014:25) é `to authenticated` — não
--        existe policy de INSERT para `anon` — e a 0038 já tinha tirado de
--        `anon` todo privilégio de tabela do schema public.
--
--    `authenticated` e `service_role` continuam com EXECUTE (0024:44): são
--    esses os caminhos reais, e nenhum é tocado aqui.
-- ---------------------------------------------------------------------------
revoke execute on function app.registrar_evento_timeline(uuid, text, text, text, jsonb) from anon;

comment on function app.registrar_evento_timeline(uuid, text, text, text, jsonb) is
  'Grava um evento na timeline da jornada. Chamada por triggers e por RPCs security definer. '
  'EXECUTE só para authenticated e service_role: o grant para anon (0038, dado por diagnóstico '
  'errado que a 0039 desmentiu) foi revogado na 0074 — anon não tem nem USAGE no schema app '
  '(0018), nenhum caminho público chega aqui como anon (todas as RPCs públicas são definer) e '
  'a policy tl_ins de eventos_timeline é to authenticated.';
