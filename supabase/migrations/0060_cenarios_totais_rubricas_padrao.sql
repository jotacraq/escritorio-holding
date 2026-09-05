-- 0060_cenarios_totais_rubricas_padrao.sql
-- Fase 4 · Onda 3 (agente K — costura). Depende de 0057 (view) e 0055 (PDF).
--
-- O que entra (aditivo; nenhum DELETE, nenhum UPDATE de valor de cliente):
--   (a) `vw_cenarios_totais`: o `total` só fecha quando TODAS as rubricas de
--       `configuracoes['cenario.rubricas']` existem no cenário com procedência
--       diferente de `ausente`. Achado do agente H (05/09): a view da 0057 só
--       contava como ausente a rubrica GRAVADA como `ausente` — com uma única
--       célula digitada (custas_cartorio R$ 15.000) o diagnóstico escreveu
--       "Inventário: R$ 15.000,00" como se fosse o custo total do inventário.
--       Rubrica padrão que a advogada nunca tocou é tão ausente quanto a
--       marcada `ausente`: não existe "total parcial" que pareça total (B26).
--       Colunas novas SÓ NO FIM (`create or replace view` exige a mesma ordem):
--         rubricas_faltantes  text[]  — padrão não gravada ∪ gravada como `ausente`
--         rubricas_padrao     int     — quantas rubricas a config pede
--       `rubricas_ausentes` passa a contar o mesmo conjunto de `rubricas_faltantes`
--       (era só as gravadas) — é o número que a Ficha/diagnóstico mostram em
--       "faltam N". `security_invoker = true` mantido (armadilha 0041b/0047).
--   (b) `app.payload_link_material` (0028/0031): acrescenta `pdf_disponivel`
--       (boolean) — o `/p/m` deixa de sondar `GET …/material-pdf` com um clique
--       para saber se o botão "Baixar PDF" existe (pendência I (c)). Mesma regra
--       de `resolver_pdf_material_publico` (0055): material ATUAL + APROVADO +
--       `pdf_caminho` preenchido. Nenhum caminho, nenhum id no payload.
--
-- ROTEIRO DE VERIFICAÇÃO (orquestrador, via MCP; `scripts/verificacao-fase4.sql`
-- passo (g) faz tudo isto dentro de uma transação com rollback):
--   1) select reloptions from pg_class where relname = 'vw_cenarios_totais';
--      → {security_invoker=true}
--   2) select column_name from information_schema.columns
--       where table_name = 'vw_cenarios_totais' order by ordinal_position;
--      → as 8 da 0057 na mesma ordem + rubricas_faltantes, rubricas_padrao
--   3) begin;
--      insert into cenarios_patrimoniais (jornada_id, cenario) values (:j, 'inventario') returning id; → :c
--      insert into cenario_rubricas (cenario_id, rubrica, procedencia, valor) values (:c, 'custas_cartorio', 'digitado', 15000);
--      select total, rubricas_ausentes, rubricas_faltantes from vw_cenarios_totais where cenario_id = :c;
--      → total NULL · rubricas_ausentes 6 · rubricas_faltantes = as 6 chaves da config menos custas_cartorio
--      -- preencher as outras 6 como digitado 1:
--      insert into cenario_rubricas (cenario_id, rubrica, procedencia, valor)
--        select :c, r, 'digitado', 1 from jsonb_array_elements_text((select valor from configuracoes where chave='cenario.rubricas')) r
--        where r <> 'custas_cartorio';
--      select total, rubricas_ausentes, rubricas_faltantes from vw_cenarios_totais where cenario_id = :c;
--      → total 15006.00 · rubricas_ausentes 0 · rubricas_faltantes '{}'
--      update cenario_rubricas set procedencia='ausente', valor=null where cenario_id=:c and rubrica='itbi';
--      select total, rubricas_faltantes from vw_cenarios_totais where cenario_id = :c; → NULL · {itbi}
--      -- rubrica livre ausente também trava (é célula que a advogada abriu):
--      insert into cenario_rubricas (cenario_id, rubrica, procedencia) values (:c, 'taxa_livre', 'ausente');
--      → rubricas_faltantes {itbi,taxa_livre}
--      rollback;
--   4) Config ausente (nunca em produção — a 0057 semeia): total segue a regra
--      antiga (só gravadas). Testar: begin; delete from configuracoes where chave='cenario.rubricas';
--      select total from vw_cenarios_totais limit 1; rollback;
--   5) Payload público: com um link tipo 'material' ativo de jornada com material
--      aprovado: select abrir_link_publico(:hash) -> 'payload' ->> 'pdf_disponivel';
--      → 'false' antes de `registrar_pdf_material`, 'true' depois.
--   6) explain (analyze, buffers) select * from vw_cenarios_totais where jornada_id = :j;
--      → Index Scan (cenarios_patrimoniais_jornada_id_cenario_key / cenario_rubricas_cenario_id_rubrica_key);
--        a leitura da config é uma linha por chave primária.
--
-- REVERSÃO:
--   create or replace view vw_cenarios_totais ... pelo texto da 0057:162-173
--   (precisa de `drop view` antes, porque colunas não podem ser removidas por replace);
--   create or replace function app.payload_link_material ... pelo texto da 0031:419-431.

