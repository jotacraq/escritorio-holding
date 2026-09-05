# Fase 5 — "O sistema guia o advogado" + Motor do Croqui
Escrito pelo orquestrador (Fable) em 05/09/2026 a partir do pedido do João e dos modelos reais do Drive (`brain/06 - Materiais/Modelo real do Croqui e da Sessao (Drive).md`). A parte "fora da caixa" (§1) é decisão de produto proposta; o detalhamento técnico (§4) é do arquiteto (Opus).

## 0. O diagnóstico em uma frase
O sistema hoje é um CRM bonito com IA em cima; o que o escritório vende é um **cálculo** (o croqui) e uma **sequência de passos** (a esteira). Nenhum dos dois está no centro da tela. A Fase 5 põe os dois no centro e tira todo o resto do caminho.

## 1. Fora da caixa — o que muda o jogo
### 1.1 Motor do Croqui (determinístico) — o croqui vira uma calculadora viva, não um texto
Hoje o croqui é 13 slides de prosa gerados por IA e um "Cenário Patrimonial" de rubricas soltas. No Drive, o croqui é **17 tabelas com número** (inventário hoje e pós-reforma, doação, 1/2/3 células, comparativo geral, ITBI, membership, honorários por hora, deduções, parcelamento). Proposta:
- `motor-croqui/` — função pura `calcularCroqui(entrada, parametros): ResultadoCroqui` que reproduz **todas** as tabelas do modelo real. Entrada = bens (classe, valor DIRPF, valor de mercado, destinação/locação), família, UF/município, modelo(s) escolhido(s). Parâmetros = `parametros_metodo` (já versionado com base legal): ITCMD herança/doação por UF (atual e pós-reforma), ITBI por município, % cartório de notas/imóveis, certidões, % honorários de inventário, deságio, IR ganho de capital, junta/contabilidade por modelo, valor-hora, tabela de horas por ato, deduções, incentivo resolvedores, membership.
- **Procedência em cada número** (já existe o conceito): `digitado | calculado(parametro vN) | ausente`. Sem alíquota cadastrada para a UF → o slide mostra "falta a alíquota de ITCMD de MG — Admin → Parâmetros", nunca zero.
- **Reforma tributária como cenário paralelo**, não como campo: cada tabela nasce com as duas colunas (atual × após reforma) porque o método apresenta sempre as duas.
- A IA deixa de "inventar" o croqui: ela recebe o `ResultadoCroqui` pronto e escreve só `como_apresentar` + perguntas + objeções (o que já faz bem). Custo de IA cai (sem números na saída → schema menor, sem o teto de gramática).
- O que o cliente vê (`/apresentar`, PDF, `/p/m`) e o `3) RELATÓRIO DO CROQUI` do Drive saem do **mesmo** resultado — exportar `.docx` com a mesma estrutura do template para a pasta do cliente no Drive (o sistema vira facilitador do Drive, como o João pediu).

### 1.2 Simulador ao vivo na Sessão de Viabilidade ("e se…")
Como a conta é pura e roda no cliente, a advogada mexe no valor de mercado de um imóvel ou marca "2 células" durante a sessão e a tabela de economia muda na hora — é o argumento de venda do método ("veja a diferença") feito na frente do cliente, sem planilha. O mesmo componente vira o slide `economia` do croqui.

### 1.3 Trilho + "o que falta agora" em toda tela de cliente
7 passos fixos (Pagou → Ligação → Agendou → Confirmou → Sessão → Croqui → Holding), passo atual aceso, UM botão. Já existe `derivarProximoPasso`; falta `derivarTrilho` (mesma fonte) e o componente `ui/Trilho` (Ficha completo; Esteira/Agenda compacto).

### 1.4 Automações com resultado visível na ficha (o "raio-x" da jornada)
Cada automação aparece como linha do trilho com o RESULTADO, não como aba: "Boas-vindas · e-mail enviado 03/09 14:02 ✓ · WhatsApp aguardando envio", "Ligação por IA · 2 tentativas · sem resposta · link enviado", "Confirmação · cliente confirmou pelo link em 08/09". Dado já existe (`mensagens_agendadas`, `ligacoes_ia`, `presenca_confirmada_*`, `webhooks_eventos`); falta uma view `vw_automacoes_jornada` e a linha na Ficha.

### 1.5 Radar de documentos ("tem documento X para enviar")
Lista explícita por cliente derivada do modelo escolhido: IR (DIRPF) do titular e cônjuge, contrato social de cada empresa, matrícula de cada imóvel, documento de cada veículo, extratos de investimento; estado `pedido | recebido | conferido`; um botão "Pedir agora" que enfileira a mensagem com o link `/p/d`. Nasce na aba Sessão/pós-sessão, e o `motor-croqui` acusa o que falta para fechar cada tabela.

### 1.6 Painel por papel e vocabulário humano
Advogada vê sessões/preparo/croquis; equipe vê pagou-sem-contato/travado; admin vê sistema. Dicionário único (`src/lib/vocabulario.ts`): "Ligação Estratégica" (não POP 03), "mensagens automáticas" (não régua), "caminho do cliente" (não esteira). Sigla só em `title`.

## 2. Lei de texto (ordem do João, 05/09)
Cartão = título + estado + 1 ação; zero prosa inline (explicação em `Dica`/"Como funciona"); rótulo ≤ 3 palavras; estado ≤ 4; descrição de página ≤ 1 linha; número primeiro; um verbo por cartão; estado vazio = 1 linha + 1 ação; nada de aviso de sistema para não-admin; sem sigla no fluxo. Meta: ≤ 50% das palavras atuais nas 5 telas mais lidas.

## 3. Tipografia e ritmo
Blocos grudados e texto "entortado": revisar `--espaco-*`, line-height dos títulos (Neuetra bold com `leading-tight` estoura em 2 linhas), `gap` entre cartões e seções, e um único padrão de respiro documentado em `docs/DESIGN-SYSTEM.md`.

# Parte II — desenho técnico (arquiteto, Opus, 05/09/2026 · rev. 2 após o recon do Drive)
Do §4 em diante é contrato de execução. Quem implementa não decide desenho; quem audita (Fable) cobra o §12.

**CONCEITO:** o croqui deixa de ser texto gerado e vira um **cálculo determinístico versionado com procedência por célula** — a IA só narra o que o motor já sabe, e slide, PDF, `.docx`, `/p/m` e simulador leem o mesmo `ResultadoCroqui`.

**O que a rev. 2 mudou** (fonte: `brain/06 - Materiais/Processo real do escritorio (Drive).md`, leitura célula a célula da planilha real de 19 abas; a nota `Modelo real do Croqui e da Sessao (Drive).md` ficou desatualizada em vários coeficientes):

Mudou: ITCMD/ITBI/ganho de capital/cartório viram **tabelas progressivas por faixa** (§4.3); a base do ITCMD é **mercado em 1 e 2 células, DIRPF só em 3** (§4.5); honorários da holding viram **fórmula** `hora × Σhoras + 10%` (T16); hora **1.800**, honorários de inventário **7%**, incentivo na SV **2.400**, cartório **0,8% / 0,5%** só como fallback; o custo do inventário passa a incluir o **deságio**; os BLOQUEIOS 3 e 4 da rev. 1 estão **resolvidos** pela planilha; o resultado sobe de 17 para **19 tabelas** (entram payback e IBS/CBS); o trilho vai de 7 para **9 passos**; minutas ganham modelo de dados agora e gerador na Onda 3. A tabela comparativa completa está em `tmp/squad/fase5-brief.md`.

## 4. Motor do Croqui — `src/server/motor-croqui/`
Função **pura**, zero I/O, zero IA, sem `server-only` (roda no servidor e no cliente — mesmo precedente de `gerar-slides.ts`, importado hoje por `mapeamentoGraficos.ts`). Vive em `src/server/` por convenção de camada, não por runtime.

```
src/server/motor-croqui/
  tipos.ts        EntradaCroqui · ParametrosCroqui · ResultadoCroqui · Celula · Faixas
  faixas.ts       aplicarFaixas(base, faixas): ResultadoFaixa  (pura, 3 modos)
  catalogo.ts     CATALOGO_PARAMETROS (38 chaves) + chavesNecessarias()
  dominio.ts + celula.ts   regras FIXAS do método · construtores de célula e somar()
  tabelas/*.ts    uma função pura por tabela (19 arquivos)
  calcular.ts     calcularCroqui(entrada, parametros): ResultadoCroqui
  index.ts        superfície pública
scripts/teste-motor-croqui.ts   testes de mesa (npx tsx); `--fixture <arquivo>` opcional
```

### 4.1 `Celula` — a unidade do resultado
```ts
export type Procedencia = "calculado" | "digitado" | "ausente"; // MESMO vocabulário do enum
                                                               // procedencia_valor (0057).
export interface Celula {
  valor: number | null;
  procedencia: Procedencia;
  formula?: string;          // "faixa 2% sobre a base de mercado (SP, doação)"
  parametro_id?: string;     // versão de parametros_metodo que entrou na conta
  parametro_chave?: string;
  aliquota?: number;
  faixa_aplicada?: number;   // ordem da faixa, quando veio de tabela progressiva
  /** qual das duas fontes de cartório foi usada — a procedência precisa dizer */
  fonte?: "tabela_uf" | "percentual_fallback";
  rubrica_id?: string;       // só em `digitado`: override vindo de cenario_rubricas
  motivo?: string;           // só em `ausente`, em português, na tela
  falta?: Array<{ chave: string; uf?: string; municipio?: string }>;
}
```

