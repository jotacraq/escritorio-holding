-- 0057_cenarios_patrimoniais.sql — Fase 4, F4 (agente D). NÃO APLICADA. Depende da 0056.
--
-- Cenário Patrimonial com PROCEDÊNCIA POR RUBRICA (default B26 do brief):
-- cada número da grade `rubrica × cenário` diz de onde veio —
--   'digitado'  : a advogada digitou o valor;
--   'calculado' : a advogada digitou a BASE e escolheu o PARÂMETRO vigente
--                 (alíquota com base legal, 0056); o banco multiplica e
--                 carimba `parametro_id` + `aliquota` na linha — é a ÚNICA
--                 conta que o sistema faz, e só com os insumos humanos;
--   'ausente'   : não há número. A tela mostra vazio, nunca zero.
-- O total de um cenário é `null` enquanto qualquer rubrica estiver ausente
-- (view `vw_cenarios_totais`): não existe "total parcial" que pareça total.
--
-- B28: `relatorios_sessao.tributos` (texto livre, 0008) NÃO é convertido nem
-- lido aqui. Nenhum backfill. Toda rubrica nasce quando a advogada a toca.
-- B37: as 7 rubricas de UI vão para `configuracoes['cenario.rubricas']`
-- (chave de tela, não valor); a advogada pode acrescentar rubrica livre.
--
-- Duas tabelas (cabeçalho + rubricas) em vez de uma: o cabeçalho é o que a
-- Ficha/Diagnóstico referenciam; as rubricas são as células.
--
-- ROTEIRO DE VERIFICAÇÃO (service_role; usar uma jornada de teste :j — nada
-- aqui altera dado existente; apagar as linhas de teste ao final):
--   1. insert into cenarios_patrimoniais (jornada_id, cenario) values (:j, 'inventario') returning id; → :c
--   2. insert into cenario_rubricas (cenario_id, rubrica, procedencia, base_calculo)
--        values (:c, 'itcmd', 'calculado', 1000000);
--      → ERRO 23514 (calculado sem parametro_id — `cenario_calculado_exige_parametro`).
--   3. insert into cenario_rubricas (cenario_id, rubrica, procedencia, valor) values (:c, 'custas_cartorio', 'digitado', 15000);
--      insert into cenario_rubricas (cenario_id, rubrica, procedencia) values (:c, 'itbi', 'ausente');
--      select total, rubricas_ausentes from vw_cenarios_totais where cenario_id = :c;
--      → total NULL, rubricas_ausentes 1 (uma ausente basta para não haver total).
--   4. (com um parâmetro percentual ativo :p — ex.: o 'itcmd.aliquota' SP do roteiro da 0056, valor 4)
--      insert into cenario_rubricas (cenario_id, rubrica, procedencia, base_calculo, parametro_id)
--        values (:c, 'itcmd', 'calculado', 1000000, :p) returning valor, aliquota;
--      → valor 40000.00, aliquota 4.0000 (carimbada a partir do parâmetro, não do cliente).
--      update cenario_rubricas set procedencia = 'digitado', valor = 1 where cenario_id = :c and rubrica = 'itbi';
--      select total from vw_cenarios_totais where cenario_id = :c; → 55001.00
--   5. insert into cenario_rubricas (cenario_id, rubrica, procedencia, base_calculo, parametro_id)
--        values (:c, 'honorarios', 'calculado', 100, (select id from parametro_vigente('honorarios.croqui.padrao')));
--      → ERRO 23514 (`parametro_nao_e_percentual`): só alíquota multiplica.
--   6. insert into cenario_rubricas (cenario_id, rubrica, procedencia, valor) values (:c, 'x', 'ausente', 10);
--      → ERRO 23514 (ck_procedencia: ausente exige valor nulo).
--   7. Como `relacionamento`: select count(*) from cenarios_patrimoniais → 0 linhas (RLS ve_patrimonio);
--      insert → 42501. Como `advogada`: lê e escreve.
--   8. delete from cenario_rubricas ... como authenticated → permission denied (sem grant). Zerar = 'ausente'.
--   9. select reloptions from pg_class where relname = 'vw_cenarios_totais' → {security_invoker=true}.
--  10. Limpar: delete from cenarios_patrimoniais where id = :c (service_role; cascade).
--  11. Reverter: drop view vw_cenarios_totais; drop table cenario_rubricas; drop table cenarios_patrimoniais;
--      drop type procedencia_valor; delete from configuracoes where chave = 'cenario.rubricas'.

