# Fase 10 — plano do arquiteto · 11/09/2026
## Copiloto ao vivo da Sessão de Viabilidade

Entrada: pedido do João (copiloto que escuta a SV, transcreve ao vivo, sugere a próxima
pergunta, avisa o que falta do roteiro e adapta quando a sala diverge do script — caso
citado: nem todos os decisores presentes, o 3º SIM).

Base lida: `CLAUDE.md`, `CONTINUAR-AQUI.md` (Fases 7–9), `brain/03 - Dominio/{Glossario,
Esteira do cliente}.md`, `brain/06 - Materiais/Script de Sessao de Viabilidade.md`,
`docs/ARQUITETURA-FASE-9.md` (postura de referência). Código:
`components/sessao/ConduzirSessaoApp.tsx`, `components/briefing/PainelBriefingSessao.tsx`,
`types/roteiro.ts`, `server/ia/{cliente,executar,consentimento}.ts`,
`server/ia/provedor/openrouter.ts`, `server/sala/tipos.ts`,
`api/sessoes/[id]/{sims,transcricao}/route.ts`, `api/webhooks/n8n/sala/route.ts`,
`next.config.ts`, migrations `0005/0027/0028/0030/0032/0048/0088-0090`.

Vault consultado: `02 Projetos/SIC-HF - Diagnostico 08-09-2026 nove fases zero uso real.md`
(o estado de produção abaixo vem de lá — medido em 08/09, não re-medido nesta sessão).

> **Aviso de honestidade sobre números.** Esta sessão **não** teve acesso ao banco
> (`.env` local não existe nesta máquina; só há `.env.example`). Todo número marcado
> *(vault 08/09)* vem da nota do Segundo Cérebro; todo número marcado `A MEDIR` é
> exigência de entrega, não estimativa. Nada foi inventado.

---

## 0. As quatro frases que resumem o desenho

**A. O copiloto não conduz — ele lembra.** Quem conduz é a Dra. Elaine; quem define o
método é `roteiros_versoes`. A IA não reescreve roteiro, não marca SIM, não fala com o
cliente e não decide o que a advogada deve dizer. Ela **ordena o que já existe e escreve
o motivo** — é o precedente do agendamento ("a IA ordena, não escolhe") aplicado à sala.

**B. A entrada de áudio recomendada é o bot na sala (opção c), não o microfone.** Ela
mantém `Permissions-Policy: microphone=()` intacto, reusa o padrão de webhook assinado
que já está maduro na casa (sala, ligação da Ana) e é a **única** das três que entrega a
lista nominal de participantes — que é exatamente o dado que falta para o caso dos
decisores. Custo (~R$ 5/sessão) não é critério: LGPD e dinâmica da sala são.

**C. O copiloto nasce desligado em quatro travas independentes**, e cada uma sozinha
basta para calar tudo: `configuracoes['copiloto_sessao.ativo']=false`, prompt v1
`ativo=false`, decisão jurídica de escopo novo ausente, consentimento novo por titular
ausente. Ligar é configuração; nenhuma das quatro se liga por deploy.

> ⚠️ **Errata (Fatia 2, trava do Fable).** "Cada uma sozinha basta" só é verdade se as
> quatro forem conferidas **antes da chamada ao provedor de IA**. Na primeira versão deste
> plano, decisão jurídica e consentimento eram conferidos **no INSERT**, depois do envio —
> ou seja, 2 de 4 barravam a tempo. Corrigido em **§6.2.1** e **§7**: a rota confere as
> quatro antes de montar contexto. O princípio geral, que vale para todas as fatias:
> **trava de dado que vale depois do envio não é trava, é registro.**

**D. O que a Fase 10 limpa.** A transcrição da SV hoje só existe se **alguém colar texto
à mão** em `POST /api/sessoes/[id]/transcricao` — na prática, nunca aconteceu *(vault
08/09: 0 uso real)*. O copiloto passa a produzi-la como subproduto, o que faz o Agente do
Croqui (`gerarAnaliseCroqui`) deixar de depender de trabalho manual que ninguém faz.
E a captura de participantes mata a ambiguidade do 3º SIM, que hoje é **um booleano sem
nenhum dado por trás** — não existe nenhuma tabela de participantes no banco (grep em
`supabase/migrations`: 0 ocorrências de "participante").

---

## 1. O que eu verifiquei do brief — e os pontos em que ele erra

O brief que recebi está quase todo certo. As correções, porque errar agora é barato:

| # | Afirmação do brief | O que o código diz |
|---|---|---|
| 1 | "`ConduzirSessaoApp.tsx` (321 linhas)" | **Correto** — 321 linhas exatas, layout `lg:grid-cols-[minmax(0,1fr)_320px]` em `:241`. |
| 2 | "0 `ReadableStream`, 0 SSE, 0 WebSocket, 0 EventSource" | **Correto e mais forte do que o brief diz**: também **0 uso de Supabase Realtime** (`grep "realtime\|channel("` em `src/` → nada). Realtime seria canal novo tanto quanto SSE. |
| 3 | "`output:'standalone'` proibido" | **Correto no `next.config.ts`** (comentário em `:4-8`) — mas o **`CLAUDE.md` §Stack diz o contrário** (`"output: 'standalone'"` listado como restrição do deploy). Um dos dois está errado e é o `CLAUDE.md`. **CONFLITO C7.** |
| 4 | "B13 é fail-closed no banco" | **Correto, e mais restritivo do que o brief supõe**: `decisoes_juridicas.escopo` tem `check (escopo in ('conhecimento.analise_ia_transcricoes'))` — **lista fechada por CHECK** (0048:50-51). Escopo novo **exige migration**, não é INSERT. Isso muda o plano de entrega. **CONFLITO C1.** |
| 5 | "A trava de B13 vale para IA sobre transcrição" | **Parcialmente.** A trigger `app.exige_flag_analise_ia_habilitada` está em `analises_transcricao` — **só ali**. `executarComAuditoria` não consulta `decisoes_juridicas` em lugar nenhum. Se o copiloto não escrever em `analises_transcricao`, **ele não herda trava nenhuma**. É literalmente a lição do pentest citada no brief ("trava é por caminho de saída de dado"). **CONFLITO C2.** |
| 6 | "`tratamento_ia` não cobre escuta ao vivo" | **Correto, e o próprio banco já diz isso por escrito**: a NOTA de `registrar_sim_sessao` (0030) afirma que `gravacao_sessao` autoriza gravar "para que minha equipe possa analisar", **não** tratamento por operador de IA, e que "nenhuma rota deste sistema pode ler `concedido=true` daqui como se fosse também `tratamento_ia`". |
| 7 | "última migration é 0090" | **Correto** (`0090_prompt_agente_whatsapp.sql`). |
| 8 | "1 execução de IA, 1 pessoa real, `OPENROUTER_API_KEY` sumiu" | **Correto** *(vault 08/09)*. Consequência prática: **o copiloto não tem como ser testado com IA real hoje** — o que reforça a ordem das fatias (§8). |

---

## 2. Trava de sustentabilidade — as 5 perguntas, respondidas antes de dividir tarefa

`~/.claude/PROTOCOLO-SUSTENTABILIDADE.md`. Nenhuma resposta é "não sei"; onde o número
não existe, a resposta é o **método de medição exigido na entrega**.

### 2.1 Escala — o custo é por item novo ou por base inteira?

**Por item novo, e o item é pequeno.** A unidade é a *sessão de 90 minutos*, não a base.
Cada sessão produz, no teto desenhado: ~180 segmentos de transcrição (um a cada ~30 s de
fala útil), **≤ 30 chamadas de IA** (teto duro, §4.4) e 1 transcrição consolidada.

Com 10× mais linha — o cenário realista é 10 SV/dia em vez de 1:
- `sessoes_copiloto_segmentos`: 180 × 10 = 1.800 linhas/dia ≈ **650 mil linhas/ano**. Nada
  para o Postgres, **desde que toda leitura seja por `(sessao_id, ordem)`** e nunca um
  `select ... order by criado_em` global. Ver 2.2.
- `execucoes_ia`: 30 × 10 = 300 linhas/dia. Hoje a tabela tem *1 linha* *(vault 08/09)*.
- Custo: 10 × (US$ 0,98 de bot + IA). Ver §4.5.

**O que NÃO escala e por isso está fora do desenho:** mandar a transcrição inteira
acumulada a cada chamada. Aos 80 minutos isso seria ~12 mil tokens de entrada por
chamada × 30 chamadas — o custo cresceria com o **quadrado** da duração da sessão. O
desenho manda **janela deslizante + resumo estruturado**, que é O(1) por chamada (§4.3).

### 2.2 Índice — a expressão da query bate com a do índice, caractere a caractere?

Três caminhos quentes, três índices, e a exigência de `explain (analyze)` colado na
entrega para cada um:

| Query do caminho quente | Índice exigido | Armadilha |
|---|---|---|
| `select ... from sessoes_copiloto_segmentos where sessao_id = $1 and ordem > $2 order by ordem` (o polling da tela) | `create index on sessoes_copiloto_segmentos (sessao_id, ordem)` | **`ordem` é `int`, não `timestamptz`.** Ordenar por `criado_em` faria dois segmentos do mesmo segundo trocarem de lugar e a tela repetiria fala. |
| `select ... from copiloto_sugestoes where sessao_id = $1 and ordem_evento > $2 order by ordem_evento` | `create index on copiloto_sugestoes (sessao_id, ordem_evento)` | Cursor por `uuid` **não ordena**. Se o cursor for uuid, o polling perde sugestão sem erro nenhum. |
| `select 1 from decisoes_juridicas where escopo = $1 and revogada_em is null` (porteiro) | `uniq_decisao_juridica_ativa` (0048:96, parcial `where revogada_em is null`) | **Já existe e o predicado bate** — desde que a query escreva `revogada_em is null` e não `not (revogada_em is not null)`. O planner não normaliza isso. |

Regra dura herdada do incidente de 19/08: `lower(btrim(x)) ≠ btrim(lower(x))`. Aqui não há
função sobre coluna em nenhum dos três caminhos — e **é por isso que o desenho não usa
`like 'sessao:%'`** para achar segmentos (que é o que `POST /api/sessoes/[id]/transcricao`
faz hoje em `:99`, aceitável porque roda uma vez por sessão, inaceitável num loop).

### 2.3 Frequência — quantas vezes por dia, e o intervalo corresponde ao ritmo do dado?

| Coisa | Frequência | O ritmo do dado justifica? |
|---|---|---|
| Webhook de transcrição (bot → nós) | ~180 por sessão | Sim: é o ritmo da fala. |
| **Chamada de IA** | **no máximo 1 a cada 45 s** + sob demanda por botão | A conversa **não muda de estado a cada 5 s**. Um bloco do roteiro dura minutos. Chamar a IA a cada turno de fala seria pagar por pergunta cuja resposta não mudou. |
| Polling da tela | 1 a cada 3 s | O advogado lê em segundos, não em milissegundos. 3 s é imperceptível e é muito mais barato que manter um canal aberto por 90 min atrás do proxy da Hostinger. |
| Persistência da transcrição consolidada | 1 por sessão, ao encerrar | Idempotente por sha256 — o caminho de 0032 já resolve. |

**O gatilho de IA não é temporal puro.** É `max(45 s desde a última, houve fala nova desde
então)` **ou** virada de bloco do roteiro **ou** botão "Me ajuda agora". Silêncio na sala
= zero chamada = zero custo. Um cron fixo de 45 s gastaria IA durante a pausa dramática da
PARTE 10 ("FICAR CALADO até que o cliente pergunte o preço") — que é justamente o momento
em que o método manda não falar.

### 2.4 Repetição — N telas pedindo o mesmo viram N queries?

Hoje, **sim, e é um problema que já existe**: `ConduzirSessaoApp` faz `buscarFicha360` +
`buscarRoteiroAtivo` + `buscarSims` + `listarOfertas` (4 chamadas) e `PainelBriefingSessao`
faz mais uma (`buscarBriefing`). São 5 requisições para montar uma tela.