**Regra de propagação (invariante testada):** qualquer parcela `ausente` torna o total `ausente`, com `falta` = união das faltas. Nunca existe soma parcial que pareça total — é a lei da `vw_cenarios_totais` (0060) em TypeScript. **Zero é resultado, ausência não é zero:** `ITBI = 3% × 0` (mercado == DIRPF) é `calculado` com `valor: 0`; ITBI sem tabela cadastrada é `ausente`.

Isso não é preciosismo: o recon achou **no Drive um deck real entregue com "R$ 0,00"** no custo total do inventário e a frase de fechamento "a família perde aproximadamente R$ 0,00" — a sincronização Sheets→Slides falhou em silêncio e ninguém viu antes de enviar. Uma segunda cópia do mesmo deck traz números diferentes nas mesmas células. **Esse caso é critério de aceite** (§4.8, teste C).

### 4.2 `EntradaCroqui`
```ts
export type ClasseBem = "imovel" | "veiculo" | "investimento" | "previdencia" | "empresa" | "outro";
export type ModeloCroqui = "inventario" | "doacao" | "celula_1" | "celula_2" | "celula_3";

export interface BemCroqui {
  id: string;                       // patrimonio_itens.id
  classe: ClasseBem;
  descricao: string;
  valor_dirpf: number | null;       // patrimonio_itens.valor_historico
  valor_mercado: number | null;
  destinacao: "uso" | "locacao" | "venda" | "operacional" | null;
  valor_locacao_mensal: number | null;
  ano_aquisicao: number | null;
  vender_para_levantar?: boolean;   // bem escolhido para dar liquidez ao inventário (T4)
}

export interface EntradaCroqui {
  jornada_id: string;
  uf: string | null;                       // jurisdição do ITCMD e dos cartórios
  municipio: string | null;                // jurisdição do ITBI
  uf_domicilio_vantajoso: string | null;   // 2 células
  familia: { regime_bens: string | null; tem_conjuge: boolean; filhos: number | null; netos: number | null; nucleos: number | null };
  bens: BemCroqui[];
  operacional: { faturamento_mensal: number | null; custo_operacional_mensal: number | null } | null;
  modelos: ModeloCroqui[];
  cdi_anual?: number | null;               // premissa do payback; null usa o parâmetro
  overrides: Array<{ tabela: string; linha: string; coluna: string; valor: number; rubrica_id: string }>;
}
```

### 4.3 Faixas progressivas — `aplicarFaixas`
Achado que derruba o desenho escalar da rev. 1: ITCMD (causa mortis e doação), IR sobre ganho de capital, IRPF mensal e emolumentos de cartório de notas **não são alíquotas únicas** — são tabelas por faixa, mantidas pelo escritório para as 27 UFs.

```ts
export type ModoFaixa = "faixa_unica" | "progressivo" | "valor_fixo";
export interface Faixa { ordem: number; ate: number | null; aliquota?: number; valor?: number; deduzir?: number }
export interface TabelaFaixas { modo: ModoFaixa; isento_ate?: number; teto?: number; faixas: Faixa[] }

export interface ResultadoFaixa { valor: number; faixa_aplicada: number; formula: string }
export function aplicarFaixas(base: number, t: TabelaFaixas): ResultadoFaixa;
```

- **`faixa_unica`** — acha a faixa em que a base cai e aplica **aquela alíquota sobre a base inteira**. É o que a planilha faz para ITCMD (cadeia de `IF` sobre a aba 15/17) e para IRPF mensal (com `deduzir` = parcela a deduzir). `isento_ate` → valor 0, `procedencia = "calculado"`, nunca `ausente`.
- **`progressivo`** — soma faixa a faixa. É o IR sobre ganho de capital (isento até R$ 35.000; depois 15% / 17,5% / 20% / 22,5%).
- **`valor_fixo`** — devolve o **valor** da faixa, não um percentual. É a tabela de emolumentos do cartório de notas por UF (ex.: SP — até 50.000 R$ 550 · até 200.000 R$ 1.650 · até 700.000 R$ 2.950 · acima R$ 17.800 como teto).

**Fallback com procedência explícita:** cartório usa a tabela da UF quando cadastrada (`fonte: "tabela_uf"`); senão o percentual de aproximação (`fonte: "percentual_fallback"`, 0,8% notas / 0,5% imóveis); sem nenhum dos dois, `ausente`. A tela e o `.docx` mostram qual das duas foi usada — hoje o escritório não sabe distinguir. Estrutura no banco: `parametros_metodo.faixas jsonb` + `unidade = 'faixas'` (§5.3, 0063). **Não** é tabela filha: a versão do parâmetro tem de ser atômica e imutável, e uma tabela filha permitiria alterar as faixas de uma versão já ativada — furo direto no que a 0056 garante. A auditoria por linha vem da view `vw_parametros_faixas`, que faz `unnest` só de leitura.

### 4.4 Catálogo de parâmetros — 38 chaves
**U** unidade · **J** jurisdição exigida · **BL** base legal obrigatória · **D** default (só onde é regra do método; só aí há seed).

| # | chave | U | J | BL | D |
|---|---|---|---|---|---|
| 1 | `itcmd.faixas.heranca` | faixas | UF | sim | — |
| 2 | `itcmd.faixas.doacao` | faixas | UF | sim | — |
| 3 | `itcmd.faixas.heranca_reforma` | faixas | UF | sim | — |
| 4 | `itcmd.faixas.doacao_reforma` | faixas | UF | sim | — |
| 5–6 | `itcmd.fixo.celula_3` · `…celula_3_reforma` | brl | UF | sim | — |
| 7 | `itcmd.aliquota.domicilio_vantajoso` | percentual | UF | sim | — |
| 8 | `itbi.aliquota` | percentual | UF+mun | sim | — |
| 9–10 | `cartorio.faixas.notas` · `…imoveis` | faixas | UF | sim | — |
| 11–12 | `cartorio.notas.percentual_fallback` · `…imoveis.…` | percentual | UF | sim | — (0,8 / 0,5) |
| 13 | `cartorio.certidoes.valor` | brl | — | não | — **(divergência 2.000 × 7.000 — §11.4)** |
| 14 | `honorarios.inventario.percentual` | percentual | UF | sim | — (sugestão 7) |
| 15–16 | `ir.faixas.ganho_capital` · `…irpf_mensal` | faixas | — | sim | **tabelas oficiais** |
| 17 | `venda_forcada.desagio.percentual` | percentual | — | não | **20** |
| 18–20 | `holding.junta_comercial.celula_1\|2\|3` | brl | — | não | **3577 · 3500 · 4599** |
| 21–23 | `holding.contabilidade.celula_1\|2\|3` | brl | — | não | **2133 · 3555 · 4266** |
| 24 | `honorarios.hora` | brl | — | não | **1800** |
| 25 | `honorarios.operacional.percentual` | percentual | — | não | **10** |
| 26–30 | deduções: `honorarios.sv.padrao` · `incentivo.resolvedor.sv` · `honorarios.croqui.padrao` · `…croqui.incentivo` · `incentivo.resolvedor.croqui` | brl | — | não | **2000 · 2400 · 7200 · 4500 · 2700** (28 e 29 já existem, 0056) |
| 31 | `incentivo.resolvedor.saldo.percentual` | percentual | — | não | **10** *(sobre o SALDO)* |
| 32 | `pagamento.sinal.percentual` | percentual | — | não | **10** |
| 33 | `pagamento.parcelas.max` | parcelas | — | não | **5** |
| 34 | `membership.mensalidade` | brl | — | não | — **(1 plano × 3 planos — §11.4)** |
| 35 | `membership.meses_isentos` | meses | — | não | **6** |
| 36–39 | `reforma.ibs_cbs.debito` · `…credito` · `reforma.irpj_csll` · `locacao.pj.presumido` (todas `.percentual`) | percentual | — | sim | **15,9** · — *(26,5 × 36,92 — §11.5)* · **7,68** · **3,65** |
| 40 | `payback.cdi_anual.percentual` | percentual | — | não | **10** *(premissa)* |
| 41 | `operacional.risco_bloqueio.meses` | meses | — | não | **6** |

38 chaves distintas (as numeradas 18–23 são 6). **Sumiram da rev. 1** as 3 de `holding.honorarios.celula_N` (viraram fórmula) e as 12 de `pos_constituicao.*` (não existem na planilha — eram inferência do deck). **Seed na 0063:** só as que têm **D** e não têm jurisdição — 15, 16, 17, 18–23, 24, 25, 26, 27, 30, 31, 32, 33, 35, 36, 38, 39, 40, 41. **Nunca semeadas (B30 intacto):** tudo com jurisdição (1–12, 14) e as 3 em divergência (13, 34, 37), que só entram por reconciliação (§11.4).