create type procedencia_valor as enum ('calculado', 'digitado', 'ausente');

create table cenarios_patrimoniais (
  id             uuid primary key default gen_random_uuid(),
  jornada_id     uuid not null references jornadas(id) on delete cascade,
  cenario        text not null
    check (cenario in ('inventario', 'doacao', 'holding_1_celula', 'holding_2_celulas', 'holding_3_celulas')),
  nota           text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  criado_por     uuid references perfis_equipe(id),
  atualizado_por uuid references perfis_equipe(id),
  unique (jornada_id, cenario)
);
create trigger trg_cenarios_atualizado_em before update on cenarios_patrimoniais
for each row execute function app.set_atualizado_em();

create table cenario_rubricas (
  id             uuid primary key default gen_random_uuid(),
  cenario_id     uuid not null references cenarios_patrimoniais(id) on delete cascade,
  rubrica        text not null check (rubrica ~ '^[a-z][a-z0-9_]{1,63}$'),
  ordem          smallint not null default 0,
  procedencia    procedencia_valor not null default 'ausente',
  valor          numeric(15,2) check (valor >= 0),
  base_calculo   numeric(15,2) check (base_calculo >= 0),
  aliquota       numeric(7,4) check (aliquota >= 0),
  parametro_id   uuid references parametros_metodo(id),   -- carimbo: QUAL versão de alíquota multiplicou
  nota           text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid references perfis_equipe(id),
  unique (cenario_id, rubrica),
  -- B26 no banco (o PostgREST é a segunda porta — armadilha 4):
  --   calculado → base + alíquota + parâmetro + valor;  digitado → valor;  ausente → valor nulo.
  constraint ck_procedencia check (
    (procedencia = 'calculado' and base_calculo is not null and aliquota is not null
       and parametro_id is not null and valor is not null)
    or (procedencia = 'digitado' and valor is not null)
    or (procedencia = 'ausente' and valor is null)
  )
);
create index idx_cenario_rubricas_parametro on cenario_rubricas (parametro_id) where parametro_id is not null;
create trigger trg_cenario_rubricas_atualizado_em before update on cenario_rubricas
for each row execute function app.set_atualizado_em();

-- ===========================================================================
-- A única conta do sistema. BEFORE ROW (roda antes do CHECK):
--   calculado: exige parametro_id → lê o parâmetro → exige unidade
--   'percentual' → carimba `aliquota` DO PARÂMETRO (nunca a que o cliente
--   mandou) → valor = round(base × alíquota / 100, 2).
--   digitado/ausente: limpa os campos de cálculo para a linha não mentir
--   ("digitado" com alíquota carimbada de outra época seria carimbo falso).
-- Todo erro sai com errcode 23514 — mesmo código do CHECK, para a rota
-- tratar igual (`cenario_invalido`).
-- ===========================================================================
create or replace function app.cenario_rubrica_calcula() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_param parametros_metodo;
begin
  if new.procedencia = 'calculado' then
    if new.parametro_id is null then
      raise exception 'cenario_calculado_exige_parametro: rubrica "%" marcada como calculada sem parâmetro vigente', new.rubrica
        using errcode = '23514';
    end if;
    if new.base_calculo is null then
      raise exception 'cenario_calculado_exige_base: rubrica "%" marcada como calculada sem base de cálculo', new.rubrica
        using errcode = '23514';
    end if;
    select * into v_param from parametros_metodo where id = new.parametro_id;
    if v_param.id is null then
      raise exception 'parametro_nao_encontrado: %', new.parametro_id using errcode = '23514';
    end if;
    if v_param.unidade <> 'percentual' then
      raise exception 'parametro_nao_e_percentual: "%" é %, não alíquota', v_param.chave, v_param.unidade
        using errcode = '23514';
    end if;
    new.aliquota := v_param.valor;
    new.valor    := round(new.base_calculo * v_param.valor / 100, 2);
  else
    new.base_calculo := null;
    new.aliquota     := null;
    new.parametro_id := null;
    if new.procedencia = 'ausente' then
      new.valor := null;
    end if;
  end if;
  new.atualizado_por := coalesce(
    (select id from perfis_equipe where auth_user_id = auth.uid() and ativo limit 1),
    new.atualizado_por);
  return new;
