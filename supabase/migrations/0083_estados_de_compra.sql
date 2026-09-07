-- 0083_estados_de_compra.sql — Fase 8, Frente A (D4).
-- ===========================================================================
-- SÓ VALORES DE ENUM, em migration PRÓPRIA. O Postgres não deixa USAR um valor
-- de enum na mesma transação em que ele é criado — mesma razão pela qual a 0079
-- ('anonimizada') foi separada da 0080. A 0085 usa os três valores abaixo
-- dentro de `public.processar_pagamento_hotmart` e de
-- `app.reage_pagamento_negativo`; por isso a ordem de aplicação é
-- 0083 → 0084 → 0085, uma transação por arquivo.
--
-- POR QUE VALOR NOVO, E NÃO REAPROVEITAR O QUE EXISTE (D4)
--   · `boleto_gerado`  — hoje `BILLET_PRINTED` vira `pendente`. "Pendente" é o
--     mesmo balde de `PROCESSING_TRANSACTION` e `PRE_ORDER`: a tela não sabe
--     dizer se existe um boleto na mão do cliente para cobrar. O vault do João
--     registra o caso Rafael Bayard — boleto compensado que ficou preso — e o
--     padrão P3, "boleto expirado preso em BILLET_PRINTED".
--   · `expirado`       — hoje `EXPIRED` vira `cancelado`. Cancelamento é ato de
--     alguém; expiração é o relógio. Misturar os dois mente no funil e some com
--     a fila de cobrança (padrão P5 do vault).
--   · `atrasado`       — `PURCHASE_DELAYED` (parcela em atraso de assinatura /
--     recorrência) não é cancelamento nem aprovação.
--
-- ADITIVO: nenhuma linha existente muda de valor — os três valores não existiam,
-- logo 0 linhas os usam. Medido antes (07/09/2026, via API de banco):
--   pagamentos = 6, todos `aprovado`; status_pagamento =
--   {pendente,em_analise,aprovado,cancelado,estornado,reembolsado}.
--
-- REVERSÃO: o Postgres não remove valor de enum. Reverter exige recriar o tipo
-- (rename + create + alter column using + drop) e NÃO é recomendado. Antes de
-- qualquer tentativa, zerar as linhas que usam os valores:
--   update pagamentos set status = 'pendente'
--    where status in ('boleto_gerado','expirado','atrasado');
-- ===========================================================================

alter type status_pagamento add value if not exists 'boleto_gerado';
alter type status_pagamento add value if not exists 'expirado';
alter type status_pagamento add value if not exists 'atrasado';