O copiloto **não pode acrescentar uma 6ª por ciclo de polling**. Desenho:

- **Uma rota de polling só** — `GET /api/sessoes/[id]/copiloto?desde=<cursor>` devolve
  segmentos novos **e** sugestões novas **e** o estado do copiloto, num payload só.
- **Coalescência no servidor**: se duas abas do mesmo navegador estiverem abertas na mesma
  sessão (acontece: a Dra. Elaine abre a Ficha e o Conduzir), o polling é o mesmo GET
  idempotente e barato — mas o **gatilho de IA é claimado no banco** (`insert ... on
  conflict do nothing` numa linha de ciclo), então duas abas **nunca** disparam duas
  execuções de IA para o mesmo instante. É o mesmo padrão de claim atômica da Fase 9
  (`agente_whatsapp_respostas.unique`), que já provou funcionar.
- O briefing **não é re-buscado** no ciclo: entra uma vez, no início, e é reduzido a um
  bloco de contexto imutável (§4.3).

### 2.5 Reversão — como desligo sem deploy?

Cinco interruptores, do mais grosso ao mais fino, **todos `UPDATE`**:

1. `update configuracoes set valor='false' where chave='copiloto_sessao.ativo'` → tela some,
   webhook passa a responder 200 sem efeito, zero IA.
2. `update prompts_versoes set ativo=false where chave='copiloto_sessao'` → IA cala, a
   transcrição ao vivo continua (a tela vira "transcrição, sem sugestões").
3. `update decisoes_juridicas set revogada_em=now(), revogada_por=... where escopo='sessao.copiloto_ao_vivo'`
   → trava jurídica fecha; o banco recusa toda escrita de segmento e de sugestão.
4. `update configuracoes set valor='false' where chave='copiloto_sessao.audio_ao_vivo'` →
   desliga só o bot; o copiloto continua funcionando no modo digitado (fatia 1, §8).
5. Revogar o consentimento da pessoa → aquela sessão específica para, sem afetar as outras.

**Nenhum deles exige deploy, nenhum apaga dado, e o 3 é auditável** (quem revogou, quando,
por quê). Reversão que exige `git revert` não é reversão — é incidente.

---

## 3. Os dois caminhos de áudio, mais o terceiro — e a recomendação

### 3.1 Comparação

| | **(a) Microfone do navegador → STT streaming** | **(b) Áudio via n8n/provedor de sala** | **(c) Bot que entra na sala** |
|---|---|---|---|
| Como funciona | `getUserMedia` na aba do Conduzir → WebSocket para o STT → servidor | O provedor de sala expõe o áudio; n8n intermedeia | Bot entra na reunião como participante, grava, transcreve, entrega por webhook |
| `Permissions-Policy` | **Exige abrir `microphone=(self)`** na rota da sessão | Não mexe | **Não mexe** |
| Canal persistente | **Cria o 1º WebSocket do sistema** | Depende do provedor | **Nenhum** — webhook assinado, padrão já maduro |
| Latência da transcrição | sub-300 ms *(levantamento do coordenador, 11/09)* | A MEDIR (não há provedor escolhido) | sub-segundo *(idem)* |
| Custo / 90 min | ~US$ 0,69 | A MEDIR | ~US$ 0,98 |
| **Lista de participantes** | **Não** | Talvez, depende do provedor | **Sim, nominal, com diarização** |
| Diarização (quem falou) | Sim, mas **sem `speaker_confidence` no streaming** e só diarizador v1 | — | Sim |
| O que captura | **O áudio da SALA inteira pelo microfone do computador da advogada** — inclusive a voz do cliente saindo do alto-falante | Sim | Sim, como participante declarado |
| Visibilidade para o cliente | **Nenhuma** — o cliente não vê nada | Nenhuma | **Alta** — aparece um participante a mais na lista |
| Subprocessador novo | 1 (STT) | 1 (sala) + talvez STT | **1, mas mais pesado**: áudio + vídeo + identidade dos participantes |
| Depende de escolher Meet/Zoom | Não | **Sim** — e essa escolha está pendente desde a Fase 4 (`sala.provedor='manual'`) | Não (funciona nos três) |
| Estado do pré-requisito hoje | `Permissions-Policy` fechado | **`sala.provedor='manual'`; o workflow de sala do n8n NÃO EXISTE** (CONTINUAR-AQUI, Fase 4 item 5) | Conta nova a contratar |

### 3.2 Recomendação: **(c) o bot na sala**. (a) descartado, (b) inviável hoje

**(b) está fora por fato, não por preferência.** O caminho "áudio via n8n/provedor de sala"
pressupõe um provedor de sala integrado. Não existe: `sala.provedor='manual'`, o link é
colado à mão na Ficha, e o workflow n8n de sala nunca foi escrito porque **a escolha entre
Meet e Zoom nunca foi feita** (pendência aberta desde a Fase 4). Desenhar sobre (b) é
desenhar sobre uma decisão que ninguém tomou.

**(a) está fora por três motivos, nesta ordem de peso:**

1. **Abrir `microphone` é abrir para a origem inteira.** O `Permissions-Policy` é um header
   por resposta HTTP. Dá para emitir um header diferente só em `/sessoes/:path*` — o
   recorte mínimo existe e é possível. Ele só não é *grátis*: qualquer XSS ou dependência
   comprometida que execute naquela rota ganha microfone. E o benefício que se compra com
   esse risco é ser US$ 0,29 mais barato por sessão.
2. **O microfone captura o cliente sem que o cliente veja nada.** É a diferença jurídica
   inteira: em (c), o cliente **vê** um participante a mais na lista. Em (a), a captura é
   invisível. Consentimento informado com captura invisível é uma discussão que a Dra.
   Elaine não precisa ter.
