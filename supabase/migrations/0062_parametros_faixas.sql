-- 0062_parametros_faixas.sql — Fase 5, Onda 1 (M1 · Motor do Croqui). NÃO APLICADA
-- (o orquestrador aplica). Depende da 0056. ADITIVA e IDEMPOTENTE.
--
-- POR QUE ESTA MIGRATION EXISTE
-- A 0056 modelou parâmetro como ESCALAR (`valor numeric`). A leitura célula a
-- célula da planilha real do escritório (19 abas, `brain/06 - Materiais/
-- Processo real do escritorio (Drive).md`) derrubou essa premissa: ITCMD
-- (causa mortis e doação), IR sobre ganho de capital, IRPF mensal e emolumentos
-- de cartório de notas NÃO são alíquotas únicas — são TABELAS POR FAIXA, que o
-- escritório mantém para as 27 UFs:
--
--   SP, causa mortis: isento até 400.000 · 2% até 4M · 4% até 10M · 6% acima
--   SP, cartório de notas: até 50.000 R$ 550 · até 200.000 R$ 1.650 · … (VALOR fixo, não %)
--   IR sobre ganho: isento até 35.000 · 15% · 17,5% · 20% · 22,5% (PROGRESSIVO)
--
-- Três modos, então: `faixa_unica` (a alíquota da faixa incide sobre a base
-- inteira), `progressivo` (soma faixa a faixa) e `valor_fixo` (a faixa devolve
-- um valor em reais).
--
-- POR QUE `jsonb` NA MESMA LINHA, E NÃO UMA TABELA FILHA
-- A 0056 garante que uma VERSÃO de parâmetro é imutável: trocar valor é INSERT
-- de versão nova + ativar. Uma tabela filha `parametro_faixas` permitiria
-- alterar as faixas de uma versão JÁ ATIVADA sem passar pelo trigger — furo
-- direto na garantia que sustenta a auditoria de "qual número entrou neste
-- croqui". A versão precisa ser atômica. A auditoria por linha vem da view
-- `vw_parametros_faixas`, que faz `unnest` só de leitura.
--
-- O QUE ESTA MIGRATION NÃO FAZ (B30 intacto)
--   - NÃO semeia NENHUMA alíquota de ITCMD ou ITBI, nem tabela de cartório,
--     nem honorário de inventário. Tudo que tem jurisdição nasce VAZIO e só
--     entra por cadastro humano com base legal.
--   - NÃO semeia as três chaves em DIVERGÊNCIA (§11.5): certidões
--     (R$ 2.000 × R$ 7.000), membership (1 plano × 3 planos) e crédito de
--     IBS/CBS (26,5% × 36,92%). O motor trava a tabela dependente com
--     `ausente`; ninguém escolhe um dos dois valores por baixo do pano.
--   - NÃO altera nenhuma linha existente de `parametros_metodo`.
--
-- ===========================================================================
-- ROTEIRO DE VERIFICAÇÃO (rodar como postgres/service_role; cada passo é
-- transacional e termina em rollback, no molde de scripts/verificacao-0061.sql;
-- os passos 1 e 5 podem rodar soltos, são leitura).
--
--   0. PRÉ (ANTES de aplicar):
--      select count(*) from parametros_metodo
--       where chave like 'cartorio.%' or chave like 'ir.%'
--          or chave like 'reforma.%'  or chave like 'locacao.%'
--          or chave like 'honorarios.inventario.%';
--      → 0 esperado. Se > 0, os CHECKs novos podem recusar linha antiga sem
--        base legal: revisar à mão ANTES de aplicar (nenhuma linha é alterada
--        por esta migration).
--
--   1. Seed: select count(*) from parametros_metodo where ativado_em is not null
--        and ativado_por is null and criado_por is null;              → 23 + 2 (as da 0056)
--      select chave, unidade, valor, faixas is not null as tem_faixas
--        from parametros_metodo where chave in ('honorarios.hora','ir.faixas.ganho_capital')
--        order by chave;
--      → honorarios.hora | brl | 1800.0000 | false
--        ir.faixas.ganho_capital | faixas | (null) | true
--
--   2. Faixas malformadas são recusadas pelo CHECK (todas devem dar 23514):
--      insert into parametros_metodo (chave, valor, unidade, faixas, base_legal) values
--        ('ir.faixas.teste_0062', null, 'faixas', '{"modo":"x","faixas":[]}'::jsonb, 'teste');            -- modo inválido
--      insert ... '{"modo":"faixa_unica","faixas":[]}'                                                    -- array vazio
--      insert ... '{"modo":"faixa_unica","faixas":[{"ordem":2,"ate":null,"aliquota":1}]}'                 -- ordem não começa em 1
--      insert ... '{"modo":"faixa_unica","faixas":[{"ordem":1,"ate":null,"aliquota":1},{"ordem":2,"ate":10,"aliquota":2}]}'  -- `ate` nulo fora da última
--      insert ... '{"modo":"faixa_unica","faixas":[{"ordem":1,"ate":100,"aliquota":1},{"ordem":2,"ate":50,"aliquota":2}]}'   -- `ate` não crescente
--      insert ... '{"modo":"valor_fixo","faixas":[{"ordem":1,"ate":null,"aliquota":1}]}'                  -- valor_fixo sem `valor`
--      E a válida ENTRA:
--      insert into parametros_metodo (chave, valor, unidade, faixas, base_legal)
--        values ('ir.faixas.teste_0062', null, 'faixas',
--                '{"modo":"faixa_unica","isento_ate":1000,"faixas":[{"ordem":1,"ate":5000,"aliquota":2},{"ordem":2,"ate":null,"aliquota":4}]}'::jsonb,
--                'teste 0062');  → OK, versao = 1, ativo = false. Guardar :id.
--
--   3. XOR unidade × conteúdo (todos 23514):
--      insert ... ('honorarios.teste_0062', 100, 'faixas', '{"modo":...}') → 23514 (faixas COM valor)
--      insert ... ('honorarios.teste_0062', null, 'brl', null)             → 23514 (escalar SEM valor)
--      insert ... ('honorarios.teste_0062', 100, 'brl', '{"modo":...}')    → 23514 (escalar COM faixas)
--
--   4. Imutabilidade cobre `faixas`:
--      update parametros_metodo set faixas = '{"modo":"faixa_unica","faixas":[{"ordem":1,"ate":null,"aliquota":9}]}'::jsonb
--       where id = :id;  → ERRO 'parametro_imutavel' (23514)
--      update parametros_metodo set notas = 'ok' where id = :id;  → 1 linha (nota continua editável)
--
--   5. B30 intacto — nenhuma alíquota de imposto semeada:
--      select count(*) from public.parametro_vigente('itcmd.faixas.doacao','SP');   → 0
--      select count(*) from public.parametro_vigente('itcmd.faixas.heranca','SP');  → 0
--      select count(*) from public.parametro_vigente('itbi.aliquota','SP','São Paulo'); → 0
--      select count(*) from parametros_metodo where chave like 'cartorio.faixas.%'; → 0
--
--   6. Base legal e jurisdição obrigatórias nas famílias novas (23514 nos três):
--      insert ... ('ir.faixas.teste2_0062', null, 'faixas', <válida>, base_legal => null)       → 23514
--      insert ... ('cartorio.faixas.notas', null, 'faixas', <válida>, uf 'SP', base_legal null) → 23514
--      insert ... ('cartorio.faixas.notas', null, 'faixas', <válida>, uf null, base_legal 'x')  → 23514 (exige UF)
--      E `cartorio.certidoes.valor` (preço, não tributo) NÃO exige base legal nem UF:
--      insert into parametros_metodo (chave, valor, unidade) values ('cartorio.certidoes.valor', 7000, 'brl'); → OK
--
--   7. A 0057 continua recusando parâmetro de faixas como se fosse alíquota —
--      é a garantia de que o trigger antigo não passa a multiplicar coisa errada:
--      insert into cenario_rubricas (cenario_id, rubrica, procedencia, base_calculo, parametro_id)
--        values (:cenario, 'itcmd', 'calculado', 1000, :id);
--      → ERRO 'parametro_nao_e_percentual' (23514)
--
--   8. View de auditoria:
--      select count(*) from vw_parametros_faixas where chave = 'ir.faixas.ganho_capital'; → 4 (uma linha por faixa)
--      select reloptions from pg_class where relname = 'vw_parametros_faixas';           → {security_invoker=true}
--      Como `relacionamento`: select count(*) from vw_parametros_faixas → > 0 (equipe lê parâmetro; pm_sel).
--
--   9. Configurações novas:
--      select chave, valor from configuracoes where chave in
--        ('croqui.horas_por_ato','croqui.sinal_modelo_referencia','parametros.divergencias') order by chave;
--      → croqui.horas_por_ato = [] (VAZIO de propósito: config vazia faz T15/T16
--        nascerem `ausente`, nunca zero) · croqui.sinal_modelo_referencia = "celula_3"
--        · parametros.divergencias = 3 entradas.
--
--  10. Reaplicar a migration inteira não duplica nada (todos os passos são
--      `if not exists` / `on conflict do nothing`).
--
-- REVERSÃO (na ordem; só funciona se nenhuma linha `unidade='faixas'` existir):
--   drop view if exists vw_parametros_faixas;
--   delete from parametros_metodo where chave in (
--     'ir.faixas.ganho_capital','ir.faixas.irpf_mensal','venda_forcada.desagio.percentual',
--     'holding.junta_comercial.celula_1','holding.junta_comercial.celula_2','holding.junta_comercial.celula_3',
--     'holding.contabilidade.celula_1','holding.contabilidade.celula_2','holding.contabilidade.celula_3',
--     'honorarios.hora','honorarios.operacional.percentual','honorarios.sv.padrao',
--     'incentivo.resolvedor.sv','incentivo.resolvedor.croqui','incentivo.resolvedor.saldo.percentual',
--     'pagamento.sinal.percentual','pagamento.parcelas.max','membership.meses_isentos',
--     'reforma.ibs_cbs.debito.percentual','reforma.irpj_csll.percentual','locacao.pj.presumido.percentual',
--     'payback.cdi_anual.percentual','operacional.risco_bloqueio.meses')
--     and ativado_por is null and criado_por is null;      -- só o que a migration semeou
--   delete from configuracoes where chave in ('croqui.horas_por_ato','croqui.sinal_modelo_referencia','parametros.divergencias');
--   alter table parametros_metodo drop constraint ck_faixas_validas;
--   alter table parametros_metodo drop constraint ck_faixas_xor;
--   alter table parametros_metodo drop constraint ck_unidade_conhecida;
--   alter table parametros_metodo drop constraint ck_cartorio_exige_jurisdicao;
--   alter table parametros_metodo drop column faixas;
--   alter table parametros_metodo alter column valor set not null;
--   -- restaurar o CHECK e o trigger da 0056 pelo texto original daquela migration.
--   drop function if exists app.faixas_validas(jsonb);
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- (a) `unidade` ganha 'faixas'
-- ---------------------------------------------------------------------------
-- O CHECK da 0056 é inline (nome gerado pelo Postgres). Derrubado por
-- descoberta, não por nome chutado: se o nome não batesse, o CHECK antigo
-- sobreviveria e todo INSERT com unidade='faixas' seria recusado — a migration
-- passaria "verde" e o motor quebraria só na hora do cadastro.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'parametros_metodo'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%unidade%'
       and pg_get_constraintdef(oid) like '%quantidade%'
  loop
    execute format('alter table parametros_metodo drop constraint %I', c.conname);
  end loop;
