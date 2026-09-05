-- 0056_parametros_metodo.sql — Fase 4, F4 (agente D). NÃO APLICADA (o orquestrador aplica).
--
-- Preço, alíquota e honorário saem do TypeScript e viram DADO VERSIONADO,
-- no mesmo padrão de `prompts_versoes` (0009) / `ativar_prompt_versao`
-- (0033): versão nova é INSERT + ativar; nunca UPDATE do valor de uma versão
-- (trigger recusa); histórico nunca é apagado (sem DELETE para ninguém).
--
-- O que esta migration NÃO faz (defaults B26/B30 do brief):
--   - NÃO cadastra nenhuma alíquota de ITCMD/ITBI. A tabela nasce SEM linha
--     `itcmd.*`/`itbi.*`; Admin → Parâmetros preenche, e o CHECK
--     `ck_tributo_exige_base_legal` recusa alíquota de imposto sem base legal.
--   - NÃO calcula imposto. Isto é só a tabela de parâmetros; a multiplicação
--     (única conta do sistema) vive na 0057 e só roda com base + parâmetro
--     digitados por humano.
--
-- SEED (B27): `honorarios.croqui.padrao` = 7200 e `honorarios.croqui.incentivo`
-- = 4500 — literais do script (PARTE 11), que até aqui eram
-- `VALOR_PADRAO_CROQUI`/`VALOR_INCENTIVO_RESOLVEDOR_CROQUI` em
-- `src/types/roteiro.ts`. A rota de ofertas passa a ler daqui.
--
-- Modelo de chave + jurisdição: `chave` é o CONCEITO (`itcmd.aliquota`,
-- `itbi.aliquota`, `honorarios.croqui.padrao`, ...); `uf`/`municipio` são a
-- jurisdição, em coluna própria (não embutida na chave) — é o que permite
-- `parametro_vigente('itcmd.aliquota', 'SP')` e uma tela de admin com filtro.
--
-- ROTEIRO DE VERIFICAÇÃO (rodar como service_role no SQL editor; nada aqui
-- altera dado de cliente):
--   1. select chave, valor, unidade, ativo from parametros_metodo order by chave;
--      → 2 linhas: honorarios.croqui.incentivo 4500 brl true · honorarios.croqui.padrao 7200 brl true
--   2. select valor from public.parametro_vigente('honorarios.croqui.padrao');   → 7200.0000
--      select valor from public.parametro_vigente('honorarios.croqui.incentivo'); → 4500.0000
--      select count(*) from public.parametro_vigente('itcmd.aliquota', 'SP');    → 0 (B30: vazio)
--   3. insert into parametros_metodo (chave, valor, unidade, uf) values ('itcmd.aliquota', 4, 'percentual', 'SP');
--      → ERRO 23514 (ck_tributo_exige_base_legal) — alíquota de imposto sem base legal não entra.
--   4. insert into parametros_metodo (chave, valor, unidade, uf, base_legal)
--        values ('itcmd.aliquota', 4, 'percentual', 'SP', 'Lei Estadual SP 10.705/2000, art. 16');
--      → OK, versao = 1 (trigger), ativo = false. Guardar o id em :id.
--      select ativo from public.ativar_parametro_metodo(:id) → true; select count(*) from parametros_metodo
--        where chave='itcmd.aliquota' and uf='SP' and ativo → 1.
--   5. update parametros_metodo set valor = 5 where id = :id;
--      → ERRO 'parametro_imutavel' (errcode 23514): versão não muda de valor; cria-se outra.
--   6. delete from parametros_metodo where id = :id; → OK só como service_role (para limpar o teste);
--      como `authenticated`, qualquer papel: `permission denied` (sem grant de DELETE).
--   7. Como usuário `relacionamento` (set role / JWT): select count(*) from parametros_metodo → 2 (lê);
--      insert ... → 42501 (só admin escreve); select public.ativar_parametro_metodo(<id>) → 42501.
--   8. Reverter: drop function public.ativar_parametro_metodo(uuid);
--      drop function public.parametro_vigente(text, text, text); drop table parametros_metodo;
--      (a 0057 referencia esta tabela — derrubar a 0057 ANTES).

