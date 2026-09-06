# Fase 6 — "Praticidade" (plano de execução, arquiteto, 05/09/2026)

Entrada: `tmp/squad/fase6-brief.md` (5 decisões + **Reforço do João de ~21:00, que é lei desta rodada**),
`brain/03 - Dominio/Esteira do cliente.md` (seção final, "A espinha dorsal são três sessões"),
`docs/DESIGN-SYSTEM.md`, `docs/ARQUITETURA-FASE-5.md` §§8.1/9.1/9.2/11.4.

**Esta rodada é POLIR e TERMINAR.** Nada aqui cria funcionalidade nova; tudo é reorganização,
compactação e reuso do que já existe. O que for feature está marcado **`FORA DESTA RODADA`**.

**Banco: nenhuma migration prevista.** Se algum agente concluir que precisa de uma, ele PARA e
escala — não escreve SQL nesta rodada. As renomeações são de rótulo; os enums (`etapa_jornada`,
`tipo_link_publico`) e as colunas (`timeline.tipo = 'ligacao'`, `materiais_gerados.fonte_dor = 'ligacao'`)
**não são tocados**.

---

## 0. O diagnóstico, em uma frase

O sistema está completo e ilegível: 9 entradas de menu, 9 abas na Ficha, hero de 34 px, ritmo
vertical de 40 px entre seções e o link que o João precisa mandar escondido dentro de uma gaveta
dentro de um cartão. A Fase 6 não adiciona: **agrupa, encolhe e traz para a superfície**.

---

## 1. A espinha dorsal: três sessões

### 1.1 O mapa (sem tocar em enum nem em coluna)

| Sessão (o que o João vê) | `etapa_jornada` (enum, **não muda**) | passos do trilho de 9 (**não muda**) | micro-tarefas (itens da Pasta) |
|---|---|---|---|
| **1. Sessão de Viabilidade** | `captado` · `qualificado` · `sessao_contratada` · `sessao_agendada` · `sessao_realizada` | `pagou` · `ligacao` · `agendou` · `confirmou` · `sessao` | boas-vindas, formulário, **contato da equipe**, links de agendamento, confirmação D-7, link da sala, briefing, relatório |
| **2. Croqui estrutural** | `croqui_contratado` · `croqui_apresentado` | `croqui` | material pós-sessão, link de pagamento + data (envio pessoal da Dra. Elaine), IR e contrato social, patrimônio/familiares, cálculo, apresentação em HTML |
| **3. Entrega da holding** | `holding_contratada` | `contrato` · `execucao` · `entrega` | contrato de prestação, marcos de execução, pasta/cartas de entrega (minutas por célula = M7, `FORA DESTA RODADA`) |

Leitura: a sessão 1 tem 5 dos 9 passos, a 2 tem 1 e a 3 tem 3. Isso é fiel ao processo — o pré-SV é
onde a operação sofre. Os micro-passos da sessão 2 **já existem** em `derivarProximoPasso`
(`src/lib/pasta/proximo-passo.ts:118-123`: `relatorio_sv`, `material`, `patrimonio`, `documentos`
caem em `croqui`); o que muda é a tela mostrá-los como micro-tarefas **dentro** da sessão 2, em vez de
como 7 cartões soltos.

### 1.2 Contratos novos (puros, sem I/O) — **BACK entrega primeiro, FRONT programa contra eles**

```ts
// src/lib/pasta/trilho.ts  (aditivo; derivarTrilho e ORDEM_TRILHO não mudam)
export type ChaveSessao = "viabilidade" | "croqui" | "entrega";
export const ROTULO_SESSAO: Record<ChaveSessao, string>;      // "Sessão de Viabilidade" | "Croqui estrutural" | "Entrega da holding"
export const SESSAO_POR_PASSO: Record<ChaveTrilho, ChaveSessao>;
export interface BlocoSessao { chave: ChaveSessao; rotulo: string; passos: PassoTrilho[]; estado: "feito" | "atual" | "futuro"; resumo: string }
/** Agrupa os 9 passos nas 3 sessões. `estado` da sessão = 'atual' se contém o passo aceso;
 *  'feito' se todos feito/pulado; 'futuro' caso contrário. Sem passo aceso (borda `a` do §8.1),
 *  NENHUMA sessão fica 'atual' — não se inventa posição. `resumo` = "2 de 5" (número primeiro, §2.2). */
export function agruparPorSessao(passos: PassoTrilho[]): BlocoSessao[];

// src/lib/pasta/catalogo.ts (aditivo)
export const SESSAO_POR_ITEM: Record<ChaveItemPasta, ChaveSessao>;
```

`SESSAO_POR_ITEM` substitui a lista `MOMENTOS` hardcoded em `src/components/pasta/PastaDoCliente.tsx:84-90`
("Antes da sessão / Na sessão / Depois da sessão") — mesma quantidade de grupos, agora derivada de
uma constante compartilhada com o trilho, em vez de duas listas que podem divergir. **É otimização
medida: −1 lista duplicada.**

Distribuição de `SESSAO_POR_ITEM` (decidida aqui, não pelo agente):
`formulario · ligacao · links · briefing · sessao · transcricao` → `viabilidade`;
`analise_sessao · diagnostico_sv · relatorio_sv · material · croqui · patrimonio · familiares · documentos` → `croqui`;
nenhum item da Pasta cai em `entrega` hoje (a sessão 3 é servida por `vw_automacoes_jornada`/`execucao_marcos`,
não pela Pasta). A sessão 3 mostra os marcos de `GET /api/jornadas/[id]/execucao`, que já existe.

### 1.3 Onde a espinha aparece

- **Ficha** (§4): o bloco "onde está" são as 3 sessões, com a atual aberta mostrando seus micro-passos.
- **Clientes/Esteira**: as colunas do quadro continuam sendo as etapas (`etapas_jornada_ordem`, dado do
  banco), mas ganham **3 faixas de agrupamento** com o nome da sessão acima das colunas. Nenhuma
  coluna some, nenhuma etapa é renomeada no banco.
- **Trilho compacto** (Esteira/Agenda): passa a mostrar `"Sessão 1 de 3 · Confirmou · 4 de 5"` em vez de
  `"4 de 9"` — mesma função `resumoDoTrilho`, agora com a sessão na frente.

---

## 2. Densidade — os tokens que mudam

### 2.1 `src/app/globals.css` (fonte de verdade; **nada hardcoded na tela**)

**Tipografia** (`src/app/globals.css:205-232`) — base 16 → 14, escala inteira encolhida um degrau:

| Token | Hoje | Fase 6 | Onde dói |
|---|---|---|---|
| `--text-display` | 2.125rem / 34px | **1.5rem / 24px** | título de página (`CabecalhoPagina`) |
| `--text-display--line-height` | 1.18 | **1.22** | título de 2 linhas a 390 px |
| `--text-titulo` | 1.5rem / 24px | **1.25rem / 20px** | gaveta, diálogo, seção grande |
| `--text-subtitulo` | 1.125rem / 18px | **1rem / 16px** | título de cartão |
| `--text-corpo` | 1rem / 16px | **0.875rem / 14px** | corpo (a decisão 1 do João) |
| `--text-corpo--line-height` | 1.55 | **1.45** | |
| `--text-sm` | 0.9375rem / 15px | **0.8125rem / 13px** | tabela, lista densa |
| `--text-xs` | 0.8125rem / 13px | **0.75rem / 12px** | legenda, meta |
| `--text-legenda` / `--text-rotulo` | 0.75rem / 12px | **0.75rem / 12px — NÃO MUDA** | é o piso do §6 |

