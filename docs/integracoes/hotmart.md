# Hotmart — três produtos, um webhook

Fase 8, Frente A. Migrations `0083`–`0085`. Roteiro de prova:
`scripts/verificacao-0083-0085.sql` (12 asserções, com rollback).

## 1. Configuração na Hotmart

São **três produtos** (Sessão de Viabilidade, Croqui Estrutural, Holding) e **uma
URL de webhook**:

```
https://<dominio>/api/webhooks/hotmart
```

Nos três produtos: Ferramentas → Webhook (versão **2.0**), a mesma URL, o mesmo
HOTTOK, e todos os eventos de compra marcados. Quem separa um produto do outro é
o `data.product.id`, conferido contra `produtos.hotmart_produto_id` **dentro da
transação que grava o dinheiro**.

Três URLs seriam três hottoks, três rate limits e três caminhos de idempotência
— e ainda assim exigiriam validar o `product.id`, senão um evento do produto A
postado na URL do produto B seria aceito (a armadilha `guard(portal) + ?produto=`
que o vault do João documenta em 11 handlers do sistema-disparos).

**O que falta o João fazer (nada disso é código):**

1. Admin → Produtos: preencher **`ID do produto na Hotmart`** nos três. Hoje os
   três estão vazios e **todo pagamento real cai em `produto_nao_mapeado`**.
2. `HOTMART_WEBHOOK_SECRET` na Hostinger, com o mesmo HOTTOK dos três produtos.
   **Sem ele o endpoint responde 503 e recusa tudo** — é o comportamento certo
   (webhook falha FECHADO), não um erro.

## 2. Eventos → estado da compra

O estado vem do **EVENTO**, nunca de `purchase.status`. A Hotmart manda
`APPROVED` no payload de um boleto apenas emitido; ler o payload é dizer que uma
família pagou quando ela só imprimiu o boleto.

| Evento | Estado (`status_pagamento`) | O que acontece |
|---|---|---|
| `PURCHASE_APPROVED` | `aprovado` | etapa avança · régua de boas-vindas · `nivel_pago` |
| `PURCHASE_COMPLETE` | `aprovado` | boleto/pix **compensado** — idem |
| `PURCHASE_BILLET_PRINTED` | `boleto_gerado` | selo "Boleto gerado"; a etapa **não** anda |
| `PURCHASE_DELAYED` | `atrasado` | selo |
| `PURCHASE_EXPIRED` | `expirado` | selo + tarefa de cobrança em D+`pagamento.dias_boleto_vencido` (7). **Não fecha a jornada** |
| `PURCHASE_CANCELED` | `cancelado` | teto cai · andamento · tarefa |
| `PURCHASE_REFUNDED` | `reembolsado` | idem + régua e fila de ligação caladas |
| `PURCHASE_CHARGEBACK` / `PURCHASE_PROTEST` | `estornado` | idem, severidade vermelha |
| `PURCHASE_OUT_OF_SHOPPING_CART` | `em_analise` | só registro |
| qualquer outro | `em_analise` | **nunca aprova**; vira pendência com o nome do evento |

Grafias alternativas colapsam antes de comparar (`COMPLETED`→`COMPLETE`,
`PRINTED_BILLET`→`BILLET_PRINTED`, `CANCELLED`→`CANCELED`, `PROTESTED`→`PROTEST`,
`DISPUTE`→`CHARGEBACK`). É o padrão P4 do vault: filtro com uma grafia só perde a
outra metade em silêncio.

> **Sobre a fonte dos nomes.** `developers.hotmart.com` respondeu CloudFront 403
> em 07/09/2026. A lista em português vem da Central de Ajuda da Hotmart; os
> nomes de máquina confirmados por evento REAL vêm do log `cs.hotmart_eventos`
> do ecossistema do João. Por isso o desenho não depende de a lista estar
> completa: evento desconhecido nunca aprova.

## 3. O gate: piso é histórico, teto é vigente

- `jornadas.nivel_pago` é **piso** e **não cai** no reembolso. Sessão que
  aconteceu aconteceu; apagar é mentir sobre o passado.
- `app.nivel_pago_vigente(jornada)` é **teto**: maior nível com pagamento hoje
  `aprovado`. Cai no cancelamento, reembolso e chargeback.
- Entrar em `sessao_contratada` / `croqui_contratado` / `holding_contratada`
  exige teto ≥ 1 / 2 / 3 — **inclusive pela mão do humano na tela**. É a resposta
  literal ao pedido: só avança para o Croqui quem pagou o Croqui.
- O trigger só julga transições NOVAS. Nenhuma jornada existente foi tocada
  (medido: 0 acima do teto).

Reembolso **trava e avisa**: a etapa não regride, o teto cai, nasce um andamento
`pagamento_alerta`, nasce uma tarefa, a régua e a fila de ligação por IA da
jornada são canceladas. Link público **não** é revogado — revogar é botão.

## 4. O que a tela mostra

| Onde | O quê |
|---|---|
| Admin → Produtos | `ID do produto na Hotmart` e link de checkout, editáveis; aviso listando os produtos sem ID |
| Admin → Pendências | `Venda de produto não mapeado`, com o ID que veio no payload e o botão **"Mapear para…"** — escolhe o produto, grava o ID e reprocessa o evento na hora |
| Admin → Pendências | `Webhook não processado` para os demais casos (inclui evento desconhecido e transação com produto divergente) |
| Ficha / Clientes | `vw_pagamentos_jornada`: estado por produto, com `revertido` e `aguardando_dinheiro` |

Compra sem produto mapeado **não** é carimbada como processada — antes da Fase 8
era, e a pendência sumia do índice: dinheiro sem destino virava silêncio.

## 5. Roteiro de teste (local, sem venda real)

```bash
# 1. dev server COM o secret (o .env.local de desenvolvimento vem vazio)
HOTMART_WEBHOOK_SECRET=hottok-local-de-teste npx next dev

# 2. os cinco roteiros
HOTMART_WEBHOOK_SECRET=hottok-local-de-teste \
  npx tsx scripts/simular-hotmart.ts --roteiro=todos

# um roteiro só, noutro produto, sem limpar no fim
npx tsx scripts/simular-hotmart.ts --roteiro=reembolso --produto=croqui --manter
```

| Roteiro | Prova |
|---|---|
| `aprovado` | 200, `aprovado`, etapa em `sessao_contratada`, `nivel_pago = 1` |
| `boleto` | `BILLET_PRINTED` **com `purchase.status=APPROVED`** vira `boleto_gerado` (não `aprovado`); depois `EXPIRED` vira `expirado` + tarefa; etapa parada em `captado` |
| `reembolso` | teto cai a 0, `nivel_pago` continua 1, etapa não regride, tarefa + andamento, régua calada |
| `chargeback` | idem, estado `estornado` |
| `desconhecido` | `product.id` não mapeado → 200, `processado_em` NULO e pendência `produto_nao_mapeado` |

O script **recusa qualquer host que não seja local** (assinar uma compra contra
produção criaria pagamento de verdade), mapeia o produto temporariamente e
devolve o `hotmart_produto_id` a `null` no fim, mesmo se falhar, e apaga tudo o
que criou.

A prova do lado do banco (12 asserções, com rollback) é
`scripts/verificacao-0083-0085.sql`; a da lógica pura é
`src/server/pagamentos/{eventos,roteador}.test.ts`.