end $$;
alter table parametros_metodo add constraint ck_unidade_conhecida
  check (unidade in ('brl', 'percentual', 'parcelas', 'dias', 'meses', 'quantidade', 'faixas'));

-- ---------------------------------------------------------------------------
-- (b) Validação estrutural das faixas. IMMUTABLE para poder viver num CHECK.
--     Fecha, no banco, os quatro jeitos de uma tabela de faixas mentir:
--     buraco (ordem fora de sequência), sobreposição (`ate` não crescente),
--     faixa infinita no meio (`ate` nulo fora da última) e faixa sem o campo
--     que o modo exige (alíquota, ou valor no `valor_fixo`).
-- ---------------------------------------------------------------------------
create or replace function app.faixas_validas(p jsonb) returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select
    jsonb_typeof(p) = 'object'
    and (p->>'modo') in ('faixa_unica', 'progressivo', 'valor_fixo')
    and jsonb_typeof(p->'faixas') = 'array'
    and jsonb_array_length(p->'faixas') between 1 and 40
    and (not (p ? 'isento_ate')
         or (jsonb_typeof(p->'isento_ate') = 'number' and (p->>'isento_ate')::numeric >= 0))
    and (not (p ? 'teto')
         or (jsonb_typeof(p->'teto') = 'number' and (p->>'teto')::numeric >= 0))
    -- forma de cada faixa
    and not exists (
      select 1
        from jsonb_array_elements(p->'faixas') with ordinality as t(f, i)
       where jsonb_typeof(t.f) <> 'object'
          or jsonb_typeof(t.f->'ordem') <> 'number'
          or (t.f->>'ordem')::int <> t.i::int                       -- sequencial a partir de 1
          or not (t.f ? 'ate')
          or jsonb_typeof(t.f->'ate') not in ('number', 'null')
          or (jsonb_typeof(t.f->'ate') = 'null' and t.i <> jsonb_array_length(p->'faixas'))
          or (jsonb_typeof(t.f->'ate') = 'number' and (t.f->>'ate')::numeric <= 0)
          or (t.f ? 'aliquota' and (jsonb_typeof(t.f->'aliquota') <> 'number' or (t.f->>'aliquota')::numeric < 0))
          or (t.f ? 'valor'    and (jsonb_typeof(t.f->'valor')    <> 'number' or (t.f->>'valor')::numeric    < 0))
          or (t.f ? 'deduzir'  and (jsonb_typeof(t.f->'deduzir')  <> 'number' or (t.f->>'deduzir')::numeric  < 0))
          or ((p->>'modo') =  'valor_fixo' and not (t.f ? 'valor'))
          or ((p->>'modo') <> 'valor_fixo' and not (t.f ? 'aliquota'))
    )
    -- `ate` estritamente crescente: sem sobreposição, sem faixa morta
    and not exists (
      select 1
        from jsonb_array_elements(p->'faixas') with ordinality as t(f, i)
        join jsonb_array_elements(p->'faixas') with ordinality as u(g, j) on u.j = t.i + 1
       where jsonb_typeof(t.f->'ate') = 'number'
         and jsonb_typeof(u.g->'ate') = 'number'
         and (u.g->>'ate')::numeric <= (t.f->>'ate')::numeric
    )
