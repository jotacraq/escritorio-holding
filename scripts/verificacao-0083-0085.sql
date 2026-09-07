-- scripts/verificacao-0083-0085.sql — roteiro da Frente A da Fase 8.
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- postgres, com 0083, 0084 e 0085 APLICADAS. A última instrução devolve
-- `resultado_0085` (ordem, passo, ok, detalhe). `ok = true` significa que o
-- banco faz o que as três migrations prometem.
--
-- TUDO COM ROLLBACK. Nenhuma fixture sobrevive: cada bloco escreve dentro de um
-- sub-`begin … exception … end` que termina em `raise 'rollback_proposital'`,
-- e o resultado é gravado FORA dele. É o padrão de `verificacao-0070.sql` e a
-- razão dele: em PL/pgSQL o bloco EXCEPTION é uma subtransação, então tudo que
-- o corpo escreveu — inclusive o INSERT no `resultado_0085` — seria desfeito se
-- o `perform pg_temp.r85(...)` ficasse dentro. É também a regra do João para
-- mexer em dinheiro: "testar venda com rollback".
--
-- O QUE ESTE ROTEIRO PROVA (12 asserções, §A5 do plano)
--   0  medição ANTES: jornadas com etapa acima do teto vigente (B52)
--   1  BILLET_PRINTED com purchase.status=APPROVED grava `boleto_gerado` (D1)
--   2  COMPLETE depois do boleto → `aprovado` e a etapa avança
--   3  reentrega ANTIGA do boleto não rebaixa o aprovado (D7)
--   4  REFUNDED derruba o TETO, não derruba `nivel_pago`, e AVISA (D6/B48)
--   5  com teto 1, a mão do humano não entra em `croqui_contratado` (D5)
--   6  evento desconhecido nunca aprova (D3)
--   7  product.id não mapeado vira pendência com ação própria (D8)
--   8  mesma transação com outro produto é recusada (D10/B54)
--   9  privilégios: anon/authenticated fora da RPC, da função de teto e do
--      livro-razão append-only
--  10  as duas grafias do padrão P4 do vault caem no mesmo estado
--  11  idempotência por id de evento: 2 entregas, 1 transição
--
-- O QUE NÃO DÁ PARA VERIFICAR AQUI: que a ROTA devolve 503/401/200. Isso é
-- `scripts/simular-hotmart.ts` contra o `next dev` — saída colada no relatório.
-- ---------------------------------------------------------------------------

drop table if exists resultado_0085;
create temp table resultado_0085 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r85(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0085 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;

-- Fixture comum: uma pessoa nova, uma jornada aberta e os TRÊS produtos com um
-- id de Hotmart de teste. Os produtos de verdade estão com `hotmart_produto_id`
-- NULL em produção (B7) — carimbar aqui dentro é seguro porque o bloco inteiro
-- é revertido.
create or replace function pg_temp.fixture85(p_tag text)
returns table (pessoa uuid, jornada uuid, sv uuid, croqui uuid, holding uuid)
language plpgsql as $$
declare v_pessoa uuid; v_jornada uuid; v_sv uuid; v_croqui uuid; v_holding uuid;
begin
  insert into pessoas (nome, email, telefone, cidade, uf, origem_dado)
  values ('Verificação 0085 ' || p_tag, 'verif85.' || p_tag || '@example.com',
          '+55000000' || lpad((random()*99999)::int::text, 5, '0'), 'São Paulo', 'SP', 'exemplo')
  returning id into v_pessoa;

  insert into jornadas (pessoa_id, origem, trilha, etapa, origem_dado)
  values (v_pessoa, 'outro', 'seminario', 'captado', 'exemplo')
  returning id into v_jornada;

  update produtos set hotmart_produto_id = 'HM-' || p_tag || '-SV'
   where id = (select id from produtos where tipo = 'sessao_viabilidade' order by criado_em limit 1)
  returning id into v_sv;
  update produtos set hotmart_produto_id = 'HM-' || p_tag || '-CROQUI'
   where id = (select id from produtos where tipo = 'croqui_estrutural' order by criado_em limit 1)
  returning id into v_croqui;
  update produtos set hotmart_produto_id = 'HM-' || p_tag || '-HOLDING'
   where id = (select id from produtos where tipo = 'holding' order by criado_em limit 1)
  returning id into v_holding;

  return query select v_pessoa, v_jornada, v_sv, v_croqui, v_holding;
end $$;

-- Payload da Hotmart no formato do webhook 2.0. `p_status_payload` existe para
-- o caso 1: é o `purchase.status` que a Hotmart às vezes manda ERRADO.
create or replace function pg_temp.payload85(
  p_evento text, p_evento_id text, p_transacao text, p_produto_hotmart text,
  p_status_payload text, p_email text, p_nome text, p_quando timestamptz
) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'id', p_evento_id,
    'event', p_evento,
    'version', '2.0.0',
    'creation_date', (extract(epoch from p_quando) * 1000)::bigint,
    'data', jsonb_build_object(
      'product',  jsonb_build_object('id', p_produto_hotmart),
      'buyer',    jsonb_build_object('email', p_email, 'name', p_nome),
      'purchase', jsonb_build_object(
        'transaction', p_transacao,
        'status', p_status_payload,
        'price', jsonb_build_object('value', 1000, 'currency_value', 'BRL'))))
