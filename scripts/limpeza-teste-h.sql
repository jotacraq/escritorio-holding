-- scripts/limpeza-teste-h.sql — desfaz SÓ o dado de teste que o agente H gravou
-- em produção (05/09/2026) na jornada "Marcos Antônio Ferreira (exemplo)":
--   • cenarios_patrimoniais 'inventario' + cenario_rubricas custas_cartorio (digitado, R$ 15.000)
--   • diagnosticos_sv v1–v4 (v4 atual, bloco "Situação familiar" visível)
--   • os eventos de timeline que os triggers da 0057/0058 geraram para isso
-- Escopo travado em `jornadas.origem_dado = 'exemplo'` + nome da pessoa: nunca
-- toca jornada real. O orquestrador decide se roda.
--
-- COMO RODAR: 3 chamadas separadas (MCP `execute_sql`):
--   1) o bloco CONFERÊNCIA ANTES (só leitura)
--   2) o bloco LIMPEZA — é UMA transação; a última instrução devolve o que foi
--      apagado em JSON (guarde a saída: é o material da reversão)
--   3) o bloco CONFERÊNCIA DEPOIS (só leitura) — esperado 0/0/0
--
-- REVERSÍVEL: a limpeza devolve as linhas apagadas como jsonb; a seção
-- REVERSÃO no fim reinsere a partir desse JSON (`jsonb_populate_record`).
-- `cenario_rubricas` e `cenarios_patrimoniais` NÃO têm policy de DELETE para
-- authenticated (0057) — este script roda como postgres/service_role.

-- ===========================================================================
-- CONFERÊNCIA ANTES
-- ===========================================================================
with alvo as (
  select j.id as jornada_id
    from jornadas j join pessoas p on p.id = j.pessoa_id
   where j.origem_dado = 'exemplo' and p.nome = 'Marcos Antônio Ferreira (exemplo)'
)
select 'cenarios'    as tabela, count(*) as linhas, string_agg(c.cenario || ':' || c.id::text, ', ') as detalhe
  from alvo a join cenarios_patrimoniais c on c.jornada_id = a.jornada_id
union all
select 'rubricas', count(*), string_agg(r.rubrica || '=' || coalesce(r.valor::text, 'ausente'), ', ')
  from alvo a join cenarios_patrimoniais c on c.jornada_id = a.jornada_id join cenario_rubricas r on r.cenario_id = c.id
union all
select 'diagnosticos', count(*), string_agg('v' || d.versao || case when d.atual then '*' else '' end, ', ' order by d.versao)
  from alvo a join diagnosticos_sv d on d.jornada_id = a.jornada_id
union all
select 'timeline cenario/diagnostico', count(*), string_agg(e.tipo || ' ' || to_char(e.ocorrido_em, 'DD/MM HH24:MI'), ', ' order by e.ocorrido_em)
  from alvo a join eventos_timeline e on e.jornada_id = a.jornada_id and e.tipo in ('cenario', 'diagnostico');

-- ===========================================================================
-- LIMPEZA (uma transação; devolve o apagado em JSON para reversão)
-- ===========================================================================
begin;
create temp table limpeza_h_apagado (tabela text, linha jsonb) on commit drop;

with alvo as (
  select j.id as jornada_id
    from jornadas j join pessoas p on p.id = j.pessoa_id
   where j.origem_dado = 'exemplo' and p.nome = 'Marcos Antônio Ferreira (exemplo)'
),
rub as (
  delete from cenario_rubricas r
   using cenarios_patrimoniais c, alvo a
   where r.cenario_id = c.id and c.jornada_id = a.jornada_id
  returning to_jsonb(r) as linha
)
insert into limpeza_h_apagado select 'cenario_rubricas', linha from rub;