$$;
-- CHECK avalia com o privilégio de quem faz o DML, e o schema `app` revoga
-- EXECUTE de public por padrão (0024) — sem este grant, todo INSERT de
-- `authenticated` em `parametros_metodo` cairia em "permission denied for
-- function" (armadilha 2 do CONTINUAR-AQUI).
revoke execute on function app.faixas_validas(jsonb) from public, anon;
grant  execute on function app.faixas_validas(jsonb) to authenticated, service_role;

alter table parametros_metodo add column if not exists faixas jsonb;
comment on column parametros_metodo.faixas is
  'Tabela por faixa quando unidade = ''faixas'' (ITCMD, IR, cartório). XOR com `valor`. Imutável como o resto da versão.';

alter table parametros_metodo drop constraint if exists ck_faixas_validas;
alter table parametros_metodo add constraint ck_faixas_validas
  check (faixas is null or app.faixas_validas(faixas));

-- ---------------------------------------------------------------------------
-- (c) `valor` deixa de ser obrigatório — mas só para quem é `faixas`.
--     O XOR impede os dois erros simétricos: faixa sem tabela e escalar sem número.
-- ---------------------------------------------------------------------------
alter table parametros_metodo alter column valor drop not null;
alter table parametros_metodo drop constraint if exists ck_faixas_xor;
alter table parametros_metodo add constraint ck_faixas_xor check (
  case
    when unidade = 'faixas' then faixas is not null and valor is null
    else faixas is null and valor is not null
  end
);

