# Fase 8 — plano do arquiteto · 07/09/2026

Entrada: `tmp/squad/fase8-{brief,pesquisa,reconhecimento}.md`. Base lida: `CLAUDE.md`,
`CONTINUAR-AQUI.md` (bloco Fase 7), `brain/03 - Dominio/{Glossario,Esteira do cliente}.md`,
`docs/{DESIGN-SYSTEM,ARQUITETURA-FASE-7,SKILLS}.md`, migrations `0004`/`0010`/`0011`/`0027`/`0070`/
`0080`, `api/webhooks/hotmart/route.ts`, `server/pagamentos/hotmart.ts`, `lib/pasta/*`,
`components/{ui,shell,ficha360,croqui}/*`, `eslint.config.mjs`, `.github/workflows/ci.yml`. Vault do
João: `04 Sistemas/HM - {Reconciliacao Hotmart x banco, esteira boleto e o gate de portal por
produto, Ofertas tags e janelas de evento}.md`.

**Não consultei o banco** (sem tool de Supabase nesta invocação): todo número `A MEDIR` é tarefa do
orquestrador antes da migration. Nenhum número foi inventado. **Os nomes dos eventos não vieram da
doc pública da Hotmart** — `developers.hotmart.com` devolveu CloudFront 403 e `help.hotmart.com`
devolveu 500 em 07/09. A fonte usada é melhor que a doc: o **log cru de eventos reais** do
ecossistema do João (`cs.hotmart_eventos`, 15–17/07/2026, no vault), que provou que a Hotmart manda
`PURCHASE_COMPLETE` (89×), `PURCHASE_BILLET_PRINTED` (9×) e `PURCHASE_EXPIRED` (8×). O desenho não
depende de a lista estar completa: **evento desconhecido nunca aprova nada** (D3).

## 0. As três frases que resumem o desenho

**A.** Uma compra na Hotmart não é um `status` — é uma **linha do tempo de estados de uma transação**,
e o estado vem do **EVENTO**, nunca de `purchase.status`. Hoje o SIC-HF lê `purchase.status`, e o
vault prova que a Hotmart manda `APPROVED` no payload de um boleto apenas emitido: **o sistema está a
um boleto de distância de dizer que uma pessoa pagou.**

**B.** O croqui não tem três estados — tem **seis fases e dois fatos** (exportado, narrado). O enum
`status_croqui` é o estado *editorial* do documento; a fase é **derivada** de quatro tabelas. Não se
conserta isso mexendo no enum; conserta-se com uma view, uma vez, para todas as telas.

**C.** "Arquivar processo" não é um rótulo faltando — é um **efeito colateral faltando**. Fechar a
jornada hoje muda a cor na tela e a régua continua mandando e-mail, a fila de ligação continua
discando e os links continuam abertos.

# FRENTE A — Pagamento por produto (Hotmart × 3, fail-closed)

## A1. O que existe hoje (medido no código)

| Camada | Estado | Consequência |
|---|---|---|
| Rota `POST /api/webhooks/hotmart` | fail-closed sem secret (503), hottok `timingSafeEqual`, 1 MB, 60/min, idempotência `(origem,evento_externo_id)` | **segurança está boa — não é aqui o buraco** |
| `mapearStatusHotmart()` (`hotmart.ts:22-32`) | lê `purchase.status`, ignora `payload.event` | **BUG LATENTE (D1)** |
| `processar_pagamento_hotmart` (0011:195-209) | só `p_status='aprovado'` avança etapa; negativo grava a linha e nada mais | reembolso é invisível |
| `produtos.hotmart_produto_id` | **null nos 3** | todo evento real cai em `produto_nao_mapeado` |
| `produto_nao_mapeado` (`hotmart.ts:141-146`) | marca `processado_em = agora` | some do índice de pendências: **dinheiro sem destino vira silêncio** |
| `app.valida_transicao_jornada` (0004:87-92) | piso por `nivel_pago`; **não existe teto** | humano avança para "Croqui pago" sem croqui pago |
| `pagamentos` upsert (0011:218) | `do update set status = excluded.status` | evento fora de ordem **rebaixa** aprovado para pendente |
| `scripts/simular-hotmart.ts` | **não existe** (só `simular-webhook-ligacao.ts`) | nada disso é testável sem venda real |

## A2. Decisões numeradas

