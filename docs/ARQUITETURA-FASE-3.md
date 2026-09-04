# SIC-HF — Arquitetura Fase 3

Escrito em **04/09/2026** pelo arquiteto, para execução por `backend-engineer`,
`frontend-engineer`, `security-pentester` e trava final do `fable-orchestrator`.

Continua `docs/ARQUITETURA.md` (fase 1) e `docs/ARQUITETURA-FASE-2.md` (fase 2).
**Tudo que está naqueles dois documentos continua valendo.** Este plano é
aditivo: não reescreve nada que funciona hoje.

Migrations novas começam em **0041** (a `0040` já está aplicada no banco remoto).

---

## 0. Sumário executivo — as cinco frases que mandam neste plano

1. **91% do custo é o que o modelo escreve.** Cache de prompt não resolve nada
   aqui (entrada = 9% = US$ 0,0094). O que resolve é: *raciocinar menos onde o
   schema já é o andaime*, *escrever menos onde o método não pede prosa*, e
   *não gerar quando o dado não sustenta análise*.
2. **Hoje não medimos a maior linha do custo.** O OpenRouter devolve
   `usage.completion_tokens_details.reasoning_tokens` e o adaptador **ignora**
   (`openrouter.ts`, `extrairUso()`). Estamos otimizando às cegas. A migration
   `0041` existe para isso e é pré-requisito de todo o resto.
3. **"Análise da Sessão" já existe e chama `agente_croqui_analise`.** Mesma
   entrada (transcrição da SV + ficha), mesmo momento (depois da SV), mesma
   saída. **Não é feature nova, é feature invisível**: a rota
   `POST /api/croquis/[id]/analise` **não tem um único chamador no front** —
   `src/lib/api.ts` não tem função para ela. Não duplicar. Dar tela e reancorar.
4. **O croqui vira gráfico sem uma segunda chamada de IA.** Tipando o campo
   `croqui` da análise (hoje `array of string`, inutilizável), a transformação
   *análise → 13 slides* vira uma **função pura em TypeScript, custo zero**.
   Isso é a feature que o João pediu e é, ao mesmo tempo, a maior economia
   estrutural do plano.
5. **`frase_literal` que não está no contexto é uma frase que o cliente nunca
   disse.** Hoje nada verifica isso, e a advogada repetiria na reunião uma
   citação inventada. A checagem é `string`, não IA, e custa zero. Entra.

---

## 1. Otimização de custo

### 1.1 A linha de base, decomposta

Medição do João em produção (`anthropic/claude-sonnet-5`, briefing real):

| | tokens | US$/MTok | custo | % |
|---|---:|---:|---:|---:|
| entrada | 4.697 | 2,00 | 0,0094 | **9%** |
| saída (prosa + raciocínio) | 9.377 | 10,00 | 0,0938 | **91%** |
| **total** | | | **0,1032** | 100% |

`reasoning.max_tokens` no effort `high` = **4.096**, faturado como saída.
Logo, dos 9.377 tokens de saída, **entre 0 e 4.096 são raciocínio** — a prosa
efetiva está entre 5.281 e 9.377 tokens. **Não sabemos qual dos dois**, e é
exatamente essa a informação que decide se cortar `effort` economiza 29% ou 0%.

> **Não escreva número de economia neste projeto antes da `0041` estar aplicada
> e uma rodada de baseline rodada.** O que segue são alavancas com teto
> calculado, não promessas.

### 1.2 As alavancas, com a conta de cada uma

| # | Alavanca | Mecanismo | Teto de economia | Status |
|---|---|---|---|---|
| **L1** | `effort` `high` → `low` | `reasoning.max_tokens` 4.096 → 1.024. Raciocínio é faturado como saída. | **até 3.072 tok = US$ 0,0307 = 29,7%** | teto certo; valor real depende do raciocínio medido |
| **L2** | Orçamento de escrita no prompt | cardinalidade máxima por array + limite de caracteres por campo, declarados no `corpo_sistema` | a medir | prompt v2 (`0042`) |
| **L3** | Enum no lugar de texto livre | `processo_decisorio` tem **5 campos `z.string()`** onde o método enumera as opções. Cada um vira um parágrafo. Idem `estrategia_sessao.ritmo`. | a medir | schema v2 |
| **L4** | **Porta de completude** | não gerar quando o dado não sustenta. O último briefing custou preço cheio para sair com grau de confiança 20. | **100% do custo das gerações barradas** | certa, custo zero |
| **L5** | Prompt caching | ~1.035 tok de sistema × 90% de acerto | **≤ US$ 0,0019 = 1,8%** | **descartado**, e o `cache_control` atual é decorativo — ver §1.6 |
| **L6** | Modelo mais barato | `UPDATE prompts_versoes.modelo_padrao` | proporcional ao preço | **BLOQUEIO B23** — não faço sozinho |
| **L7** | Enxugar o contexto de entrada | `contexto-briefing.ts` copia `formulario` e `ligacao.respostas` como blobs inteiros, com chaves nulas e duplicação (`ligacao.respostas` repete campos já nomeados logo acima) | ≤ US$ 0,0094 em $, mas **contexto grande convida resposta grande** | efeito de 2ª ordem, real |

**Onde o dinheiro está, em uma frase:** L1 + L2 + L3 atacam os 91%; L4 ataca a
frequência; L5 é ruído; L6 é decisão do João; L7 é higiene.

**Caminho plausível até a meta:** L1(`low`) + L2 + L3 levam a saída de 9.377
para a faixa de 3.500–4.500 tokens (US$ 0,035–0,045), somados a US$ 0,008–0,009
de entrada. Isto **encosta** na meta de US$ 0,04 e pode ficar em US$ 0,045.
A bancada decide. Se sobrar distância, a alavanca restante é L6 — e L6 é
`UPDATE`, não deploy, então não vira retrabalho.

### 1.3 O que muda no `effort`, e por quê não é contradição com 03/09

O documento de 03/09 aumentou `IA_TIMEOUT_MS` de 120s para 300s porque a
execução do Opus morreu com latência de **120,0s exatos**. Quem ler os dois
documentos vai achar que agora estamos fazendo o contrário. **Não estamos**:

- **teto de tempo** (`IA_TIMEOUT_MS`) é quanto esperamos a resposta chegar;
- **orçamento de raciocínio** (`reasoning.max_tokens`) é quanto pagamos o modelo
  para pensar antes de escrever.

Cortar o segundo **reduz** o primeiro como efeito colateral. As duas decisões
apontam para o mesmo lugar. Registrado aqui como **CONFLITO C17** para não
morder ninguém daqui a três semanas.

O argumento técnico para `low` no Briefing: a saída é um **JSON estrito de 13
seções em ordem fixa**, com o que cada seção deve conter escrito no
`corpo_sistema`. O schema *é* o andaime de raciocínio. Extended thinking rende
onde a estrutura da resposta é livre — não é o caso aqui. Isso é hipótese com
lastro, não certeza: **por isso a bancada mede `low`, `medium` e `high` lado a
lado** antes de qualquer troca.

### 1.4 O orçamento de escrita (L2) — o que o prompt v2 acrescenta

Bloco novo no `corpo_sistema` do `protocolo_01_briefing` v2, **sem remover uma
linha do texto do Protocolo 01** (o método é lei; o que entra é uma restrição
de forma, não de conteúdo):

```
ORÇAMENTO DE ESCRITA (regra de forma, não de conteúdo)

Escreva o mínimo que sustente a conclusão com evidência. Prolixidade não é
profundidade — no método deste escritório, uma frase presa a uma evidência vale
mais que um parágrafo bem escrito sem lastro.

- resumo_executivo: no máximo 5 frases.
- toda justificativa/motivo: 1 frase, até 240 caracteres.
- perfil_disc.evidencias: no máximo 3, as mais fortes, sempre citando a
  linguagem observada.
- arquetipo_patrimonial.evidencias: no máximo 3.
- objecoes_provaveis: no máximo 3, a mais provável primeiro.
- pontos_de_atencao: no máximo 4.
- perguntas_para_aprofundar: no máximo 5.
- frases_para_o_fechamento: no máximo 4.
- motivadores.secundarios: no máximo 3.
- estrategia_sessao.mais_tempo_em / menos_tempo_em: no máximo 3 itens cada.
- lacunas: no máximo 6.

Se houver menos evidência do que o limite permite, entregue MENOS — nunca
complete o número com item fraco. Lista curta e forte é o resultado correto;
lista cheia e genérica viola a REGRA DE OURO acima.
```