-- ---------------------------------------------------------------------------
-- (d) Imutabilidade cobre `faixas` (senão a tabela de alíquotas de uma versão
--     já ativada poderia ser reescrita sem deixar rastro — o croqui gravado
--     deixaria de ser reproduzível).
-- ---------------------------------------------------------------------------
create or replace function app.parametros_metodo_imutavel() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.chave      is distinct from old.chave
  or new.versao     is distinct from old.versao
  or new.valor      is distinct from old.valor
  or new.faixas     is distinct from old.faixas
  or new.unidade    is distinct from old.unidade
  or new.uf         is distinct from old.uf
  or new.municipio  is distinct from old.municipio
  or new.base_legal is distinct from old.base_legal
  or new.vigente_de is distinct from old.vigente_de
  or new.criado_em  is distinct from old.criado_em
  or new.criado_por is distinct from old.criado_por then
    raise exception 'parametro_imutavel: versão de parâmetro não muda de valor — crie uma versão nova e ative'
      using errcode = '23514';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- (e) Auditoria por linha, só leitura. `security_invoker` = a RLS de
--     `parametros_metodo` (pm_sel: equipe interna) continua valendo.
-- ---------------------------------------------------------------------------
drop view if exists vw_parametros_faixas;
create view vw_parametros_faixas
with (security_invoker = true) as
select
  pm.id            as parametro_id,
  pm.chave,
  pm.versao,
  pm.uf,
  pm.municipio,
  pm.ativo,
  pm.vigente_de,
  pm.base_legal,
  pm.faixas->>'modo'                    as modo,
  (pm.faixas->>'isento_ate')::numeric   as isento_ate,
  (pm.faixas->>'teto')::numeric         as teto,
  (f->>'ordem')::int                    as ordem,
  (f->>'ate')::numeric                  as ate,
  (f->>'aliquota')::numeric             as aliquota,
  (f->>'valor')::numeric                as valor_faixa,
  (f->>'deduzir')::numeric              as deduzir