with alvo as (
  select j.id as jornada_id
    from jornadas j join pessoas p on p.id = j.pessoa_id
   where j.origem_dado = 'exemplo' and p.nome = 'Marcos Antônio Ferreira (exemplo)'
),
cen as (
  delete from cenarios_patrimoniais c using alvo a where c.jornada_id = a.jornada_id
  returning to_jsonb(c) as linha
)
insert into limpeza_h_apagado select 'cenarios_patrimoniais', linha from cen;

-- diagnosticos_sv: o trigger `app.diagnostico_so_atual_edita` (0058) protege
-- UPDATE, não DELETE; a unique parcial `uniq_diagnostico_atual` não impede apagar.
with alvo as (
  select j.id as jornada_id
    from jornadas j join pessoas p on p.id = j.pessoa_id
   where j.origem_dado = 'exemplo' and p.nome = 'Marcos Antônio Ferreira (exemplo)'
),
diag as (
  delete from diagnosticos_sv d using alvo a where d.jornada_id = a.jornada_id
  returning to_jsonb(d) as linha
)
insert into limpeza_h_apagado select 'diagnosticos_sv', linha from diag;

-- timeline gerada pelos triggers da 0057/0058 (tipos 'cenario' e 'diagnostico')
with alvo as (
  select j.id as jornada_id
    from jornadas j join pessoas p on p.id = j.pessoa_id
   where j.origem_dado = 'exemplo' and p.nome = 'Marcos Antônio Ferreira (exemplo)'
),
ev as (
  delete from eventos_timeline e using alvo a
   where e.jornada_id = a.jornada_id and e.tipo in ('cenario', 'diagnostico')
  returning to_jsonb(e) as linha
)
insert into limpeza_h_apagado select 'eventos_timeline', linha from ev;

-- Saída: guardar. Se algo parecer errado, `rollback;` em vez de `commit;`.
select tabela, count(*) as apagadas, jsonb_agg(linha) as linhas
  from limpeza_h_apagado group by tabela order by tabela;
commit;

-- ===========================================================================
-- CONFERÊNCIA DEPOIS (esperado: 0 em todas)
-- ===========================================================================
with alvo as (
  select j.id as jornada_id
    from jornadas j join pessoas p on p.id = j.pessoa_id
   where j.origem_dado = 'exemplo' and p.nome = 'Marcos Antônio Ferreira (exemplo)'
)
select (select count(*) from alvo a join cenarios_patrimoniais c on c.jornada_id = a.jornada_id) as cenarios,
       (select count(*) from alvo a join diagnosticos_sv d on d.jornada_id = a.jornada_id)       as diagnosticos,
       (select count(*) from alvo a join eventos_timeline e on e.jornada_id = a.jornada_id
                                    and e.tipo in ('cenario', 'diagnostico'))                    as timeline;

-- ===========================================================================
-- REVERSÃO (só se precisar): cole o jsonb devolvido pela limpeza em :linhas de
-- cada tabela, NESTA ordem (FK): cenarios_patrimoniais → cenario_rubricas →
-- diagnosticos_sv → eventos_timeline. Os ids originais são preservados.
-- Desligue os triggers de timeline durante a reinserção para não duplicar evento.
-- ===========================================================================
-- begin;
-- alter table cenarios_patrimoniais disable trigger trg_timeline_cenario;
-- insert into cenarios_patrimoniais select * from jsonb_populate_recordset(null::cenarios_patrimoniais, :'linhas_cenarios'::jsonb);
-- insert into cenario_rubricas      select * from jsonb_populate_recordset(null::cenario_rubricas,      :'linhas_rubricas'::jsonb);
-- alter table diagnosticos_sv disable trigger trg_timeline_diagnostico;
-- insert into diagnosticos_sv       select * from jsonb_populate_recordset(null::diagnosticos_sv,       :'linhas_diagnosticos'::jsonb);
-- insert into eventos_timeline      select * from jsonb_populate_recordset(null::eventos_timeline,      :'linhas_timeline'::jsonb);
-- alter table cenarios_patrimoniais enable trigger trg_timeline_cenario;
-- alter table diagnosticos_sv enable trigger trg_timeline_diagnostico;
-- commit;
