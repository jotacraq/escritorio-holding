# ARQUITETURA — FASE 13

**A tela de condução vira uma dobra só, e a sessão passa a ter fim escrito.**

> Autor: arquiteto · 19/09/2026 · Base: HEAD `e92d322`, migrations aplicadas até 0124.
> Insumo: `tmp/squad/tela-sessao-abas-e-relatorio.md` (pedido literal do Marcio + medições
> do orquestrador). Este documento **não contém código de produção** — a migration abaixo
> é rascunho comentado, para o `backend-engineer` transformar em arquivo.

---

## 0. O que foi MEDIDO por mim hoje (19/09), e o que veio do briefing

Medi no banco de produção `fcfsnqqaphtamhrpuyoh` via PostgREST com o `SUPABASE_SERVICE_ROLE_KEY`
do `.env.local` do projeto — **só agregados, nenhuma evidência literal impressa**.

> 🔴 Correção de fato a registrar: o `CONTINUAR-AQUI.md` diz *"não existe `.env.local` nesta
> máquina"*. **Existe** (11 chaves, incluindo service role). A afirmação está desatualizada e
> foi o motivo registrado para não rodar a bancada do copiloto.

### 0.1 O que existe de sinal para pontuar uma sessão

| Fonte | Medido | Serve de score? |
|---|---|---|
| `copiloto_sugestoes` (total) | **369** em 3 sessões (70 · 178 · 121) | — |
| `copiloto_sugestoes.desfecho` | **366 `expirada` · 3 `aceita` · 0 `ignorada`** (99,2% expirada) | ❌ **não.** Ninguém usa aceitar/ignorar. Um score baseado nisso daria a mesma nota para toda sessão. |
| `conteudo.cobriu_no_bloco` (o "acerto" da 0119) | **11 itens** no total, em **8 de 369** sugestões, presentes em **1 de 3** sessões | ❌ **não.** Campo praticamente vazio em produção. |
| `conteudo.falta_no_bloco` (o "erro") | 231 itens em 72 sugestões — mas **205 numa única sessão**, 17 e 9 nas outras | ⚠️ instável. Serve de LISTA, não de nota. |
| `bloco_id` distintos por sessão | **4/13 · 9/13 · 6/13** partes do roteiro `sessao_viabilidade` v5 | ✅ **sim.** Fração verificável, com denominador fixo. |
| `inventario_acumulado` | **0 · 31 · 70** itens | ✅ sim, como fato. |
| `confianca` das sugestões | média 0,636 (min 0,30 · máx 0,90); por sessão 0,52 · 0,66 · 0,67 | ✅ sim, como fato. |
| `campos_evidencia_nao_conferida` não vazio | **223 de 369 = 60,4%** | ✅ sim — mas é saúde da **IA**, não da condução. |
| `ficha_acumulada` | **0 itens em 3 de 3 sessões** (a Ficha nunca teve conteúdo em produção) | — (ver CONFLITO C-1) |
| `resumo_acumulado` | `{}` em 3 de 3 sessões | — |
| `observacao.tipo` | inferência 178 · fato 137 · hipótese 11 · recomendação 4 | ✅ sim, como agrupamento. |
| `sessoes_copiloto` | **3 linhas, todas `encerrado`, todas com `encerrado_em`** | — |
| `sessoes_viabilidade.resultado` | **NULL em 4 de 4** | ❌ não dá para cruzar score com venda. |
| duração real (iniciado→encerrado) | 3h03 · 1h54 · 2h01 | ✅ sim, como fato. |
| `sessoes_copiloto_segmentos` | **5.190** linhas | — |
| `conteudo` (bytes) | média 834 · máx 1.602 | — |

Do briefing (não re-medido): v7 ativa, 299 execuções, **49 truncadas (16,4%)**, saída média 691,
p99 1.380, `max_tokens`=1.400, `timeout_ms`=20.000, latência máx 19.396 ms.

### 0.2 Fatos de código que mudam o desenho

- **A COL 3 tem duplo-scroll HOJE, no ramo sem Ficha.** `PainelCopiloto.tsx:405` usa
  `<Coluna className="gap-2" rolavel …>` (célula com `overflow-y-auto`) e dentro dela
  `PainelTranscricao` tem a própria região `min-h-0 flex-1 overflow-y-auto`. Duas barras
  pelo mesmo conteúdo quando o inventário (`shrink-0`) empurra. É o defeito que a F3 (17/09)
  fechou na COL 1 e reabriu aqui — e é a causa mecânica da reclamação do dono
  ("estão em conflito, ambos lá embaixo").
- **As abas já existiram e foram REMOVIDAS de propósito.** `ColunaTranscricaoInventario` foi
  apagada na F4 (18/09); a migration **0122 grava a justificativa no cabeçalho**:
  *"deixa de ser transcrição+inventário em ABAS (que a advogada nunca clica)"*. → CONFLITO C-1.
- **`RodapeTranscricao` (F4) já existe, testado, e está DESLIGADO** (`rodape_transcricao=false`).
  Ele já é indicador tricolor de saúde + última fala + overlay `role="dialog"` com `Esc`.
  Foi desligado porque, com a Ficha off, ele **duplicava** a transcrição da COL 3.
- **`ui/Abas` não serve para a COL 3**: renderiza TODOS os painéis (o inativo fica montado) e
  cada botão é `min-h-11` (44 px) + `border-b` — custo vertical e poller/scroll vivo fora de vista.
- **`--escala-texto` é variável MORTA**: declarada 3× em `globals.css` (14/16/18 px) e
  consumida **0×**. Quem faz trabalho é `--fator-escala` (1 / 1,1429 / 1,2857), e ele multiplica
  **só `--text-*`**. Consequência dura para a seção C: **na escala Grande a fonte cresce 28,6%
  e `min-h-11`/`min-h-[3.25rem]`/`gap-2` NÃO crescem** — o conteúdo pode estourar a reserva.
- **`marcarEncerrada` já é o portão de idempotência**: `.in('estado', [...])` + `maybeSingle`
  devolve `null` quando nada mudou. Tudo que for pendurado depois dele roda **uma vez por sessão**,
  nos três caminhos (manual, duração máxima, retenção infinita).
- **"Relatório" já é um termo ocupado.** `Glossario.md` define **Relatório da SV** = documento
  que a advogada preenche à mão (`relatorios_sessao`, `RelatorioAba.tsx`, item de pasta
  `relatorio_sv`). O que o Marcio pediu é outra coisa. → seção D.1.
- **O comentário do mosaico cita `min-h-[22rem]` que não existe mais** no `className`
  (`PainelCopiloto.tsx:315`). Comentário órfão — corrigir junto.

---

## A. Abas — o desenho da COL 3 e da linha de saúde

### A.1 O conceito

O dono disse duas coisas que parecem a mesma e não são:

1. *"transcrição e inventário em conflito … divididos em tabs"* → é **layout**.
2. *"a transcrição é apenas para captar com clareza se o bot está operante"* → é **saúde**.

Se a transcrição vira aba e nada mais muda, o **sinal de saúde some** sempre que ela estiver
no Inventário ou na Ficha — o pedido 2 é traído pelo pedido 1. Se a transcrição vira só rodapé
(mundo que o `RodapeTranscricao` desenhou), o pedido 5 é traído: ele quer a transcrição
**rolável, na primeira dobra, descendo com a fala** — não só num overlay.

