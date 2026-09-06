-- 0077_resolve_link_for_update_e_briefing_mesma_jornada.sql
-- Fase 7 (06/09/2026) — dois achados do pentest da rodada 2 (B3 e I1), ambos hardening.
--
-- B3 (pré-existente desde a 0028/0068): `app.resolve_link_escrita` lia o link SEM
-- trava de linha; N uploads paralelos com `usos = limite-1` passavam todos pelo
-- teto de `registrar_documento_publico` (TOCTOU). `select … for update` serializa
-- as RPCs de escrita do MESMO link dentro da transação de cada uma — leitura
-- pública (`abrir_link_publico`) não passa por aqui e não é afetada.
--
-- I1: `registrar_briefing` (0076) derivava `origem_dado` da execução sem conferir
-- que a execução é DA jornada. Chamadores são `service_role` com execução da
-- própria jornada, sem vetor externo — mas custa um `and` e fecha a porta.
create or replace function app.resolve_link_escrita(p_hash text) returns links_publicos
language plpgsql security definer set search_path = public, pg_temp as $$
declare v links_publicos;
begin
  -- `for update`: quem escreve pelo mesmo link espera a transação anterior
  -- terminar — o `usos` que a RPC compara já é o incrementado (B3, 0077).
  select * into v from links_publicos where token_hash = p_hash for update;
  if not found then return null; end if;

  if v.estado = 'ativo' and v.expira_em <= now() then
    update links_publicos set estado = 'expirado' where id = v.id returning * into v;
  end if;

  if v.estado <> 'ativo' then return null; end if;

  if not exists (select 1 from jornadas j where j.id = v.jornada_id and j.desfecho = 'aberta') then
    return null;
  end if;

  return v;
end $$;

create or replace function public.registrar_briefing(
  p_jornada_id uuid, p_execucao_id uuid, p_conteudo jsonb,
  p_grau_confianca smallint, p_fontes_usadas text[], p_modo_reduzido boolean,
  p_completude_entrada smallint default null, p_verificacao jsonb default null
) returns briefings
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_versao smallint; v_linha briefings; v_origem_dado text;
begin
  select case when e.modo = 'demonstracao' then 'exemplo' else 'real' end
    into v_origem_dado
  from execucoes_ia e
  where e.id = p_execucao_id and e.jornada_id = p_jornada_id;   -- I1 (0077): execução tem de ser DA jornada
  if v_origem_dado is null then
    raise exception 'execucao_nao_encontrada: % (ou não pertence à jornada %)', p_execucao_id, p_jornada_id
      using errcode = 'P0002';
  end if;

  update briefings set atual = false where jornada_id = p_jornada_id and atual;
  select coalesce(max(versao), 0) + 1 into v_versao from briefings where jornada_id = p_jornada_id;
  insert into briefings (jornada_id, execucao_id, versao, conteudo, grau_confianca,
                         fontes_usadas, modo_reduzido, completude_entrada, verificacao,
                         origem_dado, atual)
  values (p_jornada_id, p_execucao_id, v_versao, p_conteudo, p_grau_confianca,
          p_fontes_usadas, p_modo_reduzido, p_completude_entrada, p_verificacao,
          v_origem_dado, true)
  returning * into v_linha;
  return v_linha;
end $$;