3. **Diarização fraca ao vivo** (sem `speaker_confidence`) num caso de uso cuja pergunta
   central é *"quem está falando e quem não está na sala"*. Adivinhar o falante com
   confiança desconhecida, e depois usar isso para afirmar que um decisor não está
   presente, viola a regra da casa ("toda conclusão presa a evidência, com grau de
   confiança").

**(c) ganha porque entrega o dado que a feature precisa.** O pedido do João é
explicitamente sobre decisores. Sem lista de participantes, o copiloto só poderia
*inferir* ausência do texto ("...meu marido não pôde vir hoje") — inferência frágil que
falha exatamente quando a pessoa não menciona. Com (c), a ausência é **fato**: a lista de
participantes é dado, não hipótese. E o custo arquitetural é o menor dos três: é **mais um
webhook assinado**, num sistema que já tem quatro (`hotmart`, `chatwoot`, `n8n/sala`,
`n8n/ligacao`) com o mesmo desenho testado.

**O desenho não amarra fornecedor.** A Fase 10 define a **interface** de provedor de áudio,
no mesmo formato de `ProvedorSala` (`server/sala/tipos.ts`: `nome`, `configurado()`,
`faltam()`, `solicitar()`). O nome do fornecedor é configuração (`copiloto_sessao.provedor_audio`,
nasce `'nenhum'`) e contrato é B75 — nenhum fornecedor entra no código antes do DPA.

### 3.3 O que (c) muda no 1º SIM — e por que é BLOQUEIO, não decisão minha

O texto vigente do 1º SIM, congelado no roteiro v4 e gravado em `consentimentos` por
`registrar_sim_sessao`, diz:

> "Eu vou gravar esta sessão para que minha equipe possa analisar cada detalhe do seu
> caso depois, sem que eu precise te pedir para repetir nada."

Com o bot, **três coisas deixam de ser verdade sobre esse texto**:

1. Não é só "eu vou gravar" — **um terceiro grava**, com nome próprio, visível na sala.
2. Não é só "minha equipe analisa" — **uma IA analisa, ao vivo, durante a própria sessão**.
3. O áudio **sai da sala para um subprocessador novo**, e depois o texto sai para um
   segundo (Anthropic, via OpenRouter).

O mecanismo para consertar isso **já existe e é o certo**: o texto do 1º SIM vive dentro de
`roteiros_versoes.definicao`, na fala marcada `sim: 'sigilo_gravacao'`, e
`registrar_sim_sessao` lê **de lá**, nunca do chamador (0030). Ou seja: **publicar uma
versão v5 do roteiro com o texto ampliado é o caminho de produto inteiro** — Admin →
Método → Roteiros já tem "Ativar esta" (Fase 7), e as sessões antigas mantêm o texto que
foi realmente lido, porque cada linha de `consentimentos` guarda sua própria cópia.

Mas **qual é o texto** é decisão da Dra. Elaine, não minha. Ver **B66**.

---

## 4. O transporte e o ciclo do copiloto

### 4.1 Transporte servidor para a tela: **polling curto de 3 s**, com cursor

Avaliei os três contra a restrição 2 (zero streaming hoje) e contra o deploy Hostinger:

| Opção | Veredito |
|---|---|
| **SSE (`text/event-stream`)** | **Não.** Cria o primeiro request de vida longa do sistema em `next start` atrás do proxy da Hostinger, onde o timeout de proxy **não é nosso e não está documentado**. Um SSE que morre em 60 s e reconecta é pior que polling: parece funcionar e perde evento no meio. Para provar que funciona seria preciso medir em produção — e produção hoje não tem nem `OPENROUTER_API_KEY`. |
| **Supabase Realtime** | **Não, e é a opção que mais tenta.** O projeto já tem Supabase, então "não é canal novo" — **mas é**: zero uso hoje (`grep` confirma), o cliente do navegador usa a chave publicável, e ligar Realtime numa tabela que contém **transcrição literal de conversa patrimonial familiar** transforma a política do canal numa superfície de segurança nova, que ninguém neste projeto ainda exercitou. Fazer a estreia do Realtime justamente na tabela mais sensível do banco é a escolha errada de ordem. Fica registrado como **evolução natural depois da fatia 4**, se o polling doer. |
| **Polling curto (3 s), cursor incremental** | **Sim.** Zero infraestrutura nova, roda em `runtime` nodejs como as outras 130 rotas, funciona atrás de qualquer proxy, reversível por configuração (`copiloto_sessao.polling_ms`) e trivialmente testável sem áudio real. |

**Números do polling, para a trava do Fable:** 90 min ÷ 3 s = **1.800 requisições por
sessão**. Cada uma é `select ... where sessao_id=$1 and ordem > $2` sobre índice composto,
devolvendo quase sempre **zero linha** (fala nova chega a cada ~30 s). **Exigência de
entrega: `explain (analyze)` da query de polling colado, provando `Index Scan` e não
`Seq Scan`, mais o tempo real por chamada.** O plano não afirma "~1 ms" — isso se mede.

Mitigação de conforto: `polling_ms` sobe para 10 s quando a aba perde o foco
(`document.visibilityState`), e o polling para de todo quando a sessão é encerrada.


### 4.2 A entrada: webhook assinado — contrato MEDIDO do Recall.ai (11/09/2026)

> **Fornecedor contratado e API sondada.** O que segue não é documentação lida: é
> resposta real da API em 11/09/2026. Base `https://us-east-1.recall.ai/api/v1/`.
> Autenticação por header **`Authorization: Token <chave>`** — é `Token`, **não**
> `Bearer`. `GET /bot/` respondeu 200 em ~1 s. `POST /bot/` respondeu **201 na
> primeira tentativa**. A chave vive em `RECALL_API_KEY` e **não aparece neste
> documento nem no vault**.

**O corpo que o fornecedor aceitou**, e que vira o contrato de `pedirBot()`:

```json
{
  "meeting_url": "https://zoom.us/j/...",
  "bot_name": "Assistente - Escritorio Elaine Montenegro",
  "recording_config": {
    "transcript": { "provider": { "meeting_captions": {} } },
    "realtime_endpoints": [{
      "type": "webhook",
      "url": "https://.../api/webhooks/copiloto/transcricao",
      "events": ["transcript.data",
                 "participant_events.join",
                 "participant_events.leave"]
    }]
  }
}
```

**Os três eventos de que a feature precisa existem e foram aceitos.** Isso é o que
sustenta o §5: `participant_events.join` / `.leave` entregam a lista nominal da sala, e é
por isso que a camada 1 da adaptação do roteiro é **fato**, não inferência. Sem esses dois
eventos, o caso dos decisores seria adivinhação sobre o texto.

**Um webhook, três tipos de evento.** `POST /api/webhooks/copiloto/transcricao` recebe os
três e roteia por `type`:

| Evento | Vira | Tabela |
|---|---|---|
| `transcript.data` | segmento de fala | `sessoes_copiloto_segmentos` |
| `participant_events.join` | entrada na sala | `sessoes_copiloto.participantes` |
| `participant_events.leave` | saída da sala | `sessoes_copiloto.participantes` |

**Tipo desconhecido devolve 200 sem efeito** e vira pendência — o fornecedor pode
acrescentar evento novo sem nos avisar, e um 500 nosso faria o Recall reentregar em laço.

O restante do contrato de segurança é o do `api/webhooks/n8n/sala/route.ts`, que continua
sendo o melhor webhook da casa:

1. sem `COPILOTO_WEBHOOK_SECRET` → **503 fail-closed** (nunca aceita);
2. assinatura verificada em tempo constante, com janela de tempo;
3. Zod, limite de corpo, rate limit por IP;
4. **idempotente por (origem, id_evento)** via `reservarEventoWebhook` — reentrega devolve
   200 sem duplicar;
5. grava por RPC `service_role`, nunca INSERT direto da rota.

**Trava que não existe nos outros webhooks e precisa existir neste:** quem tiver o segredo
poderia injetar fala falsa em **qualquer** sessão. Por isso o vínculo **não** é um
`sessao_id` vindo no corpo, e sim o **`id` do bot** que o `POST /bot/` devolveu, guardado
em `sessoes_copiloto.gravacao_externa_id`. O corpo informa o id do bot; o servidor resolve
a sessão a partir dele. Id desconhecido devolve 200 sem efeito, mais pendência em
`vw_pendencias_sistema`.

**O que o webhook aceita:** texto. **Nunca `audio_url`.** Áudio bruto não entra neste
servidor — é contrato do schema, não convenção. O `recording_config` pede transcrição por
legenda da própria reunião (`meeting_captions`), então o texto já chega pronto.

#### 4.2.1 `retention` — o default do fornecedor é `forever`, e isso é defeito nosso se passar

🔴 **Achado da sonda, e é o que mais muda o desenho.** O `POST /bot/` devolveu
`"retention": {"type": "forever"}` **sem que ninguém tenha pedido**. É o default do
fornecedor. Por omissão, **áudio e vídeo de conversa patrimonial familiar ficam guardados
para sempre, fora do Brasil**.

**Requisito duro, não recomendação:** toda criação de bot **tem** de enviar `retention`
explicitamente. Três consequências, todas no aceite do BACK (§12):

1. `pedirBot()` **não aceita chamada sem `retention`** — parâmetro obrigatório na
   assinatura, não campo opcional com default nosso. Omitir tem de ser erro de tipo, não
   escolha de estilo.
2. **Teste de regressão obrigatório**: o corpo enviado ao fornecedor contém `retention`,
   com o valor de `copiloto_sessao.retencao_dias_audio`. Bot criado sem `retention` é
   **defeito**, e o teste é o que impede que volte.
3. Depois de criado, o bot é **conferido**: a resposta devolve o `retention` efetivo. Se
   voltar `forever`, o servidor **encerra o bot imediatamente** (`leave_call`), marca
   `sessoes_copiloto.estado='erro'` e abre pendência. Não se grava um segmento sequer sob
   retenção infinita.

Isto amarra o **B69** (que era "quantos dias?") e o **B19** (política de retenção, aberto
desde a Fase 7) a um fato novo: **não existe mais a opção de não decidir**. Antes, não
decidir significava "nada é apagado do nosso lado". Agora, não decidir significa
"o fornecedor guarda para sempre". Ver **B76**.

#### 4.2.2 Ciclo de vida medido — o que é erro e o que é estado esperado

| Observação da sonda | O que o código faz |
|---|---|
| Sala inexistente: `joining_call` → `fatal` (`meeting_not_found`) em **200 ms**, `recordings: 0`, **zero consumo** | Falha rápida e barata. O estado vira `sessoes_copiloto.estado='erro'` com o `sub_code` do fornecedor **na tela**, não um "erro ao iniciar" genérico. Link de sala errado é o defeito mais provável em produção, e a tela tem de dizer qual é |
| `POST /bot/<id>/leave_call/` devolve **400 `bot_command_error`** quando o bot já desligou | **400 aqui é estado esperado, não falha.** O encerramento é idempotente: `leave_call` é enviado, e `400 bot_command_error` é tratado como "já saiu" — **não** chama `registrarErro`. Sem isso a Fatia 4 enche `erros_servidor` de ruído e esconde o erro de verdade |
| `status_changes[]` traz `code`, `sub_code`, `created_at` | Persistido em `sessoes_copiloto`. É a linha do tempo do bot, e é o que responde ao **B74** ("o que a tela mostra quando o bot cai") com dado do fornecedor em vez de suposição nossa |
| `id` da resposta | Vira `gravacao_externa_id` — o vínculo do webhook (acima) |
| `recordings[]` | Guardado para o expurgo da Fatia 5 saber o que pedir para apagar |

**`automatic_leave` tem defaults generosos** — `waiting_room_timeout` 1200 s,
`noone_joined_timeout` 1200 s, `silence_detection` 3600 s. Vinte minutos de sala de espera
e uma hora de silêncio são **tempo cobrado**. O desenho envia valores próprios, derivados
de `copiloto_sessao.duracao_maxima_minutos`, em vez de aceitar os do fornecedor: o teto de
custo da §4.4 só vale se o bot também respeitar um teto.

**`bot_detection` — conferido, e o risco não é o que parecia.** A regra do fornecedor é:
*se **todos** os participantes restantes casarem a lista `matches`, começa um temporizador
e o bot sai*. Não é "vi um bot, saio". Duas leituras:

- **Risco baixo de sairmos por engano:** enquanto houver um humano na sala, a condição
  ("todos casam") é falsa e nada acontece. O nome do B72 conter "Assistente" **não** faz
  outro notetaker nos expulsar — cada bot decide sobre a própria saída.
- **Risco real, e é outro:** se a Dra. Elaine e o cliente saírem e ficarem só o nosso bot e
  outro notetaker, a condição pode se tornar verdadeira, e **isso é bom** (o bot sai em vez
  de gravar sala vazia). O que **não** pode acontecer é o nosso próprio nome ser o motivo
  de sairmos cedo numa sala onde ainda há gente.

**Decisão:** enviamos `bot_detection` com lista `matches` **explícita e nossa**, sem
depender do default do fornecedor, e o nome do nosso bot **não entra na lista**. O B72 fica
de pé como está — a palavra "Assistente" no nome é segura. **Exigência de aceite:** um
teste que prove que o corpo enviado traz `bot_detection.matches` explícito.


### 4.3 O ciclo — gatilho, contexto e saída

**Gatilho** (o primeiro que ocorrer, com claim atômica no banco):

1. **Tempo + fala nova:** passaram-se 45 s ou mais (`copiloto_sessao.intervalo_segundos`)
   desde a última execução **e** entrou pelo menos 1 segmento novo desde então.
2. **Virada de bloco:** a Dra. Elaine avança ou volta no roteiro (é ato dela, sinal forte
   de que a conversa mudou de assunto) — com piso de 15 s anti-martelada.
3. **Sob demanda:** botão "Me ajuda agora". Ignora o intervalo, **não** ignora o teto
   (§4.4), e é o único que pode disparar durante silêncio.

Nunca por turno de fala. Nunca por cron fixo. Silêncio = zero chamada.

**Passo 0 — o gate jurídico, ANTES de montar contexto.** A rota confere, nesta ordem e
antes de tocar em qualquer fala do cliente:

1. `copiloto_sessao.ativo` · 2. prompt `copiloto_sessao` ativo e dentro do orçamento ·
3. **decisão jurídica ativa** (`sessao.copiloto_ao_vivo`) · 4. **consentimento do titular**
(`copiloto_sessao_ao_vivo`).

Faltando qualquer uma → **409 `copiloto_ao_vivo_bloqueado`, sem montar contexto, sem gastar
token, sem que uma sílaba do cliente saia daqui**. As duas consultas (3 e 4) são baratas e
indexadas: `uniq_decisao_juridica_ativa` (parcial, 0048:96) e o índice de `consentimentos`
por `(pessoa_id, tipo)`.

**Por que isto é o passo 0 e não o último:** consentimento é **por titular**, enquanto
configuração e prompt são **globais**. Sem o passo 0, todo cliente **novo** — que ainda não
consentiu — teria a fala enviada ao subprocessador no primeiro clique, pagaria a execução,
e só então receberia o 409. A trava que existe para proteger aquela pessoa dispararia
**depois** do vazamento. Ver §6.2.1 e §7.

**Contexto que entra** (montado no servidor, nunca no cliente):

| | Conteúdo | Tamanho | Por quê |
|---|---|---|---|
| A | **Bloco atual do roteiro** (título, objetivo, ação, falas, observar, proibido) mais os títulos dos blocos anterior e seguinte | ~1-2 KB | É o método. Sem isso a IA improvisa. |
| B | **Recorte do briefing**: DISC, objeção provável, linguagem recomendada — o mesmo recorte que `PainelBriefingSessao` já mostra | ~1 KB | Já é o que a advogada tem na coluna direita. |
| C | **Estado factual**: SIMs registrados, blocos já percorridos, campos do roteiro ainda sem resposta, **contagem de decisores esperados contra presentes** | ~0,5 KB | É o que "o que ainda falta" significa. |
| D | **Janela deslizante**: os últimos ~90 s de transcrição, literal | ~1,5 KB | O que acabou de ser dito. |
| E | **Resumo estruturado acumulado**: jsonb pequeno, reescrito a cada ciclo (bens citados, preocupações, objeções ouvidas) — **não** a transcrição inteira | máx. 2 KB, **teto por CHECK** | É o que torna o custo O(1) por chamada em vez de O(duração ao quadrado). |

Total por chamada: **~6 KB de entrada**, constante do minuto 1 ao minuto 90.

**Saída — schema estrito, no máximo 3,9 KB compilado** (teto medido em 04/09: 3.905 B
compila, 4.428 não). Cinco campos, um único enum curto:

- `proxima_pergunta`: objeto com `texto` (240), `motivo` (200), `evidencia` (200), ou nulo
- `falta_no_bloco`: lista de no máximo 4 objetos com `item` (120) e `evidencia` (160)
- `observacao`: objeto com `tipo` (fato | hipotese | inferencia | recomendacao), `texto`
  (240), `evidencia` (200) e `confianca` (número), ou nulo
- `desvio_sugerido`: objeto com `bloco_id`, `motivo` (240) e `confianca`, ou nulo
- `confianca_geral`: número

`tipo` é o único enum e tem 4 valores curtos — é ele que materializa a regra da casa
(fato · hipótese · inferência · recomendação, sempre com confiança) **dentro do schema**,
não numa recomendação de prompt que o modelo pode ignorar. Todo campo de texto tem teto de
comprimento declarado.

Regras que ficam no **texto do prompt**, não no schema (alternação de enum estoura a
gramática): `bloco_id` só pode ser id de bloco **do roteiro ativo**; `evidencia` tem de ser
**citação literal** de D ou item de C; sem evidência, o campo **volta nulo** — nunca texto
plausível; nunca citar valor em reais; nunca redigir fala pronta para a advogada ler no ar
como se fosse dela (o método é dela, as falas estão no roteiro).

**Validação no servidor, depois do Zod** — a IA propõe, o servidor confere:

- `bloco_id` que não existe no roteiro ativo: sugestão **descartada**, não corrigida;
- `evidencia` que não casa por substring com a janela D nem com C: o campo vira nulo e a
  execução fica marcada `evidencia_nao_conferida`. **Piso de 12 caracteres** na citação:
  substring curta ("de", "sim", "não") casa com qualquer fonte e transformaria em "citação
  literal" o que é invenção do modelo. Evidência abaixo do piso **não é conferível** e cai
  na mesma regra do não-casamento — vira nulo, nunca vai à tela (achado adversarial do
  Fable na Fatia 2; sem o piso, a conferência de evidência é decorativa);
- confiança abaixo de `copiloto_sessao.confianca_minima` (0,6): **não aparece na tela**,
  vira linha no histórico com o motivo;
- guarda de termo proibido na **saída** (preço, alíquota, valor em reais) — igual à do
  agente de WhatsApp (B61).

É a aplicação literal de "a IA ordena, não escolhe": ela aponta para blocos que já existem
e escreve o porquê; quem valida o apontamento é o servidor, contra o roteiro.

**Modelo e effort:** `anthropic/claude-sonnet-5`, **effort `low`**. `low` já é o padrão
promovido por bancada (04/09: `high` US$ 0,124 · `medium` US$ 0,055 · `low` US$ 0,040) e
aqui a tarefa é **selecionar e justificar**, não redigir documento — é o caso em que `low`
é o certo, não o barato. Opus fica fora: a latência de Opus numa reunião ao vivo é o oposto
do requisito. **Trocar de modelo continua sendo B23** — não é este plano que decide.

**Latência:** `IA_TIMEOUT_MS` global é 300 s e isso é veneno aqui. O copiloto usa **timeout
próprio de 8 s**. Estourou: **nada aparece**, a execução fica `falhou` com
`erro=timeout_copiloto`, e a tela mostra o estado real ("sugestão não chegou a tempo"),
nunca uma sugestão velha disfarçada de nova. **Exigência de entrega: p50 e p95 medidos na
bancada, colados.** Se o p95 passar de 8 s com `low`, a feature não sobe — não se compensa
latência aumentando o timeout numa reunião ao vivo.

### 4.4 Os tetos (orçamento próprio, como na Fase 9)

`verificar_cooldown_ia` **não entra neste caminho** — pelo mesmo motivo da Fase 9 (C3 de
lá): o cooldown é de 600 s **por jornada**, o que calaria o copiloto na segunda sugestão.
Orçamento próprio, contado em `execucoes_ia` pelo `prompt_versao_id` do copiloto:

| Chave | Valor inicial | Efeito ao estourar |
|---|---|---|
| `copiloto_sessao.intervalo_segundos` | 45 | não dispara |
| `copiloto_sessao.teto_ia_sessao` | **30** | copiloto vira só-transcrição, com aviso na tela |
| `copiloto_sessao.teto_ia_dia` | 150 | idem, global |
| `copiloto_sessao.duracao_maxima_minutos` | **150** | encerra sozinho (sessão esquecida aberta não sangra dinheiro) |
| `copiloto_sessao.confianca_minima` | 0,6 | sugestão não aparece |

90 min ÷ 45 s = 120 janelas possíveis; 30 é o teto real, porque só dispara com fala nova e
a maior parte da SV é o cliente falando longamente enquanto a advogada ouve.

### 4.5 Custo por sessão de 90 minutos

| Item | Cálculo | Valor |
|---|---|---|
| Bot na sala (gravação mais transcrição) | 1,5 h × (US$ 0,50 + US$ 0,15) *(levantamento do coordenador, 11/09)* | **US$ 0,98** |
| IA do copiloto | até 30 chamadas × ~6 KB de entrada mais ~400 tokens de saída, Sonnet `low` | **A MEDIR na bancada.** Ordem de grandeza esperada: US$ 0,15 a 0,40 — **não colar este número em lugar nenhum antes de medir** |
| Storage do áudio depois de 7 dias | US$ 0,05/h | **US$ 0,00 se a retenção for de até 7 dias** (B69) |
| **Total esperado** | | **cerca de US$ 1,2 a 1,4 (~R$ 7) por sessão** |

Contra R$ 7.200 do croqui, é ruído. **O número que importa não é esse: é o teto.** Sem os
tetos de §4.4, uma sessão esquecida aberta durante a madrugada geraria chamadas até o fim
dos tempos. O teto é o produto; o custo unitário é detalhe.

---

## 5. A adaptação do roteiro — o caso dos decisores, sem a IA virar dona do método

O pedido do João: *se a transcrição revelar que nem todos os decisores estão presentes, o
copiloto adapta o roteiro para que a sessão conclua as tarefas possíveis.*

**O que o copiloto NÃO faz:** não edita `roteiros_versoes`, não cria bloco, não reordena o
roteiro no banco, não pula bloco sozinho, não marca o 3º SIM, não escreve fala nova. O
roteiro é dado versionado e continua sendo. Publicar versão é ato de admin, por RPC
(`publicar_roteiro_versao`, 0081), com autoria.

**O que o copiloto faz, em três camadas — e só a 3ª envolve IA:**

**Camada 1 — fato, sem IA nenhuma.** A lista de participantes vem dos eventos
`participant_events.join` e `participant_events.leave` do Recall.ai — **aceitos pela API na
sonda de 11/09** (§4.2), não supostos. O briefing já entrega `processo_decisorio.decisores`
(nomes — confirmado no schema do prompt 0009). O servidor compara os dois conjuntos por
casamento de nome normalizado, e **ambíguo não casa** (mesma postura do porteiro da Fase
9). Produz um fato:

> *O briefing esperava 2 decisores: Terezinha e Cleison. Na sala: Terezinha. Cleison não
> entrou.*

Isso aparece na tela como **fato**, com a fonte de cada lado, sem uma única chamada de IA.
É informação que o sistema hoje simplesmente não tem.

**Camada 2 — o efeito no roteiro, derivado de dado, não de IA.** O roteiro já carrega, por
bloco, `objetivo`, `campos[]` e `proibido[]`. Um bloco cujo desfecho depende de decisão
conjunta (a PARTE 12, "Finalização Binária", e a PARTE 11, preço) é marcado no **próprio
roteiro** com um atributo novo e opcional, `exige_decisores: true` — dado, versionado,
editável em Admin, não código. Faltando decisor, a tela mostra, ao lado da barra de
progresso: *"Este bloco espera todos os decisores. Cleison não está na sala."* Nenhuma IA
participou disso.

> Nota de compatibilidade: `exige_decisores` é **campo opcional** em `RoteiroBloco`. A v4
> ativa não o tem, e a tela tem de funcionar igual sem ele — ausente é ausente, nunca
> `false` inventado. Quem marca os blocos é a Dra. Elaine, publicando uma versão nova.

**Camada 3 — a sugestão de desvio, aí sim com IA.** O campo `desvio_sugerido` aponta para
um `bloco_id` **que já existe no roteiro ativo**, com motivo e confiança. A tela renderiza
como sugestão com botão, nunca como ação executada:

> **Sugestão (confiança 0,72)** — Ir para a PARTE 03 (Radiografia) e adiar a PARTE 11.
> *Motivo:* o 3º SIM não foi confirmado e a lista da sala não tem Cleison, apontado no
> briefing como decisor conjunto. A radiografia patrimonial não depende dele; a oferta
> depende. *Evidência:* "meu filho não conseguiu entrar hoje, ele viaja amanhã".
> [ Ir para a PARTE 03 ]  [ Ignorar ]

Se a Dra. Elaine clica, é **ela** navegando — a mesma função `irPara()` que as setas do
teclado já chamam (`ConduzirSessaoApp.tsx:135`). Nada muda no banco além do registro de
que a sugestão foi aceita — que é o dado que, daqui a 20 sessões, dirá se o copiloto acerta.

**Esse registro é entrega da Fatia 2, não intenção.** `copiloto_sugestoes.desfecho` e
`desfecho_em` existem desde a 0091 e os dois botões existem na tela; sem uma rota que grave
`aceita`/`ignorada`, as colunas ficariam permanentemente nulas e a frase acima seria uma
promessa que o sistema não cumpre — exatamente o tipo de "dado plausível que não existe"
que o `CLAUDE.md` proíbe. A rota de desfecho entra na Fatia 2 (§8), com `desfecho` imutável
depois de gravado (registrar duas vezes não sobrescreve o primeiro juízo).

**Por que assim e não "o copiloto reordena":** um roteiro reordenado pela IA seria um
roteiro que a Dra. Elaine não carimbou. O B15 (*qual das 4 versões é a oficial*) está
aberto há 5 fases justamente porque **carimbar método é ato dela**. Um copiloto que
reescreve o método enquanto o método ainda não foi oficializado é a definição de pôr o
carro na frente dos bois.

---

## 6. Modelo de dados

### 6.1 Relação com `transcricoes`: é outro artefato, que vira aquele

A pergunta do brief é boa e a resposta tem de ser precisa, porque as duas coisas têm ciclos
de vida diferentes:

| | `sessoes_copiloto_segmentos` (novo) | `transcricoes` (0032, existe) |
|---|---|---|
| O que é | Fala bruta, fatiada, chegando ao vivo, corrigível pelo STT | **Documento consolidado e imutável**, `sha256 unique` |
| Ciclo de vida | Existe durante a sessão; **expurgável** (B69) | Permanente; alimenta o Agente do Croqui e a Base de Conhecimento |
| Granularidade | ~180 linhas por sessão | 1 linha por sessão |
| RLS | `app.ve_patrimonio()` | `app.ve_patrimonio()` (já é) |

**Ao encerrar a sessão**, o servidor concatena os segmentos em ordem, monta o texto e chama
**o caminho que já existe**: insert em `transcricoes` com `tipo=sessao_viabilidade`,
`arquivo_origem=sessao:<id>:v<n>`, `sha256`. A idempotência de
`inserirTranscricaoComRetentativa` funciona igual. Daí em diante **não há nada novo**: é a
mesma transcrição que o Agente do Croqui já sabe ler.

**É aqui que a feature limpa em vez de empilhar.** Hoje aquele caminho existe e ninguém o
usa, porque exige alguém colar 90 minutos de texto à mão. A Fase 10 dá um produtor real a
um consumidor que já estava escrito e ocioso.

### 6.2 As migrations (rascunho comentado — o backend transforma em arquivo)

Última aplicada: **0090**. As novas são **0091, 0092, 0093** — 100% aditivas; nenhuma
tabela existente é alterada, exceto o CHECK de escopo da 0048 (ampliação) e a view de
pendências, que se refaz a partir de `pg_get_viewdef` do **banco**, nunca do repo
(armadilha catalogada na Fase 9).
```sql
-- 0091_copiloto_sessao.sql  (RASCUNHO)

-- Uma linha por sessão conduzida com o copiloto. É o vínculo com o bot e onde
-- mora o resumo acumulado (E do §4.3) — jsonb com TETO checado por CHECK, para
-- o contexto não crescer sem limite.
create table sessoes_copiloto (
  sessao_id            uuid primary key references sessoes_viabilidade(id) on delete cascade,
  estado               text not null default 'aguardando'
                         check (estado in ('aguardando','ativo','encerrado','erro')),
  -- id opaco que NOS geramos ao pedir o bot; o webhook resolve a sessão por ele
  -- (§4.2) — nunca confiamos no sessao_id que vem no corpo.
  gravacao_externa_id  text unique,
  provedor             text,          -- nome do subprocessador, para auditoria
  iniciado_em          timestamptz,
  encerrado_em         timestamptz,
  -- Participantes como o provedor entregou. PII (nome de pessoa da família).
  participantes        jsonb not null default '[]'::jsonb,
  -- Resumo estruturado acumulado (E). Teto duro: contexto O(1).
  resumo_acumulado     jsonb not null default '{}'::jsonb
                         check (pg_column_size(resumo_acumulado) <= 4096),
  transcricao_id       uuid references transcricoes(id),   -- preenchido ao consolidar
  criado_em            timestamptz not null default now()
);

create table sessoes_copiloto_segmentos (
  id                uuid primary key default gen_random_uuid(),
  sessao_id         uuid not null references sessoes_viabilidade(id) on delete cascade,
  -- int, NAO timestamp: dois segmentos no mesmo segundo não podem trocar de
  -- lugar na tela (§2.2).
  ordem             int not null,
  falante           text,              -- rótulo do provedor; NULL sem diarização
  falante_confianca numeric(3,2),      -- NULL = provedor não informou. NULL é NULL, não 1.0
  texto             text not null,
  iniciado_ms       int,
  origem            text not null default 'bot' check (origem in ('bot','manual')),
  criado_em         timestamptz not null default now(),
  unique (sessao_id, ordem)            -- idempotência de reentrega do webhook
);
-- Índice do caminho quente do polling. A query DEVE ser, caractere a caractere:
--   where sessao_id = $1 and ordem > $2 order by ordem
-- explain (analyze) colado na entrega.
create index idx_copiloto_segmentos_polling on sessoes_copiloto_segmentos (sessao_id, ordem);

create table copiloto_sugestoes (
  id             uuid primary key default gen_random_uuid(),
  sessao_id      uuid not null references sessoes_viabilidade(id) on delete cascade,
  -- cursor monotônico do polling: uuid não ordena (§2.2).
  ordem_evento   bigint generated always as identity,
  bloco_id       text,               -- id de bloco DO ROTEIRO ATIVO, validado no servidor
  gatilho        text not null check (gatilho in ('intervalo','virada_bloco','sob_demanda')),
  conteudo       jsonb not null,     -- a saída já validada (§4.3)
  confianca      numeric(3,2),
  execucao_ia_id uuid references execucoes_ia(id),
  -- o que a advogada fez com a sugestão — é o dado que mede se o copiloto presta
  desfecho       text check (desfecho in ('aceita','ignorada','expirada')),
  desfecho_em    timestamptz,
  criado_em      timestamptz not null default now()
);
create index idx_copiloto_sugestoes_polling on copiloto_sugestoes (sessao_id, ordem_evento);

-- Claim atômica do ciclo de IA: duas abas abertas na mesma sessão NUNCA disparam
-- duas execuções para a mesma janela. Mesmo padrão que provou funcionar em
-- agente_whatsapp_respostas (Fase 9).
create table copiloto_ciclos (
  sessao_id  uuid not null references sessoes_viabilidade(id) on delete cascade,
  janela     int  not null,   -- floor(segundos_desde_inicio / intervalo_segundos)
  criado_em  timestamptz not null default now(),
  primary key (sessao_id, janela)
);

-- RLS nas quatro: SELECT para app.ve_patrimonio() — é transcrição de conversa
-- patrimonial, mesmo recorte de `transcricoes` (0032), e NAO o eh_interno() mais
-- largo. Escrita: service_role apenas (quem escreve é o webhook e o ciclo).
-- revoke all ... from public, anon, authenticated; grants nomeados.

insert into configuracoes (chave, valor, descricao) values
 ('copiloto_sessao.ativo',                   'false'::jsonb,     '...'),
 ('copiloto_sessao.audio_ao_vivo',           'false'::jsonb,     '...'),
 ('copiloto_sessao.provedor_audio',          '"nenhum"'::jsonb,  '...'),
 ('copiloto_sessao.intervalo_segundos',      '45'::jsonb,        '...'),
 ('copiloto_sessao.polling_ms',              '3000'::jsonb,      '...'),
 ('copiloto_sessao.teto_ia_sessao',          '30'::jsonb,        '...'),
 ('copiloto_sessao.teto_ia_dia',             '150'::jsonb,       '...'),
 ('copiloto_sessao.duracao_maxima_minutos',  '150'::jsonb,       '...'),
 ('copiloto_sessao.confianca_minima',        '0.6'::jsonb,       '...'),
 ('copiloto_sessao.retencao_dias_segmentos', '7'::jsonb,         '...')   -- B69
on conflict (chave) do nothing;

-- ROLLBACK: drop das 4 tabelas + delete from configuracoes where chave like
--           'copiloto_sessao.%'. Nenhuma tabela existente é tocada.
```

```sql
-- 0092_copiloto_travas_juridicas.sql  (RASCUNHO — a migration MAIS IMPORTANTE)

-- (a) CONFLITO C1: decisoes_juridicas.escopo tem CHECK de lista FECHADA
--     (0048:50-51). Registrar a decisão do copiloto NAO é um INSERT — exige
--     migration, por desenho. Amplia a lista:
alter table decisoes_juridicas drop constraint decisoes_juridicas_escopo_check;
alter table decisoes_juridicas add  constraint decisoes_juridicas_escopo_check
  check (escopo in ('conhecimento.analise_ia_transcricoes',
                    'sessao.copiloto_ao_vivo'));
--     NAO insere nenhuma decisão. A decisão de mérito é da Dra. Elaine, pela rota
--     que já existe (POST /api/admin/decisoes-juridicas). Esta migration é
--     estrutura, igual à 0048 — que também não decidiu nada.

-- (b) CONFLITO C2 — a trava que FALTA. app.exige_flag_analise_ia_habilitada
--     protege SO analises_transcricao. O copiloto escreve em outras tabelas e
--     não herdaria trava nenhuma — que é exatamente a lição do pentest ("a trava
--     é por CAMINHO DE SAIDA DE DADO, não por feature"; a 2a IA não herdou a
--     trava da 1a e vazou). Função própria, mesmo formato da 0048:
create or replace function app.exige_decisao_copiloto_ao_vivo() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_ok boolean; v_pessoa uuid;
begin
  select exists (select 1 from decisoes_juridicas
                  where escopo = 'sessao.copiloto_ao_vivo'
                    and revogada_em is null)
    into v_ok;
  if not coalesce(v_ok, false) then
    raise exception 'copiloto_ao_vivo_bloqueado: sem decisao juridica ativa (escopo sessao.copiloto_ao_vivo)'
      using errcode = 'check_violation';
  end if;

  -- 2a trava, INDEPENDENTE: consentimento do TITULAR, tipo NOVO.
  -- NAO reaproveita tratamento_ia (é consentimento de PREPARACAO da SV) nem
  -- gravacao_sessao (autoriza GRAVAR, não transmitir a fala a terceiro ao vivo —
  -- a NOTA da 0030 é explícita: são tipos DIFERENTES, cada um com sua vigência).
  select j.pessoa_id into v_pessoa
    from sessoes_viabilidade s
    join jornadas j on j.id = s.jornada_id
   where s.id = new.sessao_id;
  if not app.tem_consentimento(v_pessoa, 'copiloto_sessao_ao_vivo') then
    raise exception 'copiloto_ao_vivo_bloqueado: titular sem consentimento copiloto_sessao_ao_vivo'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

-- Onde a trigger vai, e por que NAO vai em toda tabela (achado do Fable na
-- trava da Fatia 1 — ver §6.2.1 logo abaixo, que é a decisão por extenso):
--
--   `copiloto_sugestoes`  → SIM. É o caminho de saída de dado: nenhuma linha
--                           aqui existe sem que a fala do cliente tenha ido a
--                           um subprocessador. É a trava que importa.
--   `sessoes_copiloto`    → SIM, mas só para `gravacao_externa_id` (é o ato de
--                           pedir o bot; ver o `when` abaixo). Criar a linha da
--                           sessão no modo manual não toca subprocessador nenhum.
--   `..._segmentos`       → **NAO, incondicionalmente.** Trava só o que vem de
--                           fora (`origem='bot'`), pelo `when` — senão a trigger
--                           mataria o campo de digitar da Fatia 1.
create trigger trg_copiloto_exige_decisao_sugestoes
  before insert on copiloto_sugestoes
  for each row execute function app.exige_decisao_copiloto_ao_vivo();

-- Segmento vindo do BOT é entrada de dado de um subprocessador: exige as duas
-- travas. Segmento DIGITADO pela advogada é a advogada escrevendo no sistema
-- dela, sob RLS e `ve_patrimonio()` — mesma posição, textual, de
-- `POST /api/sessoes/[id]/transcricao`: "PERSISTIR não exige consentimento (é
-- dado do escritório, em banco do escritório, sob RLS); só ANALISAR exige".
create trigger trg_copiloto_exige_decisao_segmentos_bot
  before insert on sessoes_copiloto_segmentos
  for each row when (new.origem = 'bot')
  execute function app.exige_decisao_copiloto_ao_vivo();

-- Pedir o bot é o instante em que a sala passa a ser gravada por terceiro.
create trigger trg_copiloto_exige_decisao_bot_pedido
  before insert or update of gravacao_externa_id on sessoes_copiloto
  for each row when (new.gravacao_externa_id is not null)
  execute function app.exige_decisao_copiloto_ao_vivo();

-- (c) O tipo de consentimento novo entra em configuracoes['consentimento.textos'],
--     mas o TEXTO é B67 (decisão da Dra. Elaine). Esta migration cria a chave com
--     texto vazio; app.tem_consentimento devolve false enquanto ninguém conceder.
--     Fail-closed por AUSENCIA de dado, não por flag que alguém possa virar.

-- ROLLBACK: drop das 3 triggers, drop function, restaurar o CHECK original.
```

```sql
-- 0093_prompt_copiloto.sql  (RASCUNHO)
insert into prompts_versoes (chave, versao, titulo, corpo_sistema, modelo_padrao, effort, ativo)
values ('copiloto_sessao', 1, '...', '...', 'anthropic/claude-sonnet-5', 'low', false);
-- ativo=false ao nascer. Ativar só depois de POST /api/admin/sonda-schema (o
-- schema do §4.3 tem de compilar: teto medido 3.905 B) e da bancada de custo E
-- LATENCIA (p50/p95).
-- ROLLBACK: delete from prompts_versoes where chave = 'copiloto_sessao';
```

#### 6.2.1 Por que a trigger dos segmentos tem `when (new.origem = 'bot')`

**O achado (Fable, trava da Fatia 1).** A 0092, como estava rascunhada, punha a trigger
`before insert` em `sessoes_copiloto_segmentos` **sem condição**. Mas essa é a mesma tabela
onde a Fatia 1 grava o segmento `origem='manual'` — o campo de digitar e colar que existe
justamente para testar o pipeline sem bot. No dia em que a 0092 entrasse, **o campo manual
pararia de funcionar** e só voltaria quando a Dra. Elaine respondesse B65 e B67. A Fatia 2
entraria derrubando uma capacidade que a Fatia 1 entregou e que já estaria em uso.

**A decisão: a trava fica no caminho de saída de dado, e o `when` diz qual é.** Não é uma
exceção aberta no gate — é o gate apontando para o lugar certo.

O princípio do §7 é literal: *trava de LGPD é por caminho de saída de dado, não por
feature*. Aplicado com honestidade, ele obriga a perguntar, para cada INSERT, **que dado
sai para quem**:

| INSERT | O dado sai do escritório? | Trava |
|---|---|---|
| `copiloto_sugestoes` | **Sim, sempre.** Nenhuma linha existe aqui sem que a fala tenha ido ao modelo | **Trava incondicional** |
| `..._segmentos` com `origem='bot'` | **Sim.** O texto veio de um subprocessador que gravou a sala | **Trava pelo `when`** |
| `sessoes_copiloto.gravacao_externa_id` | **Sim.** É o ato de colocar um terceiro para gravar | **Trava pelo `when`** |
| `..._segmentos` com `origem='manual'` | **Não.** É a advogada digitando no sistema dela | **Sem trava** |

A quarta linha é a mesma posição que o sistema **já tomou por escrito**, em produção, em
`POST /api/sessoes/[id]/transcricao`: *"Diferente da Análise (que exige
`tem_consentimento(pessoa,'tratamento_ia')`), PERSISTIR não exige consentimento: é dado do
escritório, em banco do escritório, sob RLS. Só ANALISAR exige."* Se digitar um trecho no
copiloto exigisse consentimento, mas colar a transcrição inteira da sessão na rota ao lado
não exigisse, o sistema teria **duas éticas para o mesmo ato** — e a mais rígida delas
recairia sobre a ferramenta menor. Isso não é rigor; é incoerência com cara de rigor.