`chavesNecessarias(entrada)` devolve só o subconjunto que aquele cliente exige — um cliente de 1 célula em SP sem locação precisa de 12 chaves, não de 38. É o que alimenta o aviso "faltam N parâmetros para fechar este croqui".

**Estrutura, não preço:** a tabela de horas por ato (21 atos × BÁSICO/2/3 células, totais 50 h / 47 h / 35 h) vive em `configuracoes['croqui.horas_por_ato']`, semeada **vazia**. Config vazia → T15 e T16 nascem `ausente`, nunca zero. O modelo de referência do sinal vive em `configuracoes['croqui.sinal_modelo_referencia']` (default `celula_3`, §11.4 pendência 4).

### 4.5 Regras de domínio — fixas no motor, não parametrizáveis
`dominio.ts` guarda o que é **desenho do método**, não preço. Parametrizar isto seria oferecer ao Admin a chance de quebrar o método sem perceber:

```ts
export const BASE_ITCMD: Record<ModeloCroqui, "mercado" | "dirpf"> = {
  inventario: "mercado", doacao: "mercado",
  celula_1: "mercado", celula_2: "mercado", celula_3: "dirpf",   // ← só a 3ª usa DIRPF
};
export const BASE_CARTORIO_IMOVEIS: Record<ModeloCroqui, "mercado" | "dirpf"> = {
  inventario: "mercado", doacao: "dirpf",                        // ← a doação usa DIRPF
  celula_1: "mercado", celula_2: "mercado", celula_3: "mercado",
};
export const CASCATA_CELULAS = ["destino", "veiculo", "cofre"] as const; // Destino → Veículo → Cofre
```

A base de mercado em 1 e 2 células e DIRPF só em 3 é diferença de desenho tributário real entre os modelos — é o que faz a 3ª célula ser tão mais barata. Fica com `comment` no código apontando para a nota do brain, e entra na lista de confirmação com a Dra. Elaine (§11.4, pendência 2).

### 4.6 `ResultadoCroqui` — 19 tabelas, espelhando as 19 abas
```ts
export interface Tabela {
  chave: ChaveTabela; titulo: string;
  colunas: Array<{ chave: string; rotulo: string }>;
  linhas: Array<{ chave: string; rotulo: string; destaque?: boolean; celulas: Record<string, Celula> }>;
  falta: Array<{ chave: string; uf?: string; municipio?: string }>;
}
export interface ResultadoCroqui {
  motor_versao: "motor-croqui@1";
  gerado_em: string;
  tabelas: Partial<Record<ChaveTabela, Tabela>>;   // tabela sem insumo SAI, não vira zero
  faltas: Array<{ chave: string; uf?: string; municipio?: string; tabelas: ChaveTabela[] }>;
  divergencias: Array<{ chave: string; valores: number[]; onde: string }>;  // §11.4
}
```

| # | `ChaveTabela` | aba da planilha |
|---|---|---|
| T1 | `composicao_familiar` | 1 Família |
| T2 | `formacao_patrimonial` | 2 Patrimônio (inclui a coluna Tributação do rendimento) |
| T3 | `inventario_atual` | 3 Inventário (B3–B9) |
| T4 | `levantamento_inventario` | 3 Inventário (B12–B18) |
| T5 | `inventario_reforma` | — (é do deck; ITCMD pela tabela de reforma) |
| T6 | `doacao` | 4 Doações |
| T7 · T8 · T9 | `celula_1` · `celula_2` · `celula_3` | 5 · 6 · 7 |
| T10 | `operacional_pj` | 8 Operacional |
| T11 | `payback` | 9 Payback |
| T12 | `operacional_locacao` | 10 Operacional de aluguéis futuros |
| T13 | `comparativo_geral` | 11 Comparativos |
| T14 | `itbi` | 12 Comparativos com ITBI |
| T15 | `horas_por_ato` | 13 Horas de trabalho |
| T16 | `honorarios` | 14 Honorários (B6–B9) |
| T17 | `deducoes` | 14 Honorários (B12–B19) |
| T18 | `pagamento` | 14 Honorários (B22–B28) |
| T19 | `membership` | contrato + slide 37 |

As abas 15–19 da planilha (alíquotas ITCMD, IRPF, tabela progressiva, tabela de notas) **não são tabelas de resultado** — são os parâmetros do §4.4.

### 4.7 Fórmulas, tabela por tabela
`Σm` / `Σd` = totais de mercado / DIRPF; `Σm_im` / `Σd_im` = idem só imóveis; `pN` = parâmetro nº N do §4.4. Qualquer parcela nula propaga `ausente`.

- **T1** — passa-through da família, sem conta. **T2** — linha por bem: DIRPF · mercado · rendimento mensal · **tributação do rendimento** = `aplicarFaixas(rendimento, p16)`; linha total = `Σd`, `Σm`, Σrendimento, Στributação.
- **T3** — base = `Σm`; `itcmd = aplicarFaixas(Σm, p1)`; `notas` = tabela `p9` ou fallback `p11% × Σm`, só se houver imóvel; `certidoes = p13`; `imoveis` = `p10` ou `p12% × Σm`, só se houver imóvel; `honorarios = p14% × Σm`; `subtotal` = soma.
- **T4** — `a_levantar = T3.subtotal`; bem = o marcado `vender_para_levantar`, senão o 1º imóvel com mercado ≥ `a_levantar`, senão a soma de todos os imóveis (regra da planilha); `desagio = mercado × p17%`; `ganho = max(0, mercado × (1 − p17/100) − dirpf)`; `ir = aplicarFaixas(ganho, p15)`; **`custo_da_inercia = T3.subtotal + desagio + ir`** — é o número que TODA comparação usa; `risco_bloqueio = faturamento_mensal × p41` (sem PJ → `ausente`, nunca 0).
- **T5** — T3 com `p3` no lugar de `p1`; `custo = subtotal + T4.desagio + T4.ir`.
- **T6** — base `Σm`; `notas = T3.notas`; `certidoes = p13`; `imoveis` sobre **`Σd_im`** (`BASE_CARTORIO_IMOVEIS.doacao`); `itcmd = aplicarFaixas(Σm, p2)`; `total` = soma; **`diferenca = T4.custo_da_inercia − total`** e `percentual = diferenca ÷ T4.custo_da_inercia`. *A planilha real tem aqui um bug (`SUM(B7:B11)` soma o próprio total, inflando a diferença) — o motor implementa a versão correta, igual à das abas 5/6/7, e o `.docx` sai diferente da planilha nesta linha de propósito.*
- **T7 / T8 / T9** — base = `Σm` (T7, T8) e `Σd` (T9), por `BASE_ITCMD`; `imoveis = p10|p12 × Σm_im`; `junta = p18|19|20`; `contabilidade = p21|22|23`; `honorarios = T16.preco_total` do modelo; `itcmd`: T7 = `aplicarFaixas(Σm, p2)` · T8 = `p7% × Σm` · T9 = `p5` (e `p6` na coluna reforma); `total`; `diferenca` e `percentual` contra `T4.custo_da_inercia`.
- **T10** — `custo_operacional = faturamento × 16,33% + 20.000`; `lucro = faturamento − custo`; `locacao_intercompany = faturamento × 10%`; `ibs_cbs = lucro × p36%`; `irpj_csll = lucro × p38%`; `credito = locacao × p37%`; `lucro_final`. Sem `entrada.operacional` → tabela ausente do resultado.
- **T11 `payback`** — `capital_salvo = T4.custo_da_inercia − T13[modelo_referencia].valor`; `economia_aluguel_mes = (aluguel × faixa IRPF − deduzir) − aluguel × (p39 + p38)/100`; `taxa_cdi_mes = (1 + p40/100)^(1/12) − 1`; `rendimento_mes = capital_salvo × taxa_cdi_mes`; `beneficio_mes` = soma; `economia_ano = beneficio_mes × 12`; **`payback_meses = custo_implementacao ÷ beneficio_mes`**.
- **T12** — CPF × PJ para o aluguel: `imposto_cpf = aplicarFaixas(aluguel, p16)`; `debito = aluguel × p36%`; `credito = custo_operacional × p37%`; `ibs_cbs_liquido = debito − credito`; `irpj_csll = aluguel × p38%`; `imposto_pj` = soma; `economia_mes`; `economia_ano = economia_mes × 13` (a planilha usa 13, não 12 — reproduzido com `formula` explicando).
- **T13** — linha por modelo, colunas `valor`, `dif_inventario`, `dif_percentual`, e as três "após reforma". Só copia totais.
- **T14** — `itbi_possivel = p8% × Σ(mercado − dirpf)` dos imóveis, só diferenças positivas; repete T13 somando `itbi_possivel` a `celula_1..3`.
- **T15** — 21 atos × horas por modelo (config); linha `total_horas` = 50 / 47 / 35 no cadastro atual.
- **T16 `honorarios`** — **`preco_total = p24 × T15.total_horas(modelo)`**; `operacional = p25% × preco_total`; `total = preco_total + operacional`. *Deixou de ser parâmetro: é fórmula, e isso apaga 3 chaves do catálogo.*
- **T17 `deducoes`** — `sv = p26` + `incentivo_sv = p27` + `croqui = p29` + `incentivo_croqui = p30` = `total_deducoes` (11.600 no cadastro atual); `saldo = T16.total − total_deducoes`; **`incentivo_resolvedor = p31% × saldo`**; `novo_saldo = saldo − incentivo_resolvedor`.
- **T18 `pagamento`** — **`sinal = p32% × T17.novo_saldo` do modelo em `configuracoes['croqui.sinal_modelo_referencia']`** (default `celula_3`), **o mesmo para os três modelos**; `saldo_a_vista = T17.novo_saldo(modelo) − sinal`; parcelas 2…`p33` = `saldo_a_vista ÷ n`.
- **T19 `membership`** — `mensalidade = p34`, `meses_isentos = p35`. Enquanto `p34` estiver em divergência (1 plano × 3 planos), a tabela nasce `ausente` com o motivo — não escolhe um dos preços.