create table parametros_metodo (
  id            uuid primary key default gen_random_uuid(),
  chave         text not null
    check (chave ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),   -- 'itcmd.aliquota' | 'honorarios.croqui.padrao'
  versao        smallint not null,                            -- preenchida pelo trigger quando vier nula
  valor         numeric(15,4) not null check (valor >= 0),
  unidade       text not null
    check (unidade in ('brl', 'percentual', 'parcelas', 'dias', 'meses', 'quantidade')),
  uf            char(2) check (uf is null or uf ~ '^[A-Z]{2}$'),
  municipio     text,                                         -- nome ou código IBGE; só faz sentido com `uf`
  base_legal    text,                                         -- lei/decreto/URL — OBRIGATÓRIA para imposto
  vigente_de    date not null default current_date,
  ativo         boolean not null default false,
  ativado_por   uuid references perfis_equipe(id),
  ativado_em    timestamptz,
  notas         text,
  criado_em     timestamptz not null default now(),
  criado_por    uuid references perfis_equipe(id),
  -- B26/B30 no banco: alíquota de imposto sem base legal não existe.
  constraint ck_tributo_exige_base_legal check (
    (chave not like 'itcmd.%' and chave not like 'itbi.%')
    or (base_legal is not null and btrim(base_legal) <> '')
  ),
  -- ITCMD é estadual, ITBI municipal: jurisdição obrigatória para os dois.
  constraint ck_tributo_exige_jurisdicao check (
    (chave not like 'itcmd.%' and chave not like 'itbi.%') or uf is not null
  ),
  constraint ck_itbi_exige_municipio check (chave not like 'itbi.%' or municipio is not null),
  constraint ck_municipio_exige_uf check (municipio is null or uf is not null),
  -- Ativação por migration (seed) não tem perfil; ativação por pessoa tem os dois.
  constraint ck_ativado_completo check (ativado_por is null or ativado_em is not null)
);

-- Uma versão por (chave, jurisdição, versao) — `uf`/`municipio` nulos entram como ''.
create unique index uniq_parametro_versao
  on parametros_metodo (chave, coalesce(uf, ''), coalesce(municipio, ''), versao);
-- No máximo UMA versão ativa por (chave, jurisdição).
create unique index uniq_parametro_ativo
  on parametros_metodo (chave, coalesce(uf, ''), coalesce(municipio, '')) where ativo;
create index idx_parametros_chave on parametros_metodo (chave, vigente_de desc);

-- Versão automática (max + 1 na mesma chave/jurisdição) quando a rota não
-- informa. BEFORE ROW roda antes da checagem de NOT NULL, então `versao` pode
-- chegar nula no INSERT.
create or replace function app.parametros_metodo_versao() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.versao is null then
    select coalesce(max(versao), 0) + 1 into new.versao
      from parametros_metodo
     where chave = new.chave
       and coalesce(uf, '') = coalesce(new.uf, '')
       and coalesce(municipio, '') = coalesce(new.municipio, '');
  end if;
  if new.uf is not null then new.uf := upper(new.uf); end if;
  return new;
end $$;
create trigger trg_parametros_metodo_versao before insert on parametros_metodo
for each row execute function app.parametros_metodo_versao();

-- Versão é IMUTÁVEL no que importa: chave, valor, unidade, jurisdição, base
-- legal, vigência. Só `ativo`/`ativado_*`/`notas` mudam. Trocar valor = INSERT
-- de versão nova + ativar. Mesmo errcode do CHECK (23514) para a rota tratar
-- igual a qualquer violação de integridade.
create or replace function app.parametros_metodo_imutavel() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.chave      is distinct from old.chave
  or new.versao     is distinct from old.versao
  or new.valor      is distinct from old.valor
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
create trigger trg_parametros_metodo_imutavel before update on parametros_metodo
for each row execute function app.parametros_metodo_imutavel();

alter table parametros_metodo enable row level security;
alter table parametros_metodo force row level security;

-- Leitura: equipe inteira (preço de tabela e alíquota pública não são segredo
-- de gestão; o VALOR do patrimônio do cliente é — e esse fica na 0057).
create policy pm_sel on parametros_metodo for select to authenticated
  using ((select app.eh_interno()));
