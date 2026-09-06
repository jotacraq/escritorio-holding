-- 0076_registrar_briefing_origem_dado_de_volta.sql
-- Fase 7 (06/09/2026) — drift banco↔repo achado pelo agente DEMO ao semear um
-- briefing em modo demonstração.
--
-- A 0027 §(f) fez `registrar_briefing` DERIVAR `origem_dado` de
-- `execucoes_ia.modo` (demonstracao → 'exemplo', real → 'real'), e o trigger
-- `app.trava_saida_demonstracao` passou a exigir isso. A 0042 (prompts v2)
-- recriou a função com 2 parâmetros novos (`p_completude_entrada`,
-- `p_verificacao`) partindo do corpo da 0009 — e a derivação SUMIU. Desde
-- 04/09 toda geração de briefing em modo demonstração grava `origem_dado='real'`
-- (default da coluna) e o próprio trigger da 0027 a derruba com 23514
-- `saida_de_demonstracao_exige_origem_dado_exemplo`. Em produção: o botão
-- "Gerar briefing" com IA_MODO_DEMONSTRACAO ligado falhava; com IA real nunca
-- falhou (origem 'real' bate com modo 'real').
--
-- `registrar_croqui_analise` NÃO tem o problema (a 0043 preservou a derivação).
--
-- Mesma assinatura da 0042 → `create or replace` substitui (não cria sobrecarga).
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
  from execucoes_ia e where e.id = p_execucao_id;
  if v_origem_dado is null then
    raise exception 'execucao_nao_encontrada: %', p_execucao_id using errcode = 'P0002';
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
revoke execute on function public.registrar_briefing(uuid, uuid, jsonb, smallint, text[], boolean, smallint, jsonb)
  from public, anon, authenticated;
grant execute on function public.registrar_briefing(uuid, uuid, jsonb, smallint, text[], boolean, smallint, jsonb)
  to service_role;
comment on function public.registrar_briefing(uuid, uuid, jsonb, smallint, text[], boolean, smallint, jsonb) is
  'Porta única de escrita de briefings (0009 → 0027 → 0042 → 0076). Deriva origem_dado de '
  'execucoes_ia.modo (demonstracao → exemplo); a 0042 tinha perdido essa derivação e o trigger '
  'app.trava_saida_demonstracao derrubava toda saída de demonstração. service_role only.';