$$;


-- ===========================================================================
-- 0. MEDIÇÃO ANTES (B52). Jornadas cuja etapa implica mais dinheiro do que o
--    teto vigente. > 0 obrigaria a confirmar com o João antes de ligar o teto.
--    Sem fixture, sem escrita.
-- ===========================================================================
do $$
declare n int; det text;
begin
  select count(*) into n
    from jornadas j
   where (case j.etapa
            when 'sessao_contratada'  then 1 when 'sessao_agendada'    then 1
            when 'sessao_realizada'   then 1 when 'croqui_contratado'  then 2
            when 'croqui_apresentado' then 2 when 'holding_contratada' then 3
            else 0 end) > app.nivel_pago_vigente(j.id);
  det := n || ' jornada(s) com etapa acima do teto vigente (de ' || (select count(*) from jornadas) || ')';
  perform pg_temp.r85('0. B52 — nenhuma jornada existente fica acima do teto', n = 0, det);
end $$;


-- ===========================================================================
-- 1. D1 — O ESTADO VEM DO EVENTO. `PURCHASE_BILLET_PRINTED` com
--    `purchase.status = 'APPROVED'` no payload (o caso que o vault documenta)
--    e com o chamador passando `p_status = 'aprovado'`: mesmo assim o banco
--    grava `boleto_gerado`. É o bug de "cliente pagou" falso, fechado.
-- ===========================================================================
do $$
declare
  v_tag text := left(gen_random_uuid()::text, 8);
  f record; v_status text; v_evento text; v_etapa text; v_pago timestamptz;
  ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.fixture85(v_tag);
    perform processar_pagamento_hotmart(
      'HM-' || v_tag || '-SV', 'TX-' || v_tag, 'aprovado'::status_pagamento,
      1000, 'BRL', 1::smallint, 'verif85.' || v_tag || '@example.com', 'Verificação', null, now(),
      pg_temp.payload85('PURCHASE_BILLET_PRINTED', 'evt-' || v_tag || '-1', 'TX-' || v_tag,
                        'HM-' || v_tag || '-SV', 'APPROVED',
                        'verif85.' || v_tag || '@example.com', 'Verificação', now() - interval '2 hours'));

    select status::text, evento_hotmart, pago_em into v_status, v_evento, v_pago
      from pagamentos where transacao_externa_id = 'TX-' || v_tag;
    select etapa::text into v_etapa from jornadas where id = f.jornada;

    ok := v_status = 'boleto_gerado' and v_evento = 'BILLET_PRINTED'
          and v_etapa = 'captado' and v_pago is null;
    det := 'status=' || coalesce(v_status,'∅') || ' evento=' || coalesce(v_evento,'∅')
        || ' etapa=' || coalesce(v_etapa,'∅') || ' pago_em=' || coalesce(v_pago::text,'null (correto)');
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then ok := false; det := 'erro: ' || sqlerrm; end if;
  end;
  perform pg_temp.r85('1. D1 — boleto com purchase.status=APPROVED grava boleto_gerado', ok, det);
end $$;


