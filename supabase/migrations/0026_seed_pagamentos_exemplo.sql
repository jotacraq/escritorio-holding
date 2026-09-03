-- 0026_seed_pagamentos_exemplo.sql
-- Seed de dev, continuacao do 0016. A ficha mostrava "Sessao paga" sem nenhum
-- pagamento por tras: o nivel_pago vinha carimbado a mao no seed, sem lastro.
-- Aqui o dinheiro passa a existir de verdade e exercita a cadeia real de triggers
-- (trg_nivel_pago, trg_regua_boas_vindas, trg_timeline_pagamento).
--
-- VALOR: so o croqui tem preco documentado no metodo (R$ 7.200 padrao,
-- R$ 4.500 no "Incentivo do Resolvedor"). Sessao de Viabilidade e Holding NAO
-- tem preco definido em nenhum material — ficam com valor NULL de proposito.
-- Inventar numero aqui seria inventar regra de negocio, e a tela mostra vazio,
-- nunca zero.
do $$
declare r record; v_prod_sessao uuid; v_prod_croqui uuid; v_prod_holding uuid;
begin
  select id into v_prod_sessao  from produtos where tipo = 'sessao_viabilidade';
  select id into v_prod_croqui  from produtos where tipo = 'croqui_estrutural';
  select id into v_prod_holding from produtos where tipo = 'holding';

  for r in
    select j.id as jornada_id, j.pessoa_id, j.nivel_pago, p.nome, p.email, p.telefone
      from jornadas j join pessoas p on p.id = j.pessoa_id
     where j.origem_dado = 'exemplo' and j.nivel_pago >= 1
  loop
    insert into pagamentos (jornada_id, pessoa_id, produto_id, origem, transacao_externa_id,
                            status, valor, moeda, parcelas, comprador_email, comprador_nome,
                            comprador_telefone, pago_em, bruto)
    values (r.jornada_id, r.pessoa_id, v_prod_sessao, 'exemplo',
            'EXEMPLO-SESSAO-' || left(r.jornada_id::text, 8), 'aprovado', null, 'BRL', 1,
            r.email, r.nome, r.telefone, now() - interval '20 days',
            jsonb_build_object('origem_dado','exemplo','observacao','Pagamento de exemplo. Valor da Sessao de Viabilidade nao definido em nenhum material do metodo — fica nulo de proposito.'))
    on conflict (origem, transacao_externa_id) do nothing;

    if r.nivel_pago >= 2 then
      insert into pagamentos (jornada_id, pessoa_id, produto_id, origem, transacao_externa_id,
                              status, valor, moeda, parcelas, comprador_email, comprador_nome,
                              comprador_telefone, pago_em, bruto)
      values (r.jornada_id, r.pessoa_id, v_prod_croqui, 'exemplo',
              'EXEMPLO-CROQUI-' || left(r.jornada_id::text, 8), 'aprovado', 4500.00, 'BRL', 1,
              r.email, r.nome, r.telefone, now() - interval '12 days',
              jsonb_build_object('origem_dado','exemplo','condicao','incentivo_resolvedor','valor_padrao',7200))
      on conflict (origem, transacao_externa_id) do nothing;
    end if;

    if r.nivel_pago >= 3 then
      insert into pagamentos (jornada_id, pessoa_id, produto_id, origem, transacao_externa_id,
                              status, valor, moeda, parcelas, comprador_email, comprador_nome,
                              comprador_telefone, pago_em, bruto)
      values (r.jornada_id, r.pessoa_id, v_prod_holding, 'exemplo',
              'EXEMPLO-HOLDING-' || left(r.jornada_id::text, 8), 'aprovado', null, 'BRL', 1,
              r.email, r.nome, r.telefone, now() - interval '5 days',
              jsonb_build_object('origem_dado','exemplo','observacao','Honorarios da holding nao definidos em material — valor nulo de proposito.'))
      on conflict (origem, transacao_externa_id) do nothing;
    end if;
  end loop;
end $$;

-- Oferta do croqui registrada (CONFLITO C8 do plano: sem isso o valor recebido
-- nao reconcilia com nada e nao da para medir a eficacia do Incentivo do Resolvedor).
insert into ofertas (jornada_id, produto_id, valor_padrao, valor_ofertado, condicao, ofertada_em, aceita)
select j.id, (select id from produtos where tipo = 'croqui_estrutural'),
       7200.00, 4500.00, 'incentivo_resolvedor', now() - interval '13 days', true
  from jornadas j
 where j.origem_dado = 'exemplo' and j.nivel_pago >= 2
   and not exists (select 1 from ofertas o where o.jornada_id = j.id);
