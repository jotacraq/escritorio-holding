-- scripts/verificacao-0124.sql — roteiro da CORREÇÃO DE DESCRICAO (0124):
-- as 5 chaves da 0122 recebem `descricao` nova, `valor` intocado.
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- `postgres`, com 0091 a 0124 APLICADAS. A última instrução devolve
-- `resultado_0124` (ordem, passo, ok, detalhe). `ok = true` em todas prova
-- que o banco faz o que a 0124 promete.
--
-- O QUE ESTE ROTEIRO PROVA
--   0  as 5 chaves continuam com o MESMO `valor` de nascença (nada de dado mudou)
--   1  `rodape_transcricao` não cita mais "aba propria" nem "layout anterior"
--   2  as 2 chaves de silencio citam `lerConfiguracoesEmLote`, não `lerConfiguracaoInt`
--   3  `ficha_cliente`/`ficha_teto_fixos` citam `lerConfiguracoesEmLote`
--   4  reaplicar a migration não falha (idempotência do UPDATE por `where chave=`)
-- ---------------------------------------------------------------------------

drop table if exists resultado_0124;
create temp table resultado_0124 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r124(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0124 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;


-- ===========================================================================
-- 0 · Os 5 `valor` de nascença continuam intocados (0124 só mexe em `descricao`).
-- ===========================================================================
do $$
declare
  v_erros text := '';
  v_valor jsonb;
begin
  select valor into v_valor from configuracoes where chave = 'copiloto_sessao.ficha_cliente';
  if v_valor is distinct from 'false'::jsonb then v_erros := v_erros || 'ficha_cliente(=' || coalesce(v_valor::text,'AUSENTE') || ') '; end if;

  select valor into v_valor from configuracoes where chave = 'copiloto_sessao.ficha_teto_fixos';
  if v_valor is distinct from 'null'::jsonb then v_erros := v_erros || 'ficha_teto_fixos(=' || coalesce(v_valor::text,'AUSENTE') || ') '; end if;

  select valor into v_valor from configuracoes where chave = 'copiloto_sessao.rodape_transcricao';
  if v_valor is distinct from 'true'::jsonb then v_erros := v_erros || 'rodape_transcricao(=' || coalesce(v_valor::text,'AUSENTE') || ') '; end if;

  select valor into v_valor from configuracoes where chave = 'copiloto_sessao.silencio_atencao_s';
  if v_valor is distinct from '12'::jsonb then v_erros := v_erros || 'silencio_atencao_s(=' || coalesce(v_valor::text,'AUSENTE') || ') '; end if;

  select valor into v_valor from configuracoes where chave = 'copiloto_sessao.silencio_alerta_s';
  if v_valor is distinct from '25'::jsonb then v_erros := v_erros || 'silencio_alerta_s(=' || coalesce(v_valor::text,'AUSENTE') || ') '; end if;

  perform pg_temp.r124('0 · os 5 valores de nascença continuam intocados', v_erros = '',
    case when v_erros = '' then 'ok' else 'ACHADOS: ' || v_erros end);
end $$;


-- ===========================================================================
-- 1 · `rodape_transcricao` não cita mais "aba propria"/"layout anterior".
-- ===========================================================================
do $$
declare
  v_desc text;
begin
  select descricao into v_desc from configuracoes where chave = 'copiloto_sessao.rodape_transcricao';
  perform pg_temp.r124('1 · rodape_transcricao nao promete layout anterior inexistente',
    v_desc is not null and v_desc not ilike '%layout anterior%' and v_desc ilike '%esconde%',
    'descricao=' || coalesce(left(v_desc, 200), 'AUSENTE'));
end $$;


-- ===========================================================================
-- 2 · As 2 chaves de silêncio citam `lerConfiguracoesEmLote`, não `lerConfiguracaoInt`.
-- ===========================================================================
do $$
declare
  v_erros text := '';
  v_desc text;
begin
  select descricao into v_desc from configuracoes where chave = 'copiloto_sessao.silencio_atencao_s';
  if v_desc is null or v_desc not ilike '%lerConfiguracoesEmLote%' or v_desc ilike '%lerConfiguracaoInt%' then
    v_erros := v_erros || 'silencio_atencao_s ';
  end if;

  select descricao into v_desc from configuracoes where chave = 'copiloto_sessao.silencio_alerta_s';
  if v_desc is null or v_desc not ilike '%lerConfiguracoesEmLote%' or v_desc ilike '%lerConfiguracaoInt%' then
    v_erros := v_erros || 'silencio_alerta_s ';
  end if;

  perform pg_temp.r124('2 · chaves de silencio citam o leitor real (lerConfiguracoesEmLote)',
    v_erros = '', case when v_erros = '' then 'ok' else 'ACHADOS: ' || v_erros end);
end $$;


-- ===========================================================================
-- 3 · `ficha_cliente`/`ficha_teto_fixos` citam `lerConfiguracoesEmLote`.
-- ===========================================================================
do $$
declare
  v_erros text := '';
  v_desc text;
begin
  select descricao into v_desc from configuracoes where chave = 'copiloto_sessao.ficha_cliente';
  if v_desc is null or v_desc not ilike '%lerConfiguracoesEmLote%' then v_erros := v_erros || 'ficha_cliente '; end if;

  select descricao into v_desc from configuracoes where chave = 'copiloto_sessao.ficha_teto_fixos';
  if v_desc is null or v_desc not ilike '%lerConfiguracoesEmLote%' then v_erros := v_erros || 'ficha_teto_fixos '; end if;

  perform pg_temp.r124('3 · ficha_cliente/ficha_teto_fixos citam o leitor real (lerConfiguracoesEmLote)',
    v_erros = '', case when v_erros = '' then 'ok' else 'ACHADOS: ' || v_erros end);
end $$;


-- ===========================================================================
-- 4 · Reaplicar a migration inteira não falha (idempotência do UPDATE por
-- `where chave=`: rodar de novo só regrava o mesmo texto).
-- ===========================================================================
do $$
begin
  update configuracoes set descricao = descricao where chave in (
    'copiloto_sessao.ficha_cliente', 'copiloto_sessao.ficha_teto_fixos',
    'copiloto_sessao.rodape_transcricao', 'copiloto_sessao.silencio_atencao_s',
    'copiloto_sessao.silencio_alerta_s');
  perform pg_temp.r124('4 · reaplicar a correção de descricao não falha (idempotente)', true, 'ok');
exception when others then
  perform pg_temp.r124('4 · reaplicar a correção de descricao não falha (idempotente)', false, 'exceção: ' || sqlerrm);
end $$;


select * from resultado_0124 order by ordem;