### 4.8 Testes de mesa (`scripts/teste-motor-croqui.ts`)
Três blocos. **Nenhum valor de cliente entra no repositório.**

**A — exemplo sintético completo (commitado).** SP; ITCMD causa mortis isento até 400.000 · 2% até 4M · 4% até 10M · 6% acima; doação isento até 92.500 · 2% até 370.200 · 4% até 3.146.700 · 6% acima; notas SP por faixa (550 / 1.650 / 2.950 / 17.800 teto); IR ganho isento até 35.000 depois 15%; certidões 7.000; honorários de inventário 7%; cartório imóveis 0,5%; deságio 20%; ITBI 3%; hora 1.800; horas 50/47/35; domicílio vantajoso 2%; `itcmd.fixo.celula_3` 4.000; CDI 10% a.a. Bens: imóvel A (DIRPF 300.000 · mercado 1.000.000 · aluguel 20.000/mês) · imóvel B (200.000 · 600.000 · marcado para venda) · veículo (50.000 · 40.000) · investimento (360.000 · 360.000). **`Σd = 910.000` · `Σm = 2.000.000` · `Σd_im = 500.000` · `Σm_im = 1.600.000`.**

| tabela | células | esperado |
|---|---|---|
| T2 | tributação do aluguel (27,5% − 896) | 4.604 |
| T3 | ITCMD (faixa 2%) · notas (teto) · certidões · imóveis · honorários · **subtotal** | 40.000 · 17.800 · 7.000 · 10.000 · 140.000 · **214.800** |
| T4 | deságio · ganho · IR (progressivo) · **custo da inércia** · risco de bloqueio | 120.000 · 280.000 · 36.750 · **371.550** · **`ausente`** (sem PJ) |
| T5 | ITCMD teto 8% · subtotal · **custo** | 160.000 · 334.800 · **491.550** |
| T6 | imóveis (base DIRPF) · ITCMD 4% · **total** · diferença · % | 2.500 · 80.000 · **107.300** · 264.250 · **71,1%** |
| T7 | imóveis · ITCMD 4% · honorários · **total** · % | 8.000 · 80.000 · 90.000 · **183.710** · **50,6%** |
| T8 | ITCMD 2% · honorários · **total** · % | 40.000 · 84.600 · **139.655** · **62,4%** |
| T9 | base Σd · ITCMD fixo · honorários · **total** · % | 910.000 · 4.000 · 63.000 · **83.865** · **77,4%** |
| T14 | ITBI possível · `celula_1` com ITBI | 33.000 · 216.710 |
| T11 | capital salvo · economia aluguel/mês · taxa CDI/mês · rendimento/mês · benefício/mês · **payback** | 287.685 · 2.338,00 · 0,79741% · 2.294,03 · 4.632,03 · **18,1 meses** |
| T16 | preço total · operacional 10% · total (1 / 2 / 3 células) | 90.000 / 84.600 / 63.000 · 9.000 / 8.460 / 6.300 · **99.000 / 93.060 / 69.300** |
| T17 | deduções · saldo · incentivo 10% · novo saldo (1 célula) · novo saldo (3 células) | 11.600 · 87.400 · 8.740 · **78.660** · **51.930** |
| T18 | sinal (10% do novo saldo de 3 células) · saldo à vista 1 célula · 5× · T19 mensalidade | 5.193 · 73.467 · 14.693,40 · **`ausente`** (divergência de plano) |

**B — ausência e cascata (commitado).** MG; imóvel único (DIRPF 500.000 · mercado 500.000) + empresa (DIRPF 1.000.000 · **mercado `null`**); MG sem tabela de notas cadastrada, mas com percentual de fallback; sem `itcmd.faixas.doacao` de MG.

| assertiva | esperado |
|---|---|
| `T2.total.mercado` | `ausente`, motivo cita a empresa pela `descricao` |
| T3, T4, T5, T6, T7, T8, T13, T14 | `ausente` em cascata — **T7 e T8 caem junto**, porque a base deles é mercado |
| `T9.total` | **calculado** — base `Σd = 1.500.000` |
| `T14.itbi_possivel` | **`calculado`, valor `0`** (mercado == DIRPF) |
| notas em MG | `calculado`, `fonte: "percentual_fallback"`, com `formula` dizendo que a tabela da UF não está cadastrada |
| `T9.itcmd` · `T10` · `T12` | `ausente` com `falta = [{ chave: "itcmd.fixo.celula_3", uf: "MG" }]` · T10 e T12 saem do resultado (sem PJ, sem locação) |

**C — regressão do deck zerado (commitado).** Reproduz o caso real do Drive: parâmetro de ITCMD removido no meio do cálculo. Assertivas: nenhuma célula sai com `valor === 0` e `procedencia === "ausente"`; `T4.custo_da_inercia.valor === null`; o renderizador de `.docx`/slide desse resultado **não contém a string "R$ 0,00"** em nenhuma célula ausente; e a frase de fechamento não é montada quando o valor é `null`.

**D — propriedade (commitado).** 200 entradas aleatórias: determinismo (duas chamadas, JSON idêntico), nunca lança, nenhuma célula com `valor` não-nulo e `procedencia === "ausente"`, `aplicarFaixas` monotônica na base. **E — conferência contra a planilha real (LOCAL, nunca commitado).** `npx tsx scripts/teste-motor-croqui.ts --fixture tmp/squad/fixture-motor-croqui.json`, com os valores de célula da planilha do cliente. O `tmp/` já está fora do versionamento; o M1 cola no relatório **só** o placar (quantas células bateram, quais divergiram e por quê), nunca os valores.

## 5. Persistência
### 5.1 `croqui_calculos` — versão reproduzível
```sql
create table croqui_calculos (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid not null references jornadas(id) on delete cascade,
  croqui_id uuid references croquis(id) on delete set null,
  versao smallint not null,
  motor_versao text not null,                -- 'motor-croqui@1'
  entrada_snapshot jsonb not null,
  parametros_snapshot jsonb not null,        -- inclui as faixas de cada versão usada
  resultado jsonb not null,
  atual boolean not null default false,
  nota text,
  criado_em timestamptz not null default now(),
  criado_por uuid references perfis_equipe(id),
  unique (jornada_id, versao)
);
create unique index uniq_croqui_calculo_atual on croqui_calculos (jornada_id) where atual;
```

Trigger de versão automática (`max+1` por jornada) e trigger de **imutabilidade** no molde da 0056: só `atual` e `nota` mudam; UPDATE de `entrada_snapshot`, `parametros_snapshot`, `resultado` ou `versao` levanta `calculo_imutavel` (23514). `fixar_croqui_calculo(id)` desativa a corrente e ativa a nova na mesma transação (molde de `ativar_parametro_metodo`). **Sem grant de DELETE.** RLS `app.ve_patrimonio()`, `force row level security`.

Reproduzir um croqui de seis meses atrás = `calcularCroqui(entrada_snapshot, parametros_snapshot)` e comparar com `resultado`. É exatamente o que o Apps Script do escritório não tem: sem log, sem versão anterior, sem aviso de falha — e por isso o deck saiu com R$ 0,00.

### 5.2 Convergência com 0057/0060
| hoje | depois |
|---|---|
| `cenario_rubricas.procedencia = 'digitado'` | **override**: entra em `EntradaCroqui.overrides`, a célula sai `digitado` com `rubrica_id` |
| `cenario_rubricas.procedencia = 'calculado'` | **deprecado** — o trigger só multiplica escalar percentual e não sabe faixa; linhas existentes seguem lidas como override de valor |
| `cenario_rubricas.procedencia = 'ausente'` | ignorado (o motor já sabe) |
| `vw_cenarios_totais` | **deprecada** por comentário na 0066; serve o Diagnóstico até o M4 apontá-lo para `croqui_calculos` |
| `configuracoes['cenario.rubricas']` | mantida; ganha `configuracoes['croqui.mapa_rubricas']` (`rubrica → {tabela, linha, coluna}`) |
| grade "Cenário Patrimonial" como porta | vira **gaveta de override** dentro do croqui (§7) |

