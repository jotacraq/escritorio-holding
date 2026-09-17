# Design system do SIC-HF — contrato de migração (V2, 06/09/2026)

Para ser **seguido**, não lido. Quem migra uma tela abre isto, aplica, marca o checklist do fim.
A referência é o seminário (`guardioesdolegado.com.br/ak1`): creme, cartão branco de raio grande, tinta escura,
laranja só em CTA, Neuetra em tudo, rótulo pequeno em caixa alta + título grande, muito respiro.
**Acessibilidade vence fidelidade.** Quem usa tem 60+ anos e vive de e-mail e WhatsApp.

Fonte de verdade: `src/app/globals.css` (tokens) e `src/components/ui/*` (componentes).

> **V2 (Fase 6, "Praticidade").** O João, depois de usar a V1 em produção: *"tá tudo
> muito grande, eu tenho que escrolar muito pra ver todo o conteúdo da página"*. A
> escala encolheu: **corpo 16 → 14 px, um degrau a menos em cada título, ritmo
> vertical −35 %, raio do cartão 20 → 16 px.** O que **NÃO** mudou, e é trava:
> cor, tipografia (Neuetra), sombra, selo, foco, contraste, o piso de 12 px, o alvo
> de 44 px e a `.area-publica` (o cliente de 60+ continua com 17 px e 44 px).
> Isto é substituição consciente da escala da Fase 4, não regressão dela.

> **T1 — repaginação de densidade (16/09/2026).** Mudança de DIREÇÃO, registrada
> em `05 Decisoes/2026-09-16 - Direcao de UI validada pelo Marcio (clean e
> convencional).md` (vault): a Fase 7 pedia "mais visual"; esta rodada pede
> **clean e convencional, denso como sistema tradicional (ERP)** — Fiori, Atlassian,
> Salesforce Lightning como referência, não mais o seminário. Motivo do Marcio:
> *"a visualização é muito grande [...] tenho que escrolar demais. Nunca tenho
> amostra de acesso rápido. Se para mim [...] é difícil, imagina uma pessoa de 50
> anos."* Maior alavancagem do sistema: **2 arquivos** (`globals.css` + `Cartao.tsx`),
> **176 componentes afetados** por herança de token. O que mudou: `Cartao normal`
> 20-24px→**16px** (sem salto em `sm:` — o `sm:p-6` fazia o desktop, onde o
> advogado trabalha, ser o mais folgado; inversão de propósito), `Cartao compacto`
> 16px→**12px**, `--espaco-secao` 26px→**20px**, `--espaco-bloco` 18px→**14px**,
> `--espaco-cartao` 16px→**12px**, `--raio-cartao` 12px→**8px** (coincide agora com
> `--raio-controle`: retângulo chapado, não bolha). O que **NÃO** mudou, e é
> trava: `--espaco-item`/`--alvo-gap` (8px — densidade não come folga entre
> alvos, público 50+), `--alvo-minimo` (44px), toda a escala tipográfica, e
> nenhuma cor (contraste AAA confirmado por `scripts/contraste.mjs`, números
> idênticos aos da Fase 8). `src/components/sessao/**` e `/sessoes/**` ficaram
> de fora por decisão explícita — tela em produção com sessão real.

## 1. Tokens — quando usar cada um

| Token | Tailwind | Uso |
|---|---|---|
| `--papel-fundo` | `bg-papel-fundo` | fundo da página (creme). Já vem do `body`; não repita. |
| `--papel` | `bg-papel` | barra lateral, rodapé de gaveta, fundo de hover, chip neutro. |
| `--papel-elevado` | `bg-papel-elevado` | **cartão, gaveta, diálogo, input** (branco no claro). |
| `--tinta` | `text-tinta` | título, valor, texto principal. |
| `--tinta-suave` | `text-tinta-suave` | descrição, texto de apoio. |
| `--tinta-fraca` | `text-tinta-fraca` | rótulo caixa alta, legenda, meta. Já mede ≥ 4,5:1 — pode usar em texto. |
| `--linha` / `--linha-forte` | `border-linha` / `border-linha-forte` | divisor de cartão / borda de chip e botão secundário. |
| `--linha-controle` | `border-linha-controle` | **borda de input** (3:1). Nunca `--linha` em input. |
| `--latao` | `text-[color:var(--latao)]` | laranja para **texto/ícone/borda** (escurecido, AA). |
| `--latao-cta` + `--latao-cta-texto` | `bg-[color:var(--latao-cta)] text-[color:var(--latao-cta-texto)]` | **só fundo de CTA / nó ativo**, texto sempre escuro. |
| `--latao-fraco` | `bg-latao-fraco` | fundo de item ativo (nav, opção marcada, linha selecionada). |
| `--verde/--ambar/--vermelho/--azul` + `-fraco` | `text-[color:var(--verde)] bg-verde-fraco` | estado: pronto / atenção / erro / informação. Sempre com texto ou ícone junto. |
| `--sombra-cartao` / `--sombra-flutuante` | `shadow-cartao` / `shadow-flutuante` | cartão em repouso / gaveta, diálogo, toast, paleta. |
| `--raio-cartao` **1rem** / `--raio-controle` 0.75rem / `--raio-pilula` | `rounded-cartao` / `rounded-controle` / `rounded-pilula` | cartão / input, botão, aba / CTA primário e chip. |
| `--transicao-rapida` 120ms / `--transicao-normal` 220ms / `--suavizacao` | `duration-[var(--transicao-rapida)] ease-[var(--suavizacao)]` | hover, foco / abrir, entrar. |
| `--foco` | `shadow-foco` (já vem em `:focus-visible`) | halo de foco. Nunca `outline-none` sem substituto. |
| `--espaco-secao` · `--espaco-bloco` · `--espaco-cartao` · `--espaco-item` | `gap-secao` · `gap-bloco` · `gap-cartao` · `gap-item` | ritmo vertical — ver §2.1. Nunca escolha `gap-6`/`gap-8` no olho. |

`rounded-sm/md/lg` do Tailwind foram remapeados (10px / 14px / 16px) e `text-sm` vale 13px na V2 —
telas antigas já ganham o raio e o tamanho novos sem edição. Na migração, troque pelos nomes semânticos.
`text-xs` **não existe mais como degrau próprio**: virou alias de `text-legenda` (§6) e não deve ser escrito
em código novo.

## 2.1 Ritmo vertical — uma escala só (Fase 5)

Diagnóstico do João: "muitos blocos grudados uns nos outros, texto entortado em alguns".
Causa: cartão com 1,5rem de padding separado por 1,5rem de gap não lê como bloco distinto, e
`letter-spacing: -0.015em` valia até em `h3` de 15px, onde tracking negativo cola as letras.

**Regra: o degrau de fora é sempre maior que o de dentro.**

| Degrau | Token (T1, 16/09/2026) | V2 | V1 | Classe | Onde |
|---|---|---|---|---|---|
| Seção | `--espaco-secao` **1.25rem / 20px** | 26px | 40px | `gap-secao` | entre seções de uma página |
| Bloco | `--espaco-bloco` **0.875rem / 14px** | 18px | 28px | `gap-bloco` | entre cartões de uma mesma seção; é o degrau raiz da maioria das telas |
| Cartão | `--espaco-cartao` **0.75rem / 12px** | 16px | 24px | `gap-cartao` / `p-cartao` | dentro do cartão: entre grupos, entre KPIs de uma faixa |
| Item | `--espaco-item` **0.5rem / 8px — NÃO MUDA** | 8px | 12px | `gap-item` | entre chips, entre linhas de uma lista densa, entre rótulo e valor. Mesmo valor de `--alvo-gap` (§6): densidade não come o piso de folga entre alvos de toque |