> **Armadilha para o backend:** a cardinalidade fica no **prompt**, não em
> `.max()` do Zod. Motivo: `json-schema-estrito.ts` remove
> `minLength/minimum/maximum` porque o `strict:true` os rejeita — mas
> **`maxItems`/`minItems` não estão na lista de remoção**. Um `.max(3)` no Zod
> viraria `maxItems` no JSON Schema enviado e pode reproduzir exatamente a
> classe de falha que derrubou o Opus em 03/09. E, mesmo que passasse, um
> `.max(3)` faz o `safeParse` **rejeitar** uma resposta com 4 itens → re-prompt
> → custo dobrado, para economizar custo. Absurdo.
>
> **Regra:** cardinalidade é instrução de prompt; o Zod continua permissivo;
> `maxItems` e `minItems` **entram** em `CHAVES_REMOVIDAS` por precaução.

### 1.5 Enums no lugar de texto livre (L3) — schema v2 do Briefing

Só nos campos onde o **próprio método já enumera as opções**. Nada é removido:
cada enum vem acompanhado de uma `nota` curta, então nenhuma informação do
Protocolo 01 se perde — o que se perde é o parágrafo de enrolação em volta.

| Campo hoje | Vira | Por quê |
|---|---|---|
| `processo_decisorio.velocidade: string` | `enum('rapida','media','lenta','indefinida')` + `nota` (≤240 ch) | POP 03 pede a velocidade, não uma dissertação sobre ela |
| `processo_decisorio.necessidade_seguranca` | `enum('alta','media','baixa','indefinida')` + `nota` | idem |
| `.necessidade_validacao` | idem | idem |
| `.necessidade_detalhe` | idem | idem |
| campo novo `.nivel_autoridade` | `enum('decide_sozinho','decide_com_conjuge','decide_com_socios','nao_decide','indefinido')` | **o Protocolo 01 exige "nível de autoridade para decidir" e hoje o schema não tem esse campo** — o método está sendo perdido |
| campo novo `.decisores_presentes_na_sessao` | `enum('sim','nao','indefinido')` | idem, exigido pelo POP 03 |
| `estrategia_sessao.ritmo: string` | `enum('lento','moderado','rapido')` + `nota` | idem |

**Ganho duplo:** menos tokens escritos **e** uma tela legível — um chip
"decide com a esposa" durante a reunião é achável; um parágrafo não é. Ver §5.

Campo novo, custo zero de tokens, gravado pelo servidor (não pela IA):

| Campo | Onde vive | O que é |
|---|---|---|
| `briefings.completude_entrada smallint` | `0041` | o score da porta de completude no momento da geração |
| `briefings.verificacao jsonb` | `0041` | resultado da verificação de fidelidade (§1.8) |

### 1.6 O `cache_control` de hoje é decorativo — e a conta prova

`openrouter.ts` envia `cache_control: {type:"ephemeral"}` no bloco de sistema.
A medição do João mostra entrada de 4.697 tokens cobrada a preço cheio
(4.697 × 2 ÷ 1e6 = US$ 0,009394 — bate com os US$ 0,0094 medidos): **nenhum
token foi lido de cache**. Faz sentido: o sistema tem ~1.035 tokens, e a parte
grande e variável do contexto está na mensagem `user`, que não é cacheável entre
clientes diferentes.

Mesmo num cenário perfeito, cache pagaria **US$ 0,0019 por briefing (1,8%)**.
**Decisão:** não investir em caching. Manter o `cache_control` (é inerte e não
custa nada) mas **documentar no código** que ele não está pagando, para ninguém
"otimizar" nessa direção de novo. Uma linha de comentário, não uma refatoração.

### 1.7 A porta de completude (L4) — a alavanca gratuita

**Problema medido:** o último briefing rodou em modo reduzido, custou
US$ 0,105 e saiu com grau de confiança 20. **O sistema classificou a própria
análise como fraca depois de cobrar o preço cheio por ela.**

**Desenho.** Antes de qualquer chamada de IA, `gerarBriefing()` calcula um
**score de completude determinístico**, dos mesmos dados que
`montarContextoBriefing()` já carrega — zero query nova, zero token.

| Sinal | Peso |
|---|---:|
| formulário respondido | 25 |
| ligação estratégica registrada | 20 |
| faixa de patrimônio declarada **ou** ≥1 item de patrimônio | 15 |
| `frases_marcantes` com ≥1 item | 10 |
| `processo_decisorio` preenchido na ligação | 10 |
| ≥1 familiar registrado | 10 |
| transcrição presente **e** consentida | 10 |
| | **100** |

Pesos e limiar vivem em `configuracoes` (`ia.completude_pesos`,
`ia.completude_minima_briefing`, default **40**), rotulados na tela de Admin
com a mesma fórmula do B12: **"VALOR INICIAL, não vem do método"**. Ajustar é
`UPDATE`, não deploy. Ver **BLOQUEIO B24**.

**Comportamento:**

- score ≥ limiar → gera normalmente.
- score < limiar → **409 `dados_insuficientes`**, com o detalhamento item a
  item do que falta e o peso de cada coisa. A tela **não mostra erro** — mostra
  uma checklist acionável, cada linha linkando para a aba onde se preenche
  (§5, U5).
- `forcar_mesmo_assim: true` (admin/advogada) gera mesmo assim, atrás de uma
  confirmação que diz o score, o que falta e o custo médio histórico deste
  prompt. Nunca recusa em silêncio; nunca queima dinheiro em silêncio.

**Por que isto é a melhor economia do plano:** as outras alavancas cortam
percentual do preço unitário. Esta corta **100% das gerações que não deveriam
ter existido** — e, de quebra, empurra a equipe a preencher a ficha, que é o
que faz o briefing prestar.

**A prova de que o limiar 40 está certo vem depois, do próprio banco:**
com `briefings.completude_entrada` gravado, a correlação
`completude_entrada × grau_confianca` é uma consulta. Hoje esse dado não
existe, então qualquer limiar seria chute; em 30 dias ele é medido.

### 1.8 Verificação de fidelidade — a checagem que custa zero e vale muito

`frases_para_o_fechamento[].frase_literal` é, pelo Protocolo 01, **uma frase
que o cliente disse**. A advogada vai repeti-la na reunião. Hoje nada verifica
que ela existe no contexto de entrada.

**Desenho** (`src/server/ia/fidelidade.ts`, novo, servidor, sem IA):

1. normaliza contexto e frase (minúsculas, sem acento, colapsa espaço,
   remove pontuação);
2. `frase_literal` → **substring exata após normalização** = `verificada`;
   caso contrário `nao_localizada`;
3. `perfil_disc.evidencias[]` e `arquetipo_patrimonial.evidencias[]` →
   sobreposição de tokens com o contexto, razão de 0 a 1 (paráfrase é legítima
   em evidência, então aqui **não** se exige literalidade);
4. grava tudo em `briefings.verificacao` (`0041`) e devolve na resposta da rota.

**Na tela:** frase `nao_localizada` aparece com marcação visual distinta e o
aviso *"não localizamos esta frase no material registrado — confira antes de
usar"*. Não é bloqueio: pode ser paráfrase legítima de áudio. É honestidade,
que é a lei deste projeto.

**Na bancada:** as mesmas duas métricas (`cobertura_evidencia`, `ancoragem`)
são o critério objetivo de "a qualidade não caiu" (§1.9).

### 1.9 Como provar que a qualidade não caiu — a bancada

`scripts/bancada-ia.ts` (novo; mesmo padrão descartável de
`scripts/testar-json-schema-estrito.ts`, mas este fica no repo).

**Fixtures.** Lista de `jornada_id` num arquivo **fora do versionamento**
(`tmp/bancada/fixtures.json`, entra no `.gitignore`), cobrindo três faixas de
completude: pobre (<40), média (40–70), rica (>70). **Nenhuma fixture usa
transcrição de cliente** — não existe consentimento `tratamento_ia` registrado
para nenhuma das 70 (B3/B13). O modo reduzido é o que a bancada mede, e é
também o cenário mais comum hoje.

**Protocolo.**

1. **Baseline com repetição.** Rodar a configuração ATUAL 3× sobre cada
   fixture. Isto mede a **variância natural** do sistema. Sem essa etapa,
   qualquer diferença entre variantes é indistinguível de ruído — e a base já
   levou uma mordida de "diagnóstico plausível não é diagnóstico".
2. **Variantes**, 3× cada: `effort=medium`, `effort=low`, `prompt v2`,
   `prompt v2 + low`.
3. **Métricas por execução:** `custo_usd`, `tokens_saida`,
   `tokens_raciocinio` (novo, `0041`), `latencia_ms`, `grau_confianca`,
   `cobertura_evidencia`, `ancoragem`, `frases_nao_localizadas`.
4. **Saída:** tabela markdown em `tmp/bancada/` (gitignored). **Nunca imprime
   o conteúdo do briefing** — é PII de cliente real.

**Critério de promoção (o gate):**