Rubrica livre sem mapeamento continua existindo, numa seção "Ajustes fora do modelo".

### 5.3 Migrations 0062–0068
Todas **aditivas**: nenhum `DELETE`, nenhum `UPDATE` de valor de cliente, nenhum backfill que reclassifique alguém. Cabeçalho-história + roteiro de verificação + reversão em cada uma.

**0062 `croqui_calculos`** — tabela, índices, triggers, `fixar_croqui_calculo`, `vw_croqui_calculo_atual` (`security_invoker`), RLS, grants sem DELETE. *Verificação:* (1) insert → `versao = 1`, `atual = false`; (2) fixar → unique parcial impede duas atuais; (3) `update … set resultado='{}'` → `calculo_imutavel` 23514; (4) `delete` como `authenticated` → permission denied; (5) `relacionamento` → 0 linhas; (6) `reloptions` → `{security_invoker=true}`; (7) recálculo do snapshot bate com `resultado`. *Reversão:* `drop view`; `drop function`; `drop table`.

**0063 `parametros_faixas`** — (a) `unidade` ganha `'faixas'`; (b) coluna `faixas jsonb` + `app.faixas_validas(jsonb)` (IMMUTABLE: array não vazio, `ordem` sequencial a partir de 1, `ate` crescente e nulo só na última, `aliquota`/`valor` ≥ 0, `modo` conhecido) em CHECK; (c) `valor` perde o `not null` + CHECK XOR (`faixas` ⊻ `valor`, conforme a unidade); (d) o trigger de imutabilidade passa a cobrir `faixas`; (e) view `vw_parametros_faixas` (`unnest`, `security_invoker`); (f) `ck_tributo_exige_base_legal` ampliado para `cartorio.`, `ir.`, `reforma.`, `locacao.`; (g) seed das 24 chaves nacionais de regra do método; (h) `configuracoes['parametros.divergencias']`, `['croqui.horas_por_ato']` (vazio), `['croqui.sinal_modelo_referencia']`. *Verificação:* (1) `select count(*) from parametros_metodo where chave like 'cartorio.%' or like 'ir.%' or like 'reforma.%' or like 'locacao.%'` → **0 antes** do alter; (2) insert com `unidade='faixas'` e `faixas` malformado → 23514; (3) `update` de `faixas` em versão ativa → `parametro_imutavel`; (4) o trigger `cenario_rubrica_calcula` (0057) recusa parâmetro `faixas` com `parametro_nao_e_percentual` — **confirmar que continua recusando**, é a garantia de que a 0057 não passa a multiplicar coisa errada; (5) `parametro_vigente('itcmd.faixas.doacao','SP')` → **0 linhas** (B30 intacto); (6) reaplicar não duplica. *Reversão:* restaurar CHECKs pelo texto da 0056; `alter column valor set not null` (só se nenhuma linha `faixas` existir); `drop column faixas`; `delete` das 24 semeadas com `ativado_por is null`.

**0064 `vw_automacoes_jornada`** — só view (§8.2). *Verificação:* `security_invoker`; jornada com mensagem + ligação devolve as linhas na ordem; `relacionamento` vê mensagens e **nenhum valor de pagamento**. *Reversão:* `drop view`. **0065 `radar_documentos`** — (a) `documentos.tipo` ganha `certidao_casamento`, `certidao_nascimento`, `crlv`, `extrato_investimento`, `balanco` (a verificação compara `select tipo, count(*) … group by 1` antes e depois); (b) `documentos_pedidos (id, jornada_id, chave, item_ref, tipo, pedido_em, pedido_por, mensagem_id, conferido_em, conferido_por, dispensado_em, dispensado_por, nota)` — guarda **só o ato humano**; RLS `ve_patrimonio`; sem DELETE.

**0066 `narrativa_e_depreciacoes`** (M4) — prompt novo `agente_croqui_narrativa` em `prompts_versoes` com `modelo_padrao` próprio (§6.3); `comment on view vw_cenarios_totais` e `comment on table cenario_rubricas` marcando a substituição. Zero DDL destrutivo.

**0067 `execucao`** (M2) — `execucao_modelos (id, chave, rotulo, celulas, ativo)` e `execucao_marcos (id, modelo_id, ordem, rotulo, fase, prazo_dias, depende_de uuid[], paralelo bool)` + `execucao_jornada_marcos (jornada_id, marco_id, concluido_em, concluido_por, nota)`. Seed do cronograma real de 3 células: fase Contratações (4 marcos, 7 dias) → fase Executória (11 marcos, 7/30 dias, com dependência) → paralelas de ITBI (30 / 30 / 15 dias) → entrega em 60 dias. **Sem UI nesta rodada** — só o schema e o seed, para o trilho contar marcos.

**0068 `minutas`** (Onda 3) — `minutas_modelos (id, celula, regime_bens, variante, documento, versao, arquivo_caminho, placeholders jsonb, ativo)` com `unique (celula, regime_bens, variante, documento, versao)`; `minutas_geradas (id, jornada_id, modelo_id, valores jsonb, arquivo_caminho, gerado_em, gerado_por, atual)`. RLS `ve_patrimonio`; sem DELETE; `valores` é PII (qualificação) e nunca vai para prompt de IA. **Schema agora, gerador na Onda 3.**

## 6. Croqui e IA
### 6.1 Novo contrato de saída
`src/server/ia/schema-croqui-narrativa.ts` (novo; `schema-croqui-analise.ts` v1 e `schema-analise-v2.ts` ficam no repo para análises antigas):

```ts
export const CroquiNarrativaSchema = z.object({
  como_apresentar: z.array(z.object({ tabela: ChaveTabelaSchema, texto: z.string() })),
  arquitetura: z.object({
    recomendacao: z.enum(["celula_1", "celula_2", "celula_3", "ponto_a_validar"]),
    justificativa: z.string(),
    criterios: z.array(z.object({ criterio: z.enum(CRITERIOS_ARQUITETURA), resposta: z.string() })).length(9),
  }),
  perguntas: z.array(z.object({ pergunta: z.string(), motivo: z.string() })),
  objecoes: z.array(z.object({ objecao: z.string(), resposta_recomendada: z.string() })),
  fechamento: z.string(),
  grau_confianca: z.number().int().min(0).max(100),
  lacunas: z.array(z.string()),
});
```

**Some do schema** (passa a vir do motor): `historia`, `familia`, `patrimonio`, `empresas`, `objetivos`, `riscos`, `croqui[]`, `disc` (já vive no Briefing), `peso_na_decisao` e `categoria` dentro de `criterios`.

**Orçamento medido:** gramática serializada **< 3.905 bytes** (teto medido; a v2 atual mede 4.959 e por isso está inativa). Entregável do M4: rodar `scripts/testar-json-schema-estrito.ts` e registrar o número. Ordem de corte se estourar: `criterios` → `lacunas` → `perguntas.motivo`. O prompt recebe o `ResultadoCroqui` já renderizado como tabelas em texto + briefing + relatório da SV. Vale a lei do CLAUDE.md: nada genérico, toda afirmação presa a evidência, grau de confiança sempre. **Regra nova:** a narrativa não pode citar número que o motor marcou `ausente` — o renderizador passa "—" e o prompt instrui a falar da ausência, não a estimar.

### 6.2 Slides que viram tabela
`patrimonio` → T2 · `risco` → T3 + T4 (T5 na coluna reforma) · `celula_1|2|3` → T7/T8/T9 (com o diagrama atual) · `economia` → T13 (+ T14 quando há ITBI) · `investimento` → T16 + T17 + T18 · **novo `payback`** → T11. Seguem narrativa: `legado`, `controle`, `familia`, `alternativas`, `controle_arquitetura`, `implementacao`.

`Apresentacao`, `DeckImpressao`, `ModoApresentacao` e `/p/m` não mudam de forma — recebem um bloco a mais. Componente novo único: `src/components/croqui/TabelaDoSlide.tsx`, irmão de `GraficoDoSlide.tsx`, com legenda de procedência (célula `ausente` mostra o motivo + link "Admin → Parâmetros", nunca `R$ 0,00`). `mapeamentoGraficos.mapearCenarioParaEconomia` fica sem chamador e é removido pelo M4.

### 6.3 Roteamento de modelo por tarefa (decisão, zero código novo)
`prompts_versoes.modelo_padrao` já existe (0009, apontado para slugs do OpenRouter na 0040). A decisão é de **dado**, não de código: cada chave de prompt ganha versão nova com o modelo proporcional à tarefa.

Modelo **forte** em `agente_briefing` e `agente_diagnostico_sv` (diagnóstico, julgamento clínico); modelo **barato** em `agente_croqui_narrativa` e nos prompts de rotulagem/resumo de transcrição (narrar tabela pronta, extrair rótulo).

Nenhum agente troca modelo por conta própria: é INSERT de versão + `ativar_prompt_versao`, com a medição de custo em `execucoes_ia` antes e depois. Isso só é seguro porque o motor tirou os números da IA — narrar tabela pronta é tarefa de modelo barato; inventar número nunca foi.