`--raio-cartao` **0.5rem / 8px** (T1; era 0.75rem/12px na V2, 1.25rem/20px na V1):
padrão ERP denso (Fiori, Atlassian) pedido pelo Marcio em 16/09 — "sistema convencional"
é retângulo, e com o padding do `Cartao` caído a 16px um raio de 12px voltava a ler como
bolha. Passa a coincidir com `--raio-controle` (mesma geometria chapada em cartão e
controle).

Tipografia: entrelinha de título é `1.22` (display) e `1.30` (título) — na V2 os títulos
encolheram, então a entrelinha SUBIU: título menor precisa de proporcionalmente mais folga para
quebrar em duas linhas na Neuetra bold sem colar. **`h1`–`h4` não declaram `letter-spacing`**: ele vem do
degrau (`--text-titulo--letter-spacing`), então título pequeno fica com tracking zero.
`text-wrap: balance` em título, `text-wrap: pretty` em `p`/`li`/`dd` (sem palavra órfã).
Ao mexer nesses valores, meça um título de 2 linhas a 390px antes de fechar.

## 2.2 Lei de texto (Fase 5 — vale em toda tela)

Cartão = **título + estado + uma ação**. Zero prosa dentro do fluxo: explicação vive em `Dica`
(ícone ⓘ ao lado da contagem) ou no "Como funciona" da página. Rótulo ≤ 3 palavras · estado ≤ 4
("Aguardando cliente", "Sala pronta") · descrição de página ≤ 1 linha **ou nenhuma** · número
primeiro ("22 dias sem contato") · um verbo por cartão · estado vazio = 1 linha + 1 ação.
Descrição longa que ainda importa vai para o `title` do elemento, não para um `<p>`.

**Vocabulário:** `src/lib/vocabulario.ts` é o dicionário único. `rotulo(chave)` na tela,
`titleDe(chave)` no `title`. Sigla do método (POP 03, DISC, régua, esteira, cron, n8n, Vapi,
Chatwoot, `SUPABASE_*`, 503) **nunca** aparece no fluxo. Termo com `soAdmin: true` só pode
existir na tela de quem é admin.

**Papel:** `BLOCOS_POR_PAPEL` (`src/components/painel/blocosPorPapel.ts`) decide o que existe.
Bloco fora da lista **não é renderizado** — sai do DOM, não fica escondido por CSS —, e o fetch
que ele faria não acontece. Para admin, aviso de sistema é 1 linha + 1 link, nunca parágrafo.

## 2. Escala tipográfica (classes exatas)

| Papel | Classe | V2 | V1 | Peso |
|---|---|---|---|---|
| Display (título de página) | `text-display font-bold text-tinta` | **24px** | 34px | 700 |
| Título (gaveta, diálogo, seção grande) | `text-titulo font-bold text-tinta` | **20px** | 24px | 700 |
| Subtítulo (cartão, item) | `text-subtitulo font-bold text-tinta` | **16px** | 18px | 700 |
| Corpo | `text-corpo text-tinta` / `text-tinta-suave` | **14px** | 16px | 400 |
| Corpo compacto (tabela, lista densa) | `text-sm` | **13px** | 15px | 400/500 |
| Legenda / meta | `text-legenda text-tinta-suave` | **12px** | 13px | 400 |
| Rótulo (sentence case, migração GPS-THB 14/09) | `text-rotulo font-semibold text-tinta-fraca` | 12px | 12px | 600 |
| Mínimo absoluto | `text-legenda` | 12px | 12px | — |

> **Um degrau, um nome.** `text-legenda` É o mínimo absoluto E a legenda/meta — a linha anterior e esta
> são o mesmo tamanho de propósito. Dois nomes para o mesmo degrau é como a escala volta a divergir.

`CabecalhoPagina` usa **um só tamanho** de título (`text-display`) — o
`text-titulo sm:text-display` da V1 saiu: a 24 px o título já cabe a 390 px.
Na Fase 6 `--text-xs` e `--text-legenda` já eram o mesmo valor (0,75rem / entrelinha 1,4) com dois nomes;
a Fase 7 (r2) unificou: 229 ocorrências de `text-xs` em 80 arquivos viraram `text-legenda`, e `--text-xs`
ficou em `globals.css` só como **alias** (`var(--text-legenda)`) por causa de 1 uso em arquivo de outro
agente. Alias não diverge — quando aquele uso migrar, o token sai.