**Por que isto não é a opção 1 ("a trigger distingue `origem`") com outro nome.** A
objeção à opção 1 é boa e foi ela que definiu o desenho: *o texto manual vira entrada de IA
na Fatia 2 pelo mesmo caminho*. Verdade — e é por isso que o gate de análise existe. Mas
**onde** ele fica é a correção abaixo: não basta travar a linha de `copiloto_sugestoes`.
Digitar é livre; **analisar o que foi digitado continua exigindo as duas travas** — só que
conferidas **antes do envio**, não no INSERT. A opção 1 sozinha deixaria o furo; a 1
combinada com a 2, **aplicada no ponto certo do caminho**, fecha.

#### 6.2.2 🔴 Errata — o caminho de saída de dado é a CHAMADA, não o INSERT

**O que este plano escreveu errado.** O §6.2.1, na primeira versão, afirmava que a linha em
`copiloto_sugestoes` "é travada incondicionalmente" e concluía dali que analisar estava
protegido. A trigger existe e é incondicional — mas ela trava a **persistência**, e a
persistência acontece **depois** do envio. O backend seguiu o plano à risca, e o resultado
medido foi:

```
montarContextoCopiloto()   <- janela D: fala literal do cliente
executarIaCopiloto()       <- ENVIO HTTP AO PROVEDOR: o dado sai AQUI
insert copiloto_sugestoes  <- so aqui a trigger confere decisao + consentimento
```