| # | Decisão | Por quê |
|---|---|---|
| **D1** | O estado vem do **EVENTO**. `mapearStatusHotmart(purchase.status)` vira `mapearEventoHotmart(payload.event, purchase.status)`; `purchase.status` só é lido quando `event` falta (linha antiga reprocessada pelo Admin) | Regra do vault, literal: *"o status vem do EVENTO, nunca de `purchase.status` — a Hotmart às vezes manda `APPROVED` no payload de um boleto só emitido"* |
| **D2** | **UM** webhook, roteamento por `product.id` contra a tabela `produtos` | Três URLs = três hottoks, três rate limits, três caminhos de idempotência — e **ainda** exigiriam validar `product.id`, senão evento do produto A postado na URL do produto B é aceito (armadilha `guard({portal:"HM"}) + ?produto=AURUM` do vault, 11 handlers). Com uma URL a verdade é o banco: produto novo = 1 UPDATE em Admin, sem deploy. Ver C3 |
| **D3** | Evento desconhecido **nunca aprova**: default `em_analise` + `webhooks_eventos.erro='evento_desconhecido: <NOME>'` e `processado_em` NULL | O mapa normaliza antes de comparar, cobrindo a bomba de lógica das duas grafias (`COMPLETE`/`COMPLETED`, `BILLET_PRINTED`/`PRINTED_BILLET`) |
| **D4** | A máquina é o enum `status_pagamento` **estendido**, não uma tabela `compras` nova | Segundo livro-razão para a mesma coisa reprova em otimização. Faltam 3 valores; `estornado` já cobre chargeback/protesto, `reembolsado` cobre refund |
| **D5** | **Piso é histórico, teto é vigente.** `nivel_pago` continua monotônico (piso contábil); nasce `app.nivel_pago_vigente()` = maior nível `aprovado` e não revertido. Entrar em `sessao_contratada`/`croqui_contratado`/`holding_contratada` exige teto ≥ 1/2/3 | É a resposta literal ao João ("só avança para o Croqui quando pagou o Croqui") — e vale para o humano na tela, não só para o webhook |
| **D6** | Reembolso **TRAVA e AVISA**; não rebaixa etapa | Sessão que aconteceu aconteceu; apagar etapa é apagar histórico. O teto cai, a jornada não avança mais, e o sistema grita (timeline + tarefa + selo + linha em Hoje). Ver B48 |
| **D7** | Fora de ordem não rebaixa: `pagamentos.evento_em` e o upsert só troca o estado se o evento for **mais recente** | Hoje `do update set status = excluded.status` (0011:218) deixa uma reentrega antiga de `BILLET_PRINTED` derrubar um `APPROVED` |
| **D8** | `produto_nao_mapeado` deixa `processado_em` **NULL** (continua 200 para a Hotmart) | Hoje carimba `processado_em` e some do índice de pendências: dinheiro sem destino vira silêncio. Com NULL, fica na fila com a ação certa — mapear o ID e clicar "Reprocessar" (o botão já existe) |
| **D9** | **Zero coluna nova em `jornadas`**: o alerta de pagamento é derivado (view) | Campo novo nasce vazio e backfill reclassifica gente em silêncio — as duas armadilhas da casa. Sem coluna, sem backfill, sem risco |
| **D10** | Mesma `transaction` com outro produto → **recusa e registra** `transacao_com_produto_divergente` | Nunca sobrescrever o produto de uma compra já gravada (order bump, assinatura). Ver B54 |

## A3. Mapa de eventos → estado da compra

Normalização antes de comparar: `upper()`, remove prefixo `PURCHASE_`, e as duas grafias conhecidas
colapsam (`COMPLETED`→`COMPLETE`, `PRINTED_BILLET`→`BILLET_PRINTED`).

| Evento Hotmart | `status_pagamento` | Etapa alvo | Efeito |
|---|---|---|---|
| `PURCHASE_APPROVED` | `aprovado` | por produto | avança etapa · régua de boas-vindas · `nivel_pago` |
| `PURCHASE_COMPLETE` | `aprovado` | por produto | **boleto/pix COMPENSADO** — é o evento que o outro projeto ignorava e virou "pagou e o sistema não viu" |
| `PURCHASE_BILLET_PRINTED` | `boleto_gerado` (novo) | — | selo "Boleto gerado, não pago" + tarefa de cobrança em D+`pagamento.dias_boleto_vencido` (7) |
| `PURCHASE_DELAYED` | `atrasado` (novo) | — | selo + tarefa |
| `PURCHASE_EXPIRED` | `expirado` (novo) | — | selo "Boleto vencido" + tarefa; **não fecha jornada** (B49) |
| `PURCHASE_CANCELED` | `cancelado` | — | teto cai · tarefa · timeline |
| `PURCHASE_REFUNDED` | `reembolsado` | — | teto cai · tarefa · cancela régua e fila de ligação |
| `PURCHASE_CHARGEBACK` | `estornado` | — | idem, severidade vermelha |
| `PURCHASE_PROTEST` | `estornado` | — | idem |
| `PURCHASE_OUT_OF_SHOPPING_CART` | `em_analise` | — | só registro |
| qualquer outro | `em_analise` + pendência | — | **D3** |

## A4. Migrations (rascunho comentado — o backend transforma em arquivo)

**`0083_estados_de_compra.sql` — SÓ valores de enum** (padrão da 0079: valor novo não pode ser *usado*
na mesma transação).

```sql
alter type status_pagamento add value if not exists 'boleto_gerado';
alter type status_pagamento add value if not exists 'expirado';
alter type status_pagamento add value if not exists 'atrasado';
```

**`0084_compra_maquina_de_estados.sql`**