-- ===========================================================================
-- (a) vw_cenarios_totais
-- ===========================================================================
create or replace view vw_cenarios_totais with (security_invoker = true) as
with padrao as (
  -- chaves de tela (B37). Config ausente → array vazio → só as gravadas contam.
  select coalesce(
           (select array_agg(x order by ord)
              from configuracoes c,
                   jsonb_array_elements_text(case when jsonb_typeof(c.valor) = 'array' then c.valor else '[]'::jsonb end)
                     with ordinality as t(x, ord)
             where c.chave = 'cenario.rubricas'),
           '{}'::text[]
         ) as rubricas
),
faltas as (
  select c.id as cenario_id,
         array_remove(array_agg(distinct f.rubrica order by f.rubrica), null) as rubricas_faltantes
    from cenarios_patrimoniais c
    cross join padrao p
    left join lateral (
      -- padrão não gravada
      select r_p as rubrica
        from unnest(p.rubricas) as r_p
       where not exists (select 1 from cenario_rubricas r
                          where r.cenario_id = c.id and r.rubrica = r_p and r.procedencia <> 'ausente')
      union
      -- qualquer gravada como ausente (padrão ou livre)
      select r.rubrica
        from cenario_rubricas r
       where r.cenario_id = c.id and r.procedencia = 'ausente'
    ) f on true
   group by c.id
)
select c.id as cenario_id,
       c.jornada_id,
       c.cenario,
       case when cardinality(f.rubricas_faltantes) > 0 then null else sum(r.valor) end as total,
       count(r.id)::int                                            as rubricas_total,
       cardinality(f.rubricas_faltantes)::int                      as rubricas_ausentes,
       coalesce(bool_or(r.procedencia = 'calculado'), false)       as tem_calculado,
       greatest(c.atualizado_em, max(r.atualizado_em))             as atualizado_em,
       -- colunas novas (0060), só no fim:
       f.rubricas_faltantes                                        as rubricas_faltantes,
       (select cardinality(rubricas) from padrao)::int             as rubricas_padrao
  from cenarios_patrimoniais c
  join faltas f on f.cenario_id = c.id
  left join cenario_rubricas r on r.cenario_id = c.id
 group by c.id, c.jornada_id, c.cenario, c.atualizado_em, f.rubricas_faltantes;

comment on view vw_cenarios_totais is
  'Totais por cenário. `total` é NULL enquanto qualquer rubrica de configuracoes[cenario.rubricas] não existir ou estiver `ausente` (0060) — nunca um total parcial que pareça total. `rubricas_faltantes` nomeia o que falta.';

-- grants iguais aos da 0057 (create or replace view preserva, reafirmado por clareza)
revoke all on vw_cenarios_totais from public, anon;
grant select on vw_cenarios_totais to authenticated, service_role;

-- ===========================================================================
-- (b) app.payload_link_material + pdf_disponivel
-- ===========================================================================
create or replace function app.payload_link_material(p_link links_publicos, p_jornada jornadas)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare v_material record;
begin
  select conteudo, aprovado_em, (pdf_caminho is not null) as pdf_disponivel into v_material
    from materiais_gerados
   where jornada_id = p_jornada.id and atual and aprovado_em is not null
   limit 1;
  if not found then
    return null;
  end if;
  return v_material.conteudo
      || jsonb_build_object('aprovado_em', v_material.aprovado_em,
                            'pdf_disponivel', v_material.pdf_disponivel);
end $$;