`--text-xs` passa a coincidir com `--text-legenda` (12 px). Fica registrado: são o mesmo tamanho com
entrelinhas diferentes; unificar os dois nomes tocaria ~90 arquivos e **fica fora desta rodada**.

**Ritmo vertical** (`src/app/globals.css:96-105`) — −35 %, preservando a regra "o degrau de fora é
sempre maior que o de dentro" (§2.1 do DS):

| Token | Hoje | Fase 6 | Δ |
|---|---|---|---|
| `--espaco-secao` | 2.5rem / 40px | **1.625rem / 26px** | −35 % |
| `--espaco-bloco` | 1.75rem / 28px | **1.125rem / 18px** | −36 % |
| `--espaco-cartao` | 1.5rem / 24px | **1rem / 16px** | −33 % |
| `--espaco-item` | 0.75rem / 12px | **0.5rem / 8px** | −33 % |
| `--raio-cartao` | 1.25rem | **1rem** | cartão menor com raio de 20 px vira bolha |

**O que NÃO muda, e é trava:**

1. **`--alvo-minimo: 44px` (`globals.css:105`) fica.** `min-h-11` é `rem` sobre a raiz do documento —
   **ninguém encosta em `html { font-size }`**. Mudar a raiz encolheria todos os alvos de toque de uma
   vez, silenciosamente, e reprovaria o critério de acessibilidade do §6.
2. **`.area-publica` (`globals.css:392-420`) fica exatamente como está** — 17 px, `h1` 24 px, todo
   controle com 44 px. A compactação é do sistema interno. Quem responde no celular é o cliente de
   60+; ele não pediu praticidade, o João pediu.
3. Contraste, cores, sombra, Neuetra, selo de demonstração: **identidade intocada** (decisão 1).

### 2.2 Onde o hero encolhe (arquivo:linha)

| Componente | Hoje | Fase 6 |
|---|---|---|
| `src/components/ui/CabecalhoPagina.tsx:25-36` | `gap-4`, `mb-1.5`, `mt-2`, `text-titulo sm:text-display`, descrição em `text-corpo` | `gap-2`, `mb-0.5`, `mt-1`, **um só tamanho** (`text-display`, que já caiu para 24px), descrição em `text-sm` e **≤ 1 linha** (lei de texto §2.2) |
| `src/components/shell/AppShell.tsx:196` | `main px-4 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10` | `px-3 py-4 sm:px-5 sm:py-5 lg:px-6 lg:py-6` |
| `src/components/shell/AppShell.tsx:189` | barra lateral `w-[19rem] lg:w-72`, `gap-5`, `py-5/py-6` | `lg:w-64`, `gap-3`, `py-4` |
| `src/components/shell/Nav.tsx:85-121` | 4 grupos × `gap-5`, descrição expansível por item | 5 itens **sem grupo** (§3), `gap-1`, descrição só no ativo |
| `src/components/painel/PainelDia.tsx:117-196` | `gap-secao` + faixa de KPIs + 2 seções | KPIs em **uma faixa de altura fixa** (`Kpi` compacto), seções em `gap-bloco` |
| `src/components/esteira/KanbanEsteira.tsx:235` | `gap-8` | `gap-secao`; coluna com cabeçalho de 1 linha; cartão `preenchimento="compacto"` |
| `src/components/ficha360/CabecalhoFicha.tsx:195-276` | header com `pb-5` + `dl` de 4 campos em grade | **1 linha de identidade** + botão "Ficha completa" (§4.1). A `dl` vai para a gaveta |
| `src/app/(app)/agenda/page.tsx:17` | `gap-8` | `gap-secao` |
| `src/components/comunicacao/ComunicacaoApp.tsx:83` | `gap-secao` + descrição de página | `gap-bloco`, descrição ≤ 1 linha |
| `src/components/conhecimento/ConhecimentoApp.tsx:155,168-183` | `gap-8`, descrição de 3 linhas, cartão de aviso `realce="ambar"` | vira aba do Admin (§3), descrição = a frase do repertório, 1 linha |
| `src/components/agenda/PainelDisponibilidade.tsx:90` | `gap-6` | `gap-bloco` |
| `src/components/admin/AdminApp.tsx:74-92` | 11 abas em 3 grupos | 13 abas em 3 grupos (§3), barra de abas rolável, sem hero |

**Grep de fechamento (front):** nenhum `gap-8`/`gap-6`/`gap-5`/`p-7`/`sm:p-9` **novo**; nenhum
`text-[10px]`/`text-[11px]`; nenhum `font-semibold`; nenhum hex fixo. Os existentes listados acima
viram token.

### 2.3 Medição de aceite (o número que decide)

Script pronto: **`tmp/squad/f6-medir.mjs`** (Playwright). Instalar `playwright` **no scratchpad do
agente, nunca no repo** (`npm install` no Windows poda o lockfile e quebra o build da Hostinger); os
browsers já estão em `%LOCALAPPDATA%\ms-playwright`. Subir o dev server em **porta diferente de 3000**
(o agente do mock usa a 3000): `npx next dev -p 3100`, `BASE=http://localhost:3100`.

Rodar **duas vezes**: `PREFIXO=F6-antes` antes de tocar em qualquer token (baseline), `PREFIXO=F6-depois`
no fim. Sem a baseline não há prova de melhora.

| Tela | Rota | Meta 1440×900 | Meta 390×844 |
|---|---|---|---|
| Hoje | `/hoje` | altura do documento **≤ 1080 px** | sem scroll horizontal |
| Clientes | `/clientes` | ≤ 1080 px | sem scroll horizontal (a trilha do kanban tem rolagem própria, `.trilha-esteira` — não conta) |
| Agenda | `/agenda` | ≤ 1080 px | sem scroll horizontal |
| Agenda · Disponibilidade | `/agenda#disponibilidade` | ≤ 1080 px | idem |
| Mensagens | `/mensagens` | ≤ 1080 px | idem |
| Admin | `/admin` | ≤ 1080 px | idem |
| Admin · Repertório da IA | `/admin#repertorio` | ≤ 1080 px | idem |
| Ficha | `/jornadas/[id]` | ≤ 1080 px **com a Pasta fechada nas sessões futuras** | idem |

Invariantes em **todas** as telas, nos 2 temas: `fonte < 12 px = 0` · `alvo < 44 px = 0` · `h1 = 1` ·
`erro de console = 0` · `proximaAcao.acimaDaDobra = true` na Ficha.

> A Ficha é a única com ressalva prevista: com croqui calculado, a aba Croqui media ~8.600 px na
> Fase 5 (`tmp/squad/fase5-brief.md:1417`). O §4.3 tira o croqui da Ficha — é o que faz a meta caber.

