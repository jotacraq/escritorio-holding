-- 0025_vw_indicadores_com_edicao.sql
-- REPROVACAO do Fable (UX): /indicadores mostrava "Edicao 64f9f307-..." — UUID cru
-- como titulo, na frente da advogada. A view devolvia so `edicao_id`. Mesmo padrao
-- ja usado em vw_jornada_kanban (0015/0023): a view entrega o codigo e o nome.
drop view if exists vw_indicadores_esteira;
create view vw_indicadores_esteira with (security_invoker = true) as
select j.edicao_id,
       e.codigo as edicao_codigo,
       e.nome   as edicao_nome,
       count(*)                                                          as jornadas,
       count(*) filter (where j.etapa >= 'sessao_contratada')            as sessoes_contratadas,
       count(*) filter (where j.etapa >= 'sessao_realizada')             as sessoes_realizadas,
       count(*) filter (where j.etapa >= 'croqui_contratado')            as croquis_contratados,
       count(*) filter (where j.desfecho = 'ganha')                      as holdings,
       count(*) filter (where exists (select 1 from formularios_respostas f where f.jornada_id = j.id)
                          and j.nivel_pago >= 1)                         as formularios_respondidos,
       count(*) filter (where exists (select 1 from ligacoes_estrategicas l where l.jornada_id = j.id)) as ligacoes_feitas
  from jornadas j
  left join edicoes_seminario e on e.id = j.edicao_id
 group by j.edicao_id, e.codigo, e.nome;
