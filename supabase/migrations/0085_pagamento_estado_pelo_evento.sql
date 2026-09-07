-- 0085_pagamento_estado_pelo_evento.sql — Fase 8, Frente A (D1, D2, D3, D6, D8, D10).
-- Aplicar DEPOIS da 0083 (usa os valores novos do enum) e da 0084 (usa as
-- colunas de evento, `pagamentos_transicoes` e o teto).
-- ===========================================================================
-- O BUG QUE ESTA MIGRATION FECHA (D1 — o mais caro da Frente A)
--
--   `mapearStatusHotmart()` (src/server/pagamentos/hotmart.ts:22-32) lê
--   `data.purchase.status` e IGNORA `payload.event`. O vault do João é literal:
--
--     "O status vem do EVENTO, nunca de `purchase.status` — a Hotmart às vezes
--      manda `APPROVED` no payload de um boleto só emitido."
--     (04 Sistemas/HM - esteira, boleto e o gate de portal por produto.md)
--
--   Ou seja: hoje o SIC-HF está a um `PURCHASE_BILLET_PRINTED` de distância de
--   dizer que uma família pagou, avançar a etapa, disparar a régua de
--   boas-vindas e enfileirar a ligação por IA. Nenhuma venda real passou por
--   aqui ainda (os 3 produtos estão com `hotmart_produto_id` NULL), então isto
--   é conserto ANTES do dano, não depois.
--
-- FONTE DOS NOMES DE EVENTO (honestidade sobre a evidência)
--   · `developers.hotmart.com` respondeu **CloudFront 403** em 07/09/2026 nas
--     três tentativas (webhook 2.0, changelog, purchase-webhook). Não há como
--     citar a doc oficial como prova.
--   · A Central de Ajuda da Hotmart (help.hotmart.com/pt-br/article/360001491352,
--     lida em 07/09) lista os eventos em português: compra cancelada, compra
--     completa, aguardando pagamento, compra aprovada, compra reembolsada,
--     chargeback, compra expirada, pedido de reembolso, compra atrasada,
--     cancelamento de assinatura, troca de plano, atualização de data de
--     cobrança, primeiro acesso ao Club, módulo completo, abandono de carrinho.
--   · Os nomes de máquina confirmados por EVENTO REAL vêm do log cru
--     `cs.hotmart_eventos` do ecossistema do João (15–17/07/2026, registrado em
--     "HM - Reconciliacao Hotmart x banco"): `PURCHASE_COMPLETE` 89x,
--     `PURCHASE_BILLET_PRINTED` 9x, `PURCHASE_EXPIRED` 8x, além de
--     `PURCHASE_APPROVED` e dos cancelamentos.
--   · Por isso o desenho NÃO depende de a lista estar completa (D3): **evento
--     desconhecido nunca aprova**. Cai em `em_analise`, deixa
--     `webhooks_eventos.processado_em` NULL e vira pendência com o nome do
--     evento escrito por extenso, para o humano decidir.
--   · O padrão P4 do vault ("mesmo status em duas grafias": COMPLETE/COMPLETED,
--     BILLET_PRINTED/PRINTED_BILLET) vira normalização, não `if` duplicado.
--
-- MEDIDO ANTES (07/09/2026): pagamentos = 6, todos `aprovado` ·
-- webhooks_eventos = 6, 0 com `processado_em` nulo · produtos com
-- `hotmart_produto_id` NULL = 3 · configuracoes com prefixo `pagamento.` = 0.
--
-- REVERSÃO (descrita, não automática):
--   drop trigger if exists trg_reage_pagamento_negativo on pagamentos;
--   drop function if exists app.reage_pagamento_negativo();
--   drop function if exists app.status_do_evento_hotmart(text);
--   drop function if exists app.normaliza_evento_hotmart(text);
--   drop function if exists app.instante_epoch_ms(text);
--   delete from configuracoes where chave = 'pagamento.dias_boleto_vencido';
--   -- e recriar processar_pagamento_hotmart (corpo de 0011:141-227) e
--   --            vw_pendencias_sistema (corpo de 0081).
-- ===========================================================================