**A separação certa é: o SINAL é permanente, o CONTEÚDO é aba.**

| | Onde mora | Sempre visível? |
|---|---|---|
| Saúde da captura (🟢 ouvindo / 🟡 sem áudio Ns / 🔴 sem captura Ns) + última fala | Rodapé, linha 2 do grid, 1 linha | **sim**, em qualquer aba |
| Transcrição rolável com auto-scroll | Aba da COL 3 | não |
| Inventário acumulado | Aba da COL 3 | não |
| Ficha do cliente | Aba da COL 3, **aba de estreia** | não (ver C-1) |

### A.2 A decisão, com as três alternativas e por que cada uma cai

| Alternativa | Por que NÃO |
|---|---|
| Sub-aba dentro da `FichaCliente` | A Ficha já tem duas regiões internas (área fixa medida por container-sombra + região rolável). Enfiar aba dentro dela cria a terceira região e mexe na medição que o Fable consertou na F4-1 — o bug do `scrollHeight(614) ≠ clientHeight(590)`. Risco alto, ganho zero. |
| Tudo em overlay do `RodapeTranscricao` | Mata o pedido 5 (transcrição na primeira dobra). E mantém a transcrição escondida atrás de um clique que a advogada, medido pelo próprio time, não dá. |
| `ui/Abas` genérico na COL 3 | 44 px de faixa + painéis inativos montados (poller/scroll vivos) + moldura de cartão. Custo vertical e de runtime injustificado numa célula de 28% de largura. |

**✅ Escolhido — COL 3 é uma célula, uma faixa de abas leve, UM painel rolável:**

```
┌ COL 3 ────────────────────────────────┐
│ [Ficha 4] [Transcrição] [Inventário 70]│  ← faixa, shrink-0, ~28px, sem borda de cartão
├────────────────────────────────────────┤
│                                        │
│   painel ATIVO — min-h-0 flex-1        │  ← a ÚNICA superfície de rolagem da célula
│   (o inativo NÃO existe no DOM)        │
│                                        │
└────────────────────────────────────────┘
```

Regras que isso cumpre, uma a uma:

- **`Coluna` da COL 3 fica no modo padrão (`rolavel={false}`, `overflow-hidden`)** nos dois ramos.
  Isso **fecha** o duplo-scroll vivo de hoje (§0.2) — a célula contém, o painel rola. Uma
  superfície por célula, o contrato do `Coluna.tsx` cumprido sem exceção.
- **Nenhum empilhamento novo.** Hoje o ramo sem Ficha empilha `PainelTranscricao` +
  `PainelInventario`. Passa a ter **um** painel. Contagem de regiões na COL 3: de 2 para 1.
- **Aba inativa desmonta.** Recupera exatamente a propriedade que o docblock de
  `PainelTranscricao` descreve (por isso `usuarioLogado` desce por prop e não por
  `useUsuarioAtual()` — a economia de query já foi paga e volta a render).
- **Contagem no rótulo da aba inativa.** `Inventário 70`, `Ficha 4` — nada fica escondido em
  silêncio. Aba sem item nenhum mostra o rótulo **sem número** (regra da casa: vazio é vazio,
  nunca `Inventário 0`).
- **Nada troca de aba sozinho.** Virada de bloco, sugestão nova, alerta — nenhum evento
  sequestra a aba. Só o clique dela.
- **Aba de estreia** = `Ficha` quando `copiloto_sessao.ficha_cliente=true`; `Transcrição`
  quando `false` (o estado de hoje, zero regressão para quem não ligou a chave). A aba `Ficha`
  simplesmente **não existe** na faixa quando `polling.ficha === null`.
- **Escolha não persiste** entre sessões nem entre recargas (v1). Persistir é decisão de
  produto, não de arquitetura — fica de fora.

### A.3 O rodapé deixa de ter transcrição

`RodapeTranscricao` perde o botão **"Abrir transcrição"** e o `OverlayTranscricao` inteiro
(**~60 linhas removidas**, incluindo o segundo ponto de montagem de `PainelTranscricao`).
Fica: ponto colorido + rótulo por extenso + última fala com `text-ellipsis` + `sr-only`
`aria-live="polite"`. Uma linha, sempre.