end $$;
create trigger trg_cenario_rubrica_calcula before insert or update on cenario_rubricas
for each row execute function app.cenario_rubrica_calcula();

-- Timeline: um evento por cenário criado (não por célula — a grade muda
-- muitas vezes numa sessão de edição e a linha do tempo não é log de tecla).
create or replace function app.timeline_cenario() returns trigger
language plpgsql as $$
begin
  perform app.registrar_evento_timeline(new.jornada_id, 'cenario',
    'Cenário patrimonial iniciado: ' || new.cenario, null,
    jsonb_build_object('cenario_id', new.id, 'cenario', new.cenario));
  return new;
end $$;
create trigger trg_timeline_cenario after insert on cenarios_patrimoniais
for each row execute function app.timeline_cenario();

-- ===========================================================================
-- Totais: `null` enquanto houver rubrica ausente. `security_invoker` para a
-- RLS de `cenarios_patrimoniais` valer para quem consulta (lição da 0047).
-- ===========================================================================
create view vw_cenarios_totais with (security_invoker = true) as
select c.id as cenario_id,
       c.jornada_id,
       c.cenario,
       case when bool_or(r.procedencia = 'ausente') then null else sum(r.valor) end as total,
       count(r.id)::int                                            as rubricas_total,
       count(r.id) filter (where r.procedencia = 'ausente')::int   as rubricas_ausentes,
       coalesce(bool_or(r.procedencia = 'calculado'), false)       as tem_calculado,
       greatest(c.atualizado_em, max(r.atualizado_em))             as atualizado_em
  from cenarios_patrimoniais c
  left join cenario_rubricas r on r.cenario_id = c.id
 group by c.id, c.jornada_id, c.cenario, c.atualizado_em;

alter table cenarios_patrimoniais enable row level security;
alter table cenarios_patrimoniais force row level security;
alter table cenario_rubricas enable row level security;
alter table cenario_rubricas force row level security;

-- Mesmo recorte de `relatorios_sessao`/`patrimonio_itens`: valor de
-- patrimônio e de imposto do cliente é sigilo — `relacionamento` não lê.
create policy cp_sel on cenarios_patrimoniais for select to authenticated using ((select app.ve_patrimonio()));
create policy cp_ins on cenarios_patrimoniais for insert to authenticated with check ((select app.ve_patrimonio()));
create policy cp_upd on cenarios_patrimoniais for update to authenticated
  using ((select app.ve_patrimonio())) with check ((select app.ve_patrimonio()));

create policy cr_sel on cenario_rubricas for select to authenticated using ((select app.ve_patrimonio()));
create policy cr_ins on cenario_rubricas for insert to authenticated with check ((select app.ve_patrimonio()));
create policy cr_upd on cenario_rubricas for update to authenticated
  using ((select app.ve_patrimonio())) with check ((select app.ve_patrimonio()));
-- Sem DELETE: zerar uma célula = procedencia 'ausente'. Histórico de edição
-- fica em `atualizado_em/por`; apagar linha apagaria o carimbo do parâmetro.

revoke all on cenarios_patrimoniais, cenario_rubricas, vw_cenarios_totais from public, anon;
grant select, insert, update on cenarios_patrimoniais, cenario_rubricas to authenticated;
grant select on vw_cenarios_totais to authenticated;
grant select, insert, update, delete on cenarios_patrimoniais, cenario_rubricas to service_role;
grant select on vw_cenarios_totais to service_role;

-- B37: rubricas de UI (chaves, não valores). `on conflict do nothing`: se o
-- Admin já tiver editado, a migration não sobrescreve.
insert into configuracoes (chave, valor, descricao) values
  ('cenario.rubricas',
   '["itcmd","itbi","custas_cartorio","honorarios_advocaticios","honorarios_croqui","honorarios_holding","manutencao_anual"]'::jsonb,
   'Rubricas padrão da grade do Cenário Patrimonial (chaves de tela; a advogada pode acrescentar rubrica livre por jornada). Nenhum valor nasce preenchido.')
on conflict (chave) do nothing;