-- ===========================================================================
-- 2. `PURCHASE_COMPLETE` depois do boleto = pix/boleto COMPENSADO. É o evento
--    que o webhook do outro projeto do João descartava (caso Rafael Bayard).
--    Aqui aprova e a etapa sobe para `sessao_contratada`.
-- ===========================================================================
do $$
declare
  v_tag text := left(gen_random_uuid()::text, 8);
  f record; v_status text; v_etapa text; v_nivel smallint; v_pago timestamptz;
  ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.fixture85(v_tag);
    perform processar_pagamento_hotmart('HM-' || v_tag || '-SV', 'TX-' || v_tag,
      'pendente'::status_pagamento, 1000, 'BRL', 1::smallint,
      'verif85.' || v_tag || '@example.com', 'Verificação', null, null,
      pg_temp.payload85('PURCHASE_BILLET_PRINTED', 'evt-' || v_tag || '-1', 'TX-' || v_tag,
                        'HM-' || v_tag || '-SV', 'BILLET_PRINTED',
                        'verif85.' || v_tag || '@example.com', 'Verificação', now() - interval '3 days'));

    perform processar_pagamento_hotmart('HM-' || v_tag || '-SV', 'TX-' || v_tag,
      'aprovado'::status_pagamento, 1000, 'BRL', 1::smallint,
      'verif85.' || v_tag || '@example.com', 'Verificação', null, now(),
      pg_temp.payload85('PURCHASE_COMPLETE', 'evt-' || v_tag || '-2', 'TX-' || v_tag,
                        'HM-' || v_tag || '-SV', 'COMPLETE',
                        'verif85.' || v_tag || '@example.com', 'Verificação', now()));

    select status::text, pago_em into v_status, v_pago from pagamentos where transacao_externa_id = 'TX-' || v_tag;
    select etapa::text, nivel_pago into v_etapa, v_nivel from jornadas where id = f.jornada;

    ok := v_status = 'aprovado' and v_etapa = 'sessao_contratada' and v_nivel = 1 and v_pago is not null;
    det := 'status=' || coalesce(v_status,'∅') || ' etapa=' || coalesce(v_etapa,'∅')
        || ' nivel_pago=' || coalesce(v_nivel::text,'∅') || ' pago_em=' || coalesce(v_pago::text,'∅');
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then ok := false; det := 'erro: ' || sqlerrm; end if;
  end;
  perform pg_temp.r85('2. COMPLETE depois do boleto aprova e avanca a etapa', ok, det);
end $$;


-- ===========================================================================
-- 3. D7 — REENTREGA FORA DE ORDEM NÃO REBAIXA. Depois do COMPLETE, a Hotmart
--    reentrega o BILLET_PRINTED de 3 dias atrás. Hoje (0011:218,
--    `do update set status = excluded.status`) isso derrubaria o aprovado.
-- ===========================================================================
do $$
declare
  v_tag text := left(gen_random_uuid()::text, 8);
  f record; v_status text; v_evento text; v_obs text; v_trans int;
  ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.fixture85(v_tag);
    perform processar_pagamento_hotmart('HM-' || v_tag || '-SV', 'TX-' || v_tag,
      'aprovado'::status_pagamento, 1000, 'BRL', 1::smallint,
      'verif85.' || v_tag || '@example.com', 'Verificação', null, now(),
      pg_temp.payload85('PURCHASE_COMPLETE', 'evt-' || v_tag || '-2', 'TX-' || v_tag,
                        'HM-' || v_tag || '-SV', 'COMPLETE',
                        'verif85.' || v_tag || '@example.com', 'Verificação', now()));

    -- reentrega ANTIGA, id de evento diferente (não é idempotência, é ordem)
    select observacao into v_obs from processar_pagamento_hotmart('HM-' || v_tag || '-SV', 'TX-' || v_tag,
      'pendente'::status_pagamento, 1000, 'BRL', 1::smallint,
      'verif85.' || v_tag || '@example.com', 'Verificação', null, null,
      pg_temp.payload85('PURCHASE_BILLET_PRINTED', 'evt-' || v_tag || '-1', 'TX-' || v_tag,
                        'HM-' || v_tag || '-SV', 'BILLET_PRINTED',
                        'verif85.' || v_tag || '@example.com', 'Verificação', now() - interval '3 days'));

    select status::text, evento_hotmart into v_status, v_evento
      from pagamentos where transacao_externa_id = 'TX-' || v_tag;
    select count(*) into v_trans from pagamentos_transicoes t
      join pagamentos p on p.id = t.pagamento_id
     where p.transacao_externa_id = 'TX-' || v_tag;

    ok := v_status = 'aprovado' and v_evento = 'COMPLETE' and v_trans = 1;
    det := 'status=' || coalesce(v_status,'∅') || ' evento=' || coalesce(v_evento,'∅')
        || ' transicoes=' || v_trans || ' obs=' || coalesce(v_obs,'∅');
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then ok := false; det := 'erro: ' || sqlerrm; end if;
  end;
  perform pg_temp.r85('3. D7 — reentrega antiga do boleto nao rebaixa o aprovado', ok, det);