Isso é o que desfaz de vez o achado do Fable que desligou a chave em 18/09 ("transcrição
duplicada"): **depois desta fase não existe mais um segundo lugar que renderize a transcrição**,
então ligar a chave para de ser o estado intermediário que ninguém testou.

**A chave muda de nome porque o nome passaria a mentir.**
`copiloto_sessao.rodape_transcricao` descreveria um rodapé que não tem transcrição.
→ 0125 cria `copiloto_sessao.saude_captura` (**`true`**, nasce ligada: é reorganização de UI
sobre dado que já existe) e **deprecia por descrição** a chave antiga, sem apagá-la
(histórico preserva-se; `ativo=false` em vez de `delete` é a regra da casa). O código passa a
ler **só** a chave nova. Fail-closed já é o comportamento de `lerConfigAgente`: chave ausente
→ indicador some. Degrada, não quebra.

### A.4 O que acontece hoje à noite, quando o v10 ligar

Com `ficha_cliente=true` a COL 3 passa a ter 3 abas e estreia na Ficha. **A Ficha deixa de
ser "sempre visível"** — é o CONFLITO C-1, com o número que o justifica (0 itens de ficha em
3 de 3 sessões reais: a promessa de 0122 nunca chegou a ser exercida em produção).

---

## B. Transcrição rolável com auto-scroll que não sequestra

A base já tem **quase tudo** (`PainelTranscricao.tsx`): `noFimRef` capturado no `onScroll`,
tolerância de 24 px, `useLayoutEffect` (rola antes do paint), `aria-live="off"`,
`role="region"` + `tabIndex` nomeado. **Não reescrever.** Quatro correções cirúrgicas:

**B-1 · Tolerância em `rem`, não em px fixo.**
24 px foi calibrado para `--text-sm` na escala Padrão. Na escala Grande a linha cresce 28,6%
e 24 px passa a ser menos de uma linha — a regra "eu estava no fim" fica frouxa e ela
perde o grude depois de um arredondamento. Derivar de `getComputedStyle(el).lineHeight`
(1,5 linha, piso 24 px, teto 48 px). Na escala Padrão o número resultante é o mesmo 24 px de
hoje — **zero mudança de comportamento no caso já validado**.

**B-2 · `prefers-reduced-motion` explicitado, não implícito.**
Hoje o efeito usa `el.scrollTop = el.scrollHeight` (salto instantâneo) — já é seguro. O risco
é o próximo executor trocar por `scrollTo({behavior:"smooth"})` e quebrar sem ninguém notar.
Fixar como regra escrita e testada: **o auto-scroll é sempre instantâneo**; qualquer `behavior`
suave só pode existir atrás de `matchMedia("(prefers-reduced-motion: reduce)").matches === false`.
Teste que trava isso: um caso que falha se `behavior` aparecer sem o guarda.

**B-3 · Quando ela está lendo para cima, a fala nova precisa AVISAR — não arrastar.**
Hoje o comportamento é correto e **mudo**: a advogada rola para cima, a sessão continua, e
nada indica que há fala nova embaixo. Ela volta ao fim no escuro.
→ Botão flutuante `absolute bottom-2 right-2`, **dentro** da região rolável, só quando
(`não está no fim` **E** `chegou segmento novo desde que saiu do fim`):

```
            ┌──────────────────┐
            │  ▼ novas falas   │   ← min-h-11, custo vertical ZERO (absolute)
            └──────────────────┘
```

Clicar: rola ao fim e **re-arma** o grude. Some sozinho quando ela volta ao fim rolando.
Exige um `useState` (o `noFimRef` é ref e não repinta) — o ref continua sendo a fonte do
**efeito**, o state só governa a visibilidade do botão. Não inverter isso: mover a decisão de
rolagem para state reintroduz um frame de atraso.

**B-4 · A célula não rola.** Ver A.2: `Coluna` da COL 3 sem `rolavel`. A região do
`PainelTranscricao` passa a ser, de fato, a única do eixo.

### Critério de prova de B (não é opinião)
Em Chromium real, 1536×826, com ≥ 60 segmentos na sessão:
1. Sem tocar em nada → `scrollTop + clientHeight ≈ scrollHeight` a cada chegada.
2. Rolar 300 px para cima → chegar segmento novo → **`scrollTop` não muda** e o botão aparece.
3. Clicar no botão → volta ao fim, botão some, próximo segmento gruda de novo.
4. `document.documentElement.scrollHeight === clientHeight` (a página nunca rola).
5. Contar superfícies: `[...col3.querySelectorAll('*')].filter(e => getComputedStyle(e).overflowY === 'auto').length === 1`.

---

## C. Tudo na primeira dobra — o orçamento em número

### C.1 Inventário do que ocupa altura HOJE (valores declarados no CSS, `rem` a 16 px)

Modo **normal** (fora de tela cheia). Cadeia: `<main>` (padding 0 nesta rota) →
`ConduzirSessaoApp` `grid h-full grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-2`.

| # | Elemento | Classe que manda | Custo declarado |
|---|---|---|---|
| 1 | `Cabecalho` (nome + roteiro + "Ver ficha completa") | `header` + `h1 text-subtitulo` + Botão compacto | **conteúdo** (≈44 px na escala Padrão; some em tela cheia) |
| 2 | gap do grid | `gap-2` | **8 px** |
| 3 | `LinhaFinaRoteiro` (+ `BarraPartes` dentro) | `min-h-11 px-3 py-1.5 border` | **≥44 px** (reserva; conteúdo = rótulo `text-sm` + trilho `h-1.5` + `gap-1`) |
| 4 | gap do grid | `gap-2` | **8 px** |
| 5 | **mosaico (3 colunas)** | `minmax(0,1fr)` | **o que sobrar** |
| 6 | gap interno do `PainelCopiloto` | `gap-2` | **8 px** |
| 7 | rodapé — borda + respiro | `border-t pt-2` | **1 + 8 = 9 px** |
| 8 | rodapé — sub-linha 1 (`EstadoDoCopiloto` + "O cliente disse" + "Encerrar") | `min-h-[3.25rem]` | **≥52 px** |
| 9 | rodapé — gap entre sub-linhas | `gap-2` | **8 px** |
| 10 | rodapé — sub-linha 2 (`RodapeTranscricao`, **hoje desligada**) | `min-h-11 py-1.5 border` | **≥44 px** (hoje **0**) |
| 11 | linha 3 (`RegistroManual` aberto) | `auto` | **0 quando fechado** |

**Orçamento do mosaico, escala Padrão, 1536×826, modo normal:**

```
826 − 44 (cab.) − 8 − 44 (linha fina) − 8 − 8 (gap interno) − 9 − 52 − 8 − 44 (saúde)
    = 601 px   ← COM o indicador de saúde ligado
    = 645 px   ← hoje, com rodape_transcricao=false
Em tela cheia (cabeçalho some): +52 px  →  653 px
```

**A Fase 13 custa 44 px de mosaico** (a linha de saúde que nasce ligada) e **devolve** a
faixa de abas dentro da COL 3 (~28 px), que sai do orçamento da célula, não do grid.

### C.2 Escala Grande — a armadilha medida

`--fator-escala = 1,2857` multiplica **só** `--text-*`. `min-h-11` (44), `min-h-[3.25rem]` (52),
`gap-2` (8), `py-1.5` (6+6) **não mudam**. Então:

- `--text-sm` vai de 13 px para **16,7 px**; com `line-height: 1.45` → linha de **24,2 px**.
- `--text-subtitulo` (1 rem × fator) vai de 14 px para **18 px** → o `h1` do `Cabecalho` cresce.
- **A sub-linha 1 do rodapé (`min-h-[3.25rem]` = 52 px) fica apertada**: `EstadoDoCopiloto` é
  `px-3 py-2` + `text-sm` — 12+12+24,2 = **48,2 px**, dentro da reserva por 3,8 px. Uma segunda
  linha de texto ali (mensagem de erro, aviso de limiar) **estoura** e empurra o mosaico.
- **A faixa de abas da COL 3 é o risco novo**: 3 rótulos `text-rotulo` (0,75 rem × 1,2857 =
  17,4 px de fonte) numa célula de 28% × 1536 = **430 px** menos gaps/padding ≈ **400 px úteis**.
  `Ficha 4` + `Transcrição` + `Inventário 70` com padding de 8 px cada ≈ 280–330 px. **Cabe**,
  mas a margem é de ~70 px — e um número de 3 dígitos no inventário come metade dela.
  → **Contenção obrigatória**: a faixa é `flex-wrap`; se quebrar, quebra para 2 linhas
  (~56 px) e o painel absorve, porque a célula é `minmax(0,1fr)`. Nunca estoura para fora.

**Orçamento do mosaico, escala Grande, 1536×826, modo normal — a conta a CONFERIR no navegador:**
o cabeçalho e a linha fina crescem por conteúdo (não por reserva); se cada um crescer ~6 px,
o mosaico cai para **≈ 589 px**. Piso de legibilidade: abaixo de ~330 px a COL 1 ("Fale agora")
deixa de mostrar um card inteiro. Folga confortável.

### C.3 O que SAI, o que ENTRA, o que vira aba

| | |
|---|---|
| **SAI** | `OverlayTranscricao` inteiro + botão "Abrir transcrição" (`RodapeTranscricao.tsx`, ~60 linhas) |
| **SAI** | o empilhamento `PainelTranscricao` + `PainelInventario` da COL 3 (`PainelCopiloto.tsx:405-415`) |
| **SAI** | `rolavel` da `Coluna` da COL 3 (fecha o duplo-scroll vivo) |
| **SAI** | comentário órfão `min-h-[22rem]` (a classe não existe mais) |
| **ENTRA** | faixa de 2–3 abas dentro da COL 3 (~28 px, dentro da célula) |
| **ENTRA** | linha de saúde da captura sempre visível (44 px, kill-switch `saude_captura`, nasce ligada) |
| **ENTRA** | botão "▼ novas falas" — `absolute`, **0 px** de orçamento |
| **VIRA ABA** | Transcrição, Inventário, Ficha |
| **VIRA POP-UP** | Retrospecto (seção D) — só ao encerrar, `role="dialog"`, fora do orçamento da dobra |

### C.4 Como se PROVA (jsdom não mede layout — isto não é negociável)

Captura em Chromium real, **duas viewports × duas escalas × dois modos** = 8 capturas:
1536×826 e 1280×720 · `data-escala` `padrao` e `grande` · normal e `.modo-tela-cheia-sessao`.

Asserções que devem passar em **todas as 8**:

```
document.documentElement.scrollHeight === document.documentElement.clientHeight   // página não rola
main.scrollHeight === main.clientHeight                                            // <main> não rola
rodapeEncerrar.getBoundingClientRect().bottom <= window.innerHeight               // "Encerrar" dentro da dobra
col3.scrollHeight === col3.clientHeight                                            // a CÉLULA não rola
[...col3.querySelectorAll('*')].filter(e=>getComputedStyle(e).overflowY==='auto').length === 1
mosaico.getBoundingClientRect().height >= 330                                       // piso de legibilidade
faixaAbas.getBoundingClientRect().height <= 60                                      // wrap no máximo 2 linhas
```

E a prova negativa que esta base já pagou duas vezes: **abrir "O cliente disse"** (linha 3 do
grid) em cada uma das 8 e repetir as asserções. Se o mosaico encolher e nada vazar, o grid está certo.

Registrar cada número medido no `docs/` da entrega — não "cabe", e sim **"mosaico = 601 px em
1536×826 padrão normal"**.

---

## D. Retrospecto da Sessão (o "relatório de encerramento", v1)

### D.1 O nome — CONCEITO

**Não pode se chamar "Relatório".** `Glossario.md` já define **Relatório da SV** como o
documento que a Dra. Elaine preenche à mão (`relatorios_sessao`, `RelatorioAba.tsx`, item de
pasta `relatorio_sv`, aba `#relatorio`). Reusar a palavra criaria dois "Relatório" na mesma
aba "Sessão" da Ficha 360. A regra do CLAUDE.md é literal: *"os nomes do negócio são os nomes
do código. Não invente sinônimo"* — e o inverso vale: **não reuse um nome ocupado para uma
coisa nova.**

> **CONCEITO:** o **Retrospecto da Sessão** é o fechamento do copiloto — o que a máquina
> observou enquanto a sessão acontecia, congelado no instante em que ela terminou. É **da
> sessão de copiloto**, não do cliente; é **gerado**, não preenchido; e é **imutável**
> (encerrar duas vezes não gera dois).

Tabela: `copiloto_retrospectos`. Item de pasta: `retrospecto_sv`. Aba: `#retrospecto`.

### D.2 De onde sai o "score" — a resposta medida

**Não existe hoje base medida para uma NOTA de condução.** Os dois campos que a 0119 criou
justamente para isso estão vazios em produção: `cobriu_no_bloco` = **11 itens em 369 sugestões,
em 1 de 3 sessões**; `desfecho` = **99,2% `expirada`**. Uma nota construída sobre isso daria
um número plausível e falso — exatamente o que a regra "nada de dado inventado na tela" proíbe,
e exatamente o padrão do `feedback_coalesce_transforma_buraco_em_numero` (buraco virando número
plausível por 5 semanas).

**O que EXISTE medido e é auditável é COBERTURA:** partes do roteiro em que o copiloto
registrou atividade, sobre as 13 do `sessao_viabilidade` v5. Nas 3 sessões reais: **4/13 (31%) ·
9/13 (69%) · 6/13 (46%)**. Denominador fixo, numerador conferível por quem olha a `BarraPartes`.

**Decisão v1 — `origem = 'derivado'`, ZERO chamada de IA nova:**

| Bloco do pop-up | Fonte exata | Por que é honesto |
|---|---|---|
| **Cobertura: N de 13 partes** (o número grande) | `count(distinct copiloto_sugestoes.bloco_id)` ÷ `count(blocos do roteiro da sessão)` | fração verificável; o rótulo diz o que mede |
| Duração | `encerrado_em − iniciado_em` | fato |
| Patrimônio captado | `inventario_acumulado`: próprios / a confirmar | fato (0 · 31 · 70 medidos) |
| **Observações sobre o cliente** | `ficha_acumulada` (objeção › dor › desejo › fato › patrimônio, ordem que o servidor já produz) + `conteudo.observacao` agrupada por `tipo` | já separa fato·hipótese·inferência·recomendação — a regra da IA da casa, cumprida de graça |
| **Pontos de melhoria da condução** | união distinta de `conteudo.falta_no_bloco[].item` que **nunca** apareceu em `cobriu_no_bloco` | não é a IA opinando agora; é o que ela apontou **durante** a sessão |
| Saúde do motor (rodapé do pop-up, discreto) | sugestões da sessão · confiança média · % com evidência não conferida · % de execuções truncadas | responde "dá para confiar neste retrospecto?" antes de o dono perguntar |

**Sobre uma nota por IA (o "vamos aprimorando"):** é viável e o encerramento é o único lugar do
sistema onde latência não importa (a sessão acabou). Mas **fica fora da v1** e precisa, antes:
(a) `POST /api/admin/sonda-schema` com o schema proposto — o teto é ~4,4 KB antes do
`400 compiled grammar too large`; (b) `execucao_ia_id` gravado no retrospecto (prompt versionado
é regra da casa); (c) medir contra as 3 sessões já gravadas antes de mostrar a alguém.
O modelo de dado abaixo **já nasce pronto** para isso (`origem`, `execucao_ia_id`,
`schema_versao`) — mesma técnica da 0043 (`croqui_analises.schema_versao`), que ligou a v2 sem
migration nova.

### D.3 Modelo de dado — rascunho comentado da 0125

> Rascunho para o `backend-engineer` transformar em arquivo. **Não aplicar como está** sem
> conferir os nomes de policy/função contra a 0091/0122 no checkout.

```sql
-- 0125_copiloto_retrospecto_sessao.sql
--
-- RETROSPECTO DA SESSÃO — o fim do copiloto passa a ser escrito.
-- Pedido do Marcio (19/09): "ao finalizar a sessão e o copiloto, abra um pop-up
-- que gere o score rate da sessão, e os principais observações do cliente,
-- pontos de melhoria e etc, em um pop-up que dê para baixar também, e
-- consultar depois da sessão".
--
-- POR QUE TABELA PRÓPRIA (e não mais uma coluna jsonb em sessoes_copiloto,
-- como fizeram a 0111/0120/0122): as outras três são estado VIVO da sessão,
-- lido e reescrito a cada ciclo por PK. Este é um ARTEFATO CONGELADO, escrito
-- uma vez, lido depois por OUTRA tela (Ficha 360) e por outra pergunta
-- ("todos os retrospectos deste cliente"). Colocá-lo dentro de
-- sessoes_copiloto faria toda leitura do ciclo carregar um documento que o
-- ciclo não usa.
--
-- POR QUE NÃO SE CHAMA "RELATÓRIO": `relatorios_sessao` já existe e é o
-- documento que a advogada preenche à mão (Glossario.md, "Relatório da SV").
-- Dois "relatório" na mesma aba da Ficha seria ambiguidade permanente.

create table copiloto_retrospectos (
  -- PK = sessao_id: a idempotência vira INVARIANTE DE BANCO, não disciplina de
  -- código. Encerrar duas vezes NÃO PODE gerar dois retrospectos, e nenhuma
  -- rota futura consegue violar isso por descuido.
  sessao_id       uuid primary key
                    references sessoes_copiloto(sessao_id) on delete cascade,
  jornada_id      uuid not null references jornadas(id) on delete cascade,

  -- 'derivado' = calculado do que a sessão já gravou (v1, sem IA).
  -- 'ia'       = produzido por chamada de IA sobre a transcrição consolidada
  --              (fora da v1 — a coluna existe para a ponte ligar sem migration
  --              nova, mesma técnica de croqui_analises.schema_versao, 0043).
  origem          text not null default 'derivado'
                    check (origem in ('derivado', 'ia')),
  schema_versao   smallint not null default 1,
  -- Prompt é versionado (regra da casa). NULL enquanto origem='derivado'.
  execucao_ia_id  uuid references execucoes_ia(id),

  -- COBERTURA — não se chama "score" porque não é nota: é fração com
  -- denominador explícito. Medido em 19/09 nas 3 sessões reais: 4/13, 9/13,
  -- 6/13. Os dois campos separados (nunca só o percentual) para a tela poder
  -- escrever "9 de 13 partes" — número sozinho esconde o denominador.
  blocos_com_atividade smallint not null check (blocos_com_atividade >= 0),
  blocos_no_roteiro    smallint not null check (blocos_no_roteiro > 0),

  -- O corpo. jsonb (não colunas) porque a v2 vai acrescentar seções e a
  -- forma ainda vai mudar — mas com CHECK de tamanho, MESMO backstop de
  -- resumo_acumulado/ficha_acumulada (0091/0120/0122): nunca cresce sem teto,
  -- mesmo que a poda em TypeScript tenha um defeito futuro.
  -- Medido: conteudo médio de sugestão = 834 B, máx 1.602 B; um retrospecto
  -- com ~20 observações + ~15 pontos de melhoria fica em ordem de 8-12 KB.
  conteudo        jsonb not null,
  constraint copiloto_retrospectos_conteudo_teto
    check (pg_column_size(conteudo) <= 32768),

  -- Redação de PII (expurgo): mesmo carimbo de sessoes_copiloto. NULL = ainda
  -- tem citação literal; timestamp = já redigido.
  evidencias_redigidas_em timestamptz,

  criado_em       timestamptz not null default now(),
  criado_por      uuid references auth.users(id)
);

create index idx_copiloto_retrospectos_jornada
  on copiloto_retrospectos (jornada_id, criado_em desc);

comment on table copiloto_retrospectos is
  'Fase 13 — fechamento do copiloto: o que a máquina observou durante a '
  'Sessão de Viabilidade, congelado no encerramento. NÃO é o "Relatório da '
  'SV" (relatorios_sessao), que a advogada preenche à mão. PK=sessao_id '
  'torna a idempotência invariante de banco: encerrar 2x nunca gera 2.';

-- =====================================================================
-- RLS — MESMO recorte de sessoes_copiloto/copiloto_sugestoes (0091):
-- app.ve_patrimonio(), nunca o eh_interno() mais largo. O conteúdo carrega
-- objeção/dor/desejo com citação literal de família real.
--   * enable row level security + FORCE (service_role não dispensa RLS nem
--     GRANT — regra da casa; 0065b revogou default privileges, então GRANT
--     explícito é obrigatório, senão a tabela nasce inacessível).
--   * SELECT: authenticated com app.ve_patrimonio()
--   * INSERT/UPDATE/DELETE: NENHUMA policy para authenticated. Quem escreve é
--     service_role, pelo caminho do encerramento. A tela só lê.
--   * conferir com `select relrowsecurity, relforcerowsecurity from pg_class`
--     e `proacl` das funções tocadas — a armadilha
--     "função nova nasce exposta a authenticated" já mordeu esta base.
-- =====================================================================

-- =====================================================================
-- CONFIGURAÇÕES
--   (a) 'copiloto_sessao.saude_captura' = true
--       A linha de saúde da captura no rodapé (indicador tricolor + última
--       fala). Nasce LIGADA: é reorganização de UI sobre dado que o poller já
--       traz, não capacidade nova.
--   (b) 'copiloto_sessao.rodape_transcricao' — NÃO APAGAR. Atualizar a
--       descrição para "DEPRECADA em 0125 — o rodapé não tem mais transcrição
--       (o overlay saiu, a transcrição virou aba da COL 3). Substituída por
--       copiloto_sessao.saude_captura." Linha antiga vira histórico, não
--       delete.
--   (c) 'copiloto_sessao.retrospecto_ativo' = true
--       Kill-switch do pop-up e da gravação. Desligado: o encerramento volta
--       a ser exatamente o que é hoje, sem retrospecto e sem pop-up — caminho
--       de volta em 1 comando.
-- =====================================================================

-- REVERSÃO (descrita, como toda migration desta base):
--   update configuracoes set valor='false'::jsonb
--     where chave in ('copiloto_sessao.retrospecto_ativo',
--                     'copiloto_sessao.saude_captura');
--   -- a tabela pode ficar: sem escritor, ela apenas guarda o que já produziu.
--   -- drop table copiloto_retrospectos cascade;  -- só se for descartar o
--   --   histórico de propósito; nunca no rollback de um deploy ruim.
--
-- BACKFILL: NENHUM. As 3 sessões já encerradas NÃO ganham retrospecto
-- retroativo. Medido: as 3 têm encerrado_em e transcricao consolidada, então
-- seria tecnicamente possível — mas o retrospecto afirma "foi isto que a
-- máquina observou AO VIVO", e reconstruir isso depois produziria um
-- documento com data de hoje sobre uma sessão de anteontem. Nenhuma linha
-- muda de valor; ninguém é promovido nem rebaixado. Se o dono quiser as 3
-- retroativas, é comando manual explícito, com o carimbo de que foi
-- reconstruído — não default de migration.
```

### D.4 Idempotência — duas travas, não uma

1. **Banco:** `sessao_id` é PK. Duas linhas é impossível.
2. **Código:** a escrita vai dentro de `executarEncerramentoCopiloto`, **depois** de
   `marcarEncerrada` devolver não-nulo — que já é o portão: `.in('estado',[...])` +
   `maybeSingle` devolve `null` quando nada mudou. Isso vale para os **três** caminhos
   (clique, `duracao_maxima_minutos`, retenção infinita) sem duplicar lógica.
3. `insert … on conflict (sessao_id) do nothing` como cinto e suspensório — corrida entre o
   clique e o ciclo automático no mesmo segundo não pode virar 500 na cara da advogada.
4. **O retrospecto NUNCA pode derrubar o encerramento.** `try/catch` isolado, mesmo padrão do
   `tirarBotDaSalaSeHouver`: falhou, a sessão encerra assim mesmo, a rota responde
   `retrospecto: null`, e a tela mostra o pop-up com "não foi possível montar o retrospecto
   desta sessão" (stub rotulado, nunca um retrospecto vazio disfarçado de retrospecto real).

**Se encerrar duas vezes:** a rota já devolve `encerrado: false`. Nesse caso o cliente **busca**
o retrospecto existente (`GET`) em vez de esperar um novo — o pop-up abre igual, com o documento
que já existe. Encerrar duas vezes mostra o mesmo papel, nunca dois.

### D.5 Download — qual caminho, e por quê

**O padrão provado da casa é rota + `Content-Disposition: attachment` + `<a href download>`**
(`src/components/croqui/BaixarRelatorio.tsx` — o docblock explica: funciona com botão direito,
com "abrir em nova aba" e sem JavaScript). **Mesma origem**, então a restrição de `download`
(que só bite cross-origin) não se aplica; e mesmo que o atributo fosse ignorado, o
`Content-Disposition: attachment` já força o download sem trocar de página.

O caminho `fetch` → `Blob` → `URL.createObjectURL` → âncora sintética (`components/publico/cliente.ts`)
**não é necessário aqui** — ele existe lá porque a rota faz 302 para o Storage (cross-origin).
O retrospecto não passa por Storage.

**v1 = `.docx`**, não `.md` nem `.txt`. Razão: a dependência `docx@^9.7.1` **já está no
`package.json`** e já há uma rota que a usa (`api/croquis/[id]/docx`) — zero dependência nova,
e o destinatário é uma advogada que vai anexar isso num e-mail, não ler markdown. O builder do
croqui **não** é reaproveitado (é acoplado ao conteúdo do croqui); só a biblioteca.

- `GET /api/sessoes/[id]/copiloto/retrospecto` → JSON (a tela e o pop-up).
- `GET /api/sessoes/[id]/copiloto/retrospecto?formato=docx` → `attachment; filename="…"; filename*=UTF-8''…`
  (o nome tem acento — copiar o par `filename`/`filename*` da rota do croqui, que já resolveu isso).
- Ambos atrás de `exigirVePatrimonio()`. **Nunca** link público, **nunca** token — é PII pesada.

### D.6 Consultar depois — rota e tela

**Zero página nova.** A Ficha 360 já tem a aba "Sessão" com `["sessao","briefing","relatorio_sv",
"analise_sessao","diagnostico_sv","material"]` e navegação por hash (`Abas deepLinkHash`).

- `catalogo.ts`: item novo `retrospecto_sv` — rótulo **"Retrospecto"**, título
  `Retrospecto da Sessão de Viabilidade`, `procedencia: "gerado_ia"` (é produzido pela máquina,
  mesmo que a v1 seja derivada), `dono: "equipe"`, `requerPatrimonio: true`.
- `tabs.ts`: entra em `TABS_FICHA.sessao.itens`, **depois de `analise_sessao`**.
- `rotas.ts`: `ABA_POR_ITEM_PASTA.retrospecto_sv = "retrospecto"`.
- `derivar.ts`: `retrospecto_sv` → `pronto` se existe; `ainda_nao` com `SO_DEPOIS_DA_SESSAO`
  se a sessão não foi realizada; `falta` caso contrário. **Nunca inventar `pronto`.**
- Aba `RetrospectoAba.tsx` — reusa o **mesmo** componente de corpo do pop-up. Um corpo, dois
  containers (pop-up e aba). É o item de "otimização": a tela de consulta não é código novo.

URL de consulta: `/jornadas/<jornadaId>#retrospecto`.

### D.7 O que fica FORA da v1 (declarado, não esquecido)

| Fora | Por quê |
|---|---|
| Nota de qualidade da condução gerada por IA | sem base medida (§D.2); exige sonda de schema e medição contra as 3 sessões gravadas |
| "Pontos de melhoria" escritos pela IA no encerramento | idem; a v1 usa o que ela já apontou ao vivo |
| Comparação entre sessões / evolução da advogada | 3 sessões, uma delas anômala (205 `falta_no_bloco` e 0 inventário). Tendência sobre n=3 é ruído. |
| Cruzar retrospecto com desfecho comercial | `sessoes_viabilidade.resultado` é **NULL em 4 de 4** — medido. É trabalho de dado, não de código. |
| PDF, envio por e-mail, link de compartilhamento | PII pesada; cada canal novo é superfície nova |
| Edição do retrospecto pela advogada | é artefato congelado; se ela precisa escrever, o lugar é o **Relatório da SV**, que já existe |
| Retrospecto retroativo das 3 sessões encerradas | §D.3, "BACKFILL: NENHUM" |
| Persistir a aba escolhida da COL 3 | decisão de produto |

---

## E. CONFLITO e BLOQUEIO

### CONFLITO (pedido do dono × decisão registrada) — não bloqueiam, mas o dono precisa saber

**C-1 · As abas foram removidas há 1 dia, com justificativa gravada em migration.**
A **0122** diz no cabeçalho: *"a coluna 3 deixa de ser transcrição+inventário em ABAS (que a
advogada nunca clica)"*. A Fase 13 recoloca as abas.
Números que sustentam recolocar mesmo assim: (a) a alternativa que substituiu as abas
(`rodape_transcricao`) foi **desligada antes do push** e nunca chegou a produção; (b) a Ficha,
que ia ocupar a COL 3 sozinha, tem **`ficha_acumulada` = 0 itens em 3 de 3 sessões reais** — a
promessa de "sempre visível" nunca foi exercida; (c) o ramo sem Ficha tem **duplo-scroll vivo
hoje** (§0.2), que é literalmente o "conflito" que o dono viu na tela.
Consequência a aceitar conscientemente: **com o v10 ligado, a Ficha passa a poder sair de vista**
quando ela clicar em Transcrição ou Inventário. Mitigação: a Ficha é a aba de estreia e as
inativas mostram contagem.