create policy pm_ins on parametros_metodo for insert to authenticated
  with check ((select app.eh_admin()));
create policy pm_upd on parametros_metodo for update to authenticated
  using ((select app.eh_admin())) with check ((select app.eh_admin()));
-- Sem policy nem grant de DELETE: histórico nunca é apagado.

revoke all on parametros_metodo from public, anon;
grant select, insert, update on parametros_metodo to authenticated;
grant select, insert, update, delete on parametros_metodo to service_role;

-- ===========================================================================
-- parametro_vigente(chave, uf?, municipio?) — a leitura que toda rota usa.
-- `setof` (0 ou 1 linha): ausência é "nenhuma linha", nunca valor inventado.
-- Prefere a versão da jurisdição exata; para chaves sem jurisdição, `uf`
-- nulo. Não faz fallback de município → estado → nacional de propósito:
-- alíquota de outro lugar não é alíquota daqui.
-- ===========================================================================
create or replace function public.parametro_vigente(
  p_chave text, p_uf text default null, p_municipio text default null
) returns setof parametros_metodo
language sql stable
set search_path = public, pg_temp
as $$
  select *
    from parametros_metodo
   where chave = p_chave
     and ativo
     and coalesce(uf, '') = coalesce(upper(p_uf), '')
     and coalesce(municipio, '') = coalesce(p_municipio, '')
     and vigente_de <= current_date
   order by versao desc
   limit 1
$$;
revoke execute on function public.parametro_vigente(text, text, text) from public, anon;
grant  execute on function public.parametro_vigente(text, text, text) to authenticated, service_role;

-- ===========================================================================
-- ativar_parametro_metodo(id) — mesmo padrão de `ativar_prompt_versao` (0033):
-- desativar a corrente e ativar a nova na MESMA transação (a unique parcial
-- proíbe duas ativas; dois `.update()` do supabase-js deixariam janela sem
-- nenhuma). `security invoker` + gate explícito: sem o `if`, um não-admin
-- receberia linha vazia em vez de 42501.
-- ===========================================================================
create or replace function public.ativar_parametro_metodo(p_id uuid)
returns parametros_metodo
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_atual parametros_metodo;
  v_linha parametros_metodo;
  v_perfil_id uuid;
begin
  if not app.eh_admin() then
    raise exception 'sem_permissao: apenas admin ativa versão de parâmetro' using errcode = '42501';
  end if;

  select * into v_atual from parametros_metodo where id = p_id;
  if v_atual.id is null then
    raise exception 'versao_nao_encontrada: %', p_id using errcode = 'P0002';
  end if;

  select id into v_perfil_id from perfis_equipe where auth_user_id = auth.uid() and ativo limit 1;

  update parametros_metodo
     set ativo = false
   where chave = v_atual.chave
     and coalesce(uf, '') = coalesce(v_atual.uf, '')
     and coalesce(municipio, '') = coalesce(v_atual.municipio, '')
     and ativo and id <> p_id;

  update parametros_metodo
     set ativo = true, ativado_por = v_perfil_id, ativado_em = now()
   where id = p_id
   returning * into v_linha;

  return v_linha;
end $$;
revoke execute on function public.ativar_parametro_metodo(uuid) from public, anon;
grant  execute on function public.ativar_parametro_metodo(uuid) to authenticated, service_role;

-- ===========================================================================
-- SEED B27 — os dois honorários do Croqui, literais do script (PARTE 11).
-- Idempotente: reaplicar não duplica (unique de versão).
-- NENHUMA linha itcmd.*/itbi.* (B30).
-- ===========================================================================
insert into parametros_metodo (chave, versao, valor, unidade, ativo, ativado_em, notas)
values
  ('honorarios.croqui.padrao',    1, 7200, 'brl', true, now(),
   'Literal do script da Sessão de Viabilidade (PARTE 11). Antes: VALOR_PADRAO_CROQUI em src/types/roteiro.ts.'),
  ('honorarios.croqui.incentivo', 1, 4500, 'brl', true, now(),
   'Literal do script (PARTE 11), "Incentivo do Resolvedor" — válido para quem decide no dia. Antes: VALOR_INCENTIVO_RESOLVEDOR_CROQUI.')
on conflict do nothing;