> Uma variante é promovida se, e somente se: **(a)** o custo médio cai;
> **(b)** `cobertura_evidencia` e `ancoragem` **não caem além da variância
> medida do baseline**; **(c)** `frases_nao_localizadas` não aumenta;
> **(d)** o `grau_confianca` médio não cai.

**Reversão:** promover é `UPDATE prompts_versoes SET ativo` — a v1 fica no
banco, inativa, íntegra. Voltar atrás são segundos, sem deploy. É por isso que
promover sozinho é aceitável nesta rodada (**BLOQUEIO B22**).

**O que a bancada NÃO faz:** não julga se o texto é bom. Isso é rubrica humana,
com a Dra. Elaine ou com o João, comparando A/B às cegas. Fica marcado como
tarefa pendente, não como algo que eu inventei ter feito.

### 1.10 Cooldown e teto — a dívida que esta feature transforma em obrigação

`configuracoes` já tem `ia.cooldown_segundos` (600) e
`ia.teto_execucoes_dia_por_usuario` (20) desde a `0027`. A função existe no
banco. **Ninguém chama.** Está no backlog como BAIXO desde a fase 1.

Este plano acrescenta um **botão que gasta dinheiro de propósito**
(`forcar_mesmo_assim`) e um script que roda IA em laço. Sem enforcement, o
achado BAIXO 7 do pentest vira MÉDIO na hora. **Ligar o cooldown em runtime
entra nesta onda, não fica para depois** — e a bancada roda com uma etiqueta
que a isenta do teto por usuário, mas **não** do teto de custo total do dia.

---

## 2. Análise da Sessão de Viabilidade

### 2.1 O conceito, resolvido

**É a mesma coisa que o Agente do Croqui, com outro nome.** Mesma entrada
(transcrição da SV + ficha), mesmo momento (depois da SV), mesma saída (as 14
seções carimbadas). Criar uma terceira IA seria pagar duas vezes pela mesma
leitura e rachar o método em dois vocabulários — exatamente o que o Glossário
proíbe.

**Mas o João está apontando para um buraco real.** A análise existe presa ao
objeto errado:

| Problema de hoje | Consequência |
|---|---|
| A rota é `POST /api/croquis/[id]/analise` — **exige um croqui já criado** | Mas o croqui é *oferecido* na SV. A análise deveria ajudar a decidir a arquitetura **antes** de existir croqui. |
| A transcrição chega **no corpo do request** e não é persistida | A análise não pode ser regerada; o Relatório não pode ser pré-preenchido a partir dela; e a advogada tem que colar o texto de novo a cada tentativa. |
| **A rota não tem chamador nenhum no front** (`src/lib/api.ts` não tem função para ela) | Feature paga, testada, auditada — e invisível. Mesma armadilha de "feature sem migration vira invisível", em outra roupa. |

### 2.2 O desenho

**A Análise da Sessão pertence à Sessão, não ao Croqui.** Mas o histórico fica
onde está: `croqui_analises` continua sendo a tabela (não reescrevo o que
funciona, e é onde a análise é consumida para montar o croqui). O que muda é o
**caminho de entrada**.

```
SV acontece
   ↓
advogada cola a transcrição   →  transcricoes (tipo='sessao_viabilidade', jornada_id=<jornada>)
   ↓                              ← a tabela JÁ existe e a coluna jornada_id JÁ está
   ↓                                reservada para isto (comentário da 0032)
Análise da Sessão (agente_croqui_analise v2)
   ↓
croqui_analises (schema_versao=2)
   ↓
[função pura TS, zero tokens]  →  13 slides propostos  →  croquis.conteudo
```

**Rotas:**

| Rota | Mudança |
|---|---|
| `POST /api/sessoes/[id]/transcricao` | **nova** — persiste a transcrição da SV. `arquivo_origem = 'sessao:<sessao_id>:v<n>'` (a coluna é `not null unique` e foi desenhada como chave de idempotência de arquivo; um identificador sintético determinístico atende sem alterar a coluna). |
| `POST /api/croquis/[id]/analise` | **modificada, compatível** — `transcricao_sessao` passa a ser **opcional**. Ausente → lê a transcrição persistida da jornada. Nenhuma → 409 nomeando o que falta. Chamador antigo (nenhum, hoje) continuaria funcionando. |
| `POST /api/jornadas/[id]/analise-sessao` | **nova, fina** — garante que existe um croqui `rascunho` (cria com `construirSlidesBase()` se não houver) e delega para a rota acima. É o que a tela chama. Evita a exigência artificial de "crie o croqui antes de analisar a sessão". |

**Uma porta só para a IA.** As três rotas convergem em `gerarAnaliseCroqui()`.
Não existe segundo prompt, segundo schema, segunda trava de consentimento.

**A trava de consentimento continua idêntica**: `tem_consentimento(pessoa,
'tratamento_ia')` é exigido **antes** de montar contexto — a transcrição da SV
é o material mais sensível do sistema. Persistir a transcrição **não** exige
consentimento (é dado do escritório, em banco do escritório, com RLS — mesma
posição do C14 para as 70 transcrições). **Analisar** exige.

### 2.3 Invariante nova no banco (não na rota)

`transcricoes.tr_ins` (0037) hoje exige `app.eh_admin()`. **A advogada não é
admin** — ela vê patrimônio, não administra o sistema. Ela é quem cola a
transcrição da própria sessão.