---

## 3. Navegação em 5 entradas

### 3.1 O menu

| # | Rótulo | Rota nova | Linha de propósito (vai na tela, não só no `title`) |
|---|---|---|---|
| 1 | **Hoje** | `/hoje` | "O que precisa de você agora." |
| 2 | **Clientes** | `/clientes` | "Todo mundo, e em qual das três sessões cada um está." |
| 3 | **Agenda** | `/agenda` | "Sessões marcadas e os dias em que a equipe atende." |
| 4 | **Mensagens** | `/mensagens` | "O que vai sair para o cliente e o que já chegou." |
| 5 | **Admin** | `/admin` | "Ajustes do escritório: equipe, valores, textos e o repertório da IA." |

Sem grupos (`GrupoNavegacao` em `Nav.tsx:37,70` **sai** — 5 itens não precisam de 4 títulos de seção).
`ITENS_NAVEGACAO` continua plano e é o que a `PaletaComandos` consome (`Nav.tsx:58-68`).

### 3.2 Mapa rota antiga → nova (redirects **permanentes** em `next.config.ts`, dono: BACK)

| Rota antiga | Vai para | Por quê |
|---|---|---|
| `/painel` | `/hoje` | mesma tela, nome que a pessoa usa |
| `/esteira` | `/clientes` | idem |
| `/comunicacao` | `/mensagens` | idem |
| `/indicadores` | `/hoje#numeros` | vira aba de Hoje — mantém o acesso de hoje (todo papel interno). Pôr em Admin tiraria os números da advogada e do relacionamento |
| `/conhecimento` | `/admin#repertorio` | decisão 2 |
| `/importacoes` | `/admin#importacoes` | é cadastro, não dia a dia |
| `/sessoes` | `/agenda#sessoes` | `SelecionarSessaoApp` (97 linhas) duplica `ListaSessoes`; o que ela tem a mais é o link "Conduzir", que passa para a linha da sessão na Agenda |
| `/gaveta-demo`, `/graficos-demo` | **apagadas** | telas de desenvolvimento que respondem 200 em produção para quem tem sessão |

**Permanecem, sem redirect** (são páginas de detalhe, não entradas de menu):
`/jornadas/[id]` e `/jornadas/[id]/diagnostico` · `/croquis/[croquiId]`, `/apresentar`, `/simular` ·
`/sessoes/[id]/conduzir` · `/conhecimento/casos/[id]` e `/conhecimento/transcricoes/[id]` ·
`/importacoes/nova` e `/importacoes/[id]`.

**`/jornadas/[id]` NÃO é renomeada.** É o que `hrefDoPasso` monta
(`src/lib/pasta/proximo-passo.ts:274`) e o que 4 telas usam via `ChipProximoPasso`, `TrilhoDaFicha`,
`PagosSemContato`, `PreparoPendente`. Renomear traria risco sem ganho: o operador chega lá por
clique, nunca por URL.

Custo medido do rename: `"/painel` 5 ocorrências · `"/esteira` 6 · `"/comunicacao` 5 ·
`"/indicadores` 3 · `"/conhecimento` 4 · `"/sessoes` 2 · `"/importacoes` 9. É barato — mas o front
precisa varrer também `PaletaComandos`, `TourPrimeiraVez` e os `EstadoVazio` com ação.

### 3.3 Admin — as abas depois da absorção

Grupos de `AdminApp.tsx:78-92` mantidos, com duas entradas novas:

- **Operação**: Pendências · Integrações · Custo de IA · **Importações** *(nova, de `/importacoes`)*
- **Método**: Parâmetros do método · Modelos de material · Templates de mensagem · Versões de prompt ·
  **Repertório da IA** *(nova, de `/conhecimento`)*
- **Cadastro**: Equipe · Produtos · Edições do seminário · Configurações

**"Repertório da IA"** — a frase do brief vai **na tela**, como descrição da aba (substitui a
descrição de 3 linhas de `ConhecimentoApp.tsx:171`):

> **É o que a IA usa para analisar: o histórico de eventos e reuniões anteriores.**

### 3.4 CONFLITO resolvido — Admin é admin-only, o Repertório não é

`AdminApp.tsx:56` recusa quem não é admin; `useAcessoAdmin.ts:7-14` só conhece `admin` e
`somente_custo_ia` (advogada). Hoje `/conhecimento` é acessível a quem vê patrimônio
(`ConhecimentoApp.tsx:155-163`) — isto é, **advogada também**. Mover a tela para dentro do Admin sem
mais nada **tiraria da Dra. Elaine o repertório que ela lê antes de cada sessão**.

Resolução (não relaxa nada, usa o precedente que já existe): o ramo `somente_custo_ia` de
`AdminApp.tsx:71-80` deixa de renderizar só `CustoIaAba` e passa a renderizar um `<Abas>` com
**exatamente duas** abas — `custo-ia` e `repertorio` —, mantendo o `SeloStub` que explica o recorte.
O gate real continua no servidor (`exigirVePatrimonio` nas rotas de conhecimento). Nenhuma aba de
admin passa a ser montada para não-admin. **Tarefa obrigatória do pentester.**

---

## 4. A Ficha — "quem é · onde está · o que aconteceu · o que falta · a próxima ação"

Ordem de cima para baixo em `src/app/(app)/jornadas/[id]/page.tsx:185-227`:

### 4.1 Identidade em uma linha + "Ficha completa" a um clique

`CabecalhoFicha.tsx:195-276` vira **uma faixa**: nome (h1) · telefone · e-mail · edição do seminário ·
selo de desfecho, e três botões: **Ficha completa** · **Enviar** (§5) · **Mudar desfecho**.

A `dl` de 4 campos (`:251-276`), o bloco de desfecho (`:279-330`) e o stub de Pesquisa pública
(`PesquisaPublicaAba.tsx`, hoje ocupando uma aba inteira para exibir um `SeloStub`) vão para a
**gaveta "Ficha completa do cliente"**: dados cadastrais, origem, trilha, patrimônio declarado,
familiares, consentimentos, e o stub da pesquisa pública no rodapé. É a "aba só com os dados dele"
que o João pediu — **gaveta, não tela nova**, porque o dado já vem no payload da Ficha.

### 4.2 Onde está: as 3 sessões, com a atual aberta

`TrilhoDaFicha.tsx` passa a receber `agruparPorSessao(derivarTrilho(sinais))` e renderiza
`Trilho variante="sessoes"`: 3 blocos horizontais; o da sessão atual abre e mostra seus micro-passos
com os 4 estados e os glifos que já existem (§3.1 do DS). As regras congeladas do trilho continuam
valendo — `null` é "sem informação", `pulado` só com evidência positiva, `atual` vem de
`derivarProximoPasso`. **Sem passo aceso, nenhuma sessão acende.**

### 4.3 Próxima ação: um botão, sempre acima da dobra

Logo abaixo do trilho, um único bloco: verbo + objeto, `data-acao-agora` (é o que o script mede),
vindo de `derivarProximoPasso`. Quando o passo é um link para o cliente, o botão **já é o de copiar**
(§5.4). Sem ação clicável, `nota` de ≤ 4 palavras — nunca um botão morto (§3.1 do DS).