```sql
-- (a) colunas do evento. Campo novo nasce vazio: linha antiga fica NULL e a tela
--     mostra "sem informação", nunca um evento inventado.
alter table pagamentos add column evento_hotmart text, add column evento_em timestamptz;
create index idx_pagamentos_produto_jornada on pagamentos (jornada_id, produto_id);

-- (b) log append-only, espelho de jornadas_transicoes (0004)
create table pagamentos_transicoes (
  id uuid primary key default gen_random_uuid(),
  pagamento_id uuid not null references pagamentos(id) on delete cascade,
  de_status status_pagamento, para_status status_pagamento not null,
  evento_hotmart text, ocorrido_em timestamptz not null default now());
create index idx_pag_trans on pagamentos_transicoes (pagamento_id, ocorrido_em desc);
-- RLS: select para interno; SEM policy de update/delete (é livro-razão).

-- (c) trigger BEFORE UPDATE em pagamentos: registra a transição e RECUSA
--     rebaixamento quando new.evento_em < old.evento_em (D7).

-- (d) teto vigente (D5), stable + security definer + set search_path:
--     app.nivel_pago_vigente(uuid) = max(1|2|3 por produtos.tipo) dos pagamentos
--     da jornada com status='aprovado'.

-- (e) view do estado por produto — o que Ficha e Clientes leem (D9)
create view vw_pagamentos_jornada with (security_invoker = true) as
  select p.jornada_id, pr.tipo, p.status, p.evento_hotmart, p.evento_em, p.valor, p.pago_em
    from pagamentos p join produtos pr on pr.id = p.produto_id;
revoke all on vw_pagamentos_jornada from public, anon;   -- lição da 0065b/0070(c)
grant select on vw_pagamentos_jornada to authenticated;

-- (f) processar_pagamento_hotmart: `create or replace` a partir do corpo VIGENTE
--     de 0011:141-227, MESMA assinatura de 11 parâmetros — o evento entra por
--     `p_bruto->>'event'`. Acrescentar parâmetro criaria SOBRECARGA ambígua e
--     quebraria em runtime (armadilha já catalogada). Muda só o miolo: lê o
--     evento, grava evento_hotmart/evento_em, o `do update` só troca o estado
--     quando excluded.evento_em > pagamentos.evento_em, e produto divergente na
--     mesma transação vira observacao + return (D10).
```

**`0085_gate_e_aviso_de_pagamento.sql`**

```sql
-- (a) TETO por dinheiro em app.valida_transicao_jornada — `create or replace` do
--     corpo VIGENTE de 0004:73-99, preservando piso, ordem, tabela de transições
--     e o auto-'ganha'. Só quando new.etapa <> old.etapa: exige
--     app.nivel_pago_vigente(new.id) >= 1|2|3 para sessao_contratada|
--     croqui_contratado|holding_contratada. Mensagem genérica (trigger BEFORE
--     fala antes da RLS — não vira oráculo). Nenhuma linha existente é tocada (B52).

-- (b) app.reage_pagamento_negativo — AFTER UPDATE OF status, quando new.status in
--     ('cancelado','reembolsado','estornado','expirado'):
--       · eventos_timeline tipo 'pagamento_alerta' {produto, de, para, evento}
--       · tarefas (origem='sistema'), idempotente: não duplica tarefa aberta do par
--       · reembolsado/estornado → cancela ligacoes_ia 'na_fila' e
--         mensagens_agendadas não enviadas (mesmo mecanismo do arquivar, 0086)
--     security definer + set search_path (regra da 0070(d)).

-- (c) configuracoes: 'pagamento.dias_boleto_vencido' = 7 (editável em Admin)
```

**Roteiro `scripts/verificacao-0083-0085.sql`** — 12 asserções em bloco `DO` com `RAISE EXCEPTION` e
**rollback** (padrão "testar venda com rollback"):

| # | Prova |
|---|---|
| 0 | contagem ANTES: jornadas com `etapa` acima do teto vigente (`A MEDIR`; > 0 → B52) |
| 1 | `BILLET_PRINTED` com `purchase.status=APPROVED` no payload → grava `boleto_gerado` (D1) |
| 2 | `COMPLETE` depois de `BILLET_PRINTED` → `aprovado` + etapa avança |
| 3 | reentrega antiga de `BILLET_PRINTED` → **não** rebaixa (D7) |
| 4 | `REFUNDED` → teto cai; `nivel_pago` **não** cai; tarefa + timeline criadas |
| 5 | com teto 1, `update jornadas set etapa='croqui_contratado'` → recusado (D5) |
| 6 | evento desconhecido → `em_analise` + `processado_em` NULL (D3) |
| 7 | `product.id` não mapeado → pendência com `processado_em` NULL (D8) |
| 8 | mesma `transaction` com outro produto → recusada (D10) |
| 9 | `anon`/`authenticated` sem EXECUTE na RPC e sem SELECT na view |
| 10 | duas grafias (`COMPLETED`, `PRINTED_BILLET`) caem no mesmo estado |
| 11 | idempotência: mesmo `evento_externo_id` 2× → 1 linha em `pagamentos_transicoes` |
## A5. Simulador e testes