A `0045` acrescenta uma policy de INSERT para `ve_patrimonio()` **com a regra
de negócio no `with check`**, que é a lição literal do ALTO 1 do pentest ("se a
regra está só na rota, ela não existe — o PostgREST é uma segunda porta"):

```sql
-- rascunho comentado; o backend transforma em arquivo
create policy tr_ins_sessao on transcricoes for insert to authenticated
  with check (
    (select app.ve_patrimonio())
    and tipo = 'sessao_viabilidade'
    and jornada_id is not null
    and origem_dado = 'real'
  );
-- tr_ins (admin, 0037) permanece: é o caminho da ingestão do Módulo 4.
-- Sem policy de DELETE, como no resto da tabela: ausência de policy é negação.
```

Ou seja: pelo PostgREST direto, a advogada **não consegue** inserir uma
transcrição do Módulo 4 solta, sem jornada, nem carimbá-la como exemplo.

---

## 3. Croqui gerado a partir dos dados, e apresentado

### 3.1 O defeito que trava tudo hoje

`CroquiAnaliseSchema.croqui` é `z.array(z.string())` — *"referências aos 13
slides padrão, com o que muda em cada um"*. Um array de frases soltas **não tem
como ser mapeado deterministicamente** para os 13 slides tipados. É por isso
que o croqui nasce com os slides vazios e a análise fica num canto: não existe
ponte entre os dois, e a ponte não pode ser adivinhada em runtime.

### 3.2 Schema v2 da análise — a ponte

`agente_croqui_analise` v2 (`0042` cria a versão nova do prompt; a v1 fica
inativa e preservada). Mudanças no `CroquiAnaliseSchema`:

```
croqui: array de 13 objetos, um por tipo de slide, na ordem do método:
  {
    tipo: TipoSlideCroqui,             // enum já existente, 13 valores
    conteudo: string,                  // o que aparece para o cliente (≤600 ch)
    pontos: string[],                  // até 4 bullets, ≤120 ch cada
    como_apresentar: string,           // nota do apresentador (≤300 ch)
    categoria: CategoriaAfirmacao,     // fato_declarado | dado_documental |
                                       // inferencia | ponto_a_validar
    fontes: string[]                   // de onde saiu (≤3)
  }

arquitetura.alocacao: array de
  { celula: 'unica'|'cofre'|'veiculo'|'destino',
    item: string,                      // descrição do bem/participação
    categoria: CategoriaAfirmacao }
```

**`narrativa` sai** (o `como_apresentar` migrou para dentro do slide, onde ele
é usado). Isso **remove** um array duplicado da saída — economia de tokens que
vem de simplificação, não de corte. É o critério de otimização em ação.

> **Custo:** tipar o `croqui` **aumenta** a saída do Agente do Croqui. E
> **elimina** a necessidade de uma segunda chamada de IA para transformar a
> análise em slides. Saldo líquido: uma chamada a menos por croqui.

### 3.3 A transformação: função pura, zero token

`src/server/croqui/gerar-slides.ts` (novo):

```ts
gerarSlidesDaAnalise(analise: CroquiAnaliseV2, base = construirSlidesBase()): CroquiConteudo
```

Para cada um dos 13 tipos: se a análise trouxe o slide, usa `conteudo`/`pontos`
/`como_apresentar` e marca `origem: 'ia'`. Se não trouxe, **mantém a
mensagem-padrão do método** e marca `origem: 'metodo'`. Nunca inventa.

`SlideCroquiSchema` ganha campos **opcionais e aditivos** (croquis antigos
continuam validando):

| Campo | O que é |
|---|---|
| `origem: 'metodo' \| 'ia' \| 'humano'` | proveniência do texto daquele slide |
| `revisado: boolean` | a advogada carimbou este slide |
| `categoria` | fato / documento / inferência / ponto a validar |
| `fontes: string[]` | de onde a afirmação saiu |
| `pontos: string[]` | bullets |
| `grafico` | qual gráfico este slide comporta (§3.4) |

### 3.4 Gráficos — o que vale a pena, e de onde vem cada número

**Regra dura, acima de tudo:** *gráfico só existe se o dado existir*. Nenhum
gráfico calcula imposto, projeta valor ou completa lacuna. A `0008` já
estabeleceu: *"nenhum cálculo automático de imposto no MVP; alíquota e link são
digitados pela advogada"* — **isso continua valendo e não é negociado aqui.**

| Slide | Gráfico | Fonte do dado | Quando falta |
|---|---|---|---|
| 3 · Família | **Árvore de núcleos** | `familiares` (parentesco, idade, regime, dependente) | nenhum familiar registrado |
| 4 · Patrimônio | **Barras horizontais por tipo de bem** | `patrimonio_itens.valor_mercado ?? valor_historico` | nenhum item com valor |
| 5 · Risco | **Concentração**: fatia do maior bem sobre o total | mesmos itens | idem |
| 6 · Alternativas | **Matriz dos 9 critérios × 1/2/3 células** | `analise.arquitetura.criterios` — **já existe no schema v1**, com `.length(9)` garantido | análise ausente |
| 7-9 · Células | **Diagrama Cofre / Veículo / Destino** com os bens alocados | `analise.arquitetura.alocacao` (v2) | recomendação = `ponto_a_validar` |
| 10 · Controle | mesmo diagrama, com o instituidor destacado | idem + `familiares` | idem |
| 11 · Economia | **Barras comparativas: custo de agir × custo de não agir** | **exclusivamente** `relatorios_sessao.tributos` (jsonb digitado pela advogada) + `ideia_custo_inventario` | **qualquer um dos números ausente → não desenha** |
| 12 · Implementação | **Linha do tempo de etapas** | `analise.croqui.implementacao.pontos` | análise ausente |
| — · Mapa societário (aparece em 2 e 4) | **Quadro societário** | `consultas_cnpj.qsa` (§4) + `patrimonio_itens` tipo `empresa` | CNPJ não consultado |

**O slide 11 é o caso que exige coragem:** é o gráfico mais persuasivo do
croqui e é o único que o sistema **não pode calcular**. Registrado como
**CONFLITO C18**. A solução não é calcular — é dar à advogada um formulário de
três campos no Relatório e desenhar exatamente o que ela digitou, com a fonte
carimbada na legenda.

**Estado vazio que não é feio** — `<GraficoIndisponivel>`:

- ocupa **o mesmo espaço e a mesma moldura** do gráfico (o layout não pula);
- diz o que falta, item a item, com o nome do campo em português;
- traz um link para a aba onde se preenche;
- em modo apresentação (com cliente na frente), **não aparece**: o slide
  simplesmente não mostra o bloco de gráfico. Buraco rotulado é para a equipe,
  não para o cliente.

### 3.5 Renderização: SVG inline, zero dependência

**Decisão: nada de biblioteca de gráficos, nada de CDN.** Componentes SVG
próprios em `src/components/graficos/`.

Por quê:

1. **Sem CDN** — restrição do deploy (Hostinger Node App), e CDN externa em
   tela com patrimônio de cliente é superfície de terceiro que ninguém pediu.
2. **Sem dependência nova** — o `package.json` tem 8 dependências. Adicionar
   uma lib de gráficos infla o bundle e passa pela armadilha do
   `npm install no Windows poda o lockfile`, que já quebrou build da Hostinger
   nesta casa.
3. **Duas das quatro visualizações não são gráficos, são diagramas** (árvore
   familiar, células). Nenhuma lib de charting desenha isso bem — seria lib
   nova *mais* SVG à mão.
4. **Impressão** — SVG imprime nativamente, sem canvas, sem rasterização.
5. É o critério de otimização: **resolve com menos, não com mais**.

**Contrato dos componentes:** puros, `props → SVG`. Nenhum faz fetch. Nenhum
importa `@/lib/api`. Isso é o que os torna testáveis e o que permite construí-los
**em paralelo com tudo o mais** (fronteira de arquivo limpa, §6).

**Tema.** `ModoApresentacao` roda em fundo escuro (`#0f1012`); a Ficha 360 e a
impressão são claras. Todo componente recebe `tema: 'claro' | 'escuro'` e usa
cores explícitas — **não** variáveis CSS que resolvem diferente nos dois
contextos. Detalhe pequeno que, se esquecido, produz gráfico invisível na
apresentação.

**Acessibilidade:** todo gráfico tem `role="img"` + `aria-label` descrevendo o
achado em uma frase, e uma `<table>` equivalente com `class="sr-only"` (e
visível na impressão). O item 9 do backlog — acessibilidade formal das telas
novas — não é aumentado por esta fase.

> O `frontend-engineer` deve **invocar a skill `dataviz`** antes de escrever a
> primeira linha de gráfico, para a paleta, as regras de marca e o contraste
> nos dois temas. Não replico aqui o que a skill já resolve melhor.

### 3.6 Invariante nova: croqui pronto exige revisão humana

Se a IA preenche os 13 slides, **o que a advogada assina?** (CONFLITO C19).

O croqui é **prescrição técnica**, não saída de modelo. Resposta:

- todo slide de origem `ia` nasce `revisado: false` e aparece marcado como
  **proposta** no editor;
- `croquis.status` só pode ir para `pronto` com **os 13 slides revisados** —
  garantido por **trigger no banco** (`0043`), não por checagem na rota;
- o modo apresentação **recusa** croqui em `rascunho` com slides não revisados,
  com mensagem nomeando quantos faltam.

Isso transforma "IA gerou" em "advogada validou", que é o que o método exige e
o que a OAB espera.

---

## 4. Dossiê público — consulta de CNPJ

**O BLOQUEIO B4 não é reaberto.** Dado judicial e pesquisa sobre pessoa física
continuam fora, com a trava de consentimento que já existe. O que entra aqui é
**dado cadastral de empresa**, público por definição legal, obtido de API
oficial gratuita.

### 4.1 Por que serve ao método

O Relatório da SV pede **objeto, composição societária e capital social** da
empresa. O Agente do Croqui precisa do **mapa societário** (§43 do
Contexto-Mestre: razão social, atividade, sócios, percentuais). Hoje isso é
digitação manual dentro de `patrimonio_itens.detalhes` — que é exatamente onde
a `0007` já reservou espaço: *"campos específicos por tipo (empresa: objeto,
composição societária, capital, PL, faturamento)"*.

### 4.2 A fonte

**BrasilAPI** — `GET https://brasilapi.com.br/api/cnpj/v1/{cnpj}`, sem chave,
sem autenticação. **Verificado ao vivo em 04/09/2026** contra um CNPJ real; os
campos retornados incluem `razao_social`, `nome_fantasia`,
`descricao_situacao_cadastral`, `capital_social`, `cnae_fiscal` +
`cnae_fiscal_descricao`, `cnaes_secundarios`, endereço completo,
`data_inicio_atividade` e `qsa` (array de sócios com nome, qualificação e data
de entrada).

**Nenhum SLA. Nenhum contrato.** O desenho assume que a API **vai** falhar:
timeout curto (10s), sem retry automático, e a tela nunca fica travada
esperando.

### 4.3 Cache no banco — `0044`

```sql
-- rascunho comentado; o backend transforma em arquivo
create table consultas_cnpj (
  cnpj              char(14) primary key,          -- só dígitos, normalizado
  razao_social      text,
  nome_fantasia     text,
  situacao          text,
  data_situacao     date,
  capital_social    numeric(15,2),
  cnae_principal    text,
  cnae_descricao    text,
  data_abertura     date,
  municipio         text,
  uf                char(2),
  qsa               jsonb not null default '[]'::jsonb,  -- PII de terceiro, ver B21
  bruto             jsonb not null,                      -- payload como veio
  fonte             text not null default 'brasilapi',
  consultado_em     timestamptz not null default now(),
  consultado_por    uuid references perfis_equipe(id),
  -- Última tentativa que FALHOU. Permite exibir "não conseguimos consultar
  -- desde DD/MM" sem apagar o dado bom que já estava aqui.
  falha_em          timestamptz,
  falha_motivo      text
);
create index idx_consultas_cnpj_frescor on consultas_cnpj (consultado_em desc);
```

Vínculo com a ficha: `patrimonio_itens.detalhes->>'cnpj'` (já é `jsonb`,
**não precisa de coluna nova** — nada a migrar em `patrimonio_itens`).