Quando a trigger dispara, a fala do cliente já está na Anthropic há duas etapas. O 409 que
o cliente recebe é a confirmação de que o dado saiu, não a prevenção de que saísse.

**A ironia, registrada de propósito para quem ler isto depois:** o erro foi cometido
**dentro do plano que estabelece, no §7, que "trava de LGPD é por caminho de saída de dado,
não por feature"**, e que cita o pentest da Fase 3 exatamente sobre isso. O §6.2.1 confundiu
**persistir** com **enviar**. É o mesmo erro conceitual da Fase 3, em roupa nova — o que
prova que enunciar o princípio não protege ninguém; aplicá-lo no ponto certo, sim.

**A correção, em uma frase:** o caminho de saída de dado é a **chamada ao provedor**. Logo:

| Onde | O que confere | Papel |
|---|---|---|
| **Rota, antes de `montarContextoCopiloto()`** | config · prompt/orçamento · **decisão jurídica** · **consentimento do titular** | **O gate.** 409 `copiloto_ao_vivo_bloqueado` sem gastar token e sem que a fala saia |
| Trigger em `copiloto_sugestoes` (0093) | as mesmas duas travas jurídicas | **Backstop.** Continua certa como última linha; errado era ser a **única** |

A trigger **não sai** — um gate só em aplicação é o que a Fase 3 já provou frágil. O que
muda é que ela deixa de ser o primeiro anteparo e passa a ser o último.