**C-2 · "score rate" pedido × nenhum sinal de condução medido.**
Os campos que a 0119 criou para julgar a condução estão vazios: `cobriu_no_bloco` = **11 itens
em 369 sugestões**, `desfecho` = **99,2% expirada**. A v1 entrega **Cobertura (N de 13 partes)**,
que é fração auditável, e **não** chama isso de nota. Entregar uma "nota 7,4" hoje seria o
padrão já catalogado de buraco virando número plausível.

**C-3 · A tela de condução não tem pop-up de fim, por decisão anterior.**
A F4 estabeleceu que o encerramento mostra uma linha sóbria no rodapé
("Copiloto encerrado — transcrição consolidada"). O pop-up é uma interrupção modal **logo
depois** de a advogada ainda estar com o cliente na sala. Desenho para conviver: o pop-up abre
só no encerramento **manual** (clique dela); o encerramento **por duração máxima** apenas
grava o retrospecto e acrescenta um link "Ver retrospecto" à linha sóbria — a tela não abre
modal sozinha na cara de quem não pediu.

**C-4 · `CONTINUAR-AQUI.md` afirma "0 truncadas em 299 execuções".**
O real é **49/299 (16,4%)** (briefing) e **`.env.local` existe** nesta máquina (§0). Os dois
erros sustentavam a decisão de não rodar a bancada. Corrigir o documento faz parte da entrega.