`scripts/simular-hotmart.ts` (**novo**): assina com o `HOTMART_WEBHOOK_SECRET` local e posta em
`http://localhost:3000` — `--produto sv|croqui|holding --evento <NOME> [--transacao X] [--roteiro
boleto-pago|reembolso|fora-de-ordem|desconhecido|duplicado]`. **Recusa host que não seja localhost.**
Vitest (`src/server/pagamentos/hotmart.test.ts`, novo): 11 eventos × 2 grafias, precedência evento >
`purchase.status`, fora de ordem, desconhecido — **sem banco** (a parte de banco é provada pelo
roteiro SQL, como manda o cabeçalho do `ci.yml`).

# FRENTE B — Status do croqui, arquivar processo, vocabulário do advogado

## B1. As seis fases (o que o enum não conta)

| Fase | De onde vem | Selo (ícone · rótulo · cor) |
|---|---|---|
| `sem_croqui` | nenhuma linha em `croquis` | — · "Croqui não iniciado" · neutro |
| `rascunho` | `croquis.status='rascunho'`, sem cálculo | lápis · "Em rascunho" · âmbar |
| `calculado` | existe `croqui_calculos` | calculadora · "Calculado" · azul |
| `fixado` | `croqui_calculos.atual = true` | alfinete · "Versão fixada" · azul |
| `pronto` | `croquis.status='pronto'` | check · "Pronto para apresentar" · verde |
| `apresentado` | `croquis.status='apresentado'` | apresentação · "Apresentado" · verde |

Dois **fatos** que não são fase e ganham chip próprio ao lado: `exportado` (evento
`croqui_exportacao`) e `narrado` (`croqui_narrativa`, hoje inativo → `SeloStub`).

**D11 — o enum `status_croqui` NÃO muda.** Ele é o estado editorial do documento e tem
`uniq_croqui_pronto` pendurado nele. A fase é derivada.

**D12 — a fase vem de uma view, não da timeline.** `vw_croqui_estado` (jornada_id, croqui_id, fase,
tem_calculo, versao_fixada, exportado_em, apresentado_em). A leitura por timeline já mentiu uma vez
(incidente da 0070: fixar versão anunciava "croqui pronto"); manter a derivação em quatro filtros de
TypeScript é insistir no erro. Uma view = uma verdade, e a lista de Clientes lê a fase com um join
em vez de N chamadas.

**D13 — `sinais.croquiStatus` continua tri-estado.** Ganha o campo novo `croquiFase`; quando a fonte
não carrega (payload antigo), fica `null` = sem informação, e `derivarPasta()` cai no comportamento
de hoje. Nenhuma tela passa a inventar fase.

**D14 — "Andamentos do croqui" na Ficha.** Componente `AndamentosCroqui` lendo
`eventos_timeline` nos tipos `croqui`, `croqui_calculo`, `croqui_exportacao`, `croqui_narrativa`,
**decrescente por data** (padrão PJe/e-SAJ), cada item com data visível. Sem evento = 1 linha + 1 ação.

## B2. Arquivar processo

**D15** — "Arquivar" grava `desfecho='congelada'` com motivo: é o único desfecho que não afirma
resultado comercial e é reversível (`perdida`/`descartada`/`ganha` seguem no combo). Ver B53.
**D16** — ação reversível, **sem modal**: botão "Arquivar processo" na Ficha e no cartão de Clientes →
gaveta curta (motivo obrigatório) → toast "Arquivado · Desfazer" por 10 s. `ConfirmarAcao` não entra
(regra §8 do DS contra "Tem certeza?"). **D17** — os efeitos colaterais são reversíveis por
construção: arquivar marca as linhas com `motivo_cancelamento='jornada_arquivada'` e desarquivar
reverte **exatamente** essas; sem o marcador, desfazer seria adivinhação.

| Efeito | Ao arquivar | Ao desfazer |
|---|---|---|
| `mensagens_agendadas` não enviadas | canceladas com o marcador | reagendadas se `enviar_em > now()` |
| `ligacoes_ia` em `na_fila` | canceladas com o marcador | **não** re-enfileira (discar depois é ligação fora de contexto) |
| `tarefas` abertas de origem `sistema` | mantidas, com selo "processo arquivado" | — |
| `links_publicos` | **não revoga** (B51) | — |
| lista principal de Clientes | sai; aparece em "Arquivados" | volta |

**`0086_arquivar_e_croqui.sql`** (rascunho): `vw_croqui_estado` (com `revoke`/`grant` nomeados) ·
`motivo_cancelamento` em `mensagens_agendadas` e `ligacoes_ia` · `app.arquivar_jornada(p_jornada_id,
p_motivo)` e `app.desarquivar_jornada(p_jornada_id)` como RPC atômicas `security definer` (a régua e
a fila não podem ser tocadas por três `await` separados do Next) · filtro `desfecho` em
`processarFilaRegua` — o furo do reconhecimento: **grep por `desfecho` naquele arquivo dá 0**.
Roteiro `scripts/verificacao-0086.sql`: 7 asserções, com rollback.

## B3. Vocabulário — rótulo de tela sem renomear conceito