### 4.4 O que já aconteceu / o que falta: a Pasta por sessão

`PastaDoCliente.tsx:84-90` troca `MOMENTOS` por `SESSAO_POR_ITEM`. Três grupos; o da sessão atual
expandido, os outros dois recolhidos com o resumo ("Sessão de Viabilidade · 5 de 5 · concluída").
Cartão compacto: título + estado + uma ação (a lei de texto já vale).

`AutomacoesFicha` (hoje um bloco de página, `page.tsx:203`) vira **uma linha recolhível dentro de "o
que já aconteceu"**: "O sistema fez N coisas sozinho" + expandir. `RadarDocumentos` (`page.tsx:204`)
deixa de ser bloco solto e entra **dentro do grupo "Croqui estrutural"**, que é onde IR e contrato
social vivem. Dois blocos de página a menos, zero funcionalidade perdida.

### 4.5 O que acontece com as 9 abas

| Aba hoje | Fase 6 | Por quê |
|---|---|---|
| `briefing` | **gaveta**, aberta pelo cartão Briefing e pelo botão da próxima ação | leitura longa, não é navegação |
| `sessao` | **gaveta "Sessão"** (mesmo `SessaoAba`), aberta pelos micro-passos horário/confirmação/sala/presença | o stepper interno já é o trilho; ter os dois é a confusão que o João relatou |
| `analise-sessao` + `relatorio` + `diagnostico` | **uma gaveta "Resultado da sessão"**, com 3 seções na ordem do trabalho real: Relatório (advogada) → Análise (IA) → Diagnóstico (parecer) | são três nomes para o depois-da-sessão; hoje custam 3 abas e 3 cliques |
| `material` | **gaveta**, aberta pelo cartão Material | idem briefing |
| `croqui` | **cartão de resumo + botão "Abrir croqui"** → `/croquis/[id]`, que já existe | a aba media ~8.600 px dentro da Ficha (ressalva do Fable na F5). É o que faz a meta de altura caber |
| `pesquisa` | some da barra; o `SeloStub` vai para o rodapé da gaveta "Ficha completa" | uma aba inteira para um stub |
| `timeline` | **gaveta "Histórico"** | consulta, não fluxo |

**Resultado: a Ficha deixa de ter barra de abas.** Tudo vira ou seção da tela única, ou gaveta aberta
pelo cartão correspondente. O deep-link por hash **continua funcionando** — `ConteudoPastaOuAbas`
(`page.tsx:229-280`) já sabe abrir gaveta por hash via `ITENS_EM_GAVETA` (`src/lib/pasta/rotas.ts:98-104`);
o conjunto passa a incluir as chaves novas, e `hrefDoPasso` não muda de forma.

**Faseamento dentro da rodada** (para não estourar): **F6-A obrigatório** = §4.1 a §4.4 + croqui vira
cartão + pesquisa sai. **F6-B, só se sobrar tempo** = fundir Relatório/Análise/Diagnóstico numa
gaveta só. Se não der, F6-B fica `FORA DESTA RODADA` e as três continuam como estão, mas já como
gavetas separadas.

---

## 5. A barra "Enviar" da Ficha

### 5.1 O que existe hoje (fatos, com fonte)

- 5 tipos de link no enum `tipo_link_publico`: `formulario`, `agendamento`, `documentos`, `material`
  (`supabase/migrations/0028_links_publicos.sql:59`) e `confirmacao`
  (`supabase/migrations/0050_tipo_link_confirmacao.sql:19`). **Não são as migrations "0028a-c" do
  brief — 0028 é um arquivo só, e o 5º tipo veio na 0050/0051.**
- **Um link ativo por tipo por jornada** (índice único `uniq_link_ativo`, `0028:92`). Emitir um novo
  **revoga o anterior do mesmo tipo, na mesma transação** (`emitir_link_publico`, `0028:829-833`).
- **O endereço com o token aparece UMA única vez, na emissão** (`links/route.ts:79-82,207`); o banco
  guarda só `token_hash` (sha256 + pepper) e `token_prefixo` de 6 caracteres (`0028:70-73`). A tela já
  avisa isso (`LinksAba.tsx:126-128`).
- Quem pode emitir: `admin`, `advogada`, `relacionamento` — travado **duas vezes**, na rota
  (`links/route.ts:94`) e dentro da RPC (`0028:811-814`).
- `material`: a via da equipe **não** exige aprovação (por isso o `ConfirmarAcao` de
  `LinksAba.tsx:170-182`); a via de sistema **exige** (`0031:313-318`).
- `confirmacao`: exige agendamento (`ck_link_confirmacao_agendamento`, `0051:285-286`) e é **revogado
  automaticamente quando o agendamento é remarcado** (`app.revoga_link_confirmacao`, `0051:193-204`).
  Hoje só nasce no envio da mensagem D-7 (`src/server/regua/placeholders.ts:76-82`) — **a equipe não
  tem como emitir um pela Ficha**, que é exatamente o buraco do "cadê o link".

### 5.2 Contrato de dados (derivação pura, **zero rota nova para listar**)

```ts
// src/lib/pasta/envios.ts  (novo, puro, sem I/O — BACK)
export type TipoEnvio = "formulario" | "agendamento" | "confirmacao" | "documentos" | "material";
export type EstadoEnvio = "nao_emitido" | "ativo" | "consumido" | "expirado" | "revogado" | "indisponivel";

export interface ItemEnvio {
  tipo: TipoEnvio;
  rotulo: string;              // "Formulário" | "Agendamento" | "Confirmação de presença" | "Documentos" | "Material"
  estado: EstadoEnvio;
  /** Por que não dá para emitir agora — frase de gente, ≤ 1 linha. `null` quando dá. */
  motivo: string | null;
  emitidoEm: string | null;    // links_publicos.criado_em
  expiraEm: string | null;
  usos: number;
  /** true = o botão emite e copia. false = botão desabilitado com `motivo` no title E na tela. */
  podeEmitir: boolean;
  /** true quando emitir mata um link ativo → exige confirmação de 1 linha (§5.4). */
  substituiAtivo: boolean;
}

export function derivarEnvios(
  links: LinkPublicoResumo[],          // GET /api/jornadas/[id]/links (já existe)
  ficha: Ficha360,                     // já carregada pela Ficha
  agora?: number,
): ItemEnvio[];
```

**Nenhuma requisição nova.** `links` já vem de `GET /api/jornadas/[id]/links`
(`links/route.ts:57-77`); a disponibilidade sai de dado que a Ficha já tem:
`ficha.jornada.desfecho`, `ficha.materialAtual.aprovado_em` (`src/types/material.ts:51` — está no
payload) e `ficha.agendamentos`. **Otimização medida:** a `LinksAba` faz hoje um segundo fetch de
`listarMateriais` só para saber se o material está aprovado (`LinksAba.tsx:44-48`) — ele **sai**.

Regras de `motivo`/`podeEmitir` (nada inventado; cada uma tem fonte):