**Alvo de toque:** com a escala menor, `-my-2.5 py-2.5` deixou de alcançar 44 px.
Alvo pequeno agora declara `min-h-11` explicitamente — não confie no padding.
Link de lista que precisa de elipse vira `-my-3 flex min-h-11 items-center py-3` com o
`truncate` num `<span>` interno: `text-overflow` precisa de caixa de bloco, e a caixa flex
é quem garante os 44 px (Fase 7 r2 — os links de nome em Hoje e em Clientes mediam 42,8 px).
Exceção declarada da WCAG 2.5.8: link **dentro de uma frase** (ex.: "3 produtos sem ID —
preencher em Produtos", Admin → Integrações) é alvo *inline* e não precisa de 44 px —
esticá-lo quebraria a linha do texto.

Pesos (migração GPS-THB, 14/09/2026): **400, 500, 600, 700** (`font-normal`, `font-medium`,
`font-semibold`, `font-bold`). A proibição de `font-semibold` da V1 valia para a Neuetra
(estática, só declarava 400/500/700 em `@font-face` — 600 seria sintetizado pelo navegador).
Ela saiu: Inter (corpo) e Space Grotesk (títulos) são fontes VARIÁVEIS — 600 é peso real,
carregado pelo `next/font/google`, nunca sintetizado (por isso `font-synthesis: none` também
saiu do `body`). `font-semibold` é agora o peso do rótulo que perdeu o `uppercase` (§8, B7).
Fonte: `text-corpo`/`text-sm`/`text-legenda`/`text-rotulo`/`text-subtitulo` herdam `--font-sans`
(Inter) do `body`; `h1..h4`, `text-titulo` e `text-display` usam `--font-serif` (alias de
`--font-display`, Space Grotesk); `--text-numero` (`Kpi`) declara `font-display` explícito.
Não declare `font-family` fora desses casos.

## 3. Catálogo de componentes (`@/components/ui/*`)

| Componente | Uso essencial |
|---|---|
| `Botao` | `<Botao variante="primario" carregando={salvando} onClick={…}>Salvar</Botao>` · `variante`: `primario` (1 por tela) · `secundario` · `perigo` · `fantasma` · `tamanho`: `normal`/`compacto`/`grande` · `icone` · `largo` · aceita `ref`. |
| `Cartao` | `<Cartao rotulo="Antes da sessão" titulo="Formulário" descricao="…" acao={<Botao tamanho="compacto">Editar</Botao>}>…</Cartao>` · `preenchimento`: `normal`/`compacto`/`sem` (tabela) · `realce`: `latao`/`ambar`/`verde`/`vermelho` · `como`: `section`/`article`/`div` · **`tituloTitle`** (Fase 7): a explicação longa que ainda importa vira o `title` do `<h2>` em vez de um `<p>` (§2.2) — mesma informação, zero altura. |
| ↳ *Cartao, 390px* | O cabeçalho é `flex-wrap`: a coluna do título pede `basis-56` (14rem) e o `<h2>` tem `break-words`. Sem os dois, título sem espaço (`cartorio.certidoes.valor`, e-mail, URL) vazava por baixo do selo da coluna `acao` — medido em Admin → Parâmetros a 390px na Fase 7 r2. Quando não cabem lado a lado, quem desce é a AÇÃO. |
| `CabecalhoPagina` | `<CabecalhoPagina rotulo="Dia a dia" titulo="Agenda" descricao="…" acoes={<Botao variante="primario">Nova janela</Botao>} meta={<Selo tom="neutro">…</Selo>} acima={<Link>← Esteira</Link>} />` — único `h1`. |
| `Campo` + `Entrada`/`Selecao`/`AreaTexto`/`Opcao` | `<Campo rotulo="Telefone" ajuda="Com DDD" erro={erros.telefone} obrigatorio><Entrada type="tel" value={…} onChange={…} /></Campo>` — id, `aria-describedby`, `aria-invalid` vêm do `Campo`. `Opcao` = rádio/caixa com alvo grande. |
| `Selo` | `<Selo tom="verde" icone={<svg…/>}>Pronto</Selo>` · tons: `verde`/`vermelho`/`azul`/`ambar`/`latao`/`neutro`. `SeloStub`, `SeloIA`, `SeloDemonstracao`, `SeloDadoExemplo` inalterados. |
| `Abas` | `<Abas abas={[{ id, rotulo, conteudo, grupo?, extra? }]} deepLinkHash semMoldura />`. |
| `Gaveta` | `<Gaveta aberta aoFechar titulo="Ligação" rotulo="Maria Silva" descricao="…" rodape={<Botao variante="primario">Salvar</Botao>} largura="larga">…</Gaveta>`. |
| `ConfirmarAcao` | `<ConfirmarAcao aberto titulo="Revogar link?" efeito="O cliente perde o acesso agora." perigo confirmando aoConfirmar aoCancelar />` (movido de `admin/`; o caminho antigo re-exporta). |
| `useToast` (`@/hooks/useToast`) | `const { notificar } = useToast(); notificar({ tom: "sucesso", titulo: "Ligação registrada" })` · `tom`: `sucesso`/`erro`/`aviso`/`info` · `descricao` · `acao: { rotulo, aoClicar }` · erro não some sozinho. Provider já está no `layout.tsx` raiz. |
| `Esqueleto*` | `<EsqueletoLista linhas={5} />` · `<EsqueletoCartao quantidade={3} />` · `<EsqueletoFicha />` · `<EsqueletoLinha largura="w-1/2" />`. |
| `Progresso` | `<Progresso rotulo="Gerando o briefing" etapas={[{rotulo:"Lendo o formulário"},…]} etapaAtual={1} tempoEsperado="costuma levar 30 a 60 segundos" cronometro />` · `valor` (0–100) só quando medido. |
| `Passos` | `<Passos passos={[{ id, rotulo, quem?, descricao? }]} atual="sessao" aoEscolher? />` — stepper "onde estamos". **`atual` é sempre o passo REAL, nunca o que o usuário está olhando** (ver §3.1). |
| `Kpi` | `<Kpi rotulo="Sessões esta semana" valor={7} comparacao={{ delta: "+2", sentido: "bom", contra: "semana passada" }} motivoVazio="ainda sem sessão nesta edição" />` — sem valor mostra "—", sem comparação medida não mostra comparação. |
| `EstadoVazio` | `<EstadoVazio ilustracao="agenda" titulo="Nenhuma sessão marcada" descricao="…" acao={<Botao variante="primario">Abrir agenda</Botao>} />` · `compacto` para dentro de cartão. `EstadoCarregando`, `EstadoErro` (com `tentarNovamente`), `EstadoIndisponivel` inalterados. |
| `Dica` | `<Dica texto="Abre o roteiro da sessão"><Botao …/></Dica>` — hover + foco + Esc, `aria-describedby`. |
| `ChecklistPendencias` | inalterado (`itens` de `calcularPendencias`). |
| `Trilho` | `<Trilho passos={derivarTrilho(sinais)} variante="completo" acao={{ rotulo, href \| onClick, title? }} nota="aguardando · Cliente" notaTitle="…" rotulo="Trilho da jornada" />` — ver §3.1. |

## 3.1 Componentes da Fase 5 (regras que não estão na assinatura)

**`Trilho`** (`ui/Trilho.tsx`) — os 9 passos da jornada, iguais na Ficha, na Esteira e na Agenda.
- Não deriva nada: recebe `passos` de `derivarTrilho()` (`lib/pasta/trilho.ts`) já pronto. `passos: []` → renderiza `null`.
- `variante`: `completo` (Ficha, com ação) · `compacto` (cartão da Esteira, linha da Agenda — `acao`/`nota` ignoradas).
- `acao` é **uma só** — montada pelo pai a partir de `derivarProximoPasso()`. `href` OU `onClick`, nunca os dois. O detalhe/sigla vai em `acao.title`.
- Sem ação clicável, `nota` (≤ 4 palavras, ex.: `aguardando · Cliente`) e a frase inteira em `notaTitle`. **Nunca um botão morto.**
- `resumoDoTrilho(passos)` → `"5 de 9 · Sessão · 4 de 15"`. Número primeiro (§2.2). `null` quando não há passo aceso — o componente cai no resumo de vazio rotulado ("Sem informação" / "9 de 9 · Entregue").
- 4 estados com **glifo próprio** (check · seta · traço de pulado · círculo vazio), nunca só cor; `<ol>` + `aria-current="step"` no aceso; alvo ≥ 44 px só onde há ação (marcador é indicador, não controle).
- **Leitura do marcador (Fase 7).** O glifo e o rótulo visível são `aria-hidden`, e o rótulo some abaixo de `sm`: o `sr-only` é a ÚNICA leitura do passo. Formato fixo, por `leituraDoPasso()`: **`passo 7 de 9: Contrato — agora`** — posição, tamanho do todo, nome INTEIRO do passo (`TITULO_TRILHO`, não o rótulo de ≤ 1 palavra) e estado, mais o motivo entre parênteses quando existe. Na variante `sessoes` o índice é o do trilho inteiro, não o da sessão: "passo 1 de 9" para o 7º passo seria mentira.

**`Trilho variante="sessoes"` (Fase 6)** — a Ficha desenha os 9 passos AGRUPADOS nas
**três sessões** que são a espinha do produto (Viabilidade · Croqui estrutural · Entrega da
holding). Recebe `sessoes={agruparPorSessao(passos)}` (`lib/pasta/trilho.ts`) além de `passos`.
As três aparecem sempre; **só a `atual` abre** e mostra os micro-passos. Sem passo aceso,
nenhuma acende — o trilho não inventa posição. `desfecho` (opcional) troca o resumo "Parado"
pelo desfecho real: uma jornada GANHA no meio do trilho **terminou**, não parou.
O botão da ação de agora carrega `data-acao-agora` — é o que o contador de aceite mede.

**Recolher em vez de esconder (Fase 6).** Lista longa e seção de consulta usam `<details>`
**nativo** (Tab, Enter, Ctrl+F e leitor de tela de graça, sem JS) com `<summary>` de `min-h-11`
e o par "ver / esconder" em `group-open:`. Regras:
- o grupo da sessão ATUAL nasce aberto; os outros, fechados com o resumo ("2 de 5");
- lista sem teto ganha corte + botão com o número na frente ("Ver os 52 casos") — o croqui
  media 6.278 px e o repertório 5.110 px por listar tudo sempre;
- `@media print` reabre todo `<details>`: a folha que vai para a reunião leva o conteúdo
  inteiro (`globals.css`).

**Bloco recolhido diz o que há dentro (Fase 7).** `ficha360/BlocoRecolhivel.tsx` é o
`<details>` padrão da Ficha: `<summary>` de `min-h-11` com o título de negócio + o
**resumo do conteúdo** (`15 de 18 prontos · 3 a pedir`, `Croqui Estrutural`) + o par
`ver`/`esconder`. Um recolhido sem resumo obriga a abrir só para descobrir se vale abrir —
é pior que o aberto. Regra: **nasce fechado**, sempre; quem precisa abre (Tab + Enter), e
o deep-link por hash abre por conta própria.
Aplicado em `RadarDocumentos recolhivel` e `CartaoCroqui recolhivel`: os dois abriam
sozinhos a partir da 2ª sessão e a Ficha avançada media **1.503 px** (medido a 1440×900 em
`croqui_apresentado`); recolhidos, **917 px**.

**`Dica`** — o balão só existe no DOM quando aparece, e se desloca para dentro da janela depois
de medir. Antes ele ficava sempre montado com `opacity-0` e **quatro tooltips invisíveis
criavam rolagem horizontal em `/hoje` a 390 px**.

**`Bloco`** (`painel/Bloco.tsx`) — bloco do painel **sem nada pendente vira UMA LINHA**, não um
cartão: a boa notícia continua verde e com check, mas não ocupa o espaço de um bloco que tem
trabalho. Hierarquia visual é a informação.

**`Passos`** (`ui/Passos.tsx`) — o stepper curto dentro de uma tela (Sessão: Horário → Confirmação → Sala → Presença).
- **O "feito" sai do índice, não do estado**: tudo antes de `atual` vira check verde. Portanto `atual` recebe o passo **real**, nunca o passo que o usuário abriu para olhar — passar o passo aberto carimba "concluído" em etapa que nunca aconteceu (bug pego no navegador, `SessaoAba.tsx:85-95`). Quem sinaliza o bloco aberto é o `<h3>` do bloco, não o stepper.

**`TabelaCroqui` / `FaltaDaTabela`** (`components/croqui/`) — uma componente genérica para as 19 tabelas do croqui.
- `<TabelaCroqui tabela={t} superficie="tela|publico|projecao|documento" mostrarProcedencia colunasOcultas={[…]} rodape={<FaltaDaTabela falta={…} />} nivelTitulo="h3" comTitulo />`.
- Procedência por **glifo**, com a explicação no `title`: `✎` digitado · `≈` estimativa por percentual · `ƒ` calculado (só com `mostrarProcedencia`, senão são ~250 glifos de ruído).
- **Célula sem insumo é `—`, nunca zero**, com o motivo no `title` e no leitor de tela. A chave do parâmetro e o link "Cadastrar" ficam na tira de `FaltaDaTabela`, embaixo — nunca dentro da célula.
- `superficie="publico"` corta procedência, fórmula, motivo e nome de parâmetro: o corte é da **serialização**, não da folha de estilo.

**Croqui — uma tela, um deck, uma narrativa** (`components/croqui/`, rodada de correção da Fase 5).
- **`DeckTabelas`** é o único deck de impressão do croqui (as 19 tabelas). `DeckImpressao.tsx` (13 slides de prosa) foi **apagado** — 0 importadores.
- **`GraficoDoSlide`** perdeu o caso `economia` e o campo `dados.cenario`: o número da economia é T11/T12 do motor, e nenhuma tela alimentava mais o Cenário Patrimonial ali (gráfico que nunca teria dado). `mapearCenarioParaEconomia` saiu junto de `mapeamentoGraficos.ts`.
- **`NarrativaCroqui`** (`<NarrativaCroqui croquiId={id} />`) — as notas do apresentador. Estado em 1 linha (`N notas · M perguntas`) + UMA ação ("Gerar narrativa"). 409 `narrativa_inativa` vira `SeloStub` + link `Admin · Prompts`, nunca erro de rede.
- **`ApresentarCroqui`** registra a apresentação (`POST /api/croquis/[id]/apresentacao`): `iniciar` só quando há deck (estado vazio não inventa reunião), `encerrar` com `slides_vistos` ao sair. Falha vira toast `aviso` — registro nunca trava o projetor.
- **Aba Croqui da Ficha**: `CroquiCalculado` é o conteúdo; o editor de 13 slides da IA v1 fica recolhido em `Cartao` "Versão anterior · Narrativa da IA" com uma ação ("Abrir editor", `aria-expanded`). Sem registro de croqui: 1 linha + "Iniciar croqui".
- Botão primário do `CroquiCalculado`: **"Calcular croqui"** enquanto não há versão fixada, "Fixar versão" depois — mesma rota, o nome acompanha o estado.

## 4. Padrões de página

- **Página**: `<div className="flex flex-col gap-bloco">` → `CabecalhoPagina` (com a **linha de propósito** em `descricao`, que carrega `data-proposito`) → seções. Na V2 o degrau raiz é `gap-bloco`; `gap-secao` só quando a tela tem seções realmente distintas.
- **Seção**: `Cartao` com `rotulo` + `titulo`; ou, quando é uma grade de cartões, `<h2 className="text-subtitulo font-bold">` solto acima da grade.
- **Lista**: `Cartao preenchimento="sem"` + `<ul className="divide-y divide-linha">`, cada `<li>` com `min-h-11` e o item inteiro clicável (`<Link>`/`<button>` ocupando o `li`).
- **Tabela**: dentro de `Cartao preenchimento="sem"`, `<th>` em `text-rotulo uppercase text-tinta-fraca`, linhas `min-h-11`, `hover:bg-papel`, primeira coluna em `font-medium`; em < 640px, vira lista de cartões (não scroll horizontal).
- **Formulário**: `flex flex-col gap-5`; um `Campo` por linha (duas colunas só em `sm:` para pares curtos como cidade/UF); ações no fim, primário à direita; `Botao type="submit" carregando`.
- **Gaveta**: para ver/preencher UMA coisa sem sair da tela; ação de salvar no `rodape`.
- **Modal**: só `ConfirmarAcao`. Nenhum outro modal.
- **Kanban/quadro**: coluna com cabeçalho `rotulo` + contagem; cartão `Cartao como="article" preenchimento="compacto"`.

## 5. Padrões de interação

- **Toda ação dá feedback em < 100 ms**: `carregando` no `Botao` que disparou, depois `notificar({ tom: "sucesso" })` ao concluir. O nome do botão e o do toast são o mesmo verbo ("Salvar" → "Salvo").
- **Erro sempre diz o que fazer**: `notificar({ tom: "erro", titulo: "Não foi possível salvar", descricao: "Confira a internet e tente de novo." })` ou `EstadoErro` com `tentarNovamente`.
- **Otimismo onde é reversível** (marcar/desmarcar, mover de coluna): aplica na hora, desfaz e avisa se falhar (`acao: { rotulo: "Desfazer" }` no toast).
- **Carregando**: `Esqueleto*` para layout que já se conhece; `EstadoCarregando` só para blocos pequenos. Trabalho > 3 s: `Progresso` com `cronometro` e `tempoEsperado`.
- **Onde estou**: `Passos` no topo de qualquer fluxo com etapas; `CabecalhoPagina rotulo` diz a área.
- **Teclado**: Tab chega em tudo; Enter/Espaço agem; Esc fecha gaveta/diálogo/paleta; setas nas abas; Ctrl/⌘+K abre a busca.
- **Movimento**: só como resposta a uma ação (`anim-surgir`, `anim-deslizar-direita`, `anim-esmaecer`). Nada de animação de entrada em cada cartão.

## 6. Acessibilidade (regras medidas)

- Alvo de clique/toque **≥ 44 × 44 px** (`min-h-11`); ícone sozinho = `h-11 w-11` + `sr-only`/`aria-label`.
- Fonte **≥ 12 px** (`text-legenda` é o piso); corpo **14 px** (B3: fixo, não sobe para 15/16 — decisão
  do Marcio na migração de 14/09, "tá tudo muito grande, tenho que escrolar muito").
- **Piso AAA (7:1 texto, 3:1 borda de controle), migração GPS-THB (14/09/2026, 2 rodadas).**
  Medido por `node scripts/contraste.mjs` (fórmula WCAG 2.1, lê os tokens direto do
  `globals.css`, roda nos dois temas) — não pelo `scripts/a11y.mjs` (axe, piso AA/4,5:1, não
  prova AAA). A 1ª rodada só tinha `--papel`/`--latao` aplicados (a tabela completa não tinha
  sido enviada ainda) e saiu com 8 falhas em `--tinta-fraca`. A 2ª rodada aplicou a tabela
  inteira do Marcio: **8 falhas → 3.**
  - `--tinta` 15,3–17,5:1 (claro) / 15,3–17,7:1 (escuro) — ok.
  - `--tinta-suave` `#57514b`/`#c2bbb1`: 7,4–7,8:1 (claro) / 8,5–9,8:1 (escuro) — ok, **exceto
    `tinta-suave / papel` no claro, 6,96:1** — abaixo do piso por 0,04; é o próprio valor da
    tabela recebida, não forçado a outro número. Reportado, não escondido.
  - `--tinta-fraca` `#524d47`/`#b8b1a8`: 7,4–8,4:1 (claro) / 7,6–8,8:1 (escuro) sobre
    papel-fundo/papel/papel-elevado — **resolvida** a falha que a 1ª rodada tinha deixado
    pendente. Só **`tinta-fraca / linha`** continua abaixo (6,49 claro / 6,33 escuro) — par
    fora da tabela recebida; `--linha` não tem par de texto real medido no código (grep não
    achou `text-tinta-fraca` sobre `bg-linha` como superfície de leitura — `--linha` só
    aparece como trilha/fundo decorativo nos usos atuais). Achado a decidir: tirar o par da
    lista de prova, ou tratar como exceção, ou escurecer `--tinta-fraca` mais um degrau.
  - `--latao` (B1, `#8f3600`): 7,4–9,6:1 no escuro (melhorou — `--latao` escuro agora é
    `#ffa559`, o `#ef7d00` antigo media só 5,87:1 e reprovava), 7,35–7,79:1 no claro — só
    **`latao / latao-fraco` = 6,80:1** segue como **exceção AAA documentada** (chip/selo de
    marca, nunca corpo de texto; passa AA com folga). `--estado-latao` usa o mesmo valor e
    herda a mesma exceção.
  - `--linha-controle`: 3,35–3,77:1 (claro) / 3,50–4,03:1 (escuro) — ok (piso 3:1, WCAG 1.4.11).
  - `--estado-*` (selo, Fase 8, §12.3): todos ≥ 7,08:1 nos dois temas, sobre as quatro
    superfícies onde aparecem — ok, com folga maior no escuro (8,1–11,0:1).
- **Auditoria de contraste rodada no DOM (Fase 7), não estimada.** Varredura de todo nó de
  texto visível com a cor e o fundo COMPUTADOS pelo navegador (fundo resolvido subindo a
  árvore, com composição de alfa), mínimo 4,5:1 (3:1 para ≥ 24 px ou ≥ 18,66 px bold), com
  todo `<details>` forçado aberto: **10 telas × 2 temas = 0 nó abaixo do mínimo**
  (`Hoje · Clientes · Agenda · Mensagens · Admin · /admin#repertorio · Ficha · /p/c · /p/m · /p/d`).
  Refaça esta varredura ao mexer em token de cor — é ela que prova, não o olho.
- Foco visível em tudo (contorno + halo já vêm de `:focus-visible`). `outline-none` só com `focus:shadow-foco` + borda de foco.
- Estado nunca só por cor: chip com texto, ícone ou forma diferente.
- `aria-live`: toasts (já), `role="status"` em carregando, `role="alert"` em erro.
- Formulário: `label for`, erro ligado por `aria-describedby` (o `Campo` faz), `noValidate` + validação nossa em blur/submit.
- `prefers-reduced-motion` já zera animações; não crie animação fora dos tokens.
- Dois temas sempre: use tokens, nunca hex fixo. Impressão: `nao-imprimir` em barra, botão e gaveta.

## 7. "Vazio é vazio"

Campo sem dado mostra "—" ou nada, nunca 0; `Kpi` sem `valor` mostra travessão + `motivoVazio`; lista vazia mostra `EstadoVazio` com a ação que a preenche; funcionalidade não pronta = `SeloStub`. Nunca placeholder com número plausível.

## 8. Não fazer

`text-[10px]` / `text-[11px]` · cor fixa (`#…`, `slate-*`, `bg-white`, `text-black`) fora de token · texto claro sobre laranja · `--latao` como fundo (use `--latao-cta`) · `--linha` em borda de input · `outline-none` sem substituto · `rounded-sm` novo (use `rounded-controle`/`rounded-cartao`) · "Tem certeza?" (descreva o efeito) · modal genérico · spinner em página inteira · polling · `opacity` para "desabilitar" texto que precisa ser lido · ícone sem `aria-hidden` ou sem rótulo · `uppercase` novo em rótulo de componente do design system (migração GPS-THB, B7: os 12 que existiam em `src/components/ui/` viraram `font-semibold` sentence case; `font-semibold` deixou de ser proibido — ver §2).

## 9. Checklist de migração de uma tela (10 itens)

1. `CabecalhoPagina` com rótulo da área, título, descrição e ações — único `h1`.
2. Todo bloco em `Cartao` (raio 0.5rem — T1, 16/09/2026 — sombra) ou grade de `Cartao`; nada de `border rounded-sm bg-papel-elevado` solto.
3. Zero `text-[10px]`/`text-[11px]`/hex fixo — grep antes de fechar. `font-semibold` é peso válido desde a migração GPS-THB (§2).
4. Todo botão é `Botao`; um `primario` por tela; todos com `carregando` na ação assíncrona.
5. Todo input dentro de `Campo` (rótulo, ajuda, erro); alvo ≥ 44px; erro humano com o que fazer.
6. Estados: `Esqueleto*` ao carregar, `EstadoErro` com tentar de novo, `EstadoVazio` com ação, `SeloStub` no que não existe.
7. Toda ação de escrita termina em toast (`useToast`), com o mesmo verbo do botão.
8. Teclado: Tab em tudo, Esc fecha, foco visível; testado sem mouse.
9. Tema escuro e 390px de largura conferidos no navegador (captura anexada ao diário).
10. Vocabulário do `Glossario.md` **via `src/lib/vocabulario.ts`** (§2.2); nada de dado inventado; impressão sem barra/botão.
11. Lei de texto (§2.2) medida: palavras visíveis fora de dado de cliente ≤ 50% do que havia; nenhum bloco de texto > 2 linhas fora de `Dica`.
12. Ritmo do §2.1: `gap-secao`/`gap-bloco`/`gap-cartao`/`gap-item`. Nenhum `gap-6`/`gap-8` novo.
13. **Densidade medida (Fase 6):** altura do documento ≤ 1080 px a 1440×900 e **zero rolagem horizontal a 390 px**, nos dois temas. Tela de LISTA declara a exceção com o número, não com adjetivo.
    Medido na Fase 7 (`document.body.scrollHeight`, 1440×900, jornada de exemplo em `croqui_apresentado`):
    Hoje 900 · Clientes 900 · Agenda 900 · Mensagens 900 · Admin 900 · **Ficha 1.503 → 917** ·
    **`/admin#repertorio` 1.684 → 959** · `/p/m` 1.259 · `/p/d` 1.212. Rolagem horizontal a 390 px: 0 em todas.
    **T1 (16/09/2026) reduz estes números de novo** (`Cartao`/`gap-*` mais densos, ver nota
    de topo do arquivo) mas não foi possível remedir no navegador nesta rodada (sem
    `.env.local` na máquina de execução) — só a aritmética por contagem de token × delta
    foi entregue (diário de 16/09). **Pendência: remedir com `next dev` de verdade antes de
    considerar o número acima como atual.**
    **Lista longa não usa "ver tudo": usa página.** Botão que despeja a base inteira faz o teto
    da tela depender do tamanho do banco (52 casos = 4.900 px, e cresce a cada reunião). Com
    paginação o teto é constante; o rodapé diz onde se está (`11–20 de 52 casos · página 2 de 6`),
    não só para onde dá para ir, e trocar filtro rebobina para a página 1.
14. **Linha de propósito:** toda tela do menu e toda aba dizem, em uma frase, para que servem (`CabecalhoPagina descricao` / `DefinicaoAba.descricao`). Zero jargão: POP, DISC, régua, esteira, cron, n8n, Vapi, token, webhook e `SUPABASE_*` não aparecem no fluxo — só em `title` ou em tela de admin.

## 10. Páginas públicas `/p/*` — o que é do LAYOUT, não da tela (Fase 7 r2)

As cinco páginas (`/p/f` formulário · `/p/a` agendamento · `/p/c` confirmação · `/p/d`
documentos · `/p/m` material) compartilham **um** shell: `src/app/(publico)/layout.tsx`.

| Elemento | Onde vive | Regra |
|---|---|---|
| Cabeçalho ("Planejamento Patrimonial · Time Holding Brasil · Dra. Elaine Montenegro") | layout | idêntico nas 5. Nenhuma tela declara o seu. |
| Rodapé: contato do escritório + aviso de sigilo | layout (`ContatoEquipe`) | **uma vez por tela.** Sem `NEXT_PUBLIC_CONTATO_*` a frase é "fale com quem te enviou este link" — nunca um número inventado. Não repita o `ContatoEquipe` dentro da página só para ter contato: o rodapé já tem. Repita só quando for uma AÇÃO daquele estado ("Precisa mudar o horário?"). |
| Link vencido/revogado/inexistente | `TelaLinkInvalido` | **uma** mensagem para todos os casos — distinguir transformaria a rota em oráculo de existência (ARQUITETURA-FASE-2 §2.2). |
| Carregando · erro passageiro | `CarregandoPublico` · `ErroTemporarioPublico` | as 5 usam os mesmos dois. |
| Tipografia | `.area-publica` | corpo 17px, alvo ≥ 52px no CTA. `text-legenda` (12px) é o piso da ÁREA DA EQUIPE — no público, o menor é `text-sm`. |

**Formulário passo a passo:** ao trocar de passo, o foco vai para um `<p className="sr-only" tabIndex={-1}>`
com "Passo N de T: <bloco>" e a página rola para o topo do passo. Foco em `<fieldset>` não serve:
a regra global `:focus-visible` pinta um halo laranja em volta do cartão inteiro.
Obrigatoriedade viaja por `aria-required` + `<span className="sr-only"> (obrigatória)</span>` —
o asterisco vermelho é `aria-hidden` e sozinho não diz nada a quem não vê.

## 11. Performance — o que já é regra e como se mede (Fase 7 r3)

Medido em 06/09/2026 com Playwright + `performance.getEntriesByType("resource")`
contra `next dev` (Turbopack), 1440×900, **cache HTTP frio** (um contexto novo por
tela) e a rota já compilada. Número de `dev` **não é** número de produção — o
bundle não passou por minificação nem tree-shaking. O que vale aqui é a
**diferença entre duas rodadas na mesma máquina**, nunca o valor absoluto.

| Tela | JS antes | JS depois | LCP antes → depois | CLS |
|---|---|---|---|---|
| `/hoje` | 6.552 KB | 6.587 KB | 204 → 224 ms | 0,009 |
| `/clientes` | 5.191 KB | 5.226 KB | 900 → 868 ms | 0,004 |
| Ficha (`/jornadas/[id]`) | **8.091 KB** | **5.538 KB (−31,6%)** | 1.268 → 1.332 ms | 0,046 |
| `/croquis/[id]` | 5.247 KB | 5.282 KB | 808 → 828 ms | 0,000 |
| `/admin` | 5.764 KB | 5.799 KB | 968 → 1.064 ms | 0,000 |

### As três regras

1. **Tela que só aparece quando alguém pede não entra na carga inicial.** As onze
   gavetas da Ficha chegam por `dynamic()` com `loading:` — `Gaveta` devolve
   `null` fechada, então o módulo só é buscado no clique. Foi o que tirou 2,5 MB
   da abertura da Ficha e derrubou a interação de abrir gaveta de 88 ms para
   40 ms. **`next/dynamic` exige objeto literal nas opções**: fatorar o
   `{ loading: … }` numa função quebra a compilação (erro
   `invalid-dynamic-options-type`), e o `tsc` não pega — só o navegador.
2. **Toda rota de menu tem `loading.tsx`**, com o esqueleto de `ui/Esqueleto` que
   tem a forma do que vem. Sem ele o App Router segura a tela ANTERIOR na frente
   até o RSC chegar, e quem clicou clica de novo. Esqueleto não é dado inventado:
   é silhueta `aria-hidden` com um `role="status"` que anuncia uma vez.
3. **Otimização sem número medido não entra.** Nesta rodada o `dynamic()` da
   paleta de comandos (Ctrl+K) foi implementado, medido — **+9 KB e 3 requisições
   a mais, zero ganho de LCP**, porque as dependências dela já estavam no chunk do
   shell — e **revertido**. Código a mais que não paga é regressão.

### Onde NÃO tem gordura (não procure de novo)

- **Imagens:** o sistema não tem nenhuma. Zero `<img>`, zero `next/image` em
  `src/`. A marca é SVG inline. Não há CLS de imagem para corrigir.
- **CLS:** a pior tela é a Ficha com 0,046 — folgado abaixo do limite de 0,1.
- **`React.memo`:** nenhum foi acrescentado. A regra da casa é `memo` só com
  prova de rerender no profiler; sem a prova, é ruído que envelhece mal.

## 12. Estado, prazo, escala de texto e mobile (Fase 8)

A fase da usabilidade. Ordem do João: *"refinar visualmente todo o sistema, com foco em USABILIDADE…
o próprio sistema indica o que está acontecendo… bem no ramo da advocacia: intuitivo para um advogado
entender o que funciona e como funciona o processo"*, com dois adendos que mudam o alvo: **usuário de
mais idade** e **mobile de verdade**. Este parágrafo é o contrato; os números foram medidos, não estimados.

### 12.1 A lei: nenhum ícone sem rótulo

Vale em toda tela, sem exceção declarada: **todo ícone ou é `aria-hidden` ao lado de um texto que diz a
mesma coisa, ou tem rótulo visível.** Ícone sozinho como única pista de uma ação é proibido — e "sozinho"
inclui o botão-ícone com `sr-only`: para quem enxerga e não decorou o pictograma, o `sr-only` não existe.
Onde o espaço não permite rótulo (barra de ferramentas de tabela densa), a exceção é **declarada aqui**,
com `title` + `aria-label`, nunca improvisada na tela.

O corolário, que já era regra e agora é impossível de violar: **status é cor + ícone + rótulo, nunca só
cor.** O teste é o grayscale: se, sem matiz, dois estados do mesmo domínio ficam indistinguíveis, o
componente está errado — e o `catalogo.test.ts` reprova o commit ("dois estados nunca dividem o mesmo glifo").

### 12.2 Escala de texto do usuário

| Escolha | Corpo | `--fator-escala` | Para quem |
|---|---|---|---|
| **Padrão** (default) | 14 px | 1 | o João, que mediu a V2 e pediu compacto |
| Média | 16 px | 1,1429 | o piso que a pesquisa exige para 55+ |
| Grande | 18 px | 1,2857 | leitura longa, tela pequena, vista cansada |

Seletor `EscalaTexto` (`shell/`), no rodapé da lateral ao lado do `TemaToggle`; `localStorage`
(`sic-hf-escala`) com `try/catch`; aplicado antes do primeiro paint por script inline no `AppShell`.
O fator multiplica **só os degraus tipográficos** (`--text-*`). O que NÃO se mexe: `--alvo-minimo` (44 px),
o ritmo vertical (`--espaco-*`) e a `.area-publica`, que zera o fator — a preferência é da equipe, e o
cliente não tem seletor. `html { font-size }` continua nunca sendo declarado (a trava do `globals.css`):
mexer na raiz mudaria todo alvo de toque de uma vez, em silêncio.

### 12.3 Catálogo de estados — um dicionário, um componente

`src/lib/estados/catalogo.ts` é a fonte única. Oito domínios (`croqui`, `croqui_fato`, `pagamento`,
`processo`, `prazo`, `agendamento`, `mensagem`, `integracao` — mais `presenca`, alias de `agendamento`),
cada entrada `{ rotulo, icone, tom, explique }`, com a chave sendo **o valor cru do banco**.
Duas leituras que o catálogo tranca porque a tela errava sozinha: **C23** — `status_agendamento =
'confirmado'` é *"o cliente escolheu o horário"* (rótulo **"Horário marcado"**), NÃO "confirmou
presença", que mora em `agendamentos.presenca_confirmada_em`; e **integração sem informação do
servidor é "Estado desconhecido", nunca "desligada"** (`classificarIntegracao`). `ui/SeloEstado.tsx` é o único selo de status e o consome:

```tsx
<SeloEstado dominio="pagamento" estado={pagamento.status} />      // "Pago", check, verde
<SeloEstado dominio="processo" estado={jornada.desfecho} />       // congelada → "Arquivado"
<SeloEstado dominio="croqui" estado={fase} anunciar />            // role="status" quando muda sozinho
```

**Nenhuma tela escolhe `tom` na mão a partir da Fase 8.** O tom é do ESTADO, não da tela — era assim que
a mesma situação aparecia âmbar num lugar e cinza no outro. Não há prop de cor nem de rótulo, de propósito.

### 12.4 Migração de paleta/tipografia GPS-THB (14/09/2026)

Ordem do Marcio: trocar paleta e tipografia do SIC-HF para o padrão visual do GPS-THB, preservando
nome de token (B4), corpo 14px (B3) e a trava AAA/7:1 (Fase 8). Nomes de token continuam em português
e sem alteração (`--papel*`, `--tinta*`, `--linha*`, `--latao*`) — só o VALOR mudou.

- **Fonte:** Neuetra (3 `@font-face` locais) → Inter (`--font-sans`, corpo) + Space Grotesk
  (`--font-display`, títulos/`--text-numero`), via `next/font/google` em `layout.tsx`, `display:
  "swap"`. `font-synthesis: none` saiu do `body` — as duas são fontes VARIÁVEIS (eixo completo),
  600 é peso real, não sintetizado. `.woff2` da Neuetra continuam em `public/fonts/` até aprovação
  do Marcio (remoção em commit separado, granularidade de reversão).
- **`font-semibold` deixou de ser proibido** (§2, §8) — a proibição valia só para a Neuetra estática.
- **B1** — `--latao: #8f3600` (era `#a84d00`). Exceção AAA documentada em `globals.css`; ver §6.
- **CF4** — `--papel: #f5f1ec` (não o `#f1ede8` cru do GPS): com o valor cru, `--tinta-suave` caía a
  6,71:1 sobre `--papel`, abaixo do piso desta rodada.
- **2ª rodada (correção do Marcio, mesmo dia)** — a 1ª rodada só tinha `--papel`/`--latao`
  aplicados; a tabela completa (superfícies claras + tema escuro derivado) não tinha sido
  enviada ainda. Aplicada na íntegra: `--tinta`/`-suave`/`-fraca`, `--linha`/`-forte`/
  `-controle`, `--latao-forte`/`-fraco`/`-cta`/`-cta-forte`/`-cta-texto`, `--verde`/
  `--vermelho`/`--ambar` (+`-fraco`), `--estado-*` nos dois temas. `--azul`/`--ambar-borda`
  mantidos (sem equivalente no GPS). `scripts/contraste.mjs`: 8 falhas → 3 (ver §6).
- **B5** — tema escuro derivado QUENTE (`#14120f`/`#1c1917`/`#23201d`, viés marrom — não mais
  cinza-azulado neutro). `--latao` escuro corrigido para `#ffa559` na 2ª rodada — o `#ef7d00`
  da 1ª rodada media só 5,87:1, abaixo do piso; `linha-controle` melhorou 3,10–3,50 → 3,50–4,03.
- **B2** — `Botao` primário: retângulo chapado (`rounded-controle`, sem aresta 3D, sem
  `hover:-translate-y-px`).
- **B3** — corpo continua 14px; só o `line-height` subiu para 1,6 (do GPS).
- **Raio/foco/sombra:** `--raio-cartao` 1rem→0.75rem, `--raio-controle` 0.75rem→0.5rem; `--foco`
  halo `rgba(239,125,0,.28)` (o `--ring:#ef7d00` cru do GPS mede 2,76:1 como contorno sólido,
  abaixo do piso 3:1 de 1.4.11 — por isso o contorno de `:focus-visible` continua em `--latao`);
  `--sombra-cartao` reduzida (CF3) — **cartão passa a se distinguir quase só pela borda** (1,12:1
  entre `--papel-elevado` e `--papel`); confirmar em captura real antes de considerar fechado, e se
  a distinção não bastar o remédio é escurecer `--papel-fundo`, nunca reengordar a sombra.
- **B7** — os 12 `uppercase` de `src/components/ui/` viraram `font-semibold` sentence case
  (`Abas`, `CabecalhoPagina`, `Cartao`, `ConfirmarAcao`, `Gaveta`, `Kpi`, `Passos`, `Quadro`,
  `Selo`×2, `Tabela`×2). Os demais ~90 `uppercase` fora do DS ficaram de fora — pendência em
  `CONTINUAR-AQUI.md`.
- **`Cartao.realce`** estreitado de `"latao"|"ambar"|"verde"|"vermelho"` para `"ambar"|"vermelho"`
  (só alerta real); `border-l-4`→`border-l-2`. 6 consumidores decorativos perderam a prop.
- **`Quadro.tom`** (painel do Copiloto) — proposta inicial de manter os 5 tons por "natureza
  do bloco" foi **revista e revertida pelo Marcio**: medido de novo, `roxo` e `azul`
  renderizavam a MESMA `var(--azul)` (só a opacidade do fundo mudava) e `ambar` marcava dois
  quadros diferentes (5 e 6) sem diferenciá-los — 5 tons produzindo 4 cores, 2 indistinguíveis,
  não é taxonomia. Decisão final: `TomQuadro` estreita para `"ambar"|"vermelho"`; só o quadro 2
  (Alerta) e o quadro 7 quando `!acertou` mantêm cor — os quadros 1, 3, 4, 5, 6 e o 7 quando
  `acertou` ficam sem `tom` (chapados). `bg-*-fraco/40` (fundo tingido) removido — não estava na
  instrução do mock e é mais enfeite que a borda. `border-l-4`→`border-l-2` e
  `uppercase`→`font-semibold` mantidos. Estrutura dos 7 quadros (posição, ordem, numeração)
  intocada.
- **Divergências do plano com a realidade medida** (reportadas, não corrigidas por conta própria):
  a tabela completa "valores crus do GPS" citada no plano (sombras `--shadow-raised`/`-hover`,
  demais tokens C1–C9) não estava disponível nesta execução — só os pontos citados explicitamente
  no pedido; os tokens não especificados foram preservados como já corrigidos (Fase 8). O número
  "6,80 sobre `--latao-fraco`" citado para B1 não reproduziu — medido 6,34 (claro) / 5,16 (escuro,
  antes do ajuste do derivado quente) contra o `--latao-fraco` real do arquivo; a exceção documentada
  usa o número medido. `--marrom`: plano citava 11 usos a auditar; medido, existem 4 ocorrências no
  código (2 declarações de tema + 1 mapeamento `@theme` + 1 consumidor funcional em
  `esteira/etapas.ts`, cor da etapa `violet` vinda do banco) — token fica, não é decorativo.
Chave que o catálogo não conhece vira **"Sem informação"**, nunca um rótulo plausível (§7, "vazio é vazio").
`Selo` continua existindo para chip que **não** é status (contagem, marcador, `SeloStub`, `SeloIA`).

Contraste: selo de status e prazo usam `--estado-*`, medidos em **≥ 7:1** (AAA) sobre o fundo `-fraco` do
próprio tom e sobre as três superfícies, nos dois temas — a pesquisa para 55+ pede mais que o AA de 4,5:1.
Claro: verde `#26563f` 7,17 · âmbar `#694707` 7,16 · vermelho `#843227` 7,03 · azul `#324f70` 7,08 ·
latão `#7a3800` 7,15 · neutro `#43454f` 8,93. Escuro: `#90c1a9` 7,01 · `#e4b23c` 7,25 · `#e59b8e` 7,10 ·
`#8fb0d6` 7,01 · `#ffa559` 7,06 · `#b3b0a3` 8,16. Os tokens `--verde`/`--ambar`/… **não** mudaram: quem
precisa de AAA pede `--estado-*`.

### 12.4 Prazo é informação própria

`ui/Prazo.tsx`, separado do status (padrão ADVBOX/Astrea — o advogado procura a data antes do resto):

```tsx
<Prazo vence={tarefa.vence_em} />                 // "Vence hoje · 07/09"
<Prazo vence={tarefa.vence_em} rotulo="Prazo" />  // o rótulo vai para o leitor de tela
```

Mostra **as duas leituras**: a relativa, que decide ("Vencido há 3 dias"), e a absoluta em `<time>`, que se
anota. Quatro classes com glifo próprio: vencido (vermelho) · vence hoje (âmbar) · vence em breve, ≤ 3 dias
(âmbar) · no prazo (neutro). Sem data é **"Sem prazo"**, que não é o mesmo que estar em dia.
Compara por **dia**, não por 24 h corridas, e trata o `date` do Postgres como data local — `new Date("2026-09-07")`
é meia-noite UTC e, em São Paulo, vira 06/09: sem isso o prazo de hoje aparece vencido. O mesmo furo
existia em `formatarData()` e em duas cópias da correção (`agenda/rotulos.ts`, `admin/comum.tsx`) —
na rodada FIX virou **uma** função, `formatarDataPura()` em `lib/formatar.ts`, e `formatarData()`
passou a reconhecer `YYYY-MM-DD` puro e formatá-lo sem fuso. Data de calendário nunca mais converte.

### 12.5 Tabela: uma API, duas formas

`ui/Tabela.tsx` substitui o par "`<table>` com `hidden sm:block` + pilha de cartões com `sm:hidden`" que se
mantinha na mão em dois lugares (foi assim que coluna nova entrou numa forma e não na outra, na Fase 7).

```tsx
<Tabela legenda="Compras do processo" colunas={COLUNAS} linhas={linhas}
        chaveDaLinha={(l) => l.id} hrefDaLinha={(l) => `/clientes/${l.id}`}
        vazio={<EstadoVazio … />} acoes={(l) => <Botao tamanho="compacto">Reprocessar</Botao>} />
```

`legenda` é obrigatória (vira `<caption class="sr-only">` — tabela sem legenda é grade anônima); todo `<th>`
leva `scope="col"`; o mesmo `cabecalho` vira o rótulo do par `<dl>` no cartão, então desktop e celular
**não podem** divergir de nome. Acima de `md` (configurável em `quebra`) é `<table>`; abaixo, cartões — a
360 px nunca há rolagem horizontal. `hrefDaLinha` põe o link na primeira célula e, no cartão, no título com
`after:absolute inset-0`: o cartão inteiro é clicável com **um** ponto de Tab e semântica de link de verdade
(nada de `onClick` em `<tr>`). `acoes` é declarado **uma vez** e aparece nos dois lugares — última coluna
da grade (cabeçalho `sr-only`, `gap-alvo` entre botões) e rodapé do cartão; declarar uma coluna de ação
na mão é o contorno que esta prop existe para apagar.

### 12.6 Mobile

| Regra | Como se cumpre |
|---|---|
| Barra inferior com os 5 itens, ícone **+ rótulo** | `shell/NavInferior.tsx` — mesmos `ITENS_NAVEGACAO`, mesma ordem, mesmos rótulos da lateral; `aria-current="page"`; landmark com nome próprio ("Áreas do sistema"), porque a lateral continua no DOM com o dela |
| Tabela vira cartão, 0 rolagem horizontal a 360 px | `ui/Tabela.tsx` |
| Ação primária na zona do polegar | `ui/BarraAcaoMobile.tsx` — fixa acima da `NavInferior`, `nao-imprimir`, com **espaçador no fluxo** |
| Foco nunca atrás de barra fixa (WCAG 2.4.11) | `scroll-margin-block` global no `:focus-visible` + os espaçadores das duas barras |
| Gap entre alvos adjacentes ≥ 8 px | token `--alvo-gap` → classe `gap-alvo` |
| `Gaveta` em tela cheia volta, não fecha | `< sm` o botão é **← Voltar**; de `sm` para cima, **✕ Fechar**. Tela cheia é página, não janela |
| Piso de 16 px na área do cliente | token `--text-publico` → classe `text-publico`, fixo e sem `--fator-escala` (a escala da equipe não vaza para `/p/*`) |
| Mesma nomenclatura e ordem desktop ↔ celular | os dois consomem a MESMA fonte (`ITENS_NAVEGACAO`, `colunas`) |

`--altura-nav-inferior` vale 3,75rem abaixo de `md` e **0 a partir de `md`** — é o que faz `BarraAcaoMobile`
e o `scroll-margin` se posicionarem sozinhos, sem media query própria.

### 12.7 Como se verifica (três camadas, e o que cada uma NÃO prova)

| Camada | Ferramenta | Onde roda | Cobre |
|---|---|---|---|
| estática | `eslint-plugin-jsx-a11y`, 31 regras declaradas em `eslint.config.mjs` | `npm run lint` → **CI** | rótulo, `aria-*`, papel, clique em elemento não interativo |
| componente | `vitest-axe` + jsdom nos `*.test.tsx` | `npm test` → **CI** | árvore de acessibilidade do componente isolado |
| página | `node scripts/a11y.mjs` | **local**, contra `next dev` | ordem de leitura, landmark duplicado, contraste computado, rolagem horizontal, altura |

O axe de página **não entra no CI**: o CI não tem banco nem segredo e toda tela interna exige sessão —
ele rodaria contra o login e passaria verde sem ter visto nada. Nenhuma das três dispensa o que só a mão
pega: **Tab sem mouse** com a gaveta aberta e a **captura em grayscale** de Hoje, Clientes e Ficha.
Dívida herdada de `jsx-a11y` (10 avisos em 8 arquivos de outros donos) está listada, com dono, dentro do
`eslint.config.mjs` — a lista só encolhe.