from parametros_metodo pm
cross join lateral jsonb_array_elements(pm.faixas) f
where pm.faixas is not null;

comment on view vw_parametros_faixas is
  'Uma linha por faixa de cada versão de parâmetro. Só leitura: a versão é imutável e o jsonb é a fonte.';

revoke all on vw_parametros_faixas from public, anon;
grant select on vw_parametros_faixas to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- (f) Base legal obrigatória nas famílias novas de tributo.
--     `cartorio.certidoes.*` fica de fora de propósito: é PREÇO de cartório
--     (estimativa do escritório), não alíquota — e é justamente a chave em
--     divergência (2.000 × 7.000), que precisa poder ser cadastrada para a
--     Dra. Elaine reconciliar.
-- ---------------------------------------------------------------------------
alter table parametros_metodo drop constraint if exists ck_tributo_exige_base_legal;
alter table parametros_metodo add constraint ck_tributo_exige_base_legal check (
  case
    when chave like 'itcmd.%'
      or chave like 'itbi.%'
      or chave like 'ir.%'
      or chave like 'reforma.%'
      or chave like 'locacao.%'
      or chave like 'honorarios.inventario.%'
      or (chave like 'cartorio.%' and chave not like 'cartorio.certidoes.%')
    then base_legal is not null and btrim(base_legal) <> ''
    else true
  end
);

-- Emolumento é estadual e honorário mínimo é da seccional da OAB: os dois
-- exigem UF, como ITCMD já exigia.
alter table parametros_metodo drop constraint if exists ck_cartorio_exige_jurisdicao;
alter table parametros_metodo add constraint ck_cartorio_exige_jurisdicao check (
  case
    when (chave like 'cartorio.%' and chave not like 'cartorio.certidoes.%')
      or chave like 'honorarios.inventario.%'
    then uf is not null
    else true
  end
);

