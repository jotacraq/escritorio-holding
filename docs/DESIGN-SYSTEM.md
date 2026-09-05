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
| `--espaco-secao` 2.5rem | `gap-10` | entre seções de uma página. |

`rounded-sm/md/lg` do Tailwind foram remapeados (10px / 14px / 20px) e `text-xs/sm` sobem para 13px/15px —
telas antigas já ganham o raio e o tamanho novos sem edição. Na migração, troque pelos nomes semânticos.

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
| `Passos` | `<Passos passos={[{ id, rotulo, quem?, descricao? }]} atual="sessao" aoEscolher? />` — stepper "onde estamos". |
| `Kpi` | `<Kpi rotulo="Sessões esta semana" valor={7} comparacao={{ delta: "+2", sentido: "bom", contra: "semana passada" }} motivoVazio="ainda sem sessão nesta edição" />` — sem valor mostra "—", sem comparação medida não mostra comparação. |
| `EstadoVazio` | `<EstadoVazio ilustracao="agenda" titulo="Nenhuma sessão marcada" descricao="…" acao={<Botao variante="primario">Abrir agenda</Botao>} />` · `compacto` para dentro de cartão. `EstadoCarregando`, `EstadoErro` (com `tentarNovamente`), `EstadoIndisponivel` inalterados. |
| `Dica` | `<Dica texto="Abre o roteiro da sessão"><Botao …/></Dica>` — hover + foco + Esc, `aria-describedby`. |
| `ChecklistPendencias` | inalterado (`itens` de `calcularPendencias`). |

## 4. Padrões de página

- **Página**: `<div className="flex flex-col gap-8">` → `CabecalhoPagina` → seções (`gap-10` entre seções grandes).
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
10. Vocabulário do `Glossario.md`; nada de dado inventado; impressão sem barra/botão.