| Tipo | `indisponivel` quando | Motivo na tela |
|---|---|---|
| todos | `jornada.desfecho !== 'aberta'` (`0028:816-818`) | "Esta jornada está encerrada." |
| `agendamento` | sessão sem advogada (`links/route.ts:115-119`) | "Emite, mas sai sem horários: a sessão ainda não tem advogada." (**emite com aviso, não bloqueia**) |
| `agendamento` | `SUPABASE_SERVICE_ROLE_KEY` ausente → 503 (`links/route.ts:126-139`) | "O servidor não está configurado para gerar horários agora." |
| `confirmacao` | nenhum agendamento ativo (`0051:285-286`) | "Ainda não há sessão marcada para confirmar." |
| `material` | `materialAtual === null` | "Nenhum material foi gerado ainda — o cliente veria 'link não disponível'." |
| `material` | `materialAtual.aprovado_em === null` | "O material ainda não foi aprovado." |

Nos dois casos de `material` o botão **continua existindo**, atrás do `ConfirmarAcao` que já está
escrito em `LinksAba.tsx:170-182`. O João pediu para ver o motivo, não para perder a ação.

### 5.3 O único endereço novo no servidor: `confirmacao` na rota que já existe

**Não se cria rota.** `POST /api/jornadas/[id]/links` ganha `'confirmacao'` no `CorpoSchema`
(`links/route.ts:21-23`) e, nesse ramo:

1. lê o **agendamento ativo da própria jornada** no servidor — `agendamento_id` **jamais** vem do
   corpo da requisição (senão vira IDOR: emitir link de confirmação para o agendamento de outra
   família);
2. chama `emitirLinkConfirmacaoSistema(admin, agendamentoId)` — função que **já existe**
   (`src/server/regua/links.ts:15-34`), com `service_role`, mesma exigência de pepper;
3. sem `service_role` → **503 com motivo**, nunca link pela metade (mesmo padrão de
   `links/route.ts:126-139`);
4. sem agendamento → 409 com código estável, nunca 500.

A trava de papel da rota (`exigirPapel("admin","advogada","relacionamento")`, `links/route.ts:94`)
passa a valer para um tipo que antes só o sistema emitia. **É a mudança de superfície desta fase e é
tarefa obrigatória do pentester** (§9.3).

`SEGMENTO_POR_TIPO` (`links/route.ts:26-31`) ganha `confirmacao: "c"` — a página pública `/p/c/[token]`
**já existe** (`src/app/(publico)/p/c/[token]/page.tsx`) e não é tocada.

### 5.4 Comportamento de "Copiar"

- **Sem link ativo do tipo** → **1 clique**: emite, copia, toast "Link do formulário copiado".
  É o caso do João ("cadê o link pra eu mandar").
- **Com link ativo do tipo** → o botão diz **"Copiar link novo"** e abre `ConfirmarAcao` de uma linha:
  *"O link anterior deixa de funcionar. O cliente vai precisar do novo."* Dois cliques só quando algo
  se perde. **Motivo técnico, que a barra precisa dizer na tela:** o endereço emitido **não é
  recuperável** — o banco guarda hash, não token (`0028:70-73`). Não existe "copiar de novo".
- **Falha do `clipboard`** (contexto não seguro, permissão negada): hoje é engolida em silêncio
  (`LinksAba.tsx:115-122` só faz `setCopiado(false)`). Na barra: `notificar({tom:"erro"})` **e** a URL
  em `<code>` selecionável. Achado a corrigir, não comportamento a copiar.
- **Estado sempre visível por linha**: `Não emitido` · `Ativo · expira em 12/09` · `Consumido` ·
  `Expirado` · `Revogado` · `Indisponível — <motivo>`. Nunca só cor (§6 do DS).
- **Revogar e histórico** continuam existindo, dentro da gaveta "Todos os links" que a barra abre —
  é a `LinksAba` atual, sem os botões de emissão (que a barra passa a concentrar). **Um caminho de
  emissão na UI, não dois.**

### 5.5 O botão do próximo passo vira botão de link

| `derivarProximoPasso().chave` | Botão da Ficha |
|---|---|
| `formulario` | "Copiar link do formulário" |
| `links` | "Copiar link do agendamento" |
| `confirmar_presenca` | "Copiar link de confirmação" |
| `documentos` | "Copiar link dos documentos" |
| `material` (aprovado) | "Copiar link do material" |
| `material` (não aprovado) | "Aprovar material" → abre a gaveta Material |

---

## 6. "Ligação" → "Contato da equipe"

### 6.1 A conciliação (reforço do João, item 4)

- **"Contato da equipe"** = a **ligação preliminar HUMANA**: a equipe liga e registra como o lead
  fala, as palavras que ele usa, o que respondeu no seminário, dados públicos. É `POP 03`,
  `ligacoes_estrategicas`, `LigacaoAba`. **É passo do operador.**
- A **ligação de agendamento por IA** (`ligacoes_ia`, Vapi/n8n) **continua existindo como automação**,
  não como passo. Aparece na Ficha só como **resultado** ("agendamento marcado pela ligação da IA")
  e some da tela quando `ligacao_ia.provedor = 'manual'`.

### 6.2 Todos os pontos que carregam a palavra

**Só rótulo. Nada de banco.** `timeline.tipo = 'ligacao'` (`0014:11,78`; `0053:120`) e
`materiais_gerados.fonte_dor = 'ligacao'` (`0031:193`) são **valores de coluna, não enum de tipo** —
e permanecem. Nenhum `alter type`.

| Arquivo:linha | Hoje | Fase 6 |
|---|---|---|
| `src/lib/vocabulario.ts:42-46` (`pop03`) | humano "Ligação estratégica" | **"Contato da equipe"**; `sigla` continua "POP 03"; `explique` = "Ligação humana de até 5 minutos, antes da sessão: a equipe registra como o cliente fala e o que ele já respondeu." |
| `src/lib/pasta/catalogo.ts:86` | `rotulo: "Ligação"` | `rotulo: "Contato"`, `titulo: "Contato da equipe"` (o cartão da Pasta tem `titulo` para o nome inteiro) |
| `src/lib/pasta/trilho.ts:90` | `ligacao: "Ligação"` | `ligacao: "Contato"` — **rótulo do trilho é ≤ 1 palavra por desenho**; o nome inteiro vai no `title` do passo. A `ChaveTrilho` `"ligacao"` **não muda** (é chave, não texto) |
| `src/lib/pasta/rotas.ts:49` | "Registrar a ligação" | **"Registrar o contato"** |
| `src/lib/pasta/rotas.ts:71` | `TITULO_ACAO_ITEM_PASTA.ligacao` | recalcula sozinho a partir do vocabulário |
| `src/lib/pasta/proximo-passo.ts:186` | "Ligar para o cliente" | **"Ligar para o cliente"** — fica. É verbo de ação, e é exatamente o que a pessoa faz |
| `src/app/(app)/jornadas/[id]/page.tsx:40,210` | gaveta "Ligação" | gaveta **"Contato da equipe"** |
| `src/components/ficha360/LigacaoAba.tsx:339,201,172` | "Salvar registro da ligação", "Proibido nesta ligação" | "Salvar o contato", "Não fazer neste contato" |
| `src/components/painel/PagosSemContato.tsx:28` e `PreparoPendente.tsx:24` | dicas com "ligação" | "contato da equipe" |
| `src/app/(app)/indicadores/IndicadoresApp.tsx:189` | "Ligação Estratégica (POP 03)" | `rotulo("pop03")` + sigla no `title` (a linha viola a §2.2 hoje) |
| `src/components/briefing/BriefingAba.tsx:28-29`, `MaterialAba.tsx:19` | "Observações da ligação" | "Observações do contato" |
| `src/components/esteira/CartaoJornada.tsx:18` (comentário) | — | atualizar o comentário, não o código |

