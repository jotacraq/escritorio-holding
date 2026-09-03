-- 0023_vw_jornada_kanban_origem_dado.sql
-- Bug reportado pelo orquestrador: o kanban nunca mostra o selo de dado de
-- exemplo. `src/components/esteira/CartaoJornada.tsx:72` lê
-- `jornada.origem_dado`, mas `vw_jornada_kanban` (0015) nunca selecionava essa
-- coluna — GET /api/jornadas faz `select("*")` na VIEW, então "*" nunca incluía
-- o campo porque ele não existe na view, não porque a rota o omitiu. A Ficha
-- 360 funciona porque lê `jornadas` direto (`select("*")` na TABELA).
--
-- `origem_dado` existe tanto em `jornadas` quanto em `pessoas` (0003/0004). O
-- card é sobre a JORNADA (é o que a regra "dado de seed carimbado na tela" quer
-- marcar) — usamos `j.origem_dado`, mesmo campo que `CartaoJornada.tsx` já lê.
drop view if exists vw_jornada_kanban;
create view vw_jornada_kanban with (security_invoker = true) as
select j.id, j.etapa, j.desfecho, j.origem, j.trilha, j.edicao_id, e.codigo as edicao_codigo,
       j.faixa_patrimonio_declarada, j.nivel_pago, j.responsavel_id,
       j.origem_dado,
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