**Por que o defeito é grave no caminho principal, e não um caso de borda.** Consentimento é
**por titular**; configuração e prompt são **globais**. Com tudo ligado, todo cliente
**novo** cai no furo: no primeiro clique, a fala vai ao subprocessador, a execução é paga,
e o 409 chega depois. A trava que existe para proteger aquela pessoa dispara depois de já
não haver o que proteger. E revogar a decisão jurídica ou o consentimento **não cala o
envio** — só a gravação.

**O princípio geral, que vale para as próximas fatias:**

> **Trava de dado que só vale depois do envio não é trava, é registro.**

- **Fatia 3 (ciclo automático):** o gate do §4.3 passo 0 roda a cada ciclo, não só no
  primeiro. Sessão que perde o consentimento no meio (revogação) para de chamar a IA no
  ciclo seguinte, não ao tentar gravar.
- **Fatia 4 (bot):** é onde isto mais importa, porque o áudio **sai da sala antes de
  qualquer INSERT nosso**. Por isso o gate da 0093 inclui `sessoes_copiloto.gravacao_externa_id`
  (§6.2): o ato de **pedir** o bot é o caminho de saída, e é ele que tem de ser conferido —
  não o primeiro segmento que voltar do webhook.

**Aceite (BACK):** um teste que, com decisão e consentimento ausentes, prove **409 e zero
linha em `execucoes_ia`**. Contar execução é o que distingue "barrou antes" de "barrou
depois" — asserção sobre o código de status, sozinha, passaria nas duas versões.

**Por que não a opção 3 (aceitar que o manual morre).** Seria honesto, e por isso estava na
mesa. Mas custa uma capacidade real, em uso, por um ganho de segurança **igual a zero**: o
texto manual não sai para lugar nenhum. Desligar uma função que funciona, para não proteger
nada, é o oposto do critério de otimização.

**A garantia estrutural que torna o `when` confiável.** `origem` não é campo que a tela
escolhe: a policy de RLS da 0091 já força `with check (... and origem = 'manual')` para
`authenticated`. Escrever `origem='bot'` é privilégio de `service_role`, isto é, do webhook.
Então o `when (new.origem = 'bot')` **não é uma promessa de aplicação** — é uma condição
sobre uma coluna que a própria RLS impede o navegador de forjar. Um atacante com sessão de
advogada não consegue marcar o próprio texto como `manual` para escapar do gate, porque
`manual` é o único valor que ele já podia escrever, e `manual` nunca sai do escritório.

**Consequência para o BACK, no aceite:** três testes. (a) com decisão e consentimento
ausentes, INSERT `origem='manual'` **passa**; (b) nas mesmas condições, INSERT
`origem='bot'` **é recusado pelo banco**; (c) nas mesmas condições, INSERT em
`copiloto_sugestoes` **é recusado pelo banco**. O (a) é o teste de regressão que impede
alguém de "endurecer" a trigger no futuro e matar a Fatia 1 de novo, sem entender por quê.

**Nenhum bloqueio novo para a Dra. Elaine.** Esta decisão não pergunta nada a ela: mantém o
que já vale para a transcrição, e não afrouxa nada que já estivesse travado. **B77 não
existe** — criar um bloqueio aqui seria empurrar para ela uma escolha que o sistema já fez,
de forma consistente, em outro lugar.

---

## 7. Fronteira de PII — o que sai, o que nunca sai, e onde o gate mora

**Onde o gate é aplicado — corrigido pela errata do §6.2.2.** Em **dois lugares, nesta
ordem**, e a ordem é o ponto inteiro:

1. **Na rota, antes de montar contexto e antes de chamar o provedor** — é aqui que o dado
   sairia. Confere config, prompt/orçamento, **decisão jurídica** e **consentimento do
   titular**; faltando qualquer uma, 409 sem gastar token e sem que uma sílaba saia.
2. **Na trigger de banco** (0093), como **backstop** — para que um agente futuro que
   escreva uma rota nova apontando para essas tabelas **bata na trava sem saber que ela
   existe**. Continua sendo a última linha; deixou de ser a única.

> **O erro que estava escrito aqui, mantido à vista de propósito.** A primeira versão dizia
> que o gate morava "nos **dois INSERTs**, por trigger de banco — não numa checagem de
> rota". Isso confunde **persistir** com **enviar**: a trigger dispara depois da chamada ao
> provedor. Enunciar "trava é por caminho de saída de dado" e então travar o INSERT é
> repetir o erro da Fase 3 com outro nome. **Trava de dado que só vale depois do envio não
> é trava, é registro.**

| Dado | Sai para a IA? | Onde é barrado |
|---|---|---|
| Janela de ~90 s de transcrição literal | **Sim** — é o insumo | **Gate da rota, antes de montar contexto** (§4.3 passo 0): sem decisão jurídica e sem consentimento, o contexto nem é montado e nada é enviado. A trigger é backstop, não o anteparo |
| Rótulo do falante | **Rótulo sim; nome próprio não** — o servidor troca nome por papel (`advogada`, `cliente`, `acompanhante_1`) antes de montar o contexto | `montarContextoCopiloto()`, um lugar só |
| Bloco do roteiro, objetivo, proibições | Sim | — (é conteúdo do método, não do cliente) |
| Recorte do briefing (DISC, objeção, linguagem) | Sim | Já é saída de IA sobre esta mesma família, sob `tratamento_ia` |
| **Nomes dos decisores do briefing** | **Não.** O contexto recebe "2 decisores esperados, 1 presente", jamais os nomes | `montarContextoCopiloto()` |
| **Valores de patrimônio, CPF, endereço, dados do IR** | **Nunca.** Não entram no contexto por construção — o copiloto não consulta `cenarios`, `croqui_calculos`, `documentos` nem `pessoas` além do primeiro nome | Não há caminho: essas tabelas não são consultadas |
| Preço do croqui (R$ 7.200 / R$ 4.500) | **Não entra e não pode sair** — guarda de termo na SAIDA, igual a B61 | Validador pós-Zod |
| Áudio bruto | **Nunca chega ao nosso servidor.** O bot transcreve; recebemos texto | Contrato do webhook (aceita `texto`, não `audio_url`) |
| `hash_entrada` em `execucoes_ia` | sha256, como sempre — **nunca o conteúdo** | `executarComAuditoria` já faz |

**O ponto que merece destaque no pentest:** se um dia a transcrição levar o valor do
patrimônio à IA porque *o cliente o falou em voz alta* — e ele vai falar, a PARTE 03 pede
exatamente isso —, esse valor **estará** na janela de 90 s. Isso é inevitável, e é
precisamente o que o consentimento novo (B67) tem de dizer com todas as letras. Não há
recorte técnico que evite; só consentimento informado.

**O terceiro que não é titular.** O cônjuge, o filho, o sócio que entra na sala têm nome
capturado em `participantes` e voz capturada na transcrição, e **não assinaram nada**. É a
pergunta mais desconfortável desta fase e está em B67. Hipótese conservadora aplicada:
`participantes` guarda o rótulo do provedor, e o contexto da IA nunca recebe nome de
terceiro — só contagem.

---

## 8. Plano de entrega em fatias publicáveis

Cada fatia é publicável sozinha, útil sozinha e reversível sozinha.

### Fatia 1 — Copiloto sem áudio (a menor coisa útil e testável)

**Publicável sem nenhum subprocessador novo, sem decisão jurídica, sem consentimento novo,
sem IA.**

- Migration 0091 (só as tabelas e as configurações), com `audio_ao_vivo=false`.
- Na tela do Conduzir, a coluna direita ganha uma aba ao lado do briefing: **Copiloto**,
  em modo **determinístico puro**:
  - *O que falta neste bloco* — derivado dos `campos[]` do roteiro ainda sem resposta e
    dos `observar[]`. **Zero IA.**
  - *SIMs pendentes* — derivado de `sessoes_viabilidade.sims` mais `consentimentos`.
  - *Blocos ainda não percorridos* — derivado do índice da tela.
  - Um campo para a Dra. Elaine **digitar ou colar** trechos durante a sessão, que viram
    segmentos (`origem='manual'`) — é assim que o pipeline inteiro é testado sem bot nenhum.
- **Já entrega valor**: hoje a tela mostra o bloco atual e nada sobre o que ficou para trás.
- Reversível por `copiloto_sessao.ativo=false`.

### Fatia 2 — A sugestão por IA, sob demanda, com a sessão digitada