**Não mexer** (é a ligação por IA, e ela continua se chamando ligação): `SessaoLigacaoIa.tsx`,
`api-ligacoes-ia.ts`, `/api/ligacoes-ia/*`, `IntegracoesAba.tsx:55-63`, `ConfiguracoesAba.tsx:46-47`,
`vocabulario.ts:115` (`provedor_ligacao`, `soAdmin`).

### 6.3 A ligação por IA fica atrás de `ligacao_ia.provedor`

`configuracoes` é legível por **qualquer papel interno** (`cfg_sel`, `0027:174`) — então **não há
permissão nova**. `src/server/jornadas.ts` (montador de `Ficha360`) passa a incluir:

```ts
// src/lib/api.ts — Ficha360 (aditivo)
/** Configuração de UI lida de `configuracoes` (RLS `cfg_sel`, 0027:174). Nada de segredo aqui. */
configuracoesUi: { ligacaoIaAtiva: boolean };   // === (configuracoes['ligacao_ia.provedor'] === 'n8n')
```

Na tela, `ligacaoIaAtiva === false` (o estado de hoje, `0053:339` semeia `"manual"`):

- **some** o cartão de estado/ação da ligação por IA (`SessaoLigacaoIa.tsx:139-232`);
- **fica** o bloco da tarefa humana "ligar para agendar" (`SessaoLigacaoIa.tsx:194-203`) — ele é o
  trabalho do operador e **precisa ser separado do componente da IA**, senão esconder a IA esconde a
  tarefa. Ele passa a viver no micro-cartão "Agendamento" da Sessão 1;
- `ligacaoIaAtiva === true`: a ligação por IA aparece **como resultado** dentro do micro-cartão
  Agendamento ("Agendamento marcado pela ligação da IA · 05/09 14:20"), não como passo do trilho.

O `SeloStub` de tabela ausente (`SessaoLigacaoIa.tsx:141-147`) continua — é infraestrutura, e o §7
do DS manda mostrar stub rotulado.

---

## 7. "Horários livres" → "Disponibilidade da equipe"

- `src/app/(app)/agenda/page.tsx:12`: aba `disponibilidade` com rótulo **"Disponibilidade da equipe"**
  e linha de propósito *"Os dias e horários em que a equipe atende — é daqui que saem as opções que o
  cliente escolhe."*
- `src/components/agenda/PainelDisponibilidade.tsx:97`: cartão "Horários livres recorrentes" →
  **"Janelas de atendimento"**.
- **Entrada direta**: o item **Agenda** do menu ganha um segundo destino visível — a `PaletaComandos`
  (Ctrl+K) passa a indexar "Disponibilidade da equipe" → `/agenda#disponibilidade`, e o `CabecalhoPagina`
  da Agenda ganha a ação secundária "Disponibilidade da equipe". O deep-link por hash já funciona
  (`Abas deepLinkHash`, `agenda/page.tsx:23`).
- O aviso do link de agendamento sem horários (`links/route.ts:181-183`) passa a linkar para
  `/agenda#disponibilidade` — quem lê o problema chega na solução com um clique.

---

## 8. Lei de intuitividade (mensurável — reforço do João, item 3)

| # | Lei | Como se mede | Meta |
|---|---|---|---|
| L1 | A ação de agora está a **≤ 1 clique** da Ficha e **visível sem rolar** | `f6-medir.mjs` → `proximaAcao.acimaDaDobra` a 1440 e a 390 | `true` nos 2 temas |
| L2 | Toda tela e toda aba tem **título + 1 linha de propósito** | 1 `h1` por rota do menu + um `[data-proposito]` com ≤ 90 caracteres | 8/8 telas, 13/13 abas do Admin |
| L3 | **Zero jargão no fluxo** | grep no texto visível de `<main>`: `POP`, `DISC`, `régua`, `esteira`, `cron`, `n8n`, `Vapi`, `Chatwoot`, `SUPABASE_`, `RLS`, `token`, `webhook`, `enum`, `hash`, `503` | 0 fora de `title`/`Dica`/tela de admin |
| L4 | Nenhuma tela exige rolagem para achar a ação principal | altura do documento ≤ 1080 px (§2.3) | 8/8 telas |
| L5 | Botão diz **verbo + objeto** | revisão de lista: nenhum botão só "Emitir", "Gerar", "Abrir" sem objeto | 0 ocorrências |
| L6 | Nenhum termo de tela fora de `vocabulario.ts` | todo rótulo de negócio novo passa por `rotulo(chave)` | 0 literais novos |

---

## 9. Divisão de tarefas — dois Opus em paralelo, fronteira sem interseção

### Regra de fronteira (decide `src/lib/*` compartilhado)

> **BACK é dono de `src/lib/**`, `src/hooks/**` que buscam dados, `src/server/**`, `src/app/api/**`,
> `src/types/**`, `next.config.ts` e de TODO arquivo `api*.ts` dentro de `src/components/**`.
> FRONT é dono de todo `.tsx`, de `src/app/globals.css`, de `docs/DESIGN-SYSTEM.md` e dos
> `src/app/(app)/**/page.tsx|layout.tsx`.**
> Exceção nomeada: `src/components/admin/adminApi.ts`, `http.ts`, `useAcessoAdmin.ts` são do BACK.

Os contratos do §1.2, §5.2 e §6.3 estão **congelados neste documento**: o FRONT programa contra eles
sem esperar o BACK terminar. Quem quebrar contrato avisa no scratchpad antes de mudar.

### 9.1 `frontend-engineer` (Opus) — tokens, telas, navegação

- [ ] **F1 — baseline medida.** Rodar `tmp/squad/f6-medir.mjs` com `PREFIXO=F6-antes` **antes de
      editar qualquer token**, dev server em `-p 3100`. *Aceite:* `tmp/squad/f6-medidas-antes.json`
      existe com as 8 telas × 2 temas.
- [ ] **F2 — tokens de densidade** em `src/app/globals.css` (§2.1) + reescrever as tabelas §2 e §2.1 de
      `docs/DESIGN-SYSTEM.md` com os números novos. *Aceite:* `--alvo-minimo` intacto, `.area-publica`
      intacta, `html { font-size }` não declarado, `npm run build` verde.
- [ ] **F3 — hero e ritmo** nos 12 componentes do §2.2. *Aceite:* `gap-8`/`gap-6` = 0 no `src/`;
      altura ≤ 1080 px nas 8 telas, 2 temas.