### BLOQUEIO (depende de decisão do Marcio — não invento)

**B-1 · Com o v10 ligado, a Ficha pode sair de vista. Confirma?**
Duas leituras do pedido, que geram trabalhos diferentes:
- **Leitura 1** — "abas na COL 3, e a Ficha é uma delas": 3 abas, Ficha de estreia.
  É a que este plano desenha.
- **Leitura 2** — "a Ficha nunca sai; transcrição e inventário se dividem no que sobra":
  Ficha fixa no topo da COL 3 + abas embaixo. **Custo:** volta o empilhamento e a medição do
  container-sombra passa a conviver com a faixa de abas — é o mecanismo exato do defeito F4-1
  que o Fable mediu (`scrollHeight 614 ≠ clientHeight 590`).
  Não escolho por ele: é uma escolha entre "ver tudo com 1 clique" e "não deixar a objeção
  sair de vista", e as duas são defensáveis.

**B-2 · "Cobertura: 9 de 13 partes" serve como o "score rate", ou ele quer uma NOTA?**
Se for nota, ela exige chamada de IA nova sobre a transcrição consolidada — o que **não cabe na
v1** e tem pré-requisito técnico (sonda de schema contra o teto de ~4,4 KB). Se ele responder
"quero a nota", a v1 sai **sem número grande** e o número entra na v2, medido — não sai um
número inventado agora.