-- ---------------------------------------------------------------------------
-- (g) SEED — 23 chaves NACIONAIS que são regra do método, nunca alíquota de
--     jurisdição. Idempotente (unique de versão + on conflict do nothing).
--     Cada uma é um número que hoje vive como literal na planilha do
--     escritório; a partir daqui vive versionado, com quem ativou e quando.
-- ---------------------------------------------------------------------------
insert into parametros_metodo (chave, versao, valor, faixas, unidade, base_legal, ativo, ativado_em, notas)
values
  -- Tabelas federais (por faixa)
  ('ir.faixas.ganho_capital', 1, null,
   '{"modo":"progressivo","isento_ate":35000,"faixas":[
      {"ordem":1,"ate":5000000,"aliquota":15},
      {"ordem":2,"ate":10000000,"aliquota":17.5},
      {"ordem":3,"ate":30000000,"aliquota":20},
      {"ordem":4,"ate":null,"aliquota":22.5}]}'::jsonb,
   'faixas', 'Lei 8.981/1995, art. 21 (redação da Lei 13.259/2016); isenção de alienação de pequeno valor: Lei 9.250/1995, art. 22',
   true, now(),
   'Progressivo por faixa de GANHO. A planilha usava 15% fixo — 15% é só a primeira faixa.'),

  ('ir.faixas.irpf_mensal', 1, null,
   '{"modo":"faixa_unica","faixas":[
      {"ordem":1,"ate":2259.20,"aliquota":0,"deduzir":0},
      {"ordem":2,"ate":2826.65,"aliquota":7.5,"deduzir":169.44},
      {"ordem":3,"ate":3751.05,"aliquota":15,"deduzir":381.44},
      {"ordem":4,"ate":4664.68,"aliquota":22.5,"deduzir":662.77},
      {"ordem":5,"ate":null,"aliquota":27.5,"deduzir":896.00}]}'::jsonb,
   'faixas', 'Tabela progressiva mensal do IRPF — Lei 11.482/2007, art. 1º (redação vigente)',
   true, now(),
   'Carnê-leão do aluguel. Conferir a tabela a cada reajuste: versão nova, nunca UPDATE.'),

  -- Regras comerciais do método (sem jurisdição, sem base legal)
  ('venda_forcada.desagio.percentual', 1, 20, null, 'percentual', null, true, now(),
   'Perda estimada na venda urgente de imóvel para pagar inventário.'),
  ('holding.junta_comercial.celula_1', 1, 3577, null, 'brl', null, true, now(), '511 × 7 atos.'),
  ('holding.junta_comercial.celula_2', 1, 3500, null, 'brl', null, true, now(),
   'ATENÇÃO (§11.5-6): 500 × 7 na planilha, contra 511 nas outras duas. Diferença de R$ 77 que parece digitação — semeado como está, para a Dra. Elaine confirmar.'),
  ('holding.junta_comercial.celula_3', 1, 4599, null, 'brl', null, true, now(), '511 × 9 atos.'),
  ('holding.contabilidade.celula_1', 1, 2133, null, 'brl', null, true, now(), '711 × 3 atos.'),
  ('holding.contabilidade.celula_2', 1, 3555, null, 'brl', null, true, now(), '711 × 5 atos.'),
  ('holding.contabilidade.celula_3', 1, 4266, null, 'brl', null, true, now(), '711 × 6 atos.'),
  ('honorarios.hora', 1, 1800, null, 'brl', null, true, now(),
   'Hora do método. O honorário da holding é FÓRMULA (hora × horas do modelo + operacional), não parâmetro por modelo.'),
  ('honorarios.operacional.percentual', 1, 10, null, 'percentual', null, true, now(),
   'Valor operacional sobre o honorário.'),
  ('honorarios.sv.padrao', 1, 2000, null, 'brl', null, true, now(), 'Dedução da Sessão de Viabilidade.'),
  ('incentivo.resolvedor.sv', 1, 2400, null, 'brl', null, true, now(),
   'Incentivo do Resolvedor na SV. A nota antiga do brain dizia 1.600 — a planilha real diz 2.400.'),
  ('incentivo.resolvedor.croqui', 1, 2700, null, 'brl', null, true, now(), 'Incentivo do Resolvedor no Croqui.'),
  ('incentivo.resolvedor.saldo.percentual', 1, 10, null, 'percentual', null, true, now(),
   'Incide sobre o SALDO já deduzido (B18 = B17 × 0,1), não sobre o honorário cheio.'),
  ('pagamento.sinal.percentual', 1, 10, null, 'percentual', null, true, now(),
   'Sinal = 10% do novo saldo do modelo de referência (configuracoes[''croqui.sinal_modelo_referencia'']), igual para os três modelos.'),
  ('pagamento.parcelas.max', 1, 5, null, 'parcelas', null, true, now(), 'Parcelamento do saldo à vista.'),
  ('membership.meses_isentos', 1, 6, null, 'meses', null, true, now(),
   'Meses de acompanhamento isento após a entrega. A MENSALIDADE não é semeada: está em divergência (§11.5-3).'),

  -- Reforma tributária e locação via PJ (base legal obrigatória)
  ('reforma.ibs_cbs.debito.percentual', 1, 15.9, null, 'percentual',
   'EC 132/2023 e LC 214/2025 — alíquota de referência ESTIMADA pelo escritório para locação via PJ. Premissa de cálculo, não alíquota publicada.',
   true, now(),
   'Sai da aba 8 da planilha. Revisar quando a alíquota de referência for fixada.'),
  ('reforma.irpj_csll.percentual', 1, 7.68, null, 'percentual',
   'Lei 9.430/1996, art. 25 (IRPJ) e Lei 7.689/1988 (CSLL) — carga efetiva sobre receita de locação no lucro presumido (32% de presunção).',
   true, now(), 'Aba 8, B9.'),
  ('locacao.pj.presumido.percentual', 1, 3.65, null, 'percentual',
   'PIS 0,65% (LC 7/1970 e Lei 9.715/1998) + COFINS 3% (LC 70/1991) — regime cumulativo do lucro presumido.',
   true, now(), 'Usado no comparativo CPF × PJ do aluguel.'),

  -- Premissas
  ('payback.cdi_anual.percentual', 1, 10, null, 'percentual', null, true, now(),
   'PREMISSA de rendimento do capital salvo, não promessa. A tela mostra como premissa editável na simulação.'),
  ('operacional.risco_bloqueio.meses', 1, 6, null, 'meses', null, true, now(),
   'Meses de faturamento da operação expostos ao bloqueio durante o inventário.')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- (h) Configurações do croqui.