**Frescor.** `configuracoes['cnpj.validade_dias'] = 30`. Abaixo disso, a tela
lê do cache e mostra *"consultado em DD/MM"*. Acima, oferece um botão
**"atualizar"** — nunca consulta sozinha ao abrir a tela. Isso mata a armadilha
número 10 desta base (nada de polling) por construção.

**RLS.** `consultas_cnpj` é `ve_patrimonio()` para SELECT e para INSERT/UPDATE.
O `qsa` nomeia pessoas físicas: **mesmo recorte de quem vê patrimônio**, nunca
`relacionamento`, nunca superfície pública, nunca link público.

### 4.4 As regras duras

1. **Só consulta CNPJ que o cliente declarou.** A entrada é sempre um CNPJ que
   já está na ficha (`patrimonio_itens.detalhes.cnpj`) ou que a equipe digitou
   a partir do contrato social que o cliente entregou. **Nunca busca por nome
   de pessoa.** Isso é o que mantém a feature longe do B4.
2. **Validação antes da URL.** O CNPJ é normalizado para exatamente
   `^[0-9]{14}$` **antes** de compor a URL. Qualquer outra coisa é 400 sem sair
   da máquina. (Sem isso, entrada de usuário vira URL de saída = SSRF.)
3. **Falha nunca vira dado.** API fora do ar → grava `falha_em`/`falha_motivo`,
   devolve 503 nomeando a fonte, e a tela diz *"consulta indisponível"*. Se
   havia dado em cache, mostra o dado antigo **com a data**. Nunca campo vazio
   apresentado como "não tem sócios".
4. **O `qsa` só vai para a IA sob o mesmo gate `tratamento_ia`** que já
   protege a transcrição — é nome de pessoa física de terceiro. Nenhuma exceção
   nova de LGPD é criada por esta feature.
5. **Registro de quem consultou e quando** (`consultado_por`,
   `consultado_em`), e evento em `eventos_timeline`. Consulta a fonte externa
   sobre cliente é ato auditável.

### 4.5 Rotas e tela

| Rota | O que faz |
|---|---|
| `GET /api/cnpj/[cnpj]` | lê do cache; 404 se nunca consultado |
| `POST /api/cnpj/[cnpj]` | consulta a fonte e grava/atualiza o cache (respeita frescor; `forcar: true` ignora) |

**Tela:** bloco **"Empresas"** dentro da aba Patrimônio (não uma aba nova — já
são 13). Cada item `tipo='empresa'` ganha um campo CNPJ e um botão
**"consultar dados públicos"**. Resultado: razão social, situação, capital,
CNAE, abertura, e o quadro societário como **lista + diagrama** (o mesmo
componente do mapa societário do croqui, §3.4).

---

## 5. UX — "muito visual, muito entendível, muito fácil de operar, muito palpável"

### 5.1 O que está confuso, escondido ou trabalhoso hoje (verificado no código)

| # | Achado | Onde | Por que dói |
|---|---|---|---|
| **X1** | **O Briefing não aparece no Modo Conduzir Sessão.** `ConduzirSessaoApp.tsx` carrega a `Ficha360` inteira e **não renderiza uma linha do briefing** (`grep` por "briefing" em `src/components/sessao/` volta vazio). | `src/components/sessao/ConduzirSessaoApp.tsx` | Pagamos US$ 0,10 por uma análise de como conduzir a reunião, e a tela de conduzir a reunião não a mostra. É o pior defeito de UX do sistema, e o mais barato de consertar. |
| **X2** | **A Análise do Croqui não tem tela.** Rota existe, prompt existe, tabela existe, pentest auditou. `src/lib/api.ts` não tem função para chamá-la. | `src/app/api/croquis/[id]/analise/route.ts` | Feature completa e invisível. |
| **X3** | **13 abas na Ficha 360**, planas, sem hierarquia. | `src/app/(app)/jornadas/[id]/page.tsx` | Durante uma reunião, achar informação exige varrer 13 rótulos. |
| **X4** | **O Modo Apresentação é texto centralizado.** Um título e um parágrafo por slide. Sem gráfico, sem bullets, sem foto do patrimônio. | `src/components/croqui/ModoApresentacao.tsx` | É a tela que o cliente vê no momento da decisão. É a menos trabalhada do sistema. |
| **X5** | **Emissão de link de material antes da aprovação não avisa.** (dívida já registrada) | `MaterialAba` | Não vaza, mas a equipe descobre pelo cliente. |
| **X6** | **Nenhum estado vazio é acionável.** "Sem dados" não diz o que preencher nem onde. | vários | Empurra o operador para adivinhar. |

### 5.2 Referências reais — o que copiar e o que não

| Produto | Copiar | **Não** copiar |
|---|---|---|
| **Prontuário eletrônico** (iClinic, Epic) | A **faixa de sinais vitais fixa**: alergia e medicação ficam visíveis em toda aba, porque errar isso é grave. Aqui: faixa de patrimônio, nº de núcleos, DISC, objeção mais provável, etapa, próxima ação. | A densidade de 1998, a tipografia de 10px, o cinza sobre cinza. |
| **Stripe Dashboard** | Todo fato mostra **fonte e data** ("via webhook, 12/03 14:02"). Este projeto já faz isso com `origem_dado` — falta levar aos gráficos e aos slides. | A avalanche de métricas na home. O painel do dia daqui é fila, não dashboard. |
| **Linear** | **Command palette (Cmd+K)** e navegação por teclado. Pular para uma jornada/aba em dois toques, sem tirar o olho do cliente. Os `AtalhosTeclado` já existem em conduzir sessão — o padrão está estabelecido, falta generalizar. | O visual escuro de ferramenta de dev. Isto é um escritório de advocacia; a identidade papel/tinta/latão está certa e **não se mexe**. |
| **Keynote / Pitch — presenter view** | Notas do apresentador **ao lado**, não escondidas atrás de uma tecla. Prévia do próximo slide. | Animação, transição, tema. Croqui é prescrição técnica; se parecer pitch deck, perde autoridade. |
| **Ferramenta jurídica de peticionamento** | Documento com **proveniência por trecho** — de onde saiu cada afirmação. É exatamente o carimbo `fato/documento/inferência/ponto a validar` que o método já exige. | Bloco de texto livre para tudo. O valor deste sistema é o dado ser tipado. |

### 5.3 As mudanças propostas

Todas **aditivas**. Nenhuma redesenha o que já tem identidade.

- **U1 · Briefing no Modo Conduzir Sessão** *(a mais importante)*.
  Uma coluna lateral colapsável, sempre visível, com **6 coisas**: DISC
  (predominante/secundário + confiança), motivador principal, objeção mais
  provável **com a resposta recomendada**, tom de linguagem, os 3 "não fazer",
  e as frases do cliente para o fechamento (com a marcação de fidelidade do
  §1.8). Nada mais. Se não há briefing, o painel mostra o botão de gerar e o
  score de completude.

- **U2 · Faixa de sinais vitais fixa** no `CabecalhoFicha`, `sticky`: etapa ·
  faixa de patrimônio · nº de núcleos familiares · DISC · objeção provável ·
  próxima ação pendente. Não rola para fora da tela.

- **U3 · 13 abas → 4 grupos.** `Preparação` (Formulário, Ligação, Links,
  Briefing) · `Sessão` (Sessão, **Análise da Sessão**, Relatório, Material,
  Pesquisa) · `Patrimônio` (Patrimônio, Documentos, Croqui) · `Registro`
  (Linha do tempo). **Nenhuma aba é removida** — só agrupada, num segundo nível
  dentro do componente `Abas` que já existe. Mais: **deep-link por hash**
  (`/jornadas/<id>#briefing`), que é o que faz a checklist de completude poder
  apontar para o lugar exato.

- **U4 · Aba "Análise da Sessão"** dentro do grupo Sessão: colar/ver a
  transcrição, rodar a análise, ler as 14 seções **com o carimbo de categoria
  em cada afirmação** (cor + rótulo), e o botão **"gerar croqui a partir desta
  análise"**.

- **U5 · Estados vazios acionáveis.** Dois componentes novos em `ui/`:
  `<ChecklistPendencias>` (a porta de completude, cada linha com o peso e o
  link para a aba) e `<GraficoIndisponivel>` (§3.4).

- **U6 · Modo Apresentação repaginado.** Área do cliente (gráfico + título +
  até 4 bullets, tipografia grande) e **trilho de notas da advogada** ao lado,
  com objetivo, pergunta ao cliente e `como_apresentar`. Barra de progresso dos
  13 slides. Impressão: um slide por página, gráficos incluídos, marca d'água
  de demonstração preservada.

