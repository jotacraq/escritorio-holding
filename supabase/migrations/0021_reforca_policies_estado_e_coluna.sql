-- 0021_reforca_policies_estado_e_coluna.sql
-- Segunda passada pedida no pentest (mesmo padrão de risco do ALTO 1): policies
-- `for all` que só checam eh_interno() sem checar estado nem coluna —
-- `fam_wr` (0007), `ses_wr` e `age_wr` (0008).
--
-- Diagnóstico por tabela:
--  - `for all` inclui DELETE. Nenhuma rota deste projeto jamais executa DELETE
--    em familiares/sessoes_viabilidade/agendamentos — a convenção do projeto é
--    baixa por `ativo=false` (familiares, explícito em 0007) ou por `status`
--    (agendamentos: 'cancelado'/'remarcado', preservando a linha antiga como
--    histórico). Um interno batendo direto no PostgREST hoje pode apagar a
--    linha de verdade — familiares/sessoes_viabilidade não têm rastro nenhum
--    fora da própria tabela, e apagar um agendamento remove a prova de que a
--    Dra. Elaine esteve marcada naquele horário. RLS não deveria conceder mais
--    do que a rota usa: removemos DELETE das três, sem policy nenhuma no lugar
--    (RLS nega por ausência, mesmo padrão já usado em `pessoas`/`jornadas_transicoes`).
--  - Colunas que só o servidor deveria poder tornar imutáveis, mas que `for all`
--    deixa reescrever livremente por UPDATE direto: `familiares.pessoa_id`
--    (reatribuir um familiar a outra pessoa corrompe PII de identidade),
--    `sessoes_viabilidade.jornada_id` (a sessão é 1:1 com a jornada; trocar o
--    vínculo mistura o histórico de duas famílias) e `agendamentos.sessao_id`/
--    `inicio_em`/`fim_em` (a rota de remarcação NUNCA edita o slot antigo por
--    UPDATE — ela marca `status='remarcado'` e cria uma linha nova; editar
--    inicio_em/fim_em direto apaga o horário original sem deixar rastro).
--    Nenhuma rota hoje escreve essas colunas via UPDATE — travar por trigger
--    não muda nenhum fluxo legítimo.

-- ---------------------------------------------------------------------------
-- familiares
-- ---------------------------------------------------------------------------
drop policy if exists fam_wr on familiares;
create policy fam_ins on familiares for insert to authenticated with check ((select app.eh_interno()));
create policy fam_upd on familiares for update to authenticated
  using ((select app.eh_interno())) with check ((select app.eh_interno()));
-- Sem policy de DELETE: baixa é `ativo=false` (regra já documentada em 0007).

create or replace function app.impede_realocacao_familiar() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.pessoa_id is distinct from old.pessoa_id then
    raise exception 'alteracao_invalida: pessoa_id de familiares é imutável' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger trg_impede_realocacao_familiar before update on familiares
for each row execute function app.impede_realocacao_familiar();

-- ---------------------------------------------------------------------------
-- sessoes_viabilidade
-- ---------------------------------------------------------------------------
drop policy if exists ses_wr on sessoes_viabilidade;
create policy ses_ins on sessoes_viabilidade for insert to authenticated with check ((select app.eh_interno()));
create policy ses_upd on sessoes_viabilidade for update to authenticated
  using ((select app.eh_interno())) with check ((select app.eh_interno()));
-- Sem policy de DELETE: nenhuma rota apaga sessão; apagar arrastaria em cascata
-- agendamentos e relatório sem deixar rastro na timeline.

create or replace function app.impede_realocacao_sessao() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.jornada_id is distinct from old.jornada_id then
    raise exception 'alteracao_invalida: jornada_id de sessoes_viabilidade é imutável (1:1 com a jornada)' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger trg_impede_realocacao_sessao before update on sessoes_viabilidade
for each row execute function app.impede_realocacao_sessao();

-- ---------------------------------------------------------------------------
-- agendamentos
-- ---------------------------------------------------------------------------
drop policy if exists age_wr on agendamentos;
create policy age_ins on agendamentos for insert to authenticated with check ((select app.eh_interno()));
create policy age_upd on agendamentos for update to authenticated
  using ((select app.eh_interno())) with check ((select app.eh_interno()));
-- Sem policy de DELETE: remarcação preserva histórico (status='remarcado' +
-- linha nova) — apagar a linha antiga destruiria essa prova.

create or replace function app.impede_alteracao_direta_agendamento() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.sessao_id is distinct from old.sessao_id then
    raise exception 'alteracao_invalida: sessao_id de agendamentos é imutável' using errcode = '23514';
  end if;
  if new.inicio_em is distinct from old.inicio_em or new.fim_em is distinct from old.fim_em then
    raise exception 'alteracao_invalida: remarcar cria um agendamento novo (POST .../agendamentos) — inicio_em/fim_em não são editáveis por UPDATE direto' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger trg_impede_alteracao_direta_agendamento before update on agendamentos
for each row execute function app.impede_alteracao_direta_agendamento();

-- ---------------------------------------------------------------------------
-- NOTA (fora do escopo pedido, mesmo padrão, flag para o João decidir):
-- `pat_wr` (patrimonio_itens, 0007) e `rel_wr` (relatorios_sessao, 0008) usam
-- exatamente o mesmo `for all ... ve_patrimonio()` e têm o mesmo problema de
-- DELETE via PostgREST direto — patrimonio_itens inclusive tem a MESMA nota
-- "nada de DELETE, baixa é ativo=false" no comentário da própria migration
-- 0007. Não mexi porque não foi pedido nesta rodada; deixo registrado para
-- não silenciar o achado.
-- ---------------------------------------------------------------------------
