-- 0045_transcricao_sv.sql
-- ARQUITETURA-FASE-3.md §2.3 — Onda 2, agente E (backend-analise).
--
-- A advogada passa a persistir a transcrição da PRÓPRIA Sessão de
-- Viabilidade (POST /api/sessoes/[id]/transcricao). Ela NÃO é admin — a
-- policy `tr_ins` (0037) exige `app.eh_admin()`, e sem uma policy nova o
-- INSERT falha com RLS mesmo pela rota, porque a rota usa o cliente COM
-- SESSÃO (não service_role) de propósito: a regra de negócio precisa viver
-- no próprio WITH CHECK do banco, não só na rota — lição literal do ALTO 1
-- do pentest da Fase 2 ("se a regra está só na rota, ela não existe — o
-- PostgREST é uma segunda porta").
--
-- `tr_ins` (admin, 0037) permanece intacta: é o caminho de ingestão do
-- Módulo 4 (as 70 transcrições históricas, sem jornada). Esta é ADITIVA, não
-- substitui — as duas convivem, cada uma cobrindo um caminho de entrada
-- diferente.
create policy tr_ins_sessao on transcricoes for insert to authenticated
  with check (
    (select app.ve_patrimonio())
    and tipo = 'sessao_viabilidade'
    and jornada_id is not null
    and origem_dado = 'real'
  );

-- NOTA: `comment on policy` nao aceita expressao — o `||` da concatenacao
-- quebra com 42601. Literal unico, numa linha so.
comment on policy tr_ins_sessao on transcricoes is
  'ARQUITETURA-FASE-3.md 2.3 — advogada/admin persistem a transcrição da Sessão de Viabilidade da PRÓPRIA jornada (a rota já exige exigirVePatrimonio + jornada válida antes de chegar aqui). Regra de negócio no WITH CHECK: pelo PostgREST direto ninguém insere transcrição sem jornada, do tipo apresentacao_croqui, ou carimbada como exemplo, por este caminho.';

-- Sem policy de DELETE (ausência de policy é negação, mesmo padrão de 0032/0037).
-- Sem policy de UPDATE nova: transcrição é material bruto imutável (mesma
-- decisão de `tr_upd` ficar só com `eh_admin()`, 0037) — corrigir é inserir
-- uma versão nova (`arquivo_origem` com `v` incrementado), nunca reescrever.

-- ===========================================================================
-- Timeline: a transcrição da SV entra na Ficha 360 como evento, mesmo padrão
-- de app.timeline_documento/app.timeline_croqui (0014) — trigger, não app
-- code. Só dispara para o caminho novo (tipo='sessao_viabilidade' e
-- jornada_id preenchido); as 70 transcrições do Módulo 4 (jornada_id null)
-- nunca passam por aqui — e são INSERTs anteriores a este trigger de
-- qualquer forma (triggers não retroagem sobre linhas já existentes).
-- ===========================================================================
create or replace function app.timeline_transcricao_sv() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.tipo = 'sessao_viabilidade' and new.jornada_id is not null then
    perform app.registrar_evento_timeline(new.jornada_id, 'transcricao',
      'Transcrição da Sessão de Viabilidade registrada', null,
      jsonb_build_object('transcricao_id', new.id, 'arquivo_origem', new.arquivo_origem));
  end if;
  return new;
end $$;

create trigger trg_timeline_transcricao_sv after insert on transcricoes
for each row execute function app.timeline_transcricao_sv();