- **U7 · Command palette (Cmd+K)** para pular a jornada/aba/sessão. Reusa a
  busca de `/api/jornadas` que já existe — **sem endpoint novo**.

- **U8 · Aviso na emissão de link de material sem aprovação** (X5, dívida
  antiga, custa 6 linhas dentro de uma tela que já vamos abrir).

**O que NÃO fazemos:** trocar a paleta, trocar a tipografia, refazer o kanban,
refazer o painel do dia. Estão certos e o João não reclamou deles.

---

## 6. Plano de execução em ondas — fronteiras de arquivo disjuntas

**Regra de disjunção que vale para todas as ondas:**

1. **`src/lib/api.ts` está TRAVADO.** Nenhum agente edita. Todo cliente novo de
   API vai para um módulo por feature, ao lado dos componentes — precedente que
   já existe nesta base (`src/components/sessao/api.ts`).
2. **Cada migration tem dono único.** Números atribuídos abaixo; ninguém cria
   número fora do seu.
3. **Componentes de gráfico são puros.** Não importam `@/lib/api`, não fazem
   fetch. Por isso podem ser construídos antes de o dado existir.

### ONDA 0 — sequencial, bloqueia tudo (`backend-engineer`)

Sem `0041` não há como medir nada, e sem medição este plano vira chute.

| Arquivo | Tarefa |
|---|---|
| `supabase/migrations/0041_telemetria_ia.sql` | `execucoes_ia`: `+tokens_raciocinio int`, `+effort text`, `+variante text` (null em produção). `briefings`: `+completude_entrada smallint`, `+verificacao jsonb`. View `vw_custo_ia_por_variante`. **Aditiva, reversível por `drop column`.** |
| `src/server/ia/provedor/openrouter.ts` | `extrairUso()` passa a ler `completion_tokens_details.reasoning_tokens`. Comentário explicando que `cache_control` não está pagando (§1.6). |
| `src/server/ia/provedor/anthropic.ts` | mesmo campo, equivalente do SDK (rollback tem que medir igual). |
| `src/server/ia/provedor/tipos.ts` | `TokensUso` ganha `tokensRaciocinio`. |
| `src/server/ia/provedor/json-schema-estrito.ts` | `maxItems`/`minItems` entram em `CHAVES_REMOVIDAS` (§1.4). |
| `src/server/ia/executar.ts` | grava `tokens_raciocinio`, `effort`, `variante`; aceita `effortOverride` e `variante` nos params. |
| `src/server/ia/precos.ts` | fallback soma raciocínio como saída (só o fallback; o `usage.cost` do OpenRouter já inclui). |

**Saída obrigatória da onda:** uma execução real registrada com
`tokens_raciocinio` preenchido. **Só depois disso as outras ondas começam.**

### ONDA 1 — 4 agentes em paralelo

| Agente | Fronteira **exclusiva** | Entrega |
|---|---|---|
| **A · backend-ia** | `src/server/ia/**` (exceto `provedor/`, já fechado), `scripts/bancada-ia.ts`, `supabase/migrations/0042_prompts_v2.sql` | Prompt v2 do Briefing (orçamento de escrita), schema v2 (enums de `processo_decisorio` + `nivel_autoridade` + `decisores_presentes_na_sessao`), porta de completude, `fidelidade.ts`, enforcement de cooldown, bancada. Novas chaves em `configuracoes`. |
| **B · backend-cnpj** | `src/server/cnpj/**`, `src/app/api/cnpj/**`, `supabase/migrations/0044_consultas_cnpj.sql` | Cliente da BrasilAPI com validação `^[0-9]{14}$` antes da URL, timeout 10s, cache, frescor, falha que não vira dado, evento na timeline. |
| **C · frontend-graficos** | `src/components/graficos/**` (diretório novo, ninguém mais entra) | `BarrasComposicao`, `BarrasComparativas`, `ArvoreFamiliar`, `DiagramaCelulas`, `MatrizCriterios`, `LinhaDoTempo`, `QuadroSocietario`, `GraficoIndisponivel`, `escala.ts`. Puros, `tema` claro/escuro, `role="img"` + tabela `sr-only`, impressão. **Invocar a skill `dataviz` antes de começar.** |
| **D · frontend-ux-base** | `src/components/ui/**`, `src/components/shell/**`, `src/components/ficha360/CabecalhoFicha.tsx`, `src/app/(app)/jornadas/[id]/page.tsx` | U2 (faixa sticky), U3 (4 grupos + deep-link por hash), U5 (`ChecklistPendencias`), U7 (Cmd+K). |

### ONDA 2 — 3 agentes em paralelo (depende da 1)

| Agente | Fronteira **exclusiva** | Entrega |
|---|---|---|
| **E · backend-analise** | `src/app/api/sessoes/**`, `src/app/api/croquis/[id]/analise/route.ts`, `src/app/api/jornadas/[id]/analise-sessao/route.ts`, `src/server/croqui/**`, `supabase/migrations/0043_analise_schema_v2.sql`, `supabase/migrations/0045_transcricao_sv.sql` | §2 inteiro + `gerarSlidesDaAnalise()`. `0043`: `croqui_analises.schema_versao`, trigger de "13 revisados para ficar pronto", e o **`drop function` explícito da assinatura antiga** de `registrar_croqui_analise` antes do `create` (armadilha 6 desta base: `create or replace` com parâmetro novo cria sobrecarga, não substitui). `0045`: policy `tr_ins_sessao`. |
| **F · frontend-briefing-sessao** | `src/components/briefing/**`, `src/components/sessao/**` | U1 (briefing no conduzir sessão), render dos enums novos como chips, marcação de fidelidade nas frases, tela da porta de completude com custo médio histórico. |
| **G · frontend-cnpj** | `src/components/ficha360/PatrimonioAba.tsx`, `src/components/ficha360/api-cnpj.ts` (novo) | Bloco Empresas, campo CNPJ, botão consultar, "consultado em DD/MM", falha honesta. Consome `QuadroSocietario` da onda 1. |

### ONDA 3 — 2 agentes em paralelo (depende da 2)

| Agente | Fronteira **exclusiva** | Entrega |
|---|---|---|
| **H · frontend-croqui** | `src/components/croqui/**`, `src/components/ficha360/CroquiAba.tsx`, `src/components/ficha360/api-analise.ts` (novo) | U4 (aba Análise da Sessão), editor com marcação proposta/revisado, "gerar croqui a partir da análise", U6 (Modo Apresentação com gráficos + trilho de notas + impressão). |
| **I · backend-medicao** | `scripts/bancada-ia.ts` (segunda passada), `tmp/bancada/` | Roda o protocolo do §1.9: baseline 3×, variantes 3×, tabela de resultado, e **executa a promoção** se e somente se o gate passar. |

### ONDA 4 — `security-pentester` (obrigatório), depois `fable-orchestrator`

---

## 7. Tarefas

### backend-engineer

- [ ] **0041** — telemetria de IA: `execucoes_ia +tokens_raciocinio/+effort/+variante`, `briefings +completude_entrada/+verificacao`, `vw_custo_ia_por_variante`. **Não** altera linha existente, **não** apaga nada.
- [ ] `openrouter.ts` / `anthropic.ts` / `tipos.ts` / `precos.ts` / `executar.ts` — ler e gravar `reasoning_tokens`; `effortOverride` e `variante`; comentar por que `cache_control` não paga.
- [ ] `json-schema-estrito.ts` — `maxItems`/`minItems` em `CHAVES_REMOVIDAS`.
- [ ] **0042** — prompt v2 do `protocolo_01_briefing` (orçamento de escrita) e do `agente_croqui_analise` (croqui tipado + alocação); v1 vira `ativo=false`, **preservada**. Novas chaves em `configuracoes` (`ia.completude_pesos`, `ia.completude_minima_briefing`, `ia.orcamento_escrita_ativo`, `cnpj.validade_dias`), todas rotuladas *"VALOR INICIAL, não vem do método"*.
- [ ] `schema-briefing.ts` — enums de `processo_decisorio`, `nivel_autoridade`, `decisores_presentes_na_sessao`, `estrategia_sessao.ritmo`. **Sem `.max()` em array.**
- [ ] `src/server/ia/completude.ts` — score determinístico + 409 `dados_insuficientes` + `forcar_mesmo_assim`.
- [ ] `src/server/ia/fidelidade.ts` — verificação de `frase_literal` e ancoragem das evidências.
- [ ] **Ligar o cooldown e o teto diário em runtime** (`ia.cooldown_segundos`, `ia.teto_execucoes_dia_por_usuario`) — a função já existe no banco desde a `0027` e nunca foi chamada. Vira obrigatório porque este plano cria um botão que gasta dinheiro.
- [ ] **0044** — `consultas_cnpj` + RLS `ve_patrimonio` + índice de frescor.
- [ ] `src/server/cnpj/**` + `GET/POST /api/cnpj/[cnpj]` — normalização `^[0-9]{14}$` **antes** de compor a URL, timeout 10s, sem retry, falha grava `falha_em` e nunca vira dado.
- [ ] **0043** — `croqui_analises.schema_versao`; trigger "status `pronto` exige 13 slides `revisado`"; **`drop function public.registrar_croqui_analise(<assinatura antiga>)` explícito antes do `create`**.
- [ ] **0045** — policy `tr_ins_sessao` em `transcricoes` com a regra de negócio no `with check`.
- [ ] `POST /api/sessoes/[id]/transcricao`, `POST /api/jornadas/[id]/analise-sessao`, e `transcricao_sessao` opcional em `/api/croquis/[id]/analise`.
- [ ] `src/server/croqui/gerar-slides.ts` — função pura análise → 13 slides. **Zero chamada de IA.**
- [ ] `scripts/bancada-ia.ts` — fixtures fora do repo, 3 repetições, métricas, **nunca imprime conteúdo de briefing**.
- [ ] Rodar o protocolo de medição e promover **só se o gate do §1.9 passar**.

