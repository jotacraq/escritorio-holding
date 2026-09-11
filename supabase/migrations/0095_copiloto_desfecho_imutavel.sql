-- 0095_copiloto_desfecho_imutavel.sql
-- Fase 10 · Fatia 2 (docs/ARQUITETURA-FASE-10.md §5, §9 "solidificação").
-- Item menor da correção do `fable-orchestrator`: o §5 do plano promete
-- "o registro de que a sugestão foi aceita — o dado que, daqui a 20 sessões,
-- dirá se o copiloto acerta". `copiloto_sugestoes.desfecho`/`desfecho_em`
-- (0091) já existem; nenhuma rota os escrevia até esta migration + a rota
-- `POST /api/sessoes/[id]/copiloto/sugestoes/[sugestaoId]/desfecho`.
--
-- 100% ADITIVA. Só acrescenta uma trigger sobre `copiloto_sugestoes`,
-- nenhuma tabela/coluna/policy existente é alterada.
--
-- POR QUE UMA TRIGGER, NÃO SÓ A ROTA: `copiloto_sugestoes` só tem GRANT de
-- UPDATE para `service_role` (0091) — RLS não protege `service_role`, que a
-- ignora por completo. "Desfecho é imutável depois de gravado" (exigência da
-- errata do arquiteto) não pode depender só de a rota nunca tentar sobrescrever:
-- um bug futuro, um script de correção, um agente novo que use `service_role`
-- diretamente — todos passariam batido sem uma trava no banco. Mesmo
-- raciocínio de `app.impede_edicao_decisao_juridica` (0048): campo de MÉRITO
-- não é editável por UPDATE livre, mesmo por quem tem privilégio total.
--
-- A REGRA: `desfecho` só pode ir de NULL para um valor (a decisão da advogada,
-- uma vez tomada, é permanente — clicar "Ir para lá" ou "Ignorar" duas vezes
-- não conta duas vezes, e não existe "desfazer" um clique já contado na
-- métrica). Tentativa de trocar um desfecho JÁ gravado por outro é recusada.
-- `desfecho_em` segue a mesma regra, pelo mesmo motivo.
--
-- ROTEIRO DE VERIFICAÇÃO: adicionado em `scripts/verificacao-0092-0093.sql`
-- §11 (o nome do arquivo ficou de 0092-0093 por já existir; o passo cobre
-- 0095 também — trocar de arquivo só para isto seria fatiar sem necessidade).
--
-- ROLLBACK:
--   drop trigger if exists trg_copiloto_sugestoes_desfecho_imutavel on copiloto_sugestoes;
--   drop function if exists app.impede_reescrita_desfecho_copiloto();
-- ===========================================================================

create or replace function app.impede_reescrita_desfecho_copiloto() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if old.desfecho is not null and new.desfecho is distinct from old.desfecho then
    raise exception 'desfecho_imutavel: copiloto_sugestoes.desfecho ja foi gravado (%) e nao pode ser sobrescrito - o desfecho de uma sugestao e permanente'
      , old.desfecho
      using errcode = '23514';
  end if;
  if old.desfecho_em is not null and new.desfecho_em is distinct from old.desfecho_em then
    raise exception 'desfecho_imutavel: copiloto_sugestoes.desfecho_em ja foi gravado e nao pode ser sobrescrito'
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger trg_copiloto_sugestoes_desfecho_imutavel
  before update on copiloto_sugestoes
  for each row execute function app.impede_reescrita_desfecho_copiloto();

comment on function app.impede_reescrita_desfecho_copiloto() is
  'Fase 10, Fatia 2 (§5, §9 do plano). desfecho/desfecho_em de copiloto_sugestoes '
  'só vão de NULL para um valor, uma vez — nunca sobrescritos depois. Protege '
  'mesmo contra service_role (RLS não o filtra); é o mesmo padrão de '
  'app.impede_edicao_decisao_juridica (0048).';