--     `croqui.horas_por_ato` nasce VAZIA de propósito: sem a tabela de horas,
--     T15 e T16 nascem `ausente` com o motivo na tela. Config vazia é honesta;
--     honorário calculado sobre zero hora seria um preço inventado.
-- ---------------------------------------------------------------------------
insert into configuracoes (chave, valor, descricao) values
  ('croqui.horas_por_ato', '[]'::jsonb,
   'Tabela de horas por ato × modelo: [{"ato":"...","horas":{"celula_1":n,"celula_2":n,"celula_3":n}}]. Vazia = T15/T16 do croqui nascem ausentes (nunca zero). Totais do escritório hoje: 50 h / 47 h / 35 h.'),
  ('croqui.sinal_modelo_referencia', '"celula_3"'::jsonb,
   'Modelo cujo novo saldo define o sinal e o custo de implementação do payback. A planilha usa três células; o rótulo "maior valor" dela está errado.'),
  ('parametros.divergencias', '[
     {"chave":"cartorio.certidoes.valor","valores":[2000,7000],"onde":"aba 3 × abas 4-7 da planilha do escritório"},
     {"chave":"membership.mensalidade","valores":[750,1350,2000],"onde":"contrato (1 plano) × slide 37 (3 planos)"},
     {"chave":"reforma.ibs_cbs.credito.percentual","valores":[26.5,36.92],"onde":"aba 10 × aba 8 da planilha do escritório"}
   ]'::jsonb,
   'Chaves com dois valores conflitantes no material do escritório. O motor trava a tabela dependente com `ausente` e o Painel do admin cobra a reconciliação — nenhum agente escolhe um dos valores.')
on conflict (chave) do nothing;
