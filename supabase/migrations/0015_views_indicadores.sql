-- 0015_views_indicadores.sql
-- security_invoker: a view herda a RLS de quem consulta. SEM isso a view vira
-- porta dos fundos que expõe patrimônio a quem a policy negou.

create view vw_jornada_kanban with (security_invoker = true) as
select j.id, j.etapa, j.desfecho, j.origem, j.trilha, j.edicao_id, e.codigo as edicao_codigo,
       j.faixa_patrimonio_declarada, j.nivel_pago, j.responsavel_id,
       p.id as pessoa_id, p.nome, p.cidade, p.uf, p.telefone, p.email,
       j.entrou_na_etapa_em,
       extract(day from now() - j.entrou_na_etapa_em)::int as dias_na_etapa,
       exists (select 1 from formularios_respostas f where f.jornada_id = j.id) as tem_formulario,
       exists (select 1 from ligacoes_estrategicas l where l.jornada_id = j.id) as tem_ligacao,
       exists (select 1 from briefings b where b.jornada_id = j.id and b.atual)  as tem_briefing,
       (select min(a.inicio_em) from agendamentos a
          join sessoes_viabilidade s on s.id = a.sessao_id
         where s.jornada_id = j.id and a.status in ('agendado','confirmado')
           and a.inicio_em > now()) as proxima_sessao_em
  from jornadas j
  join pessoas p on p.id = j.pessoa_id
  left join edicoes_seminario e on e.id = j.edicao_id;

-- POP 08 — indicadores calculados das transições, sem tabela de métrica paralela.
create view vw_indicadores_esteira with (security_invoker = true) as
select j.edicao_id,
       count(*) filter (where j.etapa >= 'sessao_contratada')            as sessoes_contratadas,
       count(*) filter (where j.etapa >= 'sessao_realizada')             as sessoes_realizadas,
       count(*) filter (where j.etapa >= 'croqui_contratado')            as croquis_contratados,
       count(*) filter (where j.desfecho = 'ganha')                      as holdings,
       count(*) filter (where exists (select 1 from formularios_respostas f where f.jornada_id = j.id)
                          and j.nivel_pago >= 1)                         as formularios_respondidos,
       count(*) filter (where exists (select 1 from ligacoes_estrategicas l where l.jornada_id = j.id)) as ligacoes_feitas
  from jornadas j group by j.edicao_id;
-- NOTA: comparação entre enums usa a ordem de declaração do enum, que aqui coincide
-- com a ordem da esteira POR CONSTRUÇÃO. Se alguém inserir valor no meio do enum, quebra.
-- Etapa nova SEMPRE entra no fim do enum + linha em etapas_jornada_ordem.
