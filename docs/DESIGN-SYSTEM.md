# Design system do SIC-HF — contrato de migração (V1, 04/09/2026)

Para ser **seguido**, não lido. Quem migra uma tela abre isto, aplica, marca o checklist do fim.
A referência é o seminário (`guardioesdolegado.com.br/ak1`): creme, cartão branco de raio grande, tinta escura,
laranja só em CTA, Neuetra em tudo, rótulo pequeno em caixa alta + título grande, muito respiro.
**Acessibilidade vence fidelidade.** Quem usa tem 60+ anos e vive de e-mail e WhatsApp.

Fonte de verdade: `src/app/globals.css` (tokens) e `src/components/ui/*` (componentes).

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
| `--raio-cartao` 1.25rem / `--raio-controle` 0.75rem / `--raio-pilula` | `rounded-cartao` / `rounded-controle` / `rounded-pilula` | cartão / input, botão, aba / CTA primário e chip. |
| `--transicao-rapida` 120ms / `--transicao-normal` 220ms / `--suavizacao` | `duration-[var(--transicao-rapida)] ease-[var(--suavizacao)]` | hover, foco / abrir, entrar. |
| `--foco` | `shadow-foco` (já vem em `:focus-visible`) | halo de foco. Nunca `outline-none` sem substituto. |
| `--espaco-secao` · `--espaco-bloco` · `--espaco-cartao` · `--espaco-item` | `gap-secao` · `gap-bloco` · `gap-cartao` · `gap-item` | ritmo vertical — ver §2.1. Nunca escolha `gap-6`/`gap-8` no olho. |

`rounded-sm/md/lg` do Tailwind foram remapeados (10px / 14px / 20px) e `text-xs/sm` sobem para 13px/15px —
telas antigas já ganham o raio e o tamanho novos sem edição. Na migração, troque pelos nomes semânticos.

## 2.1 Ritmo vertical — uma escala só (Fase 5)

Diagnóstico do João: "muitos blocos grudados uns nos outros, texto entortado em alguns".
Causa: cartão com 1,5rem de padding separado por 1,5rem de gap não lê como bloco distinto, e
`letter-spacing: -0.015em` valia até em `h3` de 15px, onde tracking negativo cola as letras.

**Regra: o degrau de fora é sempre maior que o de dentro.**

| Degrau | Token | Classe | Onde |
|---|---|---|---|
| Seção | `--espaco-secao` 2.5rem | `gap-secao` | entre seções de uma página (`<div className="flex flex-col gap-secao">` na raiz da tela) |
| Bloco | `--espaco-bloco` 1.75rem | `gap-bloco` | entre cartões de uma mesma seção, e entre linhas de uma grade de cartões grandes |
| Cartão | `--espaco-cartao` 1.5rem | `gap-cartao` / `p-cartao` | dentro do cartão: entre grupos, entre KPIs de uma faixa |
| Item | `--espaco-item` 0.75rem | `gap-item` | entre chips, entre linhas de uma lista densa, entre rótulo e valor |

Tipografia: entrelinha de título é `1.18` (display) e `1.28` (título) — folga para o título que
quebra em duas linhas na Neuetra bold. **`h1`–`h4` não declaram `letter-spacing`**: ele vem do
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

| Papel | Classe | Tamanho | Peso |
|---|---|---|---|
| Display (título de página) | `text-display font-bold text-tinta` | 34px | 700 |
| Título (gaveta, diálogo, seção grande) | `text-titulo font-bold text-tinta` | 24px | 700 |
| Subtítulo (cartão, item) | `text-subtitulo font-bold text-tinta` | 18px | 700 |
| Corpo | `text-corpo text-tinta` / `text-tinta-suave` | 16px | 400 |
| Corpo compacto (tabela, lista densa) | `text-sm` | 15px | 400/500 |
| Legenda / meta | `text-xs text-tinta-suave` | 13px | 400 |
| Rótulo caixa alta | `text-rotulo font-medium uppercase text-tinta-fraca` | 12px | 500 |
| Mínimo absoluto | `text-legenda` | 12px | — |

Pesos: **400, 500, 700 apenas** (`font-medium`, `font-bold`). `font-semibold` sintetiza bold falso — proibido.
Fonte: Neuetra vem do `body`; não declare `font-family`.

## 3. Catálogo de componentes (`@/components/ui/*`)