## 7. Simulador ao vivo
`src/components/croqui/SimuladorCroqui.tsx` (cliente). Chama `calcularCroqui` direto — sem rede, recálculo em memória. Superfícies: **Conduzir Sessão** e aba **Sessão** da Ficha. Substitui o malabarismo atual (a advogada navegando entre 19 abas da planilha ao vivo, na frente da família).

- Edita: `valor_mercado`, `valor_dirpf`, `destinacao`, `vender_para_levantar`, `uf_domicilio_vantajoso`, `modelos`, `operacional`, `cdi_anual`.
- Mostra: T13 (comparativo) grande, T11 (payback: "se paga em N meses") e a tabela do modelo em foco.
- Enquanto mexe: `Selo tom="ambar"` "Não fixado". **Nada é gravado.**
- **"Fixar este cenário"** → `POST /api/jornadas/[id]/croqui-calculo` com a `EntradaCroqui`; o servidor relê os parâmetros vigentes, **recalcula** e grava versão + `fixar_croqui_calculo`.
- Gaveta "Versões": lista `croqui_calculos` com quem fixou e quando; ver versão antiga é leitura.

Segurança: a rota **ignora** qualquer `resultado` vindo do corpo — se viesse do cliente, o número apresentado à família teria sido digitado pelo navegador. O `entrada_snapshot` é o que o servidor validou por Zod.

## 8. Trilho, automações, radar e execução
### 8.1 `derivarTrilho(sinais, agora?): PassoTrilho[]` — 9 passos
```ts
export type EstadoPasso = "feito" | "atual" | "futuro" | "pulado";
export type ChaveTrilho = "pagou" | "ligacao" | "agendou" | "confirmou" | "sessao"
                        | "croqui" | "contrato" | "execucao" | "entrega";
export interface PassoTrilho {
  chave: ChaveTrilho; rotulo: string; estado: EstadoPasso;
  quando: string | null; motivo?: string;
  progresso?: { feitos: number; total: number };   // só em `execucao`
}
```

Os três passos novos vêm do processo real: **contrato** (honorários padrão ou "Empresários", + membership opcional) → **execução** (~15 marcos, 60 dias) → **entrega** (carta, sumário, checklist). `Sinais` ganha três campos aditivos e tri-estado: `contratoAssinadoEm`, `marcosExecucao: { feitos, total } | null`, `entregaEm`.

**Uma só fonte para "qual é o atual":** o passo `atual` é o que contém `derivarProximoPasso(sinais).chave`, via `PASSO_POR_CHAVE`. O trilho não reimplementa precedência — herda a que já está testada em 27 linhas de mesa.

| passo | `feito` | `pulado` | `futuro` (sem informação) |
|---|---|---|---|
| pagou | `nivelPago >= 1` | — | `nivelPago === null` |
| ligacao | `temLigacao === true` | `temLigacao === false` **e** `sessaoRealizadaEm != null` | `temLigacao === null` |
| agendou | `proximaSessaoEm != null` **ou** `sessaoRealizadaEm != null` | `nivelPago >= 2` e ambos nulos | ambos `null` e `nivelPago < 2` |
| confirmou | `presencaConfirmada === true` | sessão passou e `presencaConfirmada === false` | `presencaConfirmada === null` |
| sessao | `sessaoRealizadaEm != null` | `nivelPago >= 2` e `sessaoRealizadaEm === null` | — |
| croqui | `croquiStatus === "apresentado"` | `nivelPago === 3` e `croquiStatus === "nenhum"` | `croquiStatus === null` |
| contrato | `contratoAssinadoEm != null` | `marcosExecucao.feitos > 0` e contrato nulo | `contratoAssinadoEm === null` e `nivelPago < 3` |
| execucao | `marcosExecucao.feitos === total` | `entregaEm != null` e `feitos === 0` | `marcosExecucao === null` |
| entrega | `entregaEm != null` | — | — |

Bordas cobertas por teste de mesa: (a) tudo `null` → 9 `futuro`, nenhum `atual`, rótulo "sem informação"; (b) entrega feita → 9 `feito`; (c) croqui comprado sem sessão → `sessao` e `confirmou` `pulado`; (d) sessão realizada sem ligação → `ligacao` `pulado`, não `futuro`; (e) `presencaConfirmada === null` por coluna ausente no payload → **`futuro`, nunca `pulado`**; (f) `execucao` com 4 de 15 marcos → `atual` com `progresso`, e o rótulo é "4 de 15" (número primeiro).

`src/components/ui/Trilho.tsx`: `<Trilho passos={…} compacto? aoEscolher? />`. Completo na Ficha; compacto (9 pontos + rótulo do atual) na Esteira e na Agenda. Documentar em `docs/DESIGN-SYSTEM.md` §3.

### 8.2 `vw_automacoes_jornada`
```
jornada_id · tipo · chave · rotulo_fonte · canal · estado · quando · resultado · ordem
```

`tipo ∈ {mensagem, ligacao_ia, confirmacao, marco}`; `estado ∈ {agendado, enviado, falhou, sem_resposta, concluido, aguardando}`. União de quatro `select`s, `security_invoker = true`: (1) `mensagens_agendadas` ⋈ `mensagens_templates`; (2) `ligacoes_ia` — **nunca** `transcricao`, `gravacao_url` ou `custo_usd`; (3) `agendamentos` com `presenca_confirmada_em`; (4) `pagamentos` como marco "pagou", **sem valor**.

**Não lê `webhooks_eventos`** (§11.4, CONFLITO 8): `bruto` é payload cru com PII e é leitura de admin.

Na Ficha isso vira "O que o sistema fez", dentro da Pasta: uma linha por evento — `rótulo · resultado · quando` — sem cartão por automação e sem parágrafo.

### 8.3 Radar de documentos — coleta e entrega
`src/lib/radar/derivar.ts`, puro:

```ts
export interface ItemRadar {
  chave: string; tipo: DocumentoTipo; rotulo: string; item_ref: string | null;
  lado: "coleta" | "entrega";
  estado: "a_pedir" | "pedido" | "recebido" | "conferido";
  pedido_em: string | null; recebido_em: string | null;
  obrigatorio: boolean; trava: ChaveTabela[];
}
export function derivarRadarDocumentos(patrimonio, familiares, modelo, documentos, pedidos): ItemRadar[];
```

**Coleta** (antes do croqui): IR do titular sempre; cônjuge → IR + certidão de casamento; cada imóvel → matrícula; empresa → contrato social + balanço; veículo → CRLV; investimento → extrato; filho → certidão de nascimento; `celula_2|celula_3` → comprovante de residência da UF vantajosa. **Entrega** (depois da execução, derivado de `execucao_marcos` + células do modelo): carta, sumário, por célula constituição + alterações + alvará + cartão CNPJ, acordo de sócios. Substitui o `ENTREGA DA HOLDING.xlsx` estático de TRUE/FALSE.

Estados: `recebido` = existe `documentos` casando `tipo` + `item_ref`; `conferido` = `documentos_pedidos.conferido_em`; `pedido` = `pedido_em` sem documento; senão `a_pedir`. O quarto estado é deliberado (§11.4, CONFLITO 11): a lista derivada nasce sem pedido, e chamar isso de "pedido" mentiria na tela.

"Pedir agora" → `POST /api/jornadas/[id]/radar/pedir { chaves }` → grava `documentos_pedidos` e enfileira **uma** `mensagens_agendadas` com o template `documentos_pedido` e o link `/p/d`, `chave_idempotencia = '{jornada}:documentos_pedido:{data}'` — a idempotência da 0013 impede o duplo clique virar duas mensagens.

## 9. Painel por papel e dicionário
### 9.1 Matriz bloco × papel
`src/components/painel/blocosPorPapel.ts` — `BLOCOS_POR_PAPEL: Record<PapelEquipe, ChaveBlocoPainel[]>`. Bloco fora da lista **não é renderizado e não é buscado** (`usePainelDia` deixa de pedir o pedaço).

| bloco | admin | advogada | relacionamento | assistente |
|---|---|---|---|---|
| Sessões de hoje · Preparo pendente | ✓ | ✓ | ✓ | ✓ |
| Croquis a fixar/apresentar *(novo)* | ✓ | ✓ | — | — |
| Documentos a pedir *(novo)* | ✓ | ✓ | ✓ | ✓ |
| Execução atrasada *(novo, de `execucao_marcos`)* | ✓ | ✓ | — | ✓ |
| Pagou sem contato · Travado | ✓ | — | ✓ | ✓ / — |
| Números da semana | ✓ | ✓ | — | — |
| Parâmetros em divergência *(novo, §11.4)* | ✓ | — | — | — |
| Prova de vida · régua parada · env var · 503 | ✓ | — | — | — |

Mesma regra em Comunicação (`PendenciasSistema` vira só-admin) e em qualquer `AvisoInline` de infraestrutura. Para o admin, aviso de sistema é **1 linha + 1 link**.

### 9.2 `src/lib/vocabulario.ts`
```ts
export interface Termo { humano: string; sigla?: string; explique?: string }
export const VOCABULARIO: Record<ChaveVocabulario, Termo>;
export function rotulo(chave: ChaveVocabulario): string;
export function titleDe(chave: ChaveVocabulario): string | undefined;
```