### frontend-engineer

- [ ] `src/components/graficos/**` — 8 componentes SVG puros, tema claro/escuro, `role="img"` + tabela `sr-only`, impressão. **Invocar a skill `dataviz` primeiro.**
- [ ] U2 — faixa de sinais vitais sticky no `CabecalhoFicha`.
- [ ] U3 — 13 abas em 4 grupos + deep-link por hash. **Nenhuma aba removida.**
- [ ] U5 — `<ChecklistPendencias>` e `<GraficoIndisponivel>`.
- [ ] U7 — command palette (Cmd+K) reusando `/api/jornadas`, sem endpoint novo.
- [ ] **U1 — briefing no Modo Conduzir Sessão** (6 campos, coluna colapsável). *Maior ganho de UX do plano.*
- [ ] Render dos enums novos como chips; marcação visual de `frase_literal` não localizada.
- [ ] Tela da porta de completude: checklist + custo médio histórico + confirmação do `forcar_mesmo_assim`.
- [ ] U4 — aba "Análise da Sessão": colar transcrição, rodar, ler as 14 seções com carimbo de categoria, gerar croqui a partir da análise.
- [ ] Editor do croqui — marcação `proposta` / `revisado`, e o botão de "pronto" desabilitado enquanto faltar revisão (a trava dura é o trigger; a tela explica).
- [ ] U6 — Modo Apresentação com gráficos, trilho de notas, progresso e impressão por página.
- [ ] Bloco Empresas na aba Patrimônio (CNPJ, consultar, "consultado em DD/MM", falha honesta).
- [ ] U8 — aviso na emissão de link de material sem aprovação.

### security-pentester *(obrigatório — o plano toca PII, RLS, IA e fonte externa)*

- [ ] **Superfície CNPJ**: SSRF via CNPJ não normalizado; poisoning do cache (quem pode escrever em `consultas_cnpj`?); `qsa` como PII de terceiro — confirmar que `relacionamento` e usuário sem convite levam 42501 pelo PostgREST direto; confirmar que nenhum link público ou rota `anon` alcança a tabela.
- [ ] **Nova porta de escrita em `transcricoes`** (`tr_ins_sessao`): a policy amplia de `eh_admin` para `ve_patrimonio`. Tentar, pelo PostgREST direto, inserir transcrição sem `jornada_id`, com `tipo='apresentacao_croqui'`, com `origem_dado='exemplo'`, e como `relacionamento`. Confirmar que o `with check` segura — **a regra não pode existir só na rota** (ALTO 1).
- [ ] **Cooldown, teto e `forcar_mesmo_assim`**: o plano cria um botão que gasta dinheiro. Chamar em laço, com e sem `forcar`, por dois usuários, e confirmar o enforcement em runtime. Confirmar que `relacionamento` não alcança nenhuma rota de IA.
- [ ] **Bancada (`scripts/bancada-ia.ts`)**: roda com `service_role` sobre dado real. Confirmar que não grava `briefings`, não escreve conteúdo em log/stdout, não deixa arquivo com PII versionado, e que `variante` não é gravável pela API pública.
- [ ] **Modo Apresentação**: é a única tela do sistema exibida **para o cliente**. Conferir que gráfico e slides não vazam dado de terceiro (nome de sócio de outra empresa, familiar de outro núcleo), nem UUID interno, nem valor que o papel do usuário não deveria ver — e que a impressão carrega as mesmas restrições.
- [ ] Reteste do achado BAIXO em aberto: mensagem de erro do OpenRouter gravada em `execucoes_ia.erro` ecoando fragmento de prompt — agora com mais caminhos de erro (timeout nomeado, `dados_insuficientes`, falha de CNPJ).

---

## 8. CONFLITO

Os conflitos C1–C15 dos planos anteriores seguem valendo. Novos:

| # | Conflito | Consequência | Encaminhamento |
|---|---|---|---|
| **C16** | **"Análise da sessão" é o Agente do Croqui com outro nome.** Mesma entrada, mesmo momento, mesma saída. | Implementar como IA nova seria pagar duas vezes pela mesma leitura e criar dois vocabulários para o mesmo conceito — o Glossário proíbe. | **Não duplico.** Dou tela à IA que já existe, persisto a transcrição e reancoro o caminho de entrada na Sessão. Nenhum prompt novo, nenhuma tabela nova. |
| **C17** | **Cortar `reasoning` parece contradizer a decisão de 03/09** de aumentar o timeout de 120s → 300s. | Quem ler os dois documentos vai desfazer um dos dois. | São eixos diferentes: teto de **espera** × orçamento de **raciocínio**. Cortar o segundo alivia o primeiro. Registrado aqui e no `corpo_sistema` da v2. |
| **C18** | **"Gráficos que o cliente entenda" × "nenhum cálculo automático de imposto"** (`0008`). O slide 11 (Economia) é justamente custo de inventário × custo da estrutura. | O gráfico mais persuasivo do croqui é o único que o sistema **não pode calcular sozinho**. | O gráfico lê **exclusivamente** `relatorios_sessao.tributos` — números digitados pela advogada — e não desenha se faltar qualquer um deles. A legenda carimba a fonte. **Não calculo ITCMD. Ponto.** |
| **C19** | **Croqui gerado por IA × croqui é prescrição técnica assinada pela advogada.** | Se a IA preenche os 13 slides, a autoria fica ambígua — e isso é problema de OAB, não de produto. | Slide de origem `ia` nasce **proposta**, `revisado=false`. `status='pronto'` exige 13 revisados, **garantido por trigger no banco**. O modo apresentação recusa croqui não revisado. |
| **C20** | **CNPJ é dado público de empresa, mas o `qsa` nomeia pessoa física.** Encosta no B4 sem ser o B4. | Coletar nome de sócio automaticamente pode ser lido como pesquisa sobre pessoa. | Só consulto CNPJ **que o cliente declarou**; **nunca** busco por nome; `qsa` sob `ve_patrimonio`; nunca em superfície pública; só vai para IA sob o gate `tratamento_ia` que já existe. |
| **C21** | **"Fácil de operar" × 13 abas na Ficha 360**, e este plano acrescenta conteúdo. | Uma 14ª aba plana pioraria exatamente o que o João pediu para melhorar. | Agrupo em 4, sem remover nenhuma, e ponho o que a advogada precisa em reunião **no Modo Conduzir Sessão** (U1), não em mais uma aba. |
| **C22** | **A meta "abaixo de US$ 0,04" foi fixada antes de sabermos quanto do custo é raciocínio.** | Prometer 62% de corte sem medir seria inventar número — o que este projeto proíbe em tela e vale igual em documento. | Entrego as alavancas com **teto calculado**, a bancada que mede, e o gate de promoção. Se L1+L2+L3 pararem em US$ 0,045, digo o número medido e aponto L6 como o que falta — não maquio. |

---

## 9. BLOQUEIO — e o caminho padrão que eu sigo hoje sem o João