- Migrations da Fatia 2 (ver numeração real abaixo). O botão **Me ajuda agora** aparece.
- **Numeração real, divergente do rascunho do §6.2** (registrado para o §6.2 não mentir):
  a Fatia 2 foi entregue como **0092** (só o valor novo do enum de consentimento),
  **0093** (as travas jurídicas — é a "0092" do rascunho) e **0094** (o prompt — é a
  "0093" do rascunho). Separar o enum foi decisão do BACK, correta: `alter type ... add
  value` não roda na mesma transação que o usa. Onde o §6.2 diz 0092/0093, leia 0093/0094.
- Prompt `ativo=false` → o botão diz "copiloto de IA não ativado". É assim que sobe.
- **Gate jurídico ANTES da chamada de IA** (§4.3 passo 0 / §6.2.2): decisão jurídica e
  consentimento do titular conferidos na rota, antes de montar contexto. Teste de aceite:
  com as duas ausentes, **409 e zero linha em `execucoes_ia`**. A trigger permanece como
  backstop. **Foi aqui que a primeira versão do plano errou** — a errata explica por quê.
- **Rota de desfecho da sugestão** (`aceita`/`ignorada`), gravando `desfecho`/`desfecho_em`
  de `copiloto_sugestoes`: as colunas existem desde a 0091 e os botões existem na tela, mas
  nada grava. É **entrega desta fatia**, não backlog — sem ela, a promessa do §5 ("o dado
  que dirá se o copiloto acerta") é uma coluna nula. `desfecho` é imutável depois de
  gravado.
- **Piso de 12 caracteres** na conferência de evidência (§4.3): substring curta casa com
  qualquer fonte e vira citação falsa na tela.
- Bancada: custo, latência p50/p95, e **prova de que `ativo=false` gera 0 execução**.
- Sonda de schema (`POST /api/admin/sonda-schema`) antes de ativar.
- **A Fatia 1 não pode regredir quando as travas entrarem.** A trigger da 0093 trava
  `copiloto_sugestoes` (incondicional) e o segmento **só quando `origem='bot'`** — o campo
  de digitar e colar continua funcionando sem B65/B67. A razão inteira está em **§6.2.1**,
  e o teste (a) daquela seção é o que impede que alguém "endureça" a trigger depois e mate
  a Fatia 1 sem entender por quê. **Digitar continua livre; analisar o que foi digitado
  exige as duas travas** — que é a fronteira que a Fatia 2 está justamente criando.
- Depende de: decisão jurídica registrada (B65) e 1 consentimento concedido (B67) —
  **para gerar sugestão**, não para a sessão manual continuar de pé.
- **Bloqueada por C11 enquanto `OPENROUTER_API_KEY` não voltar à Hostinger.**

### Fatia 3 — O ciclo automático mais o polling

- Gatilho por intervalo e por virada de bloco, claim atômica, polling de 3 s.
- `explain (analyze)` das duas queries de polling, colado.
- Consolidação em `transcricoes` ao encerrar — **é aqui que o Agente do Croqui ganha
  produtor real**.

### Fatia 4 — O bot na sala (Recall.ai, contrato medido em 11/09/2026)

O fornecedor está contratado e a API foi sondada (§4.2). Isto deixa de ser desenho sobre
suposição e vira integração contra contrato conhecido.

**4a — criar e encerrar o bot.**
- `src/server/copiloto/recall.ts`: `pedirBot()` e `encerrarBot()`, `fetch` cru com timeout
  explícito, no padrão de `server/regua/email.ts` (sem SDK novo).
  Header `Authorization: Token` — **não `Bearer`**; errar isto é 401 silencioso.
- `pedirBot()` **exige `retention` na assinatura** (§4.2.1). Sem `retention` não compila.
- **Conferência pós-criação:** se a resposta vier com `retention.type === 'forever'`,
  encerra o bot na hora, marca `estado='erro'` e abre pendência. Zero segmento gravado.
- `encerrarBot()` trata **400 `bot_command_error` como sucesso** ("já saiu") — nunca chama
  `registrarErro`. É estado esperado, medido na sonda.
- `automatic_leave` e `bot_detection` enviados com valores **nossos**, nunca os defaults do
  fornecedor (20 min de sala de espera e 1 h de silêncio são tempo cobrado).
- `RECALL_API_KEY` e `COPILOTO_WEBHOOK_SECRET` entram em `server/integracoes/estado.ts`
  (Admin → Integrações mostra o que falta, **só nome de variável, nunca valor**).

**4b — receber os três eventos.**
- `POST /api/webhooks/copiloto/transcricao` roteia por `type`: `transcript.data` vira
  segmento; `participant_events.join` / `.leave` mantêm `sessoes_copiloto.participantes`.
- **Tipo desconhecido → 200 sem efeito + pendência.** Nunca 500: o fornecedor reentrega.
- Vínculo pelo `id` do bot (`gravacao_externa_id`), nunca por `sessao_id` do corpo.

**4c — o que os participantes destravam.**
- Comparação participantes × `processo_decisorio.decisores` do briefing → o **fato** da
  camada 1 do §5. É este evento concreto que sustenta o caso dos decisores.
- `exige_decisores` nos blocos do roteiro (camada 2) passa a ter dado com que trabalhar.

**4d — pré-requisitos que não são código.**
- Roteiro v5 com o 1º SIM ampliado (B66) — **publicado pela Dra. Elaine, não por nós**.
- **B76 respondido** (retenção no fornecedor) — sem ele o bot não sobe.
- Pentester obrigatório nesta fatia, sem exceção.

**Aceite da fatia:** teste provando que o corpo enviado ao Recall contém `retention`
explícito · teste provando `bot_detection.matches` explícito · teste provando que 400
`bot_command_error` **não** vira linha em `erros_servidor` · roteiro de sala inexistente
(`meeting_not_found`) chegando à tela com o `sub_code`, não com erro genérico.

### Fatia 5 — Expurgo e retenção

- Job de expurgo de `sessoes_copiloto_segmentos` por idade
  (`retencao_dias_segmentos`), **depois** de consolidada a `transcricoes`. Depende de B69.
- Fecha o **B19**, aberto desde a Fase 7.

**Ordem:** 1 → 2 → 3 podem ir seguidas; **4 só depois de B65, B66, B67 e B76 respondidos**.

---

## 9. CONFLITOS

| # | Conflito | Prova | Resolução |
|---|---|---|---|
| **C1** | **`decisoes_juridicas.escopo` é lista fechada por CHECK.** Registrar a decisão do copiloto **não é um INSERT** — exige migration | 0048:50-51 | 0092 (a) amplia o CHECK. A decisão de mérito continua sendo da Dra. Elaine, pela rota que já existe |
| **C2** | **O copiloto não herdaria trava nenhuma.** `app.exige_flag_analise_ia_habilitada` está só em `analises_transcricao`; `executarComAuditoria` **nunca** consulta `decisoes_juridicas` | 0048:180-198 e grep em `server/ia/` | 0092 (b): trigger própria nos dois INSERTs. **É a lição do pentest aplicada, não repetida** |
| **C3** | **`IA_TIMEOUT_MS`=300 s é o oposto do requisito.** O caminho de IA foi calibrado para briefing de 100 s | `openrouter.ts:34` | Timeout próprio de 8 s no copiloto, sem tocar na global (que continua certa para o briefing) |
| **C4** | **`verificar_cooldown_ia` calaria o copiloto**: 600 s por jornada. A 2ª sugestão da sessão morreria | 0027, `ia.cooldown_segundos=600` | Orçamento próprio (§4.4), como a Fase 9 fez |
| **C5** | **`Permissions-Policy: microphone=()` é global**, sem exceção por rota | `next.config.ts:69` | A recomendação (c) **não precisa abrir**. Se o João escolher (a), aí sim: header por rota `/sessoes/:path*` mais veredito do pentester |
| **C6** | **O 1º SIM não cobre bot nem IA ao vivo.** O banco já diz isso por escrito | NOTA em 0030, `registrar_sim_sessao` | Roteiro v5 (B66). O mecanismo já existe: texto congelado lido do roteiro ativo |
| **C7** | **`CLAUDE.md` diz "output: 'standalone'" como restrição do deploy; `next.config.ts` diz o contrário, com data e medição** | `CLAUDE.md:30` contra `next.config.ts:4-8` | Corrigir o `CLAUDE.md`. Não é desta fase, mas a próxima IA que ler o CLAUDE.md e ligar standalone derruba produção |
| **C8** | **Não existe tabela de participantes** — o 3º SIM é um booleano sem dado por trás | grep "participante" nas migrations: 0 | `sessoes_copiloto.participantes` (0091). É o que torna o caso do João possível |
| **C9** | **A tela do Conduzir já faz 5 requisições para montar.** Somar polling ingênuo agravaria | `ConduzirSessaoApp.tsx:79-109` mais `PainelBriefingSessao` | Uma rota de polling só, payload combinado, briefing fora do ciclo (§2.4) |
| **C10** | **A coluna direita é de 320 px fixos e já é do briefing.** Copiloto e briefing brigam pelo mesmo espaço | `ConduzirSessaoApp.tsx:241` | Abas na coluna (Briefing / Copiloto), **briefing como aba default**. O copiloto não pode empurrar o roteiro para baixo da dobra — é o U1 da Fase 3, que continua valendo |
| **C11** | **Produção não tem `OPENROUTER_API_KEY`** *(vault 08/09)*: toda IA responde 503 | vault | Não bloqueia as fatias 1 e 3 (sem IA, ou com IA desligada). Bloqueia a bancada da fatia 2 |
| **C12** | **O roteiro v4 está ativo por escolha técnica, não por carimbo da Dra. Elaine (B15, aberto há 5 fases)** | `ConduzirSessaoApp.tsx:289-294` | O copiloto **amplifica** o B15: a IA vai sugerir com base num roteiro que ninguém oficializou. Não se resolve aqui, mas **a aba do copiloto tem de repetir o aviso** que o cabeçalho já dá. ⚠️ **Dívida nomeada na Fatia 1:** o aviso passou a existir **hard-coded em dois lugares** (cabeçalho da tela e painel do copiloto) — **quando o B15 for fechado, os dois mentem juntos**. Quem fechar o B15 tem de apagar os dois, ou (melhor) derivar o aviso de `roteiros_versoes.ativado_por is null`, que é o dado que já responde a pergunta desde a 0078. Enquanto forem dois literais, é uma dívida de manutenção, não um recurso |
| **C13** | **O campo `exige_decisores` não existe em `RoteiroBloco`** e a v4 não o tem | `types/roteiro.ts:42-51` | Campo **opcional**; ausente é ausente, nunca `false` inventado. Quem marca é a Dra. Elaine, publicando versão nova |

---

## 10. BLOQUEIOS — só o João ou a Dra. Elaine decidem

Cada um vem com a **hipótese conservadora já aplicada** no desenho, e cada um se desfaz com
uma linha de SQL/configuração ou uma publicação de versão de roteiro.

| # | Pergunta | Hipótese conservadora aplicada |
|---|---|---|
| **B65** | **A Dra. Elaine autoriza institucionalmente o copiloto ao vivo?** Escopo `sessao.copiloto_ao_vivo`, nomeando os subprocessadores (provedor do bot e OpenRouter/Anthropic) e a base legal | **Não autorizado.** Sem linha ativa em `decisoes_juridicas`, a trigger da 0092 recusa todo INSERT. Nasce assim |
| **B66** | **Qual é o texto novo do 1º SIM?** Precisa declarar: bot terceiro visível na sala, análise por IA **durante** a sessão, e o destino do áudio e do texto | **Roteiro v4 permanece e o bot não é ligado.** O texto atual não cobre, e ampliá-lo por nossa conta é exatamente o que o B3 proíbe ("não amplie o texto por conta própria") |
| **B67** | **Texto do consentimento `copiloto_sessao_ao_vivo`** (tipo novo, por titular), **por onde é colhido** (formulário público antes da sessão, ou no 1º SIM dentro dela) e **o que vale para quem está na sala e não é o titular** | **Tipo criado, texto vazio, ninguém consentiu** → `tem_consentimento` = false → trava fecha. **Não reaproveitamos `tratamento_ia`** (é de preparação) **nem `gravacao_sessao`** (autoriza gravar, não transmitir ao vivo). Nome de terceiro nunca vai à IA |
| **B68** | **O cliente pode recusar só o copiloto e manter a sessão?** | **Sim.** Recusa: copiloto não liga, sessão segue normal com o roteiro. Nunca condicionar o atendimento ao consentimento |
| **B69** | **Retenção do NOSSO lado (fecha o B19, aberto desde a Fase 7):** quantos dias os segmentos ao vivo ficam no nosso banco? | **7 dias para segmentos**; depois disso só a `transcricoes` consolidada permanece. **Expurgo desligado até a resposta** — nada é apagado sem ordem. A parte "e o áudio no provedor?" **saiu daqui e virou B76**: deixou de ser a mesma pergunta no dia em que se mediu que o default do fornecedor é `forever` |
| **B70** | **O copiloto pode sugerir pular ou reordenar bloco, ou só apontar o que falta?** | **Sugere, com botão; nunca executa.** Nenhuma navegação automática (§5) |
| **B71** | **A sugestão aparece sozinha na tela, ou só quando a advogada pede?** Sugestão que aparece durante a fala do cliente rouba a atenção dela na hora errada | **Só sob demanda (fatia 2) e, na fatia 3, com aviso discreto** ("1 sugestão nova") que ela abre quando quiser. **Nada pisca, nada toca, nada abre sozinho** |
| **B72** | **O nome do bot na lista de participantes.** É a primeira coisa que o cliente lê | **"Assistente — Escritório Elaine Montenegro"**, neutro. Nome com "IA" ou "bot" muda a dinâmica da sala e é escolha de método, não técnica. **Conferido na sonda (11/09):** a palavra "Assistente" no nome **não** cria risco de expulsão — o `bot_detection` do fornecedor só age quando **todos** os participantes restantes casam a lista, e cada bot decide sobre a própria saída. Mandamos `matches` explícito, sem o nosso nome nele (§4.2.2). **O bloqueio continua aberto pelo mérito** (como o cliente lê o nome), não mais pelo risco técnico |
| **B73** | **Quem pode ligar o copiloto numa sessão:** só a Dra. Elaine, ou toda a equipe interna? | **Só `app.ve_patrimonio()`** (admin/advogada) — o mesmo recorte de quem lê transcrição hoje |
| **B74** | **Se o bot cair no meio da sessão, o que a tela mostra?** | **O estado real** ("transcrição interrompida às 14:32"); o copiloto volta ao modo determinístico da fatia 1. Nunca sugestão com base em janela velha |
| **B75** | **O subprocessador novo é o Recall.ai** (contratado pelo Marcio, 11/09). Falta DPA e a decisão sobre a região. **Fato medido: a base é `us-east-1` — os dados SAEM DO BRASIL**, e áudio e vídeo da família são processados e guardados nos EUA | **`copiloto_sessao.provedor_audio='nenhum'` até a Dra. Elaine decidir com esse fato na mão.** A interface de provedor continua genérica (como `ProvedorSala`): trocar de fornecedor ou de região é adaptador novo, não reescrita. **Transferência internacional de dado sensível entra na base legal do B65**, não é detalhe de infraestrutura |
| **B76** | **Quanto tempo o Recall.ai guarda o áudio e o vídeo?** Medido em 11/09: o `POST /bot/` devolveu `retention` do tipo `forever` **sem que ninguém pedisse** — é o default do fornecedor. Por omissão, gravação de conversa patrimonial familiar fica **para sempre**, fora do Brasil | **`retention` explícito é obrigatório em toda criação de bot** (§4.2.1): parâmetro exigido na assinatura de `pedirBot()`, teste de regressão sobre o corpo enviado, e conferência pós-criação que **encerra o bot** se voltar `forever`. Valor inicial proposto: **o menor que o fornecedor aceitar** — no limite a gravação nem se guarda, porque só precisamos do texto. **Não decidir deixou de ser neutro:** antes significava "nada é apagado do nosso lado"; agora significa "o fornecedor guarda para sempre" |

---

## 11. O que esta fase LIMPA (critério de otimização do Fable)

Feature que só empilha reprova. O que sai ou melhora:

1. **`POST /api/sessoes/[id]/transcricao` deixa de ser código órfão.** Existe desde a
   Fase 3, exige colar 90 minutos de texto à mão e nunca foi usado *(vault 08/09: zero uso
   real)*. Ganha produtor automático — e com ele o Agente do Croqui, que depende dessa
   transcrição, deixa de depender de trabalho manual que ninguém faz.
2. **O 3º SIM deixa de ser um booleano sem lastro.** Hoje a advogada marca "decisores
   presentes" sem que o sistema tenha qualquer dado sobre quem está na sala. Passa a ser
   fato conferível, e `sims.decisores` ganha algo com que ser comparado.
3. **A tela do Conduzir ganha o sumário que lhe falta, sem custo de IA.** "O que falta
   neste bloco" sai dos `campos[]` e `observar[]` que já estão no roteiro e hoje são só
   texto para ler. É a fatia 1 inteira: valor real, zero token.
4. **`decisoes_juridicas` deixa de ter um escopo só.** A 0048 criou uma estrutura de
   auditoria genérica que nunca foi exercitada. O copiloto é o segundo caso, e é o que
   prova que a estrutura serve — ou revela que não serve, agora, enquanto é barato.
5. **Uma rota de polling, não cinco.** O desenho força a coalescência que a tela do
   Conduzir já deveria ter (C9) e cria o precedente para as outras telas.
6. **`CLAUDE.md` corrigido** (C7): uma linha errada que, seguida à risca, derruba produção.

**O que a fase acrescenta de estrutura, ao final das 5 fatias:** 4 tabelas, 1 função,
**3 triggers**, 1 prompt, 10 chaves de configuração. **Nenhuma tabela existente alterada** —
só o CHECK de escopo (que é ampliação) e a view de pendências, refeita a partir do banco.

**Faseamento do DDL, para a contagem bater a cada fatia** (registrado porque a Fatia 1
entregou 3 tabelas, não 4, e a omissão não estava escrita em lugar nenhum):

| Tabela | Criada em | Por quê aí |
|---|---|---|
| `sessoes_copiloto` | 0091 (Fatia 1) | a sessão existe desde o modo manual |
| `sessoes_copiloto_segmentos` | 0091 (Fatia 1) | é onde o campo de digitar grava |
| `copiloto_sugestoes` | 0091 (Fatia 1), **DDL sem chamador** | o modelo de dados nasce inteiro numa migration só; a RLS já nega escrita a `authenticated` |
| `copiloto_ciclos` | **Fatia 3**, não 0091 | é a claim do ciclo automático. Na Fatia 1 e 2 **não existe ciclo**: a Fatia 1 não chama IA, e a Fatia 2 só dispara por botão, onde a corrida que a claim resolve não acontece. Criar a tabela antes seria DDL sem função, que é o tipo de peso morto que o critério de otimização reprova |

---

## 12. Divisão de tarefas (fronteiras de arquivo disjuntas)

**BACK** — migrations 0091 a 0093, webhook, ciclo, porteiro, contexto, validador, bancada.

*Permitido:* `supabase/migrations/009{1,2,3}_*.sql` · `scripts/verificacao-0091-0093.sql` ·
`scripts/simular-copiloto.ts` (novo) · `src/server/copiloto/**` (novo) ·
`src/app/api/webhooks/copiloto/**` (novo) · `src/app/api/sessoes/[id]/copiloto/**` (novo) ·
`src/app/api/admin/copiloto/**` (novo) · `src/types/copiloto.ts` (novo).

*Não tocar:* `src/components/**` · `src/server/ia/{executar,cliente}.ts` (usa, não altera) ·
`api/sessoes/[id]/{sims,transcricao}/route.ts` · as RPCs existentes.

*Aceite:* todas as travas do porteiro provadas pelo simulador, com a saída colada · roteiro
SQL com rollback rodado e colado · **`explain (analyze)` das duas queries de polling** ·
prova de que `copiloto_sessao.ativo=false` gera **0** execução de IA · prova de que, sem
decisão jurídica **ou** sem consentimento, o INSERT é recusado **pelo banco** · p50/p95 de
latência da IA na bancada.

**FRONT** — aba Copiloto na coluna, sugestões, aba de Admin.

*Permitido:* `src/components/sessao/PainelCopiloto.tsx` (novo) ·
`src/components/sessao/ConduzirSessaoApp.tsx` (só o ponto de inserção da coluna) ·
`src/components/sessao/api.ts` · `src/components/admin/abas/CopilotoAba.tsx` (novo) ·
`src/types/admin.ts`.

*Não tocar:* `src/server/**` · migrations · `src/components/briefing/**`.

*Aceite:* roteiro **não** desce da dobra a 1366×768 (U1 da Fase 3) · briefing continua a
aba default (C10) · sugestão nunca abre sozinha (B71) · `vitest-axe` sem violação · 0
scroll horizontal a 360 px · estado real quando o bot cai (B74) · o aviso do B15 repetido
na aba do copiloto (C12).

**PENTESTER — obrigatório, sem exceção.** Superfície: webhook novo que grava fala de
cliente; `gravacao_externa_id` como vínculo (forja de `sessao_id` no corpo); as duas
triggers de LGPD (tentar contorná-las por caminho novo é o teste principal); PII no
contexto da IA; polling como canal de exfiltração para papel interno sem `ve_patrimonio()`;
amplificação (webhook malicioso gerando custo de IA); `participantes` como PII de terceiro
que **não é o titular**; `copiloto_ciclos` como negação de serviço (claim que nunca libera).

**Contrato entre os dois:** BACK entrega **primeiro** `src/types/copiloto.ts` e as formas
de `GET /api/sessoes/[id]/copiloto` e `GET /api/admin/copiloto`; FRONT importa daí. Nenhum
arquivo aparece nas duas listas.

---

## 13. Os 5 critérios do Fable

| Critério | O que este plano garante |
|---|---|
| **Segurança** | Duas travas independentes **no banco**, em trigger, nos dois caminhos de saída de dado (não em rota, não em env) · nasce desligado em 4 lugares · webhook fail-closed com HMAC e idempotência, clonado do melhor da casa · o `Permissions-Policy` **não é aberto** · nome próprio de decisor nunca vai para a IA · vínculo por id opaco, não pelo `sessao_id` do corpo · pentester obrigatório |
| **Escalabilidade** | Contexto O(1) por chamada (janela mais resumo com teto por CHECK), não O(duração ao quadrado) · polling sobre índice composto, com `explain (analyze)` exigido na entrega · tetos por sessão, por dia e por duração · claim atômica impede que N abas virem N execuções · 10× sessões é 10× custo linear, sem cauda |
| **Solidificação** | O teto do resumo é `CHECK`, não `if` · `(sessao_id, ordem)` **é** a idempotência do webhook · `(sessao_id, janela)` **é** a trava anti-ciclo-duplo · desligado é o default · rollback escrito nas 3 migrations · 100% aditivas · a IA só aponta para `bloco_id` que o servidor confere contra o roteiro ativo |
| **UX** | O roteiro **não desce da dobra** (U1 continua valendo) · nada pisca nem abre sozinho durante a fala do cliente (B71) · sugestão sempre com motivo e evidência citada, nunca um veredito · quando falta dado, a tela diz que falta — nunca inventa · o bot é visível ao cliente por escolha, não escondido |
| **Otimização** | Dá produtor a um consumidor ocioso (`transcricoes` para o Agente do Croqui) · a fatia 1 entrega valor com **zero IA** · uma rota de polling, não cinco · o gate reusa `decisoes_juridicas`, que existia sem segundo caso de uso · não cria segunda máquina de estados: o roteiro continua sendo a única fonte do método · corrige uma linha do `CLAUDE.md` que pode derrubar produção |