end $$;


-- ===========================================================================
-- 4. D6/B48 — REEMBOLSO TRAVA E AVISA. O teto cai (nivel_pago_vigente = 0), o
--    piso NÃO cai (nivel_pago = 1), a etapa NÃO regride, e o sistema grita:
--    andamento `pagamento_alerta` + tarefa `pagamento_reembolsado`. A régua e a
--    fila de ligação da jornada ficam caladas.
-- ===========================================================================
do $$
declare
  v_tag text := left(gen_random_uuid()::text, 8);
  f record; v_status text; v_etapa text; v_nivel smallint; v_teto smallint;
  v_tarefa int; v_evt int; v_msg_pendentes int;
  ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.fixture85(v_tag);
    perform processar_pagamento_hotmart('HM-' || v_tag || '-SV', 'TX-' || v_tag,
      'aprovado'::status_pagamento, 1000, 'BRL', 1::smallint,
      'verif85.' || v_tag || '@example.com', 'Verificação', null, now(),
      pg_temp.payload85('PURCHASE_APPROVED', 'evt-' || v_tag || '-1', 'TX-' || v_tag,
                        'HM-' || v_tag || '-SV', 'APPROVED',
                        'verif85.' || v_tag || '@example.com', 'Verificação', now() - interval '1 day'));

    perform processar_pagamento_hotmart('HM-' || v_tag || '-SV', 'TX-' || v_tag,
      'reembolsado'::status_pagamento, 1000, 'BRL', 1::smallint,
      'verif85.' || v_tag || '@example.com', 'Verificação', null, null,
      pg_temp.payload85('PURCHASE_REFUNDED', 'evt-' || v_tag || '-2', 'TX-' || v_tag,
                        'HM-' || v_tag || '-SV', 'REFUNDED',
                        'verif85.' || v_tag || '@example.com', 'Verificação', now()));

    select status::text into v_status from pagamentos where transacao_externa_id = 'TX-' || v_tag;
    select etapa::text, nivel_pago into v_etapa, v_nivel from jornadas where id = f.jornada;
    v_teto := app.nivel_pago_vigente(f.jornada);
    select count(*) into v_tarefa from tarefas
     where jornada_id = f.jornada and tipo = 'pagamento_reembolsado' and concluida_em is null;
    select count(*) into v_evt from eventos_timeline
     where jornada_id = f.jornada and tipo = 'pagamento_alerta';
    select count(*) into v_msg_pendentes from mensagens_agendadas
     where jornada_id = f.jornada and status = 'pendente';

    ok := v_status = 'reembolsado' and v_etapa = 'sessao_contratada'
          and v_nivel = 1 and v_teto = 0 and v_tarefa = 1 and v_evt = 1 and v_msg_pendentes = 0;
    det := 'status=' || coalesce(v_status,'∅') || ' etapa=' || coalesce(v_etapa,'∅')
        || ' nivel_pago(piso)=' || coalesce(v_nivel::text,'∅') || ' teto=' || coalesce(v_teto::text,'∅')
        || ' tarefa=' || v_tarefa || ' timeline_alerta=' || v_evt
        || ' mensagens_pendentes=' || v_msg_pendentes;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then ok := false; det := 'erro: ' || sqlerrm; end if;
  end;
  perform pg_temp.r85('4. D6 — reembolso derruba o teto, nao o piso, e avisa', ok, det);
end $$;