**D18 — o glossário manda, então o glossário cresce.** Os quatro termos que o advogado brasileiro
usa não existem no `Glossario.md`: em vez de inventar sinônimo na tela, **acrescentar as entradas** e
mapear em `src/lib/vocabulario.ts`. Nada muda no banco nem no código.

| Conceito (código/banco) | Rótulo de tela (Fase 8) | Fonte |
|---|---|---|
| `jornadas` / "jornada" | **Processo** | PJe/Clio/Projuris; nunca "pipeline", "funil", "deal" |
| `eventos_timeline` / "timeline" | **Andamentos** | PJe/e-SAJ; nunca "atividade", "log" |
| `etapa` / as 3 sessões | **Fase** | ADVBOX (filtro por fase processual) |
| `tarefas.vence_em` | **Prazo** (selo próprio, separado do status) | ADVBOX/Astrea |
| `desfecho='congelada'` | **Arquivado** | ordem do João |

Gate de aceite: `grep -ri "pipeline\|funil\|\bdeal\b"` em texto visível de `src/app` e
`src/components` = 0.

# FRENTE C — Usabilidade, acessibilidade e mobile (o grosso da fase)

## C1. Sistema de status unificado

**D19 — um catálogo, um componente.** `src/lib/estados/catalogo.ts` (novo) é o dicionário único de
todo estado que vira selo (`croqui`, `pagamento`, `processo`, `prazo`, `presenca`, `mensagem`), cada
entrada `{ rotulo, icone, tom, explique }`; `ui/SeloEstado.tsx` (novo) o consome — **nenhuma tela
escolhe `tom` na mão a partir da Fase 8**. É "cor + ícone + texto, nunca só cor" virando impossível
de violar, não uma recomendação.

**D20 — cartão de cliente diz o estágio em 1–2 palavras.** `CartaoJornada` ganha o rótulo textual do
estágio (padrão Clio "matter status") + o `SeloEstado` do croqui + "o que falta / travado por quê" em
uma linha, sem abrir a Ficha. `Trilho variante="sessoes"` fica na Ficha; lista usa `compacto`.

**D21 — cabeçalho de status fixo no topo da Ficha, antes das abas** (padrão Astrea/Clio): nome ·
Fase · selo do croqui · selo de pagamento · próximo prazo. É o que o advogado procura primeiro.

## C2. Acessibilidade para usuário 55+

**D22 — escala de texto do usuário, não do designer.** Três tamanhos (`Padrão` 14 px · `Grande` 16 px
· `Maior` 18 px) trocando **uma** variável raiz `--escala-texto`, ao lado do `TemaToggle`, em
`localStorage`. Resolve o conflito real (C2): o João mediu a V2 e pediu 14 px, a pesquisa exige piso
de 16 px para 55+. `.area-publica` continua em 17 px.

| Item | Regra da Fase 8 | Como se mede |
|---|---|---|
| `font-light` | proibido | `grep` = 0 |
| Contraste texto | ≥ 4,5:1 (mantém); status e prazo ≥ 7:1 | varredura de DOM da Fase 7, reexecutada |
| Contraste não-texto | ≥ 3:1 nos pontos do `Trilho` e ícones de `SeloEstado` | varredura estendida a `fill`/`stroke` |
| Alvo | ≥ 44 px; **gap ≥ 8 px** entre alvos adjacentes em tabela densa | inspeção nas 3 tabelas do Admin |
| Foco | visível e **não obscurecido** (WCAG 2.4.11) com gaveta/barra fixa aberta | Tab em toda tela com gaveta aberta |
| Movimento | `prefers-reduced-motion` em tudo que a fase criar | hoje só 3 arquivos têm o guard |
| Status assíncrono | `aria-live`/`role="status"` em toda troca de selo | leitor de tela |
| Gesto | nenhuma ação **só** por swipe/long-press | `grep` de handler = 0 |

## C3. Mobile de verdade

| # | Regra | Aceite |
|---|---|---|
| M1 | Barra inferior fixa com os **5 itens** do menu, ícone **+ rótulo** | `NavInferior` visível < `md`; lateral some |
| M2 | Tabela vira cartão | **0 scroll horizontal a 360 px** (piso novo; a Fase 7 media 390) |
| M3 | Lista → detalhe | toque no cartão abre a Ficha; sem tabela rolável |
| M4 | Formulário 1 coluna abaixo de `sm` | nenhum `grid-cols-2` ativo abaixo de `sm` |
| M5 | Ação primária no polegar | `BarraAcaoMobile` fixa no rodapé, `nao-imprimir`; CTA visível no 1º paint |
| M6 | `Gaveta` em tela cheia no mobile, com "Voltar" (não "X") | nenhum modal > 80 % da viewport fora da `Gaveta` |
| M7 | Harmonia | mesmo rótulo e mesma ordem de ações em desktop e mobile |

## C4. Componentes e tokens