**B-3 · O pop-up abre também no encerramento automático por duração máxima?**
Ver C-3. Meu desenho diz **não** (só link). Se ele quiser modal nos dois casos, é 1 linha —
mas é decisão dele, porque a diferença é abrir uma janela na cara de quem não clicou em nada.

**B-4 · Ligar `saude_captura` no mesmo deploy do v10?**
São duas mudanças de tela ao vivo na mesma sessão que ele quer usar para validar o motor.
Recomendo: v10 + abas + auto-scroll juntos; `saude_captura` **ligada** (custa 44 px e é o que
responde "o bot está operante", que é o pedido 2). Mas quem decide o risco da noite é ele.

---

## F. Divisão de tarefas — fronteira de arquivo EXCLUSIVA

> Os dois agentes rodam em paralelo. **Nenhum arquivo aparece nas duas listas.**
> `PainelCopiloto.tsx` é do **frontend**; nada do backend o toca.

### backend-engineer — arquivos que só ele edita

```
supabase/migrations/0125_copiloto_retrospecto_sessao.sql        (novo)
src/server/copiloto/retrospecto.ts                              (novo)
src/server/copiloto/retrospecto.test.ts                         (novo)
src/server/copiloto/encerrar.ts                                 (edita)
src/server/copiloto/encerrar.test.ts                            (edita)
src/server/copiloto/expurgo.ts                                  (edita)
src/server/copiloto/expurgo.test.ts                             (edita)
src/server/copiloto/estado.ts                                   (edita — só a chave de config)
src/server/copiloto/estado.test.ts                              (edita)
src/app/api/sessoes/[id]/copiloto/encerrar/route.ts             (edita)
src/app/api/sessoes/[id]/copiloto/retrospecto/route.ts          (novo)
src/app/api/sessoes/[id]/copiloto/retrospecto/route.test.ts     (novo)
src/types/copiloto.ts                                           (edita — tipos do retrospecto + saudeCapturaAtivo)
CONTINUAR-AQUI.md                                               (edita — correção C-4)
```