-- ===========================================================================
-- 5. D5 — O TETO VALE PARA A MÃO DO HUMANO. Com só a Sessão paga (teto 1), o
--    UPDATE direto para `croqui_contratado` é RECUSADO. É a resposta literal ao
--    João: "só avança para o Croqui quando pagou o Croqui".
-- ===========================================================================
do $$
declare
  v_tag text := left(gen_random_uuid()::text, 8);
  f record; v_teto smallint; v_etapa_final text; v_erro text := '(nenhum)';
  v_recusado boolean := false;
  ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.fixture85(v_tag);
    perform processar_pagamento_hotmart('HM-' || v_tag || '-SV', 'TX-' || v_tag,
      'aprovado'::status_pagamento, 1000, 'BRL', 1::smallint,
      'verif85.' || v_tag || '@example.com', 'Verificação', null, now(),
      pg_temp.payload85('PURCHASE_APPROVED', 'evt-' || v_tag || '-1', 'TX-' || v_tag,
                        'HM-' || v_tag || '-SV', 'APPROVED',
                        'verif85.' || v_tag || '@example.com', 'Verificação', now()));

    update jornadas set etapa = 'sessao_agendada'  where id = f.jornada;
    update jornadas set etapa = 'sessao_realizada' where id = f.jornada;
    v_teto := app.nivel_pago_vigente(f.jornada);

    begin
      update jornadas set etapa = 'croqui_contratado' where id = f.jornada;
    exception when check_violation then
      v_recusado := true; v_erro := sqlerrm;
    end;

    select etapa::text into v_etapa_final from jornadas where id = f.jornada;
    ok := v_recusado and v_teto = 1 and v_etapa_final = 'sessao_realizada';
    det := 'teto=' || coalesce(v_teto::text,'∅') || ' recusado=' || v_recusado
        || ' etapa_final=' || coalesce(v_etapa_final,'∅') || ' erro=' || v_erro;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then ok := false; det := 'erro: ' || sqlerrm; end if;
  end;
  perform pg_temp.r85('5. D5 — com teto 1 a mao do humano nao entra em croqui_contratado', ok, det);
end $$;


-- ===========================================================================
-- 6. D3 — EVENTO DESCONHECIDO NUNCA APROVA. Cai em `em_analise`, a etapa não
--    anda, e a observação devolve o nome do evento por extenso para quem chama
--    gravar em `webhooks_eventos.erro` e deixar `processado_em` NULL.
-- ===========================================================================
do $$
declare
  v_tag text := left(gen_random_uuid()::text, 8);
  f record; v_status text; v_etapa text; v_obs text;
  ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.fixture85(v_tag);
    select observacao into v_obs from processar_pagamento_hotmart('HM-' || v_tag || '-SV', 'TX-' || v_tag,
      'aprovado'::status_pagamento, 1000, 'BRL', 1::smallint,
      'verif85.' || v_tag || '@example.com', 'Verificação', null, now(),
      pg_temp.payload85('PURCHASE_ALGO_QUE_NAO_EXISTE', 'evt-' || v_tag || '-1', 'TX-' || v_tag,
                        'HM-' || v_tag || '-SV', 'APPROVED',
                        'verif85.' || v_tag || '@example.com', 'Verificação', now()));

    select status::text into v_status from pagamentos where transacao_externa_id = 'TX-' || v_tag;
    select etapa::text into v_etapa from jornadas where id = f.jornada;

    ok := v_status = 'em_analise' and v_etapa = 'captado'
          and v_obs like 'evento_desconhecido: ALGO_QUE_NAO_EXISTE%';
    det := 'status=' || coalesce(v_status,'∅') || ' etapa=' || coalesce(v_etapa,'∅')
        || ' obs=' || coalesce(v_obs,'∅');
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then ok := false; det := 'erro: ' || sqlerrm; end if;
  end;
  perform pg_temp.r85('6. D3 — evento desconhecido cai em em_analise e nao aprova', ok, det);
end $$;