| # | Bloqueio | **Caminho padrão que sigo hoje** | O que muda se ele decidir diferente |
|---|---|---|---|
| **B21** | **Retenção do `qsa`** (nomes de sócios pessoa física vindos de fonte pública). Não é o B4, mas é dado pessoal de terceiro guardado no nosso banco. | Guardo, sob RLS `ve_patrimonio`, nunca em superfície pública, com registro de quem consultou e quando. É o dado que o próprio método (§43) exige para o mapa societário. | Reversão é `UPDATE consultas_cnpj SET qsa='[]'` — uma linha, sem migration, sem perder o resto do cadastro. |
| **B22** | **Quem carimba que a qualidade do briefing não caiu.** A rubrica cega precisa de alguém que domine o método. | Promovo a variante **só** se o gate objetivo do §1.9 passar (custo cai, cobertura de evidência e ancoragem dentro da variância do baseline, grau de confiança não cai). A v1 fica no banco, inativa. | Rollback é `UPDATE prompts_versoes SET ativo` — segundos, sem deploy. Se o João/Dra. Elaine reprovarem o texto, volta e a medição fica registrada. |
| **B23** | **Trocar de modelo para bater a meta de custo.** | **Não troco.** A lição de 03/09 é literal: *"não trocar o `modelo_padrao` sem antes confirmar com um teste real"*. Entrego o custo medido com as alavancas que não dependem disso, e deixo o comparativo pronto na bancada. | Um `UPDATE` quando ele decidir. Zero deploy, zero retrabalho. |
| **B24** | **Limiar de completude (default 40)** não vem do método — nenhum POP diz quanto dado é suficiente. | 40 em `configuracoes`, rotulado *"VALOR INICIAL, não vem do método"* na tela de Admin, ajustável sem deploy, com `forcar_mesmo_assim` sempre disponível para admin/advogada. | `UPDATE`. E em 30 dias a correlação `completude_entrada × grau_confianca` (gravada a partir da `0041`) dá o número real, medido nos clientes deste escritório. |
| **B25** | **Rubrica humana das 14 seções da Análise da Sessão** — ninguém nunca viu uma saída real dela (a rota nunca foi chamada). | Ligo a tela, rodo **uma** análise real e deixo a saída visível para a advogada julgar antes de virar rotina. Não presumo que está boa por ter passado no schema. | Se a saída não prestar, é prompt v3 — `INSERT` em `prompts_versoes`, não migration estrutural. |

**Nenhum bloqueio deste plano reclassifica pessoa, muda faixa, muda papel, muda
etapa ou apaga histórico.** Toda migration é aditiva; toda reversão é `drop
column`, `drop policy` ou `UPDATE ativo`. Por isso podem ser executados sem ele.

---

## 10. Os 5 critérios do Fable

| Critério | O que este plano garante |
|---|---|
| **Segurança** | A fonte externa nova (BrasilAPI) recebe **CNPJ normalizado para `^[0-9]{14}$` antes de virar URL** — sem isso, entrada de usuário compõe requisição de saída, que é SSRF. A ampliação de escrita em `transcricoes` (de `eh_admin` para `ve_patrimonio`) leva a regra de negócio para o `with check` da policy, **não para a rota** — que é a lição literal do ALTO 1 desta base. `qsa` é PII de terceiro e entra sob `ve_patrimonio`, fora de toda superfície pública e fora da IA sem o gate `tratamento_ia`. O plano **fecha uma dívida de segurança em aberto desde a fase 1**: cooldown e teto de IA passam a ser aplicados em runtime — obrigatório, porque a porta de completude cria um botão que gasta dinheiro de propósito. Falha de API externa grava `falha_em` e devolve 503 nomeando a fonte: **nunca vira campo vazio apresentado como fato**. 6 tarefas obrigatórias de pentester, incluindo a primeira auditoria do Modo Apresentação — a única tela do sistema que o cliente vê. |
| **Escalabilidade** | Nada novo cresce com tráfego: `consultas_cnpj` é chaveada por CNPJ (uma linha por empresa, não por consulta), com índice de frescor, e **nunca é consultada ao abrir tela** — só sob clique, com validade em `configuracoes`. Zero polling, respeitando que o egress do Supabase é da **organização** e este é o 3º projeto sob o mesmo teto. `execucoes_ia` ganha 3 colunas escalares e uma view agregadora sobre índice existente. A transformação análise→13 slides é **O(13) em memória, sem chamada de rede**. Os gráficos são SVG estático: 10× mais jornadas não muda o custo de render de nenhuma tela. A 10× o volume, o que cresce são linhas em tabela indexada — e o custo de IA por jornada cai, não sobe. |
| **Solidificação** | Invariantes novas que o **banco** passa a garantir sozinho: transcrição de SV inserida pela advogada **obriga** `tipo='sessao_viabilidade'`, `jornada_id not null` e `origem_dado='real'` (policy `with check`); croqui só chega a `pronto` com **os 13 slides revisados por humano** (trigger — é o que impede a IA de assinar prescrição técnica); `consultas_cnpj` com PK no CNPJ, que torna cache duplicado impossível. Do lado do dado: `briefings.completude_entrada` e `briefings.verificacao` transformam duas coisas que hoje são achismo — "tinha dado suficiente?" e "a frase é mesmo do cliente?" — em colunas consultáveis. E a `0043` corrige a RPC pelo caminho certo (`drop function` da assinatura antiga antes do `create`), fugindo da armadilha 6 desta base. |
| **UX** | A advogada abre o **Modo Conduzir Sessão e vê o briefing** — hoje ela paga por uma análise de como conduzir a reunião e a tela de conduzir a reunião não a mostra. A faixa de sinais vitais não rola para fora da tela. As 13 abas viram 4 grupos, sem perder nenhuma. Estado vazio deixa de ser "sem dados" e passa a ser uma checklist com o que falta e o link de onde preencher — **alerta é fila, número é informação**. Quando não há dado para um gráfico, a tela diz o que falta, na mesma moldura, sem pular o layout — e **some** quando o cliente está na frente. O cliente vê um croqui com composição patrimonial, árvore da própria família e o desenho Cofre/Veículo/Destino, em vez de um parágrafo centralizado. Toda afirmação carrega o carimbo fato/documento/inferência/ponto a validar, e frase de fechamento não localizada no material aparece marcada — **a advogada nunca repete ao cliente uma frase que ele não disse**. |
| **Otimização** | O plano **remove** em sete lugares: (a) a transformação análise→croqui é **função pura, elimina a segunda chamada de IA** que seria o caminho óbvio; (b) `narrativa` sai do schema, absorvida pelo slide onde é usada — um array duplicado a menos na saída paga; (c) o `effort` e o orçamento de escrita cortam tokens do lado onde estão 91% do custo, e a porta de completude corta **gerações inteiras**; (d) **zero dependência nova** — os gráficos são SVG próprio, não lib e não CDN, e ainda resolvem os dois diagramas que nenhuma lib de charting desenharia; (e) três caminhos de análise convergem em **uma** função, **um** prompt, **uma** trava de consentimento; (f) o command palette reusa `/api/jornadas`, sem endpoint novo; (g) `patrimonio_itens.detalhes` já é `jsonb` e recebe o CNPJ — **nenhuma coluna nova numa tabela com PII**. E o plano mata duas dívidas antigas de graça: a rota de análise sem tela, e o cooldown de IA que existia no banco e ninguém chamava. |

---

## 11. Anexo

### Chaves novas em `configuracoes` (`0042`, `0044`)

```
ia.completude_pesos                {"formulario":25,"ligacao":20,"patrimonio":15,
                                    "frases":10,"decisorio":10,"familia":10,"transcricao":10}
ia.completude_minima_briefing      40      -- VALOR INICIAL, não vem do método (B24)
ia.orcamento_escrita_ativo         true    -- desliga o bloco de orçamento sem deploy
cnpj.validade_dias                 30      -- frescor do cache
```

### Variáveis de ambiente

**Nenhuma nova.** A consulta de CNPJ não usa chave. Isso é deliberado: o
sistema já tem 3 credenciais pendentes; a quarta atrasaria a entrega.

### Ordem de aplicação das migrations

`0041` (onda 0, sozinha) → `0042` ‖ `0044` (onda 1) → `0043` ‖ `0045` (onda 2).

`0042` depende da `0041` (a v2 do prompt só faz sentido com telemetria de
raciocínio). `0043` e `0045` são independentes entre si. Nenhuma depende da
`0044`.

### Como reverter

| Migration | Reversão |
|---|---|
| `0041` | `drop column` das 5 colunas + `drop view vw_custo_ia_por_variante`. Nada perdido além da telemetria nova. |
| `0042` | `UPDATE prompts_versoes SET ativo = (versao = 1)` nas duas chaves + `delete from configuracoes where chave in (...)`. **A v1 nunca é apagada.** |
| `0043` | `drop trigger` + `drop column schema_versao` + recriar a RPC na assinatura antiga (o backend deixa o texto anterior em comentário dentro do arquivo, para o caminho de volta ser copiar e colar). |
| `0044` | `drop table consultas_cnpj`. Nenhuma outra tabela referencia. |
| `0045` | `drop policy tr_ins_sessao`. A `tr_ins` de admin (0037) continua intacta. |

**Nenhuma migration deste plano faz `DELETE`. Nenhuma faz `UPDATE` que mude o
valor de uma linha de cliente. Nenhuma pessoa muda de faixa, papel, etapa ou
desfecho por causa deste plano.**