| # | Tarefa | Critério de aceite |
|---|---|---|
| BE-1 | **0125** conforme §D.3 | `relrowsecurity` **e** `relforcerowsecurity` = true na tabela nova; `proacl` conferido (nenhum privilégio default para `authenticated` além do SELECT desenhado); tentativa de INSERT como `authenticated` → negado; reversão testada; **BACKFILL: nenhum**, declarado no cabeçalho |
| BE-2 | `retrospecto.ts` — **montagem derivada**, função pura + 1 leitura | zero chamada de IA; zero polling novo; a cobertura sai de `count(distinct bloco_id)` sobre `blocos_no_roteiro` **do roteiro daquela sessão** (não do ativo de hoje); reproduz os números medidos nas 3 sessões reais: **4/13, 9/13, 6/13** |
| BE-3 | Ligar em `executarEncerramentoCopiloto`, **depois** de `marcarEncerrada` | teste: chamar `executarEncerramentoCopiloto` **2×** → 1 linha em `copiloto_retrospectos`; teste: `retrospecto.ts` lançando → `encerrado: true` mesmo assim e `retrospecto: null` na resposta |
| BE-4 | `GET …/retrospecto` (JSON) e `?formato=docx` | `exigirVePatrimonio()`; docx com `filename` **e** `filename*=UTF-8''` (nome com acento); sem retrospecto → **404 com código**, nunca 200 com corpo vazio |
| BE-5 | **Expurgo** — `redigirRetrospectoDaSessao` na MESMA onda | `conteudo` com citação literal é redigido; `evidencias_redigidas_em` carimbado; `carimbarSessoesSemPendencia` passa a considerar a tabela nova (senão a sessão é carimbada "limpa" com PII viva no retrospecto) |
| BE-6 | Config: `saude_captura` no payload de polling; `retrospecto_ativo` no gate | chave ausente → `false` (fail-closed), testado; a chave antiga `rodape_transcricao` **não é lida por nenhum código** ao fim da tarefa (grep prova) |
| BE-7 | Corrigir `CONTINUAR-AQUI.md`: 49/299 truncadas e `.env.local` existe | o bloco não afirma mais "0 truncadas"; a razão registrada para não rodar a bancada é atualizada |

### frontend-engineer — arquivos que só ele edita

```
src/components/sessao/PainelCopiloto.tsx                         (edita)
src/components/sessao/copiloto/AbasColuna3.tsx                   (novo)
src/components/sessao/copiloto/AbasColuna3.test.tsx              (novo)
src/components/sessao/copiloto/PainelInventario.tsx              (novo — extraído de PainelCopiloto.tsx)
src/components/sessao/copiloto/PainelTranscricao.tsx             (edita)
src/components/sessao/copiloto/PainelTranscricao.test.tsx        (edita)
src/components/sessao/copiloto/RodapeTranscricao.tsx             (edita — remove o overlay)
src/components/sessao/copiloto/RodapeTranscricao.test.tsx        (edita)
src/components/sessao/copiloto/usePollingCopiloto.ts             (edita — só saudeCapturaAtivo/retrospecto)
src/components/sessao/copiloto/CorpoRetrospecto.tsx              (novo)
src/components/sessao/copiloto/PopupRetrospecto.tsx              (novo)
src/components/sessao/copiloto/PopupRetrospecto.test.tsx         (novo)
src/components/ficha360/RetrospectoAba.tsx                       (novo)
src/lib/pasta/catalogo.ts · tabs.ts · rotas.ts · derivar.ts      (edita)
src/app/(app)/jornadas/[id]/page.tsx                             (edita — registra a aba)
```

> ⚠️ `src/types/copiloto.ts` é do **backend**. O frontend consome os tipos; se precisar de campo
> novo, **pede ao orquestrador**, não edita. Se os dois editarem o mesmo tipo em paralelo, o
> merge some com um dos dois em silêncio.