- [ ] **F4 — menu de 5 entradas** (`Nav.tsx`, `AppShell.tsx`, `PaletaComandos`, `TourPrimeiraVez`) +
      trocar os links internos das 7 rotas renomeadas + apagar `/gaveta-demo` e `/graficos-demo`.
      *Aceite:* 5 itens, cada um com linha de propósito; `PaletaComandos` acha as 5 áreas + a
      Disponibilidade; nenhum link interno apontando para rota antiga (grep).
- [ ] **F5 — Admin absorve Repertório da IA e Importações** (§3.3/§3.4), com a frase do repertório na
      tela e o ramo `somente_custo_ia` renderizando 2 abas. *Aceite:* logado como advogada, `/admin#repertorio`
      abre; nenhuma outra aba de admin é montada (conferir no DOM, não no visual).
- [ ] **F6 — Ficha F6-A** (§4.1 a §4.4): identidade em 1 linha, gaveta "Ficha completa", trilho por
      3 sessões, bloco da próxima ação com `data-acao-agora`, Pasta por sessão, Automações recolhidas,
      Radar dentro da sessão 2, croqui vira cartão + botão, aba `pesquisa` sai. *Aceite:* Ficha ≤ 1080 px,
      `proximaAcao.acimaDaDobra = true`, deep-link `#formulario`/`#documentos` ainda abre a gaveta.
- [ ] **F7 — barra "Enviar"** (§5.4/§5.5), consumindo `derivarEnvios` do BACK. *Aceite:* os 5 tipos
      aparecem sempre; indisponível mostra o motivo na tela (não só no `title`); 1 clique quando não há
      link ativo; confirmação de 1 linha quando há; falha de clipboard vira toast + URL selecionável.
- [ ] **F8 — rótulos "Contato da equipe"** nos `.tsx` do §6.2 e **"Disponibilidade da equipe"** (§7).
      *Aceite:* grep de "Ligação" no texto visível só sobra onde é ligação por IA.
- [ ] **F9 — medição final** `PREFIXO=F6-depois` + tabela antes/depois no relatório, com as capturas em
      `tmp/squad/capturas/F6-*.png`. *Aceite:* as 6 invariantes do §2.3 batem; onde não bater, a
      ressalva vem com o número, não com adjetivo.

### 9.2 `backend-engineer` (Opus) — domínio, rotas, links, vocabulário

- [ ] **B1 — espinha das 3 sessões** (§1.2): `ChaveSessao`, `ROTULO_SESSAO`, `SESSAO_POR_PASSO`,
      `agruparPorSessao` em `src/lib/pasta/trilho.ts`; `SESSAO_POR_ITEM` em `catalogo.ts`.
      *Aceite:* `npm test` (`src/lib/pasta/trilho.test.ts`, vitest desde a Fase 7) continua passando nas 6 bordas **e** ganha 3 casos
      novos (tudo `null` → nenhuma sessão atual; jornada completa → 3 sessões `feito`; croqui sem
      sessão → sessão 1 com passos `pulado` e sessão 2 `atual`).
- [ ] **B2 — `src/lib/pasta/envios.ts`** (§5.2), função pura, com teste de mesa em
      `src/lib/pasta/envios.test.ts` cobrindo os 6 motivos da tabela. *Aceite:* `npm test`
      imprime 6/6; nenhum motivo inventado (cada um cita a fonte no comentário).
- [ ] **B3 — `POST /api/jornadas/[id]/links` aceita `confirmacao`** (§5.3). *Aceite:* `agendamento_id`
      lido no servidor (nunca do corpo); sem agendamento → 409 com código estável; sem `service_role`
      → 503 com motivo; `curl` das 3 respostas colado no relatório.
- [ ] **B4 — `configuracoesUi.ligacaoIaAtiva`** no montador de `Ficha360` (`src/server/jornadas.ts`,
      §6.3), tolerante a chave ausente (`false`, nunca erro). *Aceite:* `GET /api/jornadas/[id]`
      devolve o campo; com `provedor='manual'` vem `false`.
- [ ] **B5 — vocabulário "Contato da equipe"** em `src/lib/vocabulario.ts`, `catalogo.ts`, `trilho.ts`,
      `rotas.ts` (§6.2). *Aceite:* nenhum `alter type`, nenhuma migration; `rotuloDeEtapa` intacto;
      build e lint verdes.
- [ ] **B6 — redirects permanentes** em `next.config.ts` (§3.2) + apagar `SelecionarSessaoApp.tsx` e
      `src/app/(app)/sessoes/page.tsx` **depois** que o FRONT puser "Conduzir" na linha da Agenda
      (coordenar pelo scratchpad). *Aceite:* `curl -I /painel /esteira /comunicacao /indicadores
      /conhecimento /importacoes /sessoes` → 308 para o destino certo; `/gaveta-demo` → 404.
- [ ] **B7 — remover o segundo fetch de material** da via de links (§5.2) e conferir que `materialAtual.aprovado_em`
      chega no payload. *Aceite:* 1 requisição a menos por abertura da Ficha, medida no Network.

### 9.3 `security-pentester` — obrigatório

A barra "Enviar" amplia quem emite o quê. O que auditar:

1. **`confirmacao` pela rota da equipe (§5.3)** — o `agendamento_id` sai mesmo do servidor? Dá para
   emitir link de confirmação para agendamento de **outra** jornada trocando o `id` da URL ou o corpo?
   A trava de papel da rota vale (a RPC `emitir_link_confirmacao_sistema` roda como `service_role` e
   **não** confere papel — a rota é a única barreira: se ela falhar, um `assistente` emite link).
2. **`exigirPapel` × RLS** — `assistente` continua sem emitir nada? (`0028:811-814` lista só admin,
   advogada, relacionamento).
3. **Vazamento de token** — o token continua aparecendo só na resposta do POST? Nada de token em log,
   em `registrarErro`, em `erros_servidor` ou no toast.
4. **Revogação em cadeia** — emitir pela barra revoga o ativo anterior (`0028:829-833`); confirmar que
   não dá para revogar link de **outra** jornada por `id` (`/api/links/[id]/revogar`).
5. **Admin para não-admin (§3.4)** — logado como advogada em `/admin#repertorio`: nenhuma aba de
   admin montada, nenhum fetch de rota admin disparado (Network, não só DOM).
6. **`configuracoesUi` (§6.3)** — só `ligacao_ia.provedor` sai; nenhuma outra chave de `configuracoes`
   (que inclui coisas de integração) vaza no payload da Ficha.
7. **Rate limit e pepper** — a emissão pela barra passa pelos mesmos `exigirPepper`/limites; sem
   pepper, 500 controlado, nunca token fraco.

---

## 10. CONFLITO · BLOQUEIO · fora desta rodada

### CONFLITO 1 — "Copiar em 1 clique" × o token não é recuperável
A decisão 3 pede "Copiar em 1 clique, sempre visível". O banco guarda **hash**, não token
(`0028:70-73`): **não existe recopiar** um link já emitido, e emitir de novo **revoga o anterior**
(`0028:829-833`). Resolução do §5.4 (1 clique quando não há ativo; confirmação de 1 linha quando há)
**mantém a decisão no caso que o João descreveu** e evita quebrar em silêncio um link que já está no
WhatsApp do cliente. **Se o João quiser 1 clique sempre, sem confirmação nenhuma, é dizer — o efeito é
esse.**