| Peça | Onde vive | Novo/alterado |
|---|---|---|
| `SeloEstado` | `src/components/ui/SeloEstado.tsx` | **novo** — o único selo de status |
| catálogo de estados | `src/lib/estados/catalogo.ts` | **novo** |
| `Prazo` | `src/components/ui/Prazo.tsx` | **novo** — data-limite com tom próprio, separado do status |
| `Tabela` | `src/components/ui/Tabela.tsx` | **novo** — `colunas` + `renderCartao`, uma fonte para os dois layouts |
| `NavInferior` | `src/components/shell/NavInferior.tsx` | **novo**, consome `ITENS_NAVEGACAO` |
| `BarraAcaoMobile` | `src/components/ui/BarraAcaoMobile.tsx` | **novo** |
| `EscalaTexto` | `src/components/shell/EscalaTexto.tsx` | **novo** (D22) |
| `Selo`, `Trilho`, `Estado`, `Gaveta` | `src/components/ui/*` | alterados (ícone obrigatório, foco, tela cheia) |
| `--escala-texto`, `--alvo-gap` | `src/app/globals.css` | tokens novos |

## C5. Telas, por prioridade

| Prioridade | Tela | O que o advogado faz ali | Ação primária (visível sem rolar) | Falta hoje |
|---|---|---|---|---|
| 1 | `/hoje` | ver o que precisa dele agora | a ação do bloco mais urgente | KPI/alerta no canto superior esquerdo (F-pattern); bloco de pagamento revertido |
| 1 | `/clientes` | achar um processo e ver em que pé está | abrir o processo | rótulo de estágio no cartão · filtro por **Fase** · selo de croqui · "Arquivados" |
| 1 | `/jornadas/[id]` | tudo sobre um cliente | a ação do passo atual | cabeçalho de status fixo · Andamentos · Arquivar · selo de pagamento |
| 2 | `/agenda` | ver e mexer nas sessões | agendar/reagendar | cartão no mobile · prazo com selo próprio |
| 2 | `/mensagens` | ver o que sai e o que chegou | — (leitura) | estado por mensagem no catálogo único |
| 2 | `/admin` | configurar | por aba | densidade das tabelas · gap entre alvos · 3 produtos sem ID em destaque |
| 3 | `/p/*` | **o cliente** usa | o CTA da tela | já revisado na Fase 7 r2 — só regressão |
| 3 | `/croquis/[id]` | calcular/fixar/apresentar | "Calcular croqui" / "Fixar versão" | selo de fase no topo |

**Critério de aceite por tela (mensurável, os 5 juntos):** (1) axe 0 `serious`/`critical`;
(2) capturas 1440×900 **e** 390×844, nos dois temas, anexadas ao diário; (3) ação primária visível no
primeiro paint sem rolagem; (4) `document.body.scrollHeight` ≤ 1080 px a 1440 (lista declara a
exceção **com o número**) e **0 scroll horizontal a 360 px**; (5) INP da interação principal medido e
não pior que a Fase 7.

## C6. Ferramentas

**D23 — três camadas, e cada uma prova o que consegue.**

| Camada | Ferramenta | Onde roda | Por quê |
|---|---|---|---|
| estática | `eslint-plugin-jsx-a11y` **explícito** no `eslint.config.mjs` (regras em `error`) | `npm run lint` → **CI já roda** | `eslint-config-next` empacota as regras mas não as declara; explícito é auditável |
| componente | `vitest-axe` + `jsdom` sobre `SeloEstado`/`Trilho`/`Campo`/`Tabela`/`NavInferior` | `npm test` → **CI já roda** | sem navegador, sem banco, custo ~0 |
| página inteira | `@axe-core/playwright` em `scripts/a11y.mjs` | **local**, contra `next dev` + seed de demo | ver CONFLITO C1 |

**D24 — skill.** Instalar **só** `addyosmani/web-quality-skills@accessibility` (50,7 K installs), lendo
o `SKILL.md` inteiro antes (regra do `docs/SKILLS.md`), e documentar na tabela de instaladas.
**Não** instalar `wshobson/agents@responsive-design`: autor sem org oficial e conteúdo genérico que
colidiria com o DS próprio — mesma ressalva que já reprovou `tailwind-design-system`.

---

## D. CONFLITO — o que colide com o que já existe

| # | Conflito | Resolução |
|---|---|---|
| C1 | João pediu `@axe-core/playwright` **no CI**; o CI **não tem banco** (cabeçalho do `ci.yml`) e toda tela interna exige sessão | axe de página roda **local** (`scripts/a11y.mjs`, resultado no relatório do Fable); no CI ficam lint a11y + `vitest-axe`. Prometer axe de página no CI seria trava verde que não prova nada |
| C2 | Pesquisa exige corpo ≥ 16 px; a V2 do DS baixou para 14 px **a pedido do João** | D22: escala do usuário, default 14, "Grande" = 16 |
| C3 | "Três produtos = três webhooks" (ordem literal) × um endpoint com roteamento | D2: três produtos na Hotmart apontando para a mesma URL — a configuração dele continua sendo três |
| C4 | 0004 diz, em comentário, "estorno **não** rebaixa" × "reembolso REVERTE" (ordem) | D5/D6: piso histórico não cai, **teto vigente** cai. Trava e avisa, não apaga |
| C5 | Fase 7 fechou mobile a 390 px; a pesquisa pede 360 px | piso novo = 360 px; re-medir as 31 telas |
| C6 | Pesquisa sugere selo de croqui "rascunho/desenho/aprovação/aprovado" | D11/B1: os estados **reais** são outros seis; usar os do banco, não os do exemplo |