| # | Tarefa | Critério de aceite |
|---|---|---|
| FE-1 | `AbasColuna3` — faixa leve + painel único | painel inativo **ausente do DOM** (`queryByText` do inativo = null); `role="tablist"`, setas ←/→, `aria-selected`, alvo ≥44 px; contagem no rótulo só quando >0; `flex-wrap` |
| FE-2 | COL 3 usa `AbasColuna3` nos dois ramos; `Coluna` **sem** `rolavel` | `col3.scrollHeight === col3.clientHeight`; **exatamente 1** elemento com `overflowY:auto` dentro da COL 3 (medido no navegador, não no jsdom) |
| FE-3 | `PainelInventario` sai de `PainelCopiloto.tsx` para arquivo próprio | `PainelCopiloto.tsx` **encolhe** (hoje 2.094 linhas); comportamento idêntico; comentário órfão `min-h-[22rem]` removido |
| FE-4 | Auto-scroll B-1…B-4 | os 5 testes de §B, **em Chromium**; na escala Padrão a tolerância resultante é **24 px** (prova de não-regressão) |
| FE-5 | `RodapeTranscricao` perde overlay e botão | `OverlayTranscricao` não existe mais no arquivo; `PainelTranscricao` tem **um único** ponto de montagem em toda a árvore (grep prova); a linha continua ≤44 px |
| FE-6 | `PopupRetrospecto` + `CorpoRetrospecto` | `role="dialog"` + `aria-modal`, foco na raiz ao abrir, `Esc` fecha, foco volta ao botão; abre **só** no encerramento manual (C-3); falha do backend → stub rotulado, nunca corpo vazio |
| FE-7 | Botão "Baixar (.docx)" = `<a href download>` | mesmo padrão de `BaixarRelatorio.tsx`; a página **não** troca ao clicar; nada de `createObjectURL` |
| FE-8 | `RetrospectoAba` reusa `CorpoRetrospecto` | `/jornadas/<id>#retrospecto` abre na aba certa; sem retrospecto → estado vazio honesto (`EstadoVazio`), nunca zeros |
| FE-9 | Catálogo/tabs/rotas/derivar | `retrospecto_sv` aparece na Pasta com estado correto nos 3 casos; `requerPatrimonio: true` respeitado |
| FE-10 | **As 8 capturas de §C.4** | todas as asserções verdes; os números reais registrados no `docs/` da entrega, não "cabe" |

### security-pentester — OBRIGATÓRIO (não é opcional nesta fase)

Toca PII pesada (objeção/dor/desejo com citação literal de família real), tabela nova com RLS,
rota nova, download de documento. Auditar:
1. `copiloto_retrospectos` — RLS `force`, `proacl`, INSERT como `authenticated` negado,
   SELECT de outra jornada negado, `service_role` sem bypass implícito.
2. `GET …/retrospecto` e `?formato=docx` — IDOR por `sessao_id` de outra jornada; resposta a
   requisição **sem** claims; 404 vs 403 não vazando existência.
3. **Expurgo:** confirmar que `carimbarSessoesSemPendencia` não carimba "limpa" uma sessão com
   retrospecto não redigido — é exatamente o padrão que falhou 2× nesta base.
4. `Content-Disposition` — injeção via nome do cliente no `filename` (aspas, CRLF, unicode).
5. Nenhuma citação literal em log/`registrarErro` no caminho novo.

### Ordem de verificação (o orquestrador executa nesta sequência)

1. `npx tsc --noEmit` — **antes** de qualquer teste. (`"use server"` só exporta async; o `tsc`
   não pega tudo, então o `next build` também.)
2. `npx vitest run src/server/copiloto` — backend isolado.
3. `npx vitest run src/components/sessao` — frontend isolado. **Rodar 3× seguidas**: esta pasta
   já teve corrida de efeito (18/09), e é a pasta que os dois agentes mais mexem.
4. `npm run build`.
5. **Migration 0125 aplicada em staging** + roteiro SQL de verificação (`scripts/verificacao-0125.sql`,
   padrão da casa): `relrowsecurity`, `relforcerowsecurity`, `proacl`, `pg_column_size` no CHECK,
   e o teste de **encerrar 2× → 1 linha** feito com `DO … INSERT … RAISE EXCEPTION` (rollback),
   porque build verde não vê regra que mora no banco.
6. **Navegador real (Chromium)** — as 8 capturas de §C.4 **e** o roteiro de §B. Sem isso,
   nada nesta fase está provado: `jsdom` não calcula layout e página em branco não lança erro.
7. `security-pentester` com o diff completo.
8. `fable-orchestrator` — trava final.

---

## G. Os 5 critérios do Fable

| Critério | O que este plano garante |
|---|---|
| **Segurança** | Tabela nova com RLS `force` + `app.ve_patrimonio()` (o recorte estreito, não `eh_interno()`); **zero** policy de escrita para `authenticated`; `redigirRetrospectoDaSessao` no expurgo **na mesma onda** que cria a coluna com citação literal — não numa fatia depois, que é o padrão que já falhou 2× aqui; download em rota autenticada, sem Storage e sem token público; pentester obrigatório com 5 superfícies nomeadas. |
| **Escalabilidade** | Hoje: 3 sessões, 369 sugestões, 5.190 segmentos. 10×: 30 sessões, ~3.700 sugestões — o retrospecto é escrito **1× por sessão** e lido por PK ou por `idx_copiloto_retrospectos_jornada`. **Zero polling novo, zero rota nova no caminho quente, zero chamada de IA nova** (egress do Supabase é da organização). A aba inativa desmonta: trocar de aba não bate no banco. `PainelTranscricao` mantém o teto de 60 segmentos em estado. |
| **Solidificação** | A idempotência deixa de ser disciplina de código e vira **invariante de banco**: `sessao_id` é PK — encerrar 2× não consegue gerar 2 retrospectos nem que alguém escreva a rota errada. Mais: `CHECK` de 32 KB no `conteudo` (backstop igual ao de `resumo_acumulado`/`ficha_acumulada`), `CHECK` em `origem`, `blocos_no_roteiro > 0`, FK com `on delete cascade` nos dois lados. |
| **UX** | A advogada passa a ter **uma pergunta por superfície**: "o bot está vivo?" tem resposta permanente de 1 linha; "o que ele ouviu / o que ele captou / quem é o cliente" viram uma escolha explícita de 1 clique, com contagem visível no rótulo do que ela não está olhando. O auto-scroll deixa de ser silencioso: rolou para cima, a fala nova **avisa** em vez de arrastar. O fim da sessão deixa de ser uma frase cinza e vira um documento que ela leva embora. Nada troca de aba sozinho; nenhum modal abre sem clique dela. |
| **Otimização** | A fase **remove mais do que acrescenta na tela de condução**: sai o `OverlayTranscricao` inteiro (~60 linhas) e o segundo ponto de montagem de `PainelTranscricao`; sai o empilhamento transcrição+inventário; sai o `rolavel` da COL 3 (que é um **defeito vivo** de duplo-scroll, não só estilo); `PainelInventario` sai de um arquivo de 2.094 linhas para arquivo próprio; a chave de config que passaria a mentir é depreciada em vez de sobreviver mentindo. O retrospecto não cria tela de consulta nova (reusa a aba da Ficha 360) nem corpo novo (um `CorpoRetrospecto`, dois containers) nem dependência nova (`docx` já está no `package.json`). **Zero chamada de IA, zero query nova por tick.** Saldo de superfícies de rolagem na COL 3: de 2 (defeituosas) para 1 (correta). |