### CONFLITO 2 — "identidade do seminário" (Fase 4) × compactação
O design system é fiel ao seminário: título grande, muito respiro, raio grande. A Fase 6 corta 35 %
do respiro e um degrau de cada fonte. **A identidade preservada é cor, tipo, sombra, selo e raio —
não a escala.** Registrado aqui para o Fable não julgar como regressão da Fase 4: é substituição
consciente, com a decisão 1 do João como fonte.

### CONFLITO 3 — trilho de 9 passos × passo renomeado
`ChaveTrilho = "ligacao"` continua sendo a chave (`trilho.ts:53,78,111`), e `PASSO_POR_CHAVE`
(contrato congelado da F5, §11.4) não muda. Só `ROTULO_TRILHO.ligacao` vira **"Contato"** e o nome
inteiro vai para o `title`. **Nenhum contrato congelado da Fase 5 é quebrado.**

### CONFLITO 4 — Admin admin-only × Repertório para a advogada
Resolvido no §3.4 (2 abas no ramo `somente_custo_ia`). Sem isso, a decisão 2 tiraria da Dra. Elaine a
tela que ela usa antes de cada sessão.

### CONFLITO 5 — o brief cita "migrations 0028a-c"
Não existem. É `0028_links_publicos.sql` (arquivo único) + `0050`/`0051` para o tipo `confirmacao`.
Corrigido ao longo do §5.1 para o agente não procurar arquivo que não existe.

### BLOQUEIO 1 — `/indicadores` dentro de "Hoje": quem passa a ver o quê
A proposta do §3.2 é `/indicadores` virar a aba `#numeros` de Hoje, **mantendo o acesso atual** (todo
papel interno). A alternativa (levar para o Admin) tiraria os números de relacionamento e assistente.
Escolhi manter o acesso — mas **se a intenção do João era restringir os números do funil a
admin/advogada, isso é decisão dele, não minha**, e muda o trabalho do F4/F5.

### BLOQUEIO 2 — `LIMITE_ARQUIVOS_POR_LINK = 5` × radar com 10+ documentos
Herdado da Fase 5 (`CONTINUAR-AQUI.md` §0, item 5). A barra "Enviar" torna o link de documentos
**muito mais fácil de mandar**, o que aumenta a chance de o cliente esbarrar no teto de 5 arquivos.
A barra vai **dizer o limite** ("até 5 arquivos por link"); subir o número continua sendo decisão do
João.

### `FORA DESTA RODADA`
- F6-B (fundir Relatório/Análise/Diagnóstico numa gaveta só), se o tempo não der.
- Unificar `--text-xs` e `--text-legenda` (~90 arquivos).
- Guardar a URL do link cifrada para permitir recópia — **muda o modelo de segurança** (o token
  deixaria de ser irrecuperável): exige decisão do João e pentest próprio.
- M7 (minutas por célula × regime) — já previsto em `ARQUITETURA-FASE-5.md` §10.2.
- Qualquer migration.
- Limpeza dos exemplos e criação da pessoa "João Pedro Alves Assunção" — **é do agente do mock**
  (`tmp/squad/mock-exemplo.md`).

---

## 11. Skills a usar (`npx skills find` rodado)

| Tema | O que a busca devolveu | Decisão |
|---|---|---|
| density / typography | `jakubkrehel/skills@better-typography` (16,4 K), `dembrandt/dembrandt-skills@ui-density` (636), `membranedev/application-skills@density` (97) | **Não instalar.** `docs/SKILLS.md` só admite fonte oficial (vercel-labs, anthropics, supabase) — skill é instrução que o agente segue, e nenhuma dessas é de owner conhecido. O que já está instalado cobre: **`web-design-guidelines`** (vercel-labs) audita a UI contra as Web Interface Guidelines |
| navigation / IA | `owl-listener/designer-skills@information-architecture` (1,2 K), `hueyexe/frontend-agent-skills@information-architecture-navigation` (194) | **Não instalar**, mesma razão |
| medir no navegador | `webapp-testing` (anthropics) — **já instalada** | **Usar** junto com `tmp/squad/f6-medir.mjs` |
| React/Next | `vercel-react-best-practices` — **já instalada** | **Usar** no F6 (a Ficha vira uma tela só; cuidado com waterfall de fetch) |

---

## 12. Os 5 critérios do Fable

| Critério | O que este plano garante |
|---|---|
| **Segurança** | Uma única superfície nova: `tipo='confirmacao'` na rota que já existe, com `agendamento_id` resolvido no servidor, trava de papel dupla e `service_role` fail-closed (§5.3). Zero rota pública nova, zero migration, zero grant. `configuracoes` já é legível por interno (`0027:174`), então `ligacaoIaAtiva` não abre nada. Admin para não-admin monta 2 abas nomeadas, com gate de servidor mantido (§3.4). Pentest obrigatório com 7 alvos escritos (§9.3). |
| **Escalabilidade** | Nenhuma consulta nova: a barra "Enviar" deriva de payload já carregado e **remove** um fetch (`LinksAba.tsx:44-48`). Nenhum índice novo é necessário — `idx_links_jornada` (`0028:93`) já serve a listagem por jornada. A Ficha deixa de renderizar as 19 tabelas do croqui (~8.600 px de DOM) em toda abertura. |
| **Solidificação** | O banco já garante o que importa e continua garantindo: um link ativo por tipo (`uniq_link_ativo`), confirmação sempre amarrada a agendamento (`ck_link_confirmacao_agendamento`), material de sistema só aprovado (`0031:313-318`). No código, `SESSAO_POR_PASSO`/`SESSAO_POR_ITEM` passam a ser **a única fonte** do agrupamento das 3 sessões — a lista `MOMENTOS` duplicada morre. Os testes de mesa do trilho ganham 3 bordas novas. |
| **UX** | É a fase inteira: −35 % de respiro, um degrau a menos de fonte, 9 entradas → 5, 9 abas da Ficha → 0 (seções + gavetas), o link que o João procurava vira botão fixo, "Conhecimento" vira "Repertório da IA" com a frase na tela, "Horários livres" vira "Disponibilidade da equipe" com entrada direta, e a lei de intuitividade tem 6 medidas (§8), não adjetivos. |
| **Otimização** | Sai mais do que entra, e é contável: 2 telas de demonstração apagadas · `SelecionarSessaoApp` (97 linhas) apagada · 1 fetch por Ficha removido · 1 lista duplicada (`MOMENTOS`) removida · 4 grupos de menu removidos · 1 aba-stub (Pesquisa pública) removida da barra · 3 abas do pós-sessão viram 1 gaveta (F6-B) · ~8.600 px de DOM saem da Ficha. Entra: 1 função pura (`derivarEnvios`), 1 constante de agrupamento, 1 campo booleano no payload, 1 valor a mais num enum de rota que já existia. |