## E. BLOQUEIO — decisões que não são técnicas (hipótese conservadora já aplicada)

| # | Pergunta para o João / Dra. Elaine | Hipótese aplicada por padrão |
|---|---|---|
| **B48** | Reembolso da SV **depois** da sessão realizada: o que acontece? | Etapa **não** regride, teto cai, jornada continua aberta, tarefa + selo vermelho. Nada é apagado |
| **B49** | Boleto vencido (`EXPIRED`) = processo perdido? | **Não.** Selo "Boleto vencido" + tarefa de cobrança em D+7 (`pagamento.dias_boleto_vencido`). Fechar jornada continua sendo ato humano |
| **B50** | Chargeback revoga os links públicos do cliente? | **Não.** Só selo + tarefa. Revogar é botão, nunca automático |
| **B51** | Arquivar revoga os links já enviados? | **Não.** Caixa "revogar também os links enviados" nasce **desmarcada** |
| **B52** | Teto por dinheiro vale para as jornadas que **hoje** já estão acima do nível pago? | **Não.** O trigger só julga transições novas; nenhuma linha existente é tocada. Contagem obrigatória no passo 0 do roteiro (`A MEDIR`) |
| **B53** | "Arquivar" = `congelada`? A Dra. Elaine diz "arquivar" ou "suspender"? | `congelada`, rótulo "Arquivado" |
| **B54** | Order bump / assinatura pode mandar a mesma `transaction` com outro produto? | Recusa e registra pendência; nunca sobrescreve o produto (D10) |
| **B55** | Default da escala de texto para a conta da Dra. Elaine: `Padrão` ou `Grande`? | `Padrão` (14 px), como o João aprovou; ela troca em 1 clique |

## F. Trava do Fable — o que o orquestrador tem de verificar

**Segurança** — webhook segue fail-closed sem secret (503) e `timingSafeEqual`; evento desconhecido
**não** aprova; `revoke`/`grant` **nomeados** nas duas views novas (a 0064 provou que `grant` sem
`revoke` não restringe nada); `set search_path` em toda função nova; `pagamentos_transicoes` sem
policy de update/delete; `app.arquivar_jornada` só interno; simulador recusa host não-local;
pentester obrigatório (toca pagamento, webhook e PII).

**Escalabilidade** — `idx_pagamentos_produto_jornada` existe; a lista de Clientes lê fase de croqui e
estado de pagamento por **join**, não por N chamadas (contar as queries por tela antes e depois);
`app.nivel_pago_vigente` só é chamada quando a etapa muda.

**Solidificação** — as 12 asserções do roteiro 0083–0085 e as 7 do 0086 rodadas **contra o banco**,
com rollback, saída colada; vitest verde (baseline **581**, esperado subir); `npm run verificar`.

**UX** — capturas 1440×900 e 390×844 nos dois temas das 8 telas; **grayscale** de Hoje, Clientes e
Ficha (item 19 da pesquisa); axe local 0 `serious`/`critical`; Tab sem mouse com gaveta aberta.

**Otimização** — baseline do `CONTINUAR-AQUI` (Fase 7 r3, `next dev`, 1440×900, cache frio):
`/hoje` **6.587 KB** · `/clientes` **5.226 KB** · Ficha **5.538 KB** · `/croquis/[id]` **5.282 KB** ·
`/admin` **5.799 KB**; densidade Hoje/Clientes/Agenda/Mensagens/Admin **900 px**, Ficha **917 px**,
`/admin#repertorio` **959 px**. **Nenhuma tela pode piorar.** O que a fase **remove**: quatro
derivações de estado de croqui espalhadas viram uma view; a escolha de `tom` de selo por tela vira um
catálogo; `<table>` duplicada com versão mobile vira um `Tabela`. Otimização sem número medido não
entra (regra 3 do DS §11).

## G. Divisão de tarefas — fronteiras de arquivo disjuntas

**Rodada 0 · UX1 (design system e ferramenta), sozinho e curto.** Entrada: §C deste documento +
`docs/DESIGN-SYSTEM.md` + a pesquisa. Saída: tokens `--escala-texto`/`--alvo-gap`; `SeloEstado`,
`Prazo`, `Tabela`, `BarraAcaoMobile`, `NavInferior`, `EscalaTexto`; catálogo de estados; vocabulário
(D18) + as 4 entradas novas no `Glossario.md`; `eslint-plugin-jsx-a11y` explícito; `vitest-axe`;
`scripts/a11y.mjs`; skill instalada + `docs/SKILLS.md`; §12 novo no DS.
*Permitido:* `src/app/globals.css` · `components/{ui,shell}/**` · `lib/vocabulario.ts` ·
`lib/estados/**` · `docs/{DESIGN-SYSTEM,SKILLS}.md` · `brain/03 - Dominio/Glossario.md` ·
`eslint.config.mjs` · `.github/workflows/ci.yml` · `package.json` · `scripts/a11y.mjs`.
*Não tocar:* nenhuma tela, nenhum `src/app/(app)/**`, nenhuma migration.
*Aceite:* `npm run verificar` verde · `vitest-axe` 0 violação nos 5 componentes · captura dos 3
tamanhos de texto · nenhum consumidor existente quebrado.