Inventário por grep dirigido (o M3 roda e cola a contagem):

```
grep -rn "POP 0\|DISC\|régua\|regua\|esteira\|briefing\|Briefing\|cron\|n8n\|Vapi\|MQL\|kanban\|rubrica\|procedênc\|service_role\|RLS\|webhook\|payload\|env var\|503" src/components src/app --include=*.tsx
```

| termo | rótulo humano | sigla em `title`/`Dica` |
|---|---|---|
| POP 02 · POP 03 | Formulário do cliente · Ligação estratégica | POP 02 · POP 03 |
| DISC · "C / S" | Perfil de decisão · Conformidade / Estabilidade | DISC |
| régua · esteira · briefing (a etapa) | Mensagens automáticas · Caminho do cliente · Preparo da sessão | régua · esteira · briefing |
| Briefing Estratégico (o entregável) | **mantém** — é o nome do produto | — |
| SV · MQL | Sessão de Viabilidade · Acima de R$ 1 milhão | SV · MQL |
| kanban · rubrica · procedência | Quadro · Linha de custo · De onde veio o número | — |
| Cofre · Veículo · Destino | **mantêm** — são os nomes jurídicos das células | — |
| cron · n8n · Vapi · service_role · RLS · webhook · env · 503 | **não aparecem fora do Admin** | — |

`Glossario.md` manda: onde ele define o termo (Croqui Estrutural, Sessão de Viabilidade, Arquétipo Patrimonial), o nome do negócio fica.

## 10. Exportação `.docx` e minutas
### 10.1 Relatório do croqui (Onda 2, M6)
`src/server/exportacao/docx-croqui.ts`: `montarDocxCroqui({ resultado, narrativa, pessoa, gerado_em }): Promise<Uint8Array>` — capa, T1, T2, texto do método, T3–T5, T6, T7–T9 com diagrama, T11 payback, T13, T14, T15–T16, T12, T17, T18, T19. Célula `ausente` sai como "—" com nota de rodapé dizendo o que falta; **nunca R$ 0,00 num documento que vai para o cliente** (é a regressão do §4.8 C).

Só **download**: `GET /api/croquis/[id]/docx` (e `?info=1` para a UI saber se há cálculo fixado). O desenho original previa um segundo destino, Google Drive por service account com pasta `HOLDING DRIVE - <cliente>` — foi implementado e **removido em 05/09/2026 à noite** por ordem do João: a pasta do Drive de um cliente foi dada como *referência* para entender o método, não como padrão a replicar. O sistema é a fonte; o advogado guarda o arquivo onde quiser. Nenhuma env de Drive é esperada.

Dependência: o pacote `docx` (o repo tem `pdfkit`, que não serve). `npm install` no Windows poda o lockfile — o M6 confere o diff de `package-lock.json` e reporta as linhas alteradas.

### 10.2 Minutas (Onda 3, M7)
Taxonomia real, já mapeada: **célula** (Cofre · Veículo · Destino) × **regime de bens** (Comunhão Parcial · Universal) × **variante** (Tradicional/usufruto · Golden Share — só na Destino) × **documento** (Contrato Social · 1ª/2ª Alteração · Alteração Pós-Morte · Acordo de Sócios · Termo de Ciência · declarações e petição de não incidência de ITBI).

Placeholders por tipo, já extraídos: comuns `[CPF] [RG] [ÓRGÃO EXPEDIDOR] [DATA DE EXPEDIÇÃO] [DATA DE NASCIMENTO] [NACIONALIDADE] [PROFISSÃO] [ENDEREÇO COMPLETO] [CEP] [ESTADO] [NOME DO SÓCIO N]`; alterações somam `[QUANTIDADE DE QUOTAS A/B] [VALOR INICIAL/FINAL DO CAPITAL SOCIAL] [VALOR POR EXTENSO] [DURAÇÃO EM ANOS] [ENDEREÇO DA SEDE]`; AVJ soma `[ENTIDADE AVALIADORA] [VALOR DO IMÓVEL] [VALOR DECLARADO] [VALOR DE ALIENAÇÃO] [VALOR POR MEEIRO]`. As Alterações Pós-Morte não usam colchete — usam texto substituível, e o gerador precisa de um mapa próprio.

`gerarMinuta(jornada, modelo, valores): Promise<Uint8Array>` a partir de `minutas_modelos` (0068) + qualificação estruturada do cliente. Hoje isso é copiar e colar do croqui aprovado, conferindo contra os documentos — ponto de erro manual óbvio. **Fora do escopo de código desta rodada**; o modelo de dados entra na 0068 para o gerador não precisar de migration depois.

## 11. Fronteiras disjuntas — 7 agentes Opus em 3 ondas
Cada agente recebe: este documento, `tmp/squad/fase5-brief.md`, `brain/06 - Materiais/Processo real do escritorio (Drive).md`, os globs **exclusivos** e os contratos do §11.3. Fora do glob, **lê e reporta**, não edita. Ninguém commita; ninguém roda `npm run build`. Só o M1 abre `tmp/squad/drive-cliente-exemplo.md`, e apenas para montar a fixture local — nenhum valor de lá entra em arquivo versionado.

### 11.1 Onda 1
| agente | entrega testável | globs exclusivos |
|---|---|---|
| **M1 · Motor + faixas** | `npx tsx scripts/teste-motor-croqui.ts` com PASS em A, B, C e D; placar (sem valores) do bloco E contra a planilha; `tsc` limpo; 0062/0063 com roteiro rodado e saída colada | `src/server/motor-croqui/**` · `src/types/croqui-calculo.ts` · `supabase/migrations/0062_*.sql` · `supabase/migrations/0063_*.sql` · `scripts/teste-motor-croqui.ts` |
| **M2 · Trilho 9 passos + automações + radar + execução** | mesa do trilho (6 bordas do §8.1); `GET /automacoes` e `GET /radar` em `curl` autenticado; 0064/0065/0067 verificadas e o seed dos 15 marcos conferido contra o cronograma | `src/lib/pasta/trilho.ts` · `src/lib/pasta/sinais.ts` *(só campos novos)* · `src/lib/radar/**` · `src/server/{automacoes,radar,execucao}/**` · `src/app/api/jornadas/[id]/{automacoes,radar,execucao}/**` · `src/types/jornada-automacoes.ts` · `supabase/migrations/0064_*.sql` · `0065_*.sql` · `0067_*.sql` |
| **M3 · Vocabulário + painel por papel + lei de texto** | palavras visíveis antes/depois em Painel e Comunicação (meta ≤ 50%); captura nos 2 temas e em 390 px; nenhum bloco de sistema no DOM como advogada | `src/lib/vocabulario.ts` · `src/components/painel/**` · `src/components/comunicacao/**` · `src/app/globals.css` · `docs/DESIGN-SYSTEM.md` |

### 11.2 Onda 2 (contratos da Onda 1 congelados)
| agente | entrega testável | globs exclusivos |
|---|---|---|
| **M4 · Croqui, apresentação, simulador** | croqui real com as 19 tabelas no navegador; célula sem parâmetro mostrando a falta; simulador recalculando sem rede; byte-count do schema < 3.905; 0066 aplicada | `src/components/croqui/**` · `src/server/croqui/**` · `src/server/ia/schema-croqui-narrativa.ts` · `src/app/(app)/croquis/**` · `src/app/(publico)/p/m/**` · `supabase/migrations/0066_*.sql` |
| **M5 · Ficha, Sessão, Esteira, radar (front)** | Pasta como porta única com `Trilho` de 9 passos; aba Sessão em uma linha de passos; automações com resultado; radar com "Pedir agora"; contagem de palavras nas 3 telas | `src/components/ficha360/**` · `src/components/esteira/**` · `src/components/agenda/**` · `src/components/ui/Trilho.tsx` · `src/app/(app)/jornadas/**` · `src/app/(app)/esteira/**` · `src/app/(publico)/p/d/**` |
| **M6 · Exportação `.docx`** | `.docx` aberto com a estrutura do template e sem nenhum "R$ 0,00"; `disponivel()` false sem env e botão ausente; diff do lockfile | `src/server/exportacao/**` · `src/app/api/croquis/[id]/docx/**` · `package.json` |

### 11.3 Onda 3 (depois do veredito do Fable sobre as ondas 1–2)
| agente | entrega testável | globs exclusivos |
|---|---|---|
| **M7 · Minutas + sub-esteira de execução (front)** | minuta gerada com placeholders preenchidos da ficha, baixada e conferida; sub-esteira dos 15 marcos com dependência e prazo na Ficha | `src/server/minutas/**` · `src/components/minutas/**` · `src/components/execucao/**` · `src/app/(app)/jornadas/[id]/execucao/**` · `supabase/migrations/0068_*.sql` |

Sobreposições resolvidas: `ui/Trilho.tsx` é do **M5** (M3 não toca Esteira); `globals.css` e `DESIGN-SYSTEM.md` são do **M3**; `package.json` é do **M6**; `src/lib/pasta/proximo-passo.ts` e `src/types/cenario.ts` ficam **congelados**; `src/lib/pasta/sinais.ts` só o M2 toca, e só acrescentando campo tri-estado.