-- ===========================================================================
-- 7. D8 — PRODUTO NÃO MAPEADO É FILA, NÃO SILÊNCIO. A compra é gravada órfã, a
--    função devolve `produto_mapeado = false`, e a pendência aparece com TIPO
--    PRÓPRIO (`produto_nao_mapeado`), não misturada em `webhook_falho`.
-- ===========================================================================
do $$
declare
  v_tag text := left(gen_random_uuid()::text, 8);
  f record; v_mapeado boolean; v_obs text; v_pag_id uuid; v_prod uuid;
  v_tipo text; v_desc text; v_wid uuid;
  ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.fixture85(v_tag);
    select produto_mapeado, observacao, pagamento_id into v_mapeado, v_obs, v_pag_id
      from processar_pagamento_hotmart('ID-QUE-NINGUEM-MAPEOU-' || v_tag, 'TX-' || v_tag,
        'aprovado'::status_pagamento, 1000, 'BRL', 1::smallint,
        'verif85.' || v_tag || '@example.com', 'Verificação', null, now(),
        pg_temp.payload85('PURCHASE_APPROVED', 'evt-' || v_tag || '-1', 'TX-' || v_tag,
                          'ID-QUE-NINGUEM-MAPEOU-' || v_tag, 'APPROVED',
                          'verif85.' || v_tag || '@example.com', 'Verificação', now()));
    select produto_id into v_prod from pagamentos where id = v_pag_id;

    -- a linha do webhook que a rota deixa com processado_em NULL (D8)
    insert into webhooks_eventos (origem, evento_externo_id, tipo_evento, assinatura_valida, bruto, erro, processado_em)
    values ('hotmart', 'evt-' || v_tag || '-1', 'PURCHASE_APPROVED', true,
            pg_temp.payload85('PURCHASE_APPROVED', 'evt-' || v_tag || '-1', 'TX-' || v_tag,
                              'ID-QUE-NINGUEM-MAPEOU-' || v_tag, 'APPROVED',
                              'verif85.' || v_tag || '@example.com', 'Verificação', now()),
            'produto_nao_mapeado', null)
    returning id into v_wid;

    select tipo, descricao into v_tipo, v_desc from vw_pendencias_sistema where id = v_wid::text;

    ok := v_mapeado = false and v_obs like '%produto_nao_mapeado%' and v_pag_id is not null
          and v_prod is null and v_tipo = 'produto_nao_mapeado'
          and v_desc like '%ID-QUE-NINGUEM-MAPEOU-' || v_tag || '%';
    det := 'produto_mapeado=' || coalesce(v_mapeado::text,'∅') || ' obs=' || coalesce(v_obs,'∅')
        || ' pagamento_gravado=' || (v_pag_id is not null) || ' produto_id=' || coalesce(v_prod::text,'null (correto)')
        || ' pendencia.tipo=' || coalesce(v_tipo,'∅');
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then ok := false; det := 'erro: ' || sqlerrm; end if;
  end;
  perform pg_temp.r85('7. D8 — produto nao mapeado vira pendencia com tipo proprio', ok, det);
end $$;


-- ===========================================================================
-- 8. D10/B54 — MESMA TRANSAÇÃO COM OUTRO PRODUTO É RECUSADA. Order bump e
--    assinatura podem mandar isso; sobrescrever o produto trocaria o destino
--    do dinheiro em silêncio.
-- ===========================================================================
do $$
declare
  v_tag text := left(gen_random_uuid()::text, 8);
  f record; v_obs text; v_pag_id uuid; v_prod uuid;
  ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.fixture85(v_tag);
    perform processar_pagamento_hotmart('HM-' || v_tag || '-SV', 'TX-' || v_tag,
      'aprovado'::status_pagamento, 1000, 'BRL', 1::smallint,
      'verif85.' || v_tag || '@example.com', 'Verificação', null, now(),
      pg_temp.payload85('PURCHASE_APPROVED', 'evt-' || v_tag || '-1', 'TX-' || v_tag,
                        'HM-' || v_tag || '-SV', 'APPROVED',
                        'verif85.' || v_tag || '@example.com', 'Verificação', now()));

    select observacao, pagamento_id into v_obs, v_pag_id
      from processar_pagamento_hotmart('HM-' || v_tag || '-CROQUI', 'TX-' || v_tag,
        'aprovado'::status_pagamento, 5000, 'BRL', 1::smallint,
        'verif85.' || v_tag || '@example.com', 'Verificação', null, now(),
        pg_temp.payload85('PURCHASE_APPROVED', 'evt-' || v_tag || '-2', 'TX-' || v_tag,
                          'HM-' || v_tag || '-CROQUI', 'APPROVED',
                          'verif85.' || v_tag || '@example.com', 'Verificação', now()));

    select produto_id into v_prod from pagamentos where transacao_externa_id = 'TX-' || v_tag;

    ok := v_pag_id is null and v_obs like 'transacao_com_produto_divergente%' and v_prod = f.sv;
    det := 'obs=' || coalesce(v_obs,'∅') || ' pagamento_id=' || coalesce(v_pag_id::text,'null (recusado)')
        || ' produto_continua_SV=' || (v_prod = f.sv);
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then ok := false; det := 'erro: ' || sqlerrm; end if;
  end;
  perform pg_temp.r85('8. D10 — mesma transacao com outro produto e recusada', ok, det);
end $$;


-- ===========================================================================
-- 9. PRIVILÉGIOS. Nada de `grant` sem `revoke` (lição da 0064) e nada de
--    livro-razão editável (lição da 0065b: o default do Supabase dá ALL em
--    tabela nova para `authenticated`).
-- ===========================================================================
do $$
declare
  a_rpc boolean; u_rpc boolean; a_teto boolean; u_teto boolean;
  a_view boolean; u_view boolean; a_pt boolean; u_pt_sel boolean;
  u_pt_ins boolean; u_pt_upd boolean; u_pt_del boolean; n_pol int;
  ok boolean; det text;