-- ===========================================================================
-- (a) Normalização do nome do evento. Uma função, não um `if` espalhado —
--     P4 do vault: filtro escrito com uma grafia perde a outra metade em
--     silêncio. `immutable` para poder virar índice/expressão um dia.
-- ===========================================================================
create or replace function app.normaliza_evento_hotmart(p_evento text) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare e text;
begin
  if p_evento is null or btrim(p_evento) = '' then return null; end if;
  e := regexp_replace(upper(btrim(p_evento)), '^PURCHASE[_-]', '');
  e := replace(e, '-', '_');
  return case e
           when 'COMPLETED'       then 'COMPLETE'
           when 'PRINTED_BILLET'  then 'BILLET_PRINTED'
           when 'BILLET'          then 'BILLET_PRINTED'
           when 'CANCELLED'       then 'CANCELED'
           when 'PROTESTED'       then 'PROTEST'
           when 'DISPUTE'         then 'CHARGEBACK'
           when 'CHARGE_BACK'     then 'CHARGEBACK'
           when 'REFUND'          then 'REFUNDED'
           when 'OVERDUE'         then 'DELAYED'
           else e
         end;
end $$;
revoke execute on function app.normaliza_evento_hotmart(text) from public, anon, authenticated;
grant  execute on function app.normaliza_evento_hotmart(text) to service_role;

-- ===========================================================================
--     O MAPA (A3 do plano). Devolve NULL para evento desconhecido — quem chama
--     decide o que fazer, e a decisão é sempre a mesma: NÃO aprovar.
-- ===========================================================================
create or replace function app.status_do_evento_hotmart(p_evento_normalizado text)
returns status_pagamento
language sql immutable set search_path = public, pg_temp as $$
  select case p_evento_normalizado
           when 'APPROVED'             then 'aprovado'::status_pagamento
           -- pix/boleto COMPENSADO. É o evento que o outro projeto do João
           -- descartava e virou "pagou e o sistema não viu" (caso Rafael).
           when 'COMPLETE'             then 'aprovado'::status_pagamento
           when 'BILLET_PRINTED'       then 'boleto_gerado'::status_pagamento
           when 'DELAYED'              then 'atrasado'::status_pagamento
           when 'EXPIRED'              then 'expirado'::status_pagamento
           when 'CANCELED'             then 'cancelado'::status_pagamento
           when 'REFUNDED'             then 'reembolsado'::status_pagamento
           when 'CHARGEBACK'           then 'estornado'::status_pagamento
           when 'PROTEST'              then 'estornado'::status_pagamento
           when 'OUT_OF_SHOPPING_CART' then 'em_analise'::status_pagamento
           else null::status_pagamento
         end
$$;
revoke execute on function app.status_do_evento_hotmart(text) from public, anon, authenticated;
grant  execute on function app.status_do_evento_hotmart(text) to service_role;

comment on function app.status_do_evento_hotmart(text) is
  'Mapa evento -> estado da compra (A3 da Fase 8). NULL = evento desconhecido, e evento desconhecido NUNCA aprova (D3).';

-- Epoch em milissegundos (formato das datas do webhook 2.0) -> timestamptz.
-- Devolve NULL em vez de estourar quando o campo vem vazio ou fora do formato:
-- data ilegível não pode derrubar o registro do dinheiro.
create or replace function app.instante_epoch_ms(p_valor text) returns timestamptz
language sql immutable set search_path = public, pg_temp as $$
  select case
           when p_valor is null then null
           when p_valor !~ '^[0-9]{10,16}$' then null
           else to_timestamp(p_valor::numeric / 1000.0)
         end
$$;
revoke execute on function app.instante_epoch_ms(text) from public, anon, authenticated;
grant  execute on function app.instante_epoch_ms(text) to service_role;