### 11.4 Contratos congelados
```ts
// M1
export function calcularCroqui(entrada: EntradaCroqui, parametros: ParametrosCroqui): ResultadoCroqui;
export function aplicarFaixas(base: number, tabela: TabelaFaixas): ResultadoFaixa;
export function chavesNecessarias(entrada: EntradaCroqui): ChaveParametroCroqui[];
export const CATALOGO_PARAMETROS: Record<ChaveParametroCroqui, DefinicaoParametro>;
export const BASE_ITCMD: Record<ModeloCroqui, "mercado" | "dirpf">;
// GET  /api/jornadas/[id]/croqui-calculo
//   → { atual: CroquiCalculo | null; entrada: EntradaCroqui; parametros: ParametrosCroqui;
//       ausentes: ChaveParametroCroqui[]; divergencias: Divergencia[] }
// POST /api/jornadas/[id]/croqui-calculo { entrada } → { calculo: CroquiCalculo }  (201; recalcula no servidor)

// M2
export function derivarTrilho(sinais: Sinais, agora?: number): PassoTrilho[];   // 9 passos
export const PASSO_POR_CHAVE: Record<ChavePasso, ChaveTrilho>;
export function derivarRadarDocumentos(patrimonio, familiares, modelo, documentos, pedidos): ItemRadar[];
// GET  /api/jornadas/[id]/automacoes → { itens: LinhaAutomacao[] }
// GET  /api/jornadas/[id]/radar      → { itens: ItemRadar[]; modelo: ModeloCroqui | null }
// POST /api/jornadas/[id]/radar/pedir { chaves: string[] } → { enfileiradas: number }
// GET  /api/jornadas/[id]/execucao   → { marcos: MarcoExecucao[]; feitos: number; total: number }

// M3
export function rotulo(chave: ChaveVocabulario): string;
export function titleDe(chave: ChaveVocabulario): string | undefined;
export const BLOCOS_POR_PAPEL: Record<PapelEquipe, ChaveBlocoPainel[]>;

// M6 / M7
export function montarDocxCroqui(args: ArgsDocxCroqui): Promise<Uint8Array>;
export function gerarMinuta(jornada, modelo: MinutaModelo, valores: Record<string, string>): Promise<Uint8Array>;
```

### 11.5 BLOQUEIO e CONFLITO
**BLOQUEIO — decisão humana; nenhum agente escolhe.** Todos aparecem no Painel do admin como "Parâmetros em divergência" (§9.1) e travam a tabela que dependem deles, nunca inventam valor.

1. **Certidões: R$ 2.000 × R$ 7.000** na mesma planilha do escritório (aba 3 × abas 4–7). Trava T3, T5 e T6. O sistema **força a reconciliação no cadastro** — a unique parcial da 0056 já impede duas versões ativas; o que falta é a Dra. Elaine dizer qual vale.
2. **Base do ITCMD: mercado em 1 e 2 células, DIRPF só em 3.** Está assim na planilha e muda drasticamente o preço apresentado. Confirmar que é intencional, não resquício.
3. **Membership: 1 plano (contrato, R$ 2.000) × 3 planos (slide 37: LEGACY R$ 750 · PRIME R$ 2.000 · INFINITY R$ 1.350).** A ordem de preço do slide parece trocada. Trava T19.
4. **Crédito de IBS/CBS: 26,5% (aba 10) × 36,92% (aba 8).** Duas versões do mesmo modelo na mesma planilha. Trava T10 e T12.
5. ~~**Google Drive**~~ — resolvido por remoção (05/09 à noite): não há envio ao Drive; o relatório é só download. O Drive era referência, não padrão.
6. **Junta comercial da 2ª célula usa unitário R$ 500, as outras R$ 511** — diferença de R$ 77 que parece digitação. Semeado como está (3.500), com `notas` registrando a suspeita.

**Resolvidos pelo recon (eram BLOQUEIO na rev. 1):** incentivo de 10% é **sobre o saldo** (`B18 = B17 × 0,1`); o sinal é **10% do novo saldo do modelo de 3 células**, igual para os três (`B22 = 10% × D19`, `B24 = B19 − $B$22`) — o rótulo "maior valor" da planilha está errado, já que 3 células é o mais barato; fica registrado em `configuracoes['croqui.sinal_modelo_referencia']` para a Dra. Elaine trocar sem migration.

**CONFLITO — decidido aqui, registrado para o Fable derrubar se discordar:**

7. **Honorários da holding é fórmula, não parâmetro** — `hora × horas do modelo + 10%`, como na aba 14. Reverte a decisão da rev. 1 (que os fazia parâmetro) e apaga 3 chaves do catálogo.
8. **O motor não replica o bug da aba `4 DOAÇÕES`** (`B12 = SUM(B7:B11)`, que soma o próprio total e infla a diferença). Implementa `T4.custo − total`, como as abas 5/6/7. O `.docx` sai diferente da planilha nessa linha, de propósito.
9. **ITCMD da 3ª célula e do domicílio vantajoso viram parâmetro dedicado** — não o artifício da planilha (`alíquota da faixa 1 × R$ 10.000`) nem o `2%` digitado à mão na aba 6. Sem parâmetro, a célula é `ausente`.
10. **A view de automações não lê `webhooks_eventos`** — `bruto` é payload cru com PII, leitura de admin. O marco "pagou" vem de `pagamentos`.
11. **O Cenário Patrimonial vira gaveta de override**, não porta de entrada — nada apagado (§5.2), mas é superfície que a advogada já usa: o Fable deve exigir aviso na tela. E **`a_pedir` é um quarto estado do radar**, contra os três do brief (lista derivada nasce sem pedido).
12. **Percentual de cartório é fallback, não regra** — a fonte de verdade é a tabela de emolumentos por UF; a procedência diz qual das duas entrou.

## 12. Os 5 critérios do Fable
| critério | o que este plano garante |
|---|---|
| **Segurança** | `croqui_calculos` sob `ve_patrimonio`, `force RLS`, sem DELETE, snapshot imutável por trigger (23514) cobrindo também `faixas`; o simulador **nunca** grava resultado vindo do cliente; `vw_automacoes_jornada` não expõe transcrição, gravação, custo nem `webhooks_eventos.bruto`; parâmetro segue só-admin; `minutas_geradas.valores` é PII e nunca vai para prompt; Drive falha fechada; blocos de sistema somem do DOM por papel; os valores da planilha real ficam em `tmp/`, fora do versionamento. **Pentester obrigatório**: patrimônio, documento do cliente, `/p/d`, export de PII, qualificação em minuta. |
| **Escalabilidade** | cálculo O(bens) puro, sem IA e sem rede — roda no cliente durante a sessão, substituindo a navegação manual por 19 abas; a IA cai de 2 chamadas para 1, com gramática ~21% menor **e** roteamento por tarefa (narrativa em modelo barato); painel por papel deixa de **buscar** bloco que não vai renderizar; índices novos são `unique (jornada_id, versao)` e o parcial `where atual`. |
| **Solidificação** | invariantes que o banco garante sozinho: uma só versão `atual` por jornada; snapshot imutável; `faixas` validadas por função IMMUTABLE em CHECK (sem buraco, sem sobreposição, sem faixa fora de ordem); base legal obrigatória em `cartorio.*`/`ir.*`/`reforma.*`/`locacao.*`; `documentos_pedidos` e `minutas_geradas` sem DELETE; duas versões ativas do mesmo parâmetro continuam impossíveis — é o que resolve, na raiz, as 4 divergências que o escritório carrega hoje. |
| **UX** | as tabelas do método, não gráficos genéricos; payback ("se paga em N meses") como argumento na tela; célula sem parâmetro diz **o que falta e onde cadastrar**, nunca R$ 0,00; Pasta como porta única com trilho de 9 passos e um botão; automação com resultado; documentos "na cara" nos dois lados (coleta e entrega); lei de texto medida (≤ 50% das palavras nas 5 telas). |
| **Otimização** | a fase **remove** mais do que soma: a 2ª chamada de IA do croqui, o schema v2 de 4.959 bytes, `mapearCenarioParaEconomia`, a grade de rubricas soltas como porta, os fetches de bloco de sistema para não-admin, as 9 abas como menu, a prosa das telas — e, no catálogo, **15 chaves de parâmetro viraram fórmula ou sumiram** entre a rev. 1 e a rev. 2. O que entra é **um** módulo puro alimentando 6 superfícies que hoje têm 6 caminhos diferentes de montar número — e substituindo um Apps Script sem log, sem versão e sem aviso de falha. |

**O que a Fase 5 REMOVE:** 2ª chamada de IA do croqui · `CroquiAnaliseV2` (4.959 B) do caminho ativo · `mapearCenarioParaEconomia` · Cenário Patrimonial como grade solta de entrada · 15 chaves de parâmetro · blocos de dívida técnica no Painel e na Comunicação para não-admin · abas da Ficha como menu · prosa dentro de cartão · sigla no fluxo. Nada é apagado do banco: view e tabela ficam, marcadas como deprecadas na 0066.