begin
  a_rpc := has_function_privilege('anon',
    'public.processar_pagamento_hotmart(text,text,status_pagamento,numeric,char,smallint,text,text,text,timestamptz,jsonb)', 'execute');
  u_rpc := has_function_privilege('authenticated',
    'public.processar_pagamento_hotmart(text,text,status_pagamento,numeric,char,smallint,text,text,text,timestamptz,jsonb)', 'execute');
  a_teto := has_function_privilege('anon', 'app.nivel_pago_vigente(uuid)', 'execute');
  u_teto := has_function_privilege('authenticated', 'app.nivel_pago_vigente(uuid)', 'execute');
  a_view := has_table_privilege('anon', 'vw_pagamentos_jornada', 'select');
  u_view := has_table_privilege('authenticated', 'vw_pagamentos_jornada', 'select');
  a_pt   := has_table_privilege('anon', 'pagamentos_transicoes', 'select');
  u_pt_sel := has_table_privilege('authenticated', 'pagamentos_transicoes', 'select');
  u_pt_ins := has_table_privilege('authenticated', 'pagamentos_transicoes', 'insert');
  u_pt_upd := has_table_privilege('authenticated', 'pagamentos_transicoes', 'update');
  u_pt_del := has_table_privilege('authenticated', 'pagamentos_transicoes', 'delete');
  select count(*) into n_pol from pg_policies
   where tablename = 'pagamentos_transicoes' and cmd in ('UPDATE', 'DELETE', 'INSERT', 'ALL');

  ok := (not a_rpc) and (not u_rpc) and (not a_teto) and (not u_teto)
        and (not a_view) and u_view
        and (not a_pt) and u_pt_sel and (not u_pt_ins) and (not u_pt_upd) and (not u_pt_del)
        and n_pol = 0;
  det := 'rpc anon/auth=' || a_rpc || '/' || u_rpc
      || ' · teto anon/auth=' || a_teto || '/' || u_teto
      || ' · vw_pagamentos anon/auth=' || a_view || '/' || u_view
      || ' · pag_transicoes anon.sel=' || a_pt || ' auth sel/ins/upd/del='
      || u_pt_sel || '/' || u_pt_ins || '/' || u_pt_upd || '/' || u_pt_del
      || ' · policies de escrita=' || n_pol;
  perform pg_temp.r85('9. privilegios: anon/auth fora da RPC, do teto e do livro-razao', ok, det);
end $$;


-- ===========================================================================
-- 10. P4 DO VAULT — AS DUAS GRAFIAS. `COMPLETE`/`COMPLETED` e
--     `BILLET_PRINTED`/`PRINTED_BILLET` caem no MESMO estado. Filtro escrito
--     com uma só grafia perde a outra metade em silêncio.
-- ===========================================================================
do $$
declare
  v_tag text := left(gen_random_uuid()::text, 8);
  f record; v_status text;
  c1 text; c2 text; b1 text; b2 text; ca1 text; ca2 text;
  ok boolean := false; det text;
begin
  begin
    c1 := app.status_do_evento_hotmart(app.normaliza_evento_hotmart('PURCHASE_COMPLETE'))::text;
    c2 := app.status_do_evento_hotmart(app.normaliza_evento_hotmart('PURCHASE_COMPLETED'))::text;
    b1 := app.status_do_evento_hotmart(app.normaliza_evento_hotmart('PURCHASE_BILLET_PRINTED'))::text;
    b2 := app.status_do_evento_hotmart(app.normaliza_evento_hotmart('purchase_printed_billet'))::text;
    ca1 := app.status_do_evento_hotmart(app.normaliza_evento_hotmart('PURCHASE_CANCELED'))::text;
    ca2 := app.status_do_evento_hotmart(app.normaliza_evento_hotmart('PURCHASE_CANCELLED'))::text;

    -- e a grafia rara também passa pela RPC inteira, não só pela função pura
    select * into f from pg_temp.fixture85(v_tag);
    perform processar_pagamento_hotmart('HM-' || v_tag || '-SV', 'TX-' || v_tag,
      'em_analise'::status_pagamento, 1000, 'BRL', 1::smallint,
      'verif85.' || v_tag || '@example.com', 'Verificação', null, now(),
      pg_temp.payload85('PURCHASE_COMPLETED', 'evt-' || v_tag || '-1', 'TX-' || v_tag,
                        'HM-' || v_tag || '-SV', 'COMPLETED',
                        'verif85.' || v_tag || '@example.com', 'Verificação', now()));
    select status::text into v_status from pagamentos where transacao_externa_id = 'TX-' || v_tag;

    ok := c1 = c2 and c1 = 'aprovado' and b1 = b2 and b1 = 'boleto_gerado'
          and ca1 = ca2 and ca1 = 'cancelado' and v_status = 'aprovado';
    det := 'COMPLETE/COMPLETED=' || c1 || '/' || c2
        || ' · BILLET_PRINTED/PRINTED_BILLET=' || b1 || '/' || b2
        || ' · CANCELED/CANCELLED=' || ca1 || '/' || ca2
        || ' · via RPC com COMPLETED=' || coalesce(v_status,'∅');
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then ok := false; det := 'erro: ' || sqlerrm; end if;
  end;
  perform pg_temp.r85('10. P4 — as duas grafias caem no mesmo estado', ok, det);