**Rodada 1 — quatro agentes em paralelo (uma mensagem, quatro chamadas).**

| Agente | Arquivos permitidos | NÃO tocar | Aceite |
|---|---|---|---|
| **PAG** back · pagamento | `migrations/008{3,4,5}_*.sql` · `scripts/verificacao-0083-0085.sql` · `scripts/simular-hotmart.ts` · `server/pagamentos/**` · `api/webhooks/hotmart/route.ts` · `api/admin/webhooks/**` · `components/admin/abas/{ProdutosAba,PendenciasAba}.tsx` · `scripts/seed-*.ts` | `components/ui/**`, croqui, telas, `lib/pasta/**` | 12 asserções provadas com saída colada · vitest novo · simulador roda os 5 roteiros · `produto_nao_mapeado` visível em Admin → Pendências com a ação certa |
| **CRQ** back+front · croqui e arquivar | `migrations/0086_*.sql` · `scripts/verificacao-0086.sql` · `lib/pasta/{sinais,derivar,trilho}.ts` · `components/croqui/**` · `components/ficha360/{CabecalhoFicha,CartaoCroqui,TimelineAba,AndamentosCroqui}.tsx` · `api/jornadas/[id]/{etapa,arquivar}/route.ts` · `server/jornadas.ts` · `server/regua/processar.ts` · `server/ligacao-ia/fila.ts` | `components/ui/**`, `lib/vocabulario.ts`, `lib/estados/**` (do UX1), demais arquivos de `ficha360` | 7 asserções provadas · arquivar/desarquivar reversível medido no banco antes e depois · fase do croqui idêntica em Ficha e Clientes |
| **UX2** telas de uso diário | `app/(app)/{hoje,clientes,jornadas}/**` · `components/painel/**` · `components/esteira/**` · `components/ficha360/**` **exceto os 4 do CRQ** | `ui/**`, `shell/**`, migrations, `server/**` | os 5 critérios de C5 nas 3 telas · filtro por Fase e aba "Arquivados" |
| **UX3** telas de apoio e mobile | `app/(app)/{agenda,mensagens,admin}/**` · `app/(publico)/**` · `components/{agenda,comunicacao,publico}/**` · `components/admin/**` **exceto ProdutosAba/PendenciasAba** | `ui/**`, `shell/**`, migrations | os 5 critérios de C5 · 0 scroll horizontal a 360 px nas 31 telas · `/p/*` sem regressão da Fase 7 r2 |

**Rodada 2 · `security-pentester` (obrigatório).** Superfície ampliada: webhook com roteamento por
produto e caminho de estado novo, RPC `arquivar_jornada`/`desarquivar_jornada`, duas views novas,
teto no trigger da máquina de estados, simulador com segredo local, `localStorage` da escala de
texto. Depois: trava do Fable (§F).


## H. Ordem de execução

1. **Medir antes** (orquestrador, SQL): jornadas com etapa acima do teto vigente · `pagamentos` por
   status · croquis por fase · jornadas por desfecho. Item 1 > 0 → confirmar B52 com o João.
2. **Rodada 0 · UX1 sozinho** — tokens e componentes são dependência de UX2/UX3; deixar para depois
   garante conflito de arquivo e retrabalho.
3. **Rodada 1 · PAG ‖ CRQ ‖ UX2 ‖ UX3** (uma mensagem, quatro chamadas).
4. **Rodada 2 · pentester → Fable.** Reprovou? Roteia para o dono do arquivo, não para todos.
5. Push no `infra` só depois da aprovação.

## I. Os 5 critérios do Fable

| Critério | O que este plano garante |
|---|---|
| **Segurança** | evento desconhecido nunca aprova (D3); estado vem do evento, não do payload (D1); teto por dinheiro vira invariante de banco (D5); `revoke`/`grant` nomeados e `search_path` fixo em tudo que nasce; pentester obrigatório |
| **Escalabilidade** | índice `(jornada_id, produto_id)`; fase de croqui e estado de pagamento por join (mata N+1 na lista); função de teto só roda na troca de etapa; `Tabela` única em vez de dois layouts |
| **Solidificação** | 19 asserções SQL com rollback; `status_pagamento` passa a ter os estados que a realidade tem; `pagamentos_transicoes` append-only; unicidade de produto por transação (D10); vitest sobe de 581 |
| **UX** | estágio em 1–2 palavras no cartão; status fixo no topo da Ficha; Andamentos datados e decrescentes; arquivar com desfazer; escala de texto do usuário; mobile com barra inferior rotulada e 0 scroll a 360 px |
| **Otimização** | 4 derivações de croqui → 1 view; escolha de `tom` por tela → 1 catálogo; tabela duplicada → 1 componente; **nenhuma tela pode piorar** contra os números do §F, e otimização sem número medido não entra |