-- ===========================================================================
-- (b) Prazo da cobrança de boleto vencido (B49). Configuração é DADO, não
--     constante em TS — muda em Admin → Configurações, sem deploy.
-- ===========================================================================
insert into configuracoes (chave, valor, descricao) values
 ('pagamento.dias_boleto_vencido', '7'::jsonb,
  'Dias, a partir do vencimento, para a tarefa de cobrança nascer quando a Hotmart avisa que o boleto expirou. Boleto vencido NÃO fecha a jornada (B49) — fechar continua sendo ato humano.')
on conflict (chave) do nothing;


-- ===========================================================================
-- (c) `processar_pagamento_hotmart` — MESMA ASSINATURA de 11 parâmetros.
--
--     Acrescentar um `p_evento` criaria SOBRECARGA AMBÍGUA: `create or replace`
--     com parâmetro novo NÃO substitui a função, cria uma segunda, e a chamada
--     passa a falhar em runtime. Essa armadilha já foi paga nesta casa
--     (memória "Sobrecarga SQL ambígua quebra em runtime"). O evento entra pelo
--     payload, que já chega inteiro em `p_bruto`.
--
--     O corpo abaixo parte do corpo VIGENTE (0011:141-227) e muda:
--       1. o estado vem de `p_bruto->>'event'` (D1); `p_status` só tem voz
--          quando NÃO há evento no payload — reprocesso de linha antiga, seed
--          e registro manual;
--       2. idempotência por id de evento, contra `pagamentos_transicoes` (0084);
--       3. o upsert grava `evento_hotmart/evento_em/evento_externo_id` e não
--          rebaixa por evento velho (o trigger da 0084 é quem garante, D7);
--       4. mesma `transaction` com OUTRO produto → recusa e registra (D10/B54);
--       5. **o pagamento é gravado ANTES de a etapa subir.** A ordem inverteu:
--          o teto da 0084 exige o dinheiro já registrado para deixar entrar em
--          `sessao_contratada`/`croqui_contratado`/`holding_contratada`. De
--          quebra fecha o risco que a própria 0011:129-140 documentou — a etapa
--          falhava e levava o INSERT do pagamento junto, "dinheiro sem
--          registro".
--       6. `pago_em` só é preenchido quando o estado é `aprovado`. Boleto
--          emitido não tem data de pagamento — inventá-la é o padrão P1 do
--          vault virando dado.
-- ===========================================================================
create or replace function public.processar_pagamento_hotmart(
  p_hotmart_produto_id text, p_transacao_externa_id text, p_status status_pagamento,
  p_valor numeric, p_moeda char(3), p_parcelas smallint,
  p_comprador_email text, p_comprador_nome text, p_comprador_telefone text,
  p_pago_em timestamptz, p_bruto jsonb
) returns table (
  pagamento_id uuid, jornada_id uuid, produto_mapeado boolean, etapa_avancada boolean, observacao text
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_evento_cru     text := nullif(btrim(p_bruto ->> 'event'), '');
  v_evento         text;
  v_evento_id      text;
  v_evento_em      timestamptz;
  v_status         status_pagamento;
  v_produto        produtos%rowtype;
  v_existente      pagamentos%rowtype;
  v_pagamento      pagamentos%rowtype;
  v_pessoa_id      uuid;
  v_jornada_id     uuid;
  v_etapa_alvo     etapa_jornada;
  v_etapa_atual    etapa_jornada;
  v_pagamento_id   uuid;
  v_pago_em        timestamptz;
  v_observacao     text := null;
  v_etapa_avancada boolean := false;
begin
  -- ---- 1. O ESTADO VEM DO EVENTO (D1) -----------------------------------
  v_evento := app.normaliza_evento_hotmart(v_evento_cru);
  v_status := app.status_do_evento_hotmart(v_evento);

  if v_status is null then
    if v_evento is null then
      -- Sem `event` no payload: reprocesso de linha antiga pelo Admin, seed ou
      -- registro manual. Só aqui `purchase.status` (já mapeado pelo chamador
      -- em `p_status`) tem voz.
      v_status := coalesce(p_status, 'em_analise');
      v_observacao := 'evento_ausente: estado veio de purchase.status';
    else
      -- D3: desconhecido NUNCA aprova. Nome por extenso para o humano decidir.
      v_status := 'em_analise';
      v_observacao := 'evento_desconhecido: ' || v_evento;
    end if;
  end if;

  v_evento_id := nullif(btrim(p_bruto ->> 'id'), '');
  if v_evento_id is null then
    v_evento_id := p_transacao_externa_id || ':' || coalesce(v_evento, 'sem_evento');
  end if;

  v_evento_em := coalesce(
    app.instante_epoch_ms(p_bruto ->> 'creation_date'),
    app.instante_epoch_ms(p_bruto -> 'data' -> 'purchase' ->> 'approved_date'),
    app.instante_epoch_ms(p_bruto -> 'data' -> 'purchase' ->> 'order_date'),
    p_pago_em,
    now());

  v_pago_em := case when v_status = 'aprovado' then coalesce(p_pago_em, v_evento_em) else null end;

  -- ---- 2. produto (roteamento por product.id, C3/D2) ---------------------
  select * into v_produto from produtos
   where hotmart_produto_id is not null
     and hotmart_produto_id = p_hotmart_produto_id;

  -- ---- 3. a compra já é conhecida? ---------------------------------------
  select * into v_existente from pagamentos
   where origem = 'hotmart' and transacao_externa_id = p_transacao_externa_id;

  if v_existente.id is not null then
    -- D10/B54: order bump e assinatura podem mandar a MESMA transação com
    -- outro produto. Nunca sobrescrever o produto de uma compra já gravada —
    -- seria trocar o destino do dinheiro em silêncio.
    if v_produto.id is not null
       and v_existente.produto_id is not null
       and v_existente.produto_id <> v_produto.id then
      return query select null::uuid, v_existente.jornada_id, true, false,
        ('transacao_com_produto_divergente: ' || p_transacao_externa_id)::text;
      return;
    end if;

    -- Idempotência por id de EVENTO (0084). Reentrega não vira segunda linha
    -- em `pagamentos_transicoes` nem reexecuta efeito colateral.
    if exists (select 1 from pagamentos_transicoes t
                where t.pagamento_id = v_existente.id
                  and t.evento_externo_id = v_evento_id) then
      return query select v_existente.id, v_existente.jornada_id,
                          (v_produto.id is not null), false,
                          (coalesce(v_observacao || ' | ', '') || 'evento_ja_aplicado')::text;
      return;
    end if;
  end if;

  -- ---- 4. produto não mapeado (D8) ---------------------------------------
  --      Grava a compra órfã e devolve `produto_mapeado = false`. Quem chama
  --      deixa `processado_em` NULL: dinheiro sem destino tem de FICAR na fila
  --      de pendências, não sumir carimbado como processado.
  if v_produto.id is null then
    insert into pagamentos (jornada_id, pessoa_id, produto_id, origem, transacao_externa_id,
                            status, valor, moeda, parcelas, comprador_email, comprador_nome,
                            comprador_telefone, pago_em, bruto,
                            evento_hotmart, evento_em, evento_externo_id)
    values (null, null, null, 'hotmart', p_transacao_externa_id, v_status, p_valor, p_moeda,
            p_parcelas, p_comprador_email, p_comprador_nome, p_comprador_telefone, v_pago_em, p_bruto,
            v_evento, v_evento_em, v_evento_id)
    on conflict (origem, transacao_externa_id) do update
       set status            = excluded.status,
           valor             = coalesce(excluded.valor, pagamentos.valor),
           pago_em           = coalesce(excluded.pago_em, pagamentos.pago_em),
           bruto             = excluded.bruto,
           evento_hotmart    = excluded.evento_hotmart,
           evento_em         = excluded.evento_em,
           evento_externo_id = excluded.evento_externo_id
    returning id into v_pagamento_id;
    return query select v_pagamento_id, null::uuid, false, false,
      (coalesce(v_observacao || ' | ', '') || 'produto_nao_mapeado')::text;
    return;
  end if;

  -- ---- 5. pessoa ----------------------------------------------------------
  if p_comprador_email is not null then
    select id into v_pessoa_id from pessoas where lower(email) = lower(p_comprador_email);
  end if;
  if v_pessoa_id is null and p_comprador_telefone is not null then
    select id into v_pessoa_id from pessoas where telefone = p_comprador_telefone;
  end if;
  if v_pessoa_id is null then
    v_pessoa_id := v_existente.pessoa_id;
  end if;
  if v_pessoa_id is null then
    insert into pessoas (nome, email, telefone)
    values (coalesce(p_comprador_nome, 'Cliente Hotmart'), p_comprador_email, p_comprador_telefone)
    returning id into v_pessoa_id;
  end if;

  -- ---- 6. jornada ---------------------------------------------------------
  v_jornada_id := v_existente.jornada_id;
  if v_jornada_id is null then
    select id, etapa into v_jornada_id, v_etapa_atual from jornadas
     where pessoa_id = v_pessoa_id and desfecho = 'aberta' limit 1;
  end if;
  if v_jornada_id is null then
    insert into jornadas (pessoa_id, origem, trilha, etapa)
    values (v_pessoa_id, 'outro', 'seminario', 'captado')
    returning id, etapa into v_jornada_id, v_etapa_atual;
  end if;

  -- ---- 7. GRAVA O DINHEIRO PRIMEIRO --------------------------------------
  --      Inverteu em relação à 0011 de propósito: o teto da 0084 exige o
  --      pagamento já registrado para deixar a etapa subir, e a etapa nunca
  --      mais pode derrubar o INSERT do pagamento junto com ela.
  begin
    insert into pagamentos (jornada_id, pessoa_id, produto_id, origem, transacao_externa_id,
                            status, valor, moeda, parcelas, comprador_email, comprador_nome,
                            comprador_telefone, pago_em, bruto,
                            evento_hotmart, evento_em, evento_externo_id)
    values (v_jornada_id, v_pessoa_id, v_produto.id, 'hotmart', p_transacao_externa_id,
            v_status, p_valor, p_moeda, p_parcelas, p_comprador_email, p_comprador_nome,
            p_comprador_telefone, v_pago_em, p_bruto,
            v_evento, v_evento_em, v_evento_id)
    on conflict (origem, transacao_externa_id) do update
       set jornada_id         = coalesce(pagamentos.jornada_id, excluded.jornada_id),
           pessoa_id          = coalesce(pagamentos.pessoa_id,  excluded.pessoa_id),
           produto_id         = coalesce(pagamentos.produto_id, excluded.produto_id),
           status             = excluded.status,
           valor              = coalesce(excluded.valor, pagamentos.valor),
           parcelas           = coalesce(excluded.parcelas, pagamentos.parcelas),
           comprador_email    = coalesce(pagamentos.comprador_email, excluded.comprador_email),
           comprador_nome     = coalesce(pagamentos.comprador_nome, excluded.comprador_nome),
           comprador_telefone = coalesce(pagamentos.comprador_telefone, excluded.comprador_telefone),
           pago_em            = coalesce(excluded.pago_em, pagamentos.pago_em),
           bruto              = excluded.bruto,
           evento_hotmart     = excluded.evento_hotmart,
           evento_em          = excluded.evento_em,
           evento_externo_id  = excluded.evento_externo_id
    returning * into v_pagamento;
    v_pagamento_id := v_pagamento.id;
  exception when others then
    v_observacao := coalesce(v_observacao || ' | ', '') || 'pagamento_bloqueado: ' || sqlerrm;
    return query select null::uuid, v_jornada_id, true, false, v_observacao;
    return;
  end;

  -- Estado EFETIVO depois dos triggers: se o evento chegou fora de ordem, a
  -- 0084 devolveu o estado anterior e não há etapa a avançar.
  if v_pagamento.evento_externo_id is distinct from v_evento_id then
    v_observacao := coalesce(v_observacao || ' | ', '') || 'evento_fora_de_ordem: estado mantido';
  end if;

  -- ---- 8. só então a etapa ------------------------------------------------
  if v_pagamento.status = 'aprovado' then
    v_etapa_alvo := case v_produto.tipo
                      when 'sessao_viabilidade' then 'sessao_contratada'
                      when 'croqui_estrutural'  then 'croqui_contratado'
                      when 'holding'            then 'holding_contratada'
                    end;
    select etapa into v_etapa_atual from jornadas where id = v_jornada_id;
    if v_etapa_alvo is not null and v_etapa_atual is distinct from v_etapa_alvo then
      begin
        update jornadas set etapa = v_etapa_alvo where id = v_jornada_id;
        v_etapa_avancada := true;
      exception when check_violation then
        v_observacao := coalesce(v_observacao || ' | ', '')
          || 'etapa_nao_avancada: transicao ' || v_etapa_atual::text || ' -> '
          || v_etapa_alvo::text || ' nao permitida';
      end;
    end if;
  end if;

  return query select v_pagamento_id, v_jornada_id, true, v_etapa_avancada, v_observacao;
end $$;
revoke execute on function public.processar_pagamento_hotmart(
  text, text, status_pagamento, numeric, char, smallint, text, text, text, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.processar_pagamento_hotmart(
  text, text, status_pagamento, numeric, char, smallint, text, text, text, timestamptz, jsonb
) to service_role;


-- ===========================================================================
-- (d) TRAVA E AVISA (D6 / B48 / B49 / B50). O reembolso não apaga história:
--     a etapa NÃO regride e `nivel_pago` NÃO cai. O que muda é o TETO — que
--     cai sozinho, porque `app.nivel_pago_vigente` só conta o que está
--     `aprovado` — e o sistema passa a GRITAR: andamento na timeline, tarefa
--     na fila e, no reembolso/estorno, a régua e a fila de ligação caladas.
--
--     B50/B51: link público NÃO é revogado aqui. Revogar é botão, nunca efeito
--     automático de um evento externo.
--
--     Idempotente por construção: a tarefa usa `uniq_tarefa_aberta_por_tipo`
--     (0051) e os UPDATEs filtram pelo estado de origem.
-- ===========================================================================
create or replace function app.reage_pagamento_negativo() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tipo    produto_tipo;
  v_produto text;
  v_dias    int;
  v_titulo  text;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status not in ('cancelado', 'reembolsado', 'estornado', 'expirado') then return new; end if;
  if new.jornada_id is null then return new; end if;

  select p.tipo into v_tipo from produtos p where p.id = new.produto_id;
  v_produto := coalesce(case v_tipo
                          when 'sessao_viabilidade' then 'Sessão de Viabilidade'
                          when 'croqui_estrutural'  then 'Croqui Estrutural'
                          when 'holding'            then 'Holding'
                        end, 'produto não identificado');

  v_titulo := case new.status
                when 'cancelado'   then 'Pagamento cancelado — ' || v_produto
                when 'reembolsado' then 'Pagamento reembolsado — ' || v_produto
                when 'estornado'   then 'Chargeback — ' || v_produto
                when 'expirado'    then 'Boleto vencido — ' || v_produto
              end;

  perform app.registrar_evento_timeline(
    new.jornada_id, 'pagamento_alerta', v_titulo,
    'A jornada não avança mais por este produto até o pagamento voltar a constar como aprovado.',
    jsonb_build_object(
      'pagamento_id', new.id, 'produto_id', new.produto_id, 'produto_tipo', v_tipo,
      'de', old.status, 'para', new.status, 'evento', new.evento_hotmart,
      'transacao', new.transacao_externa_id));

  select coalesce((valor #>> '{}')::int, 7) into v_dias
    from configuracoes where chave = 'pagamento.dias_boleto_vencido';

  insert into tarefas (jornada_id, tipo, titulo, descricao, vence_em, origem)
  values (new.jornada_id,
          'pagamento_' || new.status::text,
          v_titulo,
          case new.status
            when 'expirado' then 'O boleto venceu e o dinheiro não entrou. Cobrar ou registrar a desistência — a jornada continua aberta (B49).'
            else 'Confirmar com o cliente e decidir o desfecho. Nada foi apagado: a etapa e o histórico continuam como estão (D6/B48).'
          end,
          current_date + coalesce(v_dias, 7),
          'sistema')
  on conflict (jornada_id, tipo) where concluida_em is null and tipo is not null do nothing;

  -- Reembolso e chargeback calam a máquina: continuar mandando e-mail de
  -- boas-vindas e discando para quem pediu o dinheiro de volta é o pior uso
  -- possível da automação.
  if new.status in ('reembolsado', 'estornado') then
    update mensagens_agendadas
       set status = 'cancelada',
           erro = 'pagamento_' || new.status::text
     where jornada_id = new.jornada_id
       and status = 'pendente';

    update ligacoes_ia
       set status = 'cancelada',
           encerrada_em = now()
     where jornada_id = new.jornada_id
       and status = 'na_fila';
  end if;

  return new;
end $$;

drop trigger if exists trg_reage_pagamento_negativo on pagamentos;
create trigger trg_reage_pagamento_negativo after update of status on pagamentos
for each row execute function app.reage_pagamento_negativo();


-- ===========================================================================
-- (e) `produto_nao_mapeado` sai do balde `webhook_falho` e vira pendência com
--     ação PRÓPRIA. Corpo VIGENTE da 0081, copiado inteiro; a ÚNICA diferença
--     está no primeiro `select` do `union all` — o resto (mensagem_falhou,
--     link_expirando, material_aguardando_aprovacao, sessao_sem_sala,
--     cron_parado, expurgo_storage_pendente) é cópia literal.
--
--     Por que separar: "webhook não processado" leva a "Reprocessar", e
--     reprocessar um produto não mapeado dá exatamente no mesmo lugar. A ação
--     certa é OUTRA — mapear o `product.id` para um dos três produtos. Fila
--     cujo botão não resolve treina o time a ignorar a fila.
--
--     `security_invoker` reafirmado (lição da 0047). O `product.id` do payload
--     é identificador de produto, não PII do comprador.
-- ===========================================================================
create or replace view vw_pendencias_sistema with (security_invoker = true) as
select
  w.id::text as id,
  (case when w.erro = 'produto_nao_mapeado' then 'produto_nao_mapeado' else 'webhook_falho' end)::text as tipo,
  (case when w.erro = 'produto_nao_mapeado'
        then 'Venda de produto não mapeado'
        else 'Webhook não processado' end)::text as titulo,
  case when w.erro = 'produto_nao_mapeado'
       then 'A Hotmart mandou uma venda do produto '
            || coalesce(nullif(w.bruto -> 'data' -> 'product' ->> 'id', ''), '(sem id no payload)')
            || ', que não está ligado a nenhum produto do sistema. O dinheiro entrou e a jornada não anda até alguém mapear esse ID.'
       else coalesce(w.erro, 'Sem detalhe de erro registrado — ver tentativas.') end as descricao,
  null::uuid as jornada_id,
  null::text as pessoa_nome,
  w.recebido_em as ocorrido_em
from webhooks_eventos w
where w.processado_em is null
union all
select
  m.id::text,
  'mensagem_falhou'::text,
  'Mensagem da régua falhou'::text,
  coalesce(m.erro, 'Sem detalhe de erro registrado.'),
  m.jornada_id,
  p.nome,
  coalesce(m.enviada_em, m.criado_em)
from mensagens_agendadas m
join jornadas j on j.id = m.jornada_id
join pessoas p on p.id = j.pessoa_id
where m.status = 'falhou'
union all
select
  l.id::text,
  'link_expirando'::text,
  'Link público expirando em breve'::text,
  'Expira em ' || to_char(l.expira_em at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI'),
  l.jornada_id,
  p.nome,
  l.expira_em
from links_publicos l
join jornadas j on j.id = l.jornada_id
join pessoas p on p.id = j.pessoa_id
where l.estado = 'ativo'
  and l.expira_em <= now() + interval '48 hours'
union all
select
  mg.id::text,
  'material_aguardando_aprovacao'::text,
  'Material pós-sessão aguardando aprovação'::text,
  case
    when mg.fonte_dor = 'nenhuma' then 'Material padrão (sem dor identificada) — revisar antes de aprovar.'
    else 'Personalizado pela dor declarada — revisar antes de aprovar.'
  end,
  mg.jornada_id,
  p.nome,
  mg.criado_em
from materiais_gerados mg
join jornadas j on j.id = mg.jornada_id
join pessoas p on p.id = j.pessoa_id
where mg.atual and mg.aprovado_em is null
union all
-- Sessão nas próximas 24h sem link da sala: o e-mail do dia fica em hold
-- (reivindicar_mensagens_pendentes, 0051) até alguém colar o link ou a
-- integração responder. Texto exato do §1.9.
select
  a.id::text,
  'sessao_sem_sala'::text,
  'Sessão sem link da sala'::text,
  'Sessão em ' || greatest(0, floor(extract(epoch from (a.inicio_em - now())) / 3600))::int
    || ' h sem link da sala — cole o link ou ligue a integração (N8N_WEBHOOK_SALA_URL, Admin → Integrações).',
  j.id,
  p.nome,
  a.inicio_em
from agendamentos a
join sessoes_viabilidade s on s.id = a.sessao_id
join jornadas j on j.id = s.jornada_id
join pessoas p on p.id = j.pessoa_id
where a.status in ('agendado', 'confirmado')
  and s.link_sala is null
  and a.inicio_em > now() - interval '1 hour'
  and a.inicio_em <= now() + interval '24 hours'
union all
-- Cron parado: nenhuma passagem há mais de 15 min (ou nunca). Uma linha só.
select
  'cron'::text,
  'cron_parado'::text,
  'A régua não está rodando'::text,
  'A régua ainda não roda sozinha: falta o cron da Hostinger chamar /api/cron/regua a cada 5 minutos com o CRON_SECRET de produção. Última passagem registrada: '
    || case
         when c.valor = 'null'::jsonb then 'nunca'
         else 'há ' || greatest(0, floor(extract(epoch from (now() - (c.valor #>> '{}')::timestamptz)) / 60))::int || ' min'
       end || '.',
  null::uuid,
  null::text,
  case when c.valor = 'null'::jsonb then null else (c.valor #>> '{}')::timestamptz end
from configuracoes c
where c.chave = 'regua.ultimo_cron_em'
  and (c.valor = 'null'::jsonb or (c.valor #>> '{}')::timestamptz < now() - interval '15 minutes')
union all
select
  ts.id::text,
  'expurgo_storage_pendente'::text,
  'Expurgo de arquivos pendente'::text,
  'O tratamento deste titular foi encerrado, mas '
    || jsonb_array_length(ts.resultado -> 'storage_pendente')
    || ' arquivo(s) continuam no armazenamento. Abra Cadastro -> Direitos do titular e conclua o expurgo.',
  null::uuid,
  p.nome,
  ts.executado_em
from titulares_solicitacoes ts
join pessoas p on p.id = ts.pessoa_id
where ts.tipo = 'anonimizacao'
  and ts.resultado ->> 'storage_removido_em' is null
  and jsonb_typeof(ts.resultado -> 'storage_pendente') = 'array'
  and jsonb_array_length(ts.resultado -> 'storage_pendente') > 0
order by ocorrido_em asc nulls last;

revoke all on vw_pendencias_sistema from public, anon;
grant select on vw_pendencias_sistema to authenticated;

comment on view vw_pendencias_sistema is
  'Painel do dia, bloco 4: travado. Tipos: webhook_falho, mensagem_falhou, link_expirando, '
  'material_aguardando_aprovacao (0031), sessao_sem_sala e cron_parado (0052), '
  'expurgo_storage_pendente (0081), produto_nao_mapeado (0085).';