| Componente | Uso essencial |
|---|---|
| `Botao` | `<Botao variante="primario" carregando={salvando} onClick={…}>Salvar</Botao>` · `variante`: `primario` (1 por tela) · `secundario` · `perigo` · `fantasma` · `tamanho`: `normal`/`compacto`/`grande` · `icone` · `largo` · aceita `ref`. |
| `Cartao` | `<Cartao rotulo="Antes da sessão" titulo="Formulário" descricao="…" acao={<Botao tamanho="compacto">Editar</Botao>}>…</Cartao>` · `preenchimento`: `normal`/`compacto`/`sem` (tabela) · `realce`: `latao`/`ambar`/`verde`/`vermelho` · `como`: `section`/`article`/`div`. |
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
- 4 estados com **glifo próprio** (check · seta · traço de pulado · círculo vazio), nunca só cor; `<ol>` + `aria-current="step"` no aceso; rótulo em `sr-only` abaixo de `sm`; alvo ≥ 44 px só onde há ação (marcador é indicador, não controle).

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

- **Página**: `<div className="flex flex-col gap-secao">` → `CabecalhoPagina` → seções; cartões dentro de uma seção com `gap-bloco` (§2.1).
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
- Fonte **≥ 12 px** (`text-legenda` é o piso); corpo 15–16 px.
- Contraste medido (fórmula WCAG): `--tinta` 17,4:1 · `--tinta-suave` 9,5:1 · `--tinta-fraca` 5,3:1 (creme) / 6,0:1 (branco) · `--latao` 5,0:1 (creme) / 5,6:1 (branco) · CTA texto 6,4:1 · `--linha-controle` 3,5:1 · escuro: `--tinta-fraca` 5,5:1, `--latao` 6,1:1.
- Foco visível em tudo (contorno + halo já vêm de `:focus-visible`). `outline-none` só com `focus:shadow-foco` + borda de foco.
- Estado nunca só por cor: chip com texto, ícone ou forma diferente.
- `aria-live`: toasts (já), `role="status"` em carregando, `role="alert"` em erro.
- Formulário: `label for`, erro ligado por `aria-describedby` (o `Campo` faz), `noValidate` + validação nossa em blur/submit.
- `prefers-reduced-motion` já zera animações; não crie animação fora dos tokens.
- Dois temas sempre: use tokens, nunca hex fixo. Impressão: `nao-imprimir` em barra, botão e gaveta.

## 7. "Vazio é vazio"

Campo sem dado mostra "—" ou nada, nunca 0; `Kpi` sem `valor` mostra travessão + `motivoVazio`; lista vazia mostra `EstadoVazio` com a ação que a preenche; funcionalidade não pronta = `SeloStub`. Nunca placeholder com número plausível.

## 8. Não fazer

`text-[10px]` / `text-[11px]` · `font-semibold` · cor fixa (`#…`, `slate-*`, `bg-white`, `text-black`) fora de token · texto claro sobre laranja · `--latao` como fundo (use `--latao-cta`) · `--linha` em borda de input · `outline-none` sem substituto · `rounded-sm` novo (use `rounded-controle`/`rounded-cartao`) · "Tem certeza?" (descreva o efeito) · modal genérico · spinner em página inteira · polling · `opacity` para "desabilitar" texto que precisa ser lido · ícone sem `aria-hidden` ou sem rótulo.

## 9. Checklist de migração de uma tela (10 itens)

1. `CabecalhoPagina` com rótulo da área, título, descrição e ações — único `h1`.
2. Todo bloco em `Cartao` (raio 1.25rem, sombra) ou grade de `Cartao`; nada de `border rounded-sm bg-papel-elevado` solto.
3. Zero `text-[10px]`/`text-[11px]`/`font-semibold`/hex fixo — grep antes de fechar.
4. Todo botão é `Botao`; um `primario` por tela; todos com `carregando` na ação assíncrona.
5. Todo input dentro de `Campo` (rótulo, ajuda, erro); alvo ≥ 44px; erro humano com o que fazer.
6. Estados: `Esqueleto*` ao carregar, `EstadoErro` com tentar de novo, `EstadoVazio` com ação, `SeloStub` no que não existe.
7. Toda ação de escrita termina em toast (`useToast`), com o mesmo verbo do botão.
8. Teclado: Tab em tudo, Esc fecha, foco visível; testado sem mouse.
9. Tema escuro e 390px de largura conferidos no navegador (captura anexada ao diário).
10. Vocabulário do `Glossario.md` **via `src/lib/vocabulario.ts`** (§2.2); nada de dado inventado; impressão sem barra/botão.
11. Lei de texto (§2.2) medida: palavras visíveis fora de dado de cliente ≤ 50% do que havia; nenhum bloco de texto > 2 linhas fora de `Dica`.
12. Ritmo do §2.1: `gap-secao`/`gap-bloco`/`gap-cartao`/`gap-item`. Nenhum `gap-6`/`gap-8` novo.