end $$;


-- ===========================================================================
-- 11. IDEMPOTÊNCIA POR ID DE EVENTO. A mesma entrega duas vezes: uma linha em
--     `pagamentos_transicoes`, nenhum efeito colateral repetido.
-- ===========================================================================
do $$
declare
  v_tag text := left(gen_random_uuid()::text, 8);
  f record; v_obs2 text; v_trans int; v_pag int; v_msg int;
  ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.fixture85(v_tag);
    perform processar_pagamento_hotmart('HM-' || v_tag || '-SV', 'TX-' || v_tag,
      'aprovado'::status_pagamento, 1000, 'BRL', 1::smallint,
      'verif85.' || v_tag || '@example.com', 'Verificação', null, now(),
      pg_temp.payload85('PURCHASE_APPROVED', 'evt-' || v_tag || '-1', 'TX-' || v_tag,
                        'HM-' || v_tag || '-SV', 'APPROVED',
                        'verif85.' || v_tag || '@example.com', 'Verificação', now()));

    select observacao into v_obs2 from processar_pagamento_hotmart('HM-' || v_tag || '-SV', 'TX-' || v_tag,
      'aprovado'::status_pagamento, 1000, 'BRL', 1::smallint,
      'verif85.' || v_tag || '@example.com', 'Verificação', null, now(),
      pg_temp.payload85('PURCHASE_APPROVED', 'evt-' || v_tag || '-1', 'TX-' || v_tag,
                        'HM-' || v_tag || '-SV', 'APPROVED',
                        'verif85.' || v_tag || '@example.com', 'Verificação', now()));

    select count(*) into v_pag from pagamentos where transacao_externa_id = 'TX-' || v_tag;
    select count(*) into v_trans from pagamentos_transicoes t
      join pagamentos p on p.id = t.pagamento_id
     where p.transacao_externa_id = 'TX-' || v_tag;
    select count(*) into v_msg from mensagens_agendadas where jornada_id = f.jornada;

    ok := v_pag = 1 and v_trans = 1 and v_obs2 like '%evento_ja_aplicado%' and v_msg <= 2;
    det := 'pagamentos=' || v_pag || ' transicoes=' || v_trans
        || ' obs_2a_entrega=' || coalesce(v_obs2,'∅') || ' mensagens_da_regua=' || v_msg;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then ok := false; det := 'erro: ' || sqlerrm; end if;
  end;
  perform pg_temp.r85('11. idempotencia por id de evento: 2 entregas, 1 transicao', ok, det);
end $$;


-- ===========================================================================
-- MEDIÇÃO DEPOIS: nada sobrou. Os números têm de bater com os de antes.
-- ===========================================================================
do $$
declare n_pag int; n_jor int; n_pes int; n_prod_sem_id int; n_trans int; n_wh int;
begin
  select count(*) into n_pag  from pagamentos;
  select count(*) into n_jor  from jornadas;
  select count(*) into n_pes  from pessoas;
  select count(*) into n_wh   from webhooks_eventos;
  select count(*) into n_trans from pagamentos_transicoes;
  select count(*) into n_prod_sem_id from produtos where hotmart_produto_id is null;
  perform pg_temp.r85('12. nada sobrou (fixtures revertidas)', true,
    'pagamentos=' || n_pag || ' jornadas=' || n_jor || ' pessoas=' || n_pes
    || ' webhooks_eventos=' || n_wh || ' pagamentos_transicoes=' || n_trans
    || ' produtos sem hotmart_produto_id=' || n_prod_sem_id);
end $$;

select ordem, passo, ok, detalhe from resultado_0085 order by ordem;
