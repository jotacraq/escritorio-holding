# Ligação por IA — contrato SIC-HF ⇄ n8n (Vapi)

Fase 4 · F2 (`docs/ARQUITETURA-FASE-4.md` §2). Padrão da casa: o mesmo desenho
do RSVP do seminário — `LANCADOR (webhook) → DISPARO (lê fila, chama a Vapi)
→ WEBHOOK (Vapi → grava resultado) → REAPER (solta 'discando' preso)`,
credencial `Vapi API - RSVP`. **O repo não guarda JSON de workflow**; o
orquestrador constrói o workflow `SIC-HF · LIGAÇÃO · agendar SV` no n8n pela
MCP a partir deste documento.

## O que a ligação É

Um **"link de agendamento falado"**. O SIC-HF manda à assistente o **melhor
horário** (posição 1 de `agendamentos_sugestoes` do link `/p/a` da jornada) e
até **3 alternativas** — exatamente os horários que o link público ofertaria. A
assistente só pode devolver `inicio_em` de um desses 4. O horário entra em
`agendamentos` pelo mesmo núcleo do link público
(`app.confirmar_horario_da_sugestao`, 0051, origem `'ia'`), que valida "entre
os ofertados" e "jornada pagou". A rota não decide nada disso.

**A ligação é agendamento, não venda.** A assistente não fala de preço, de
holding, de imposto, nem dá orientação jurídica.

## Variáveis de ambiente (servidor SIC-HF)

| Variável | Uso |
|---|---|
| `N8N_WEBHOOK_LIGACAO_URL` | URL do webhook **LANCADOR** no n8n. Sem ela: ligação vira tarefa humana (`manual`). |
| `LIGACAO_IA_WEBHOOK_SECRET` | Segredo compartilhado. Assina o POST SIC-HF → n8n **e** o retorno n8n → SIC-HF. Sem ele o SIC-HF responde 503 a qualquer retorno (fail-closed). |
| `VAPI_ASSISTENTE_ID` | ID do assistente na Vapi; vai no payload (`assistente_id`), nunca hardcoded no fluxo. |

Configurações que são **dado** (`configuracoes`, `UPDATE` sem deploy):
`ligacao_ia.automatica` (default `false`, B33), `ligacao_ia.provedor`
(`"manual"` | `"n8n"`), `ligacao_ia.max_tentativas` (2),
`ligacao_ia.intervalo_retentativa_minutos` (240), `ligacao_ia.timeout_minutos` (20).

## Assinatura (os dois sentidos)

```
x-sichf-timestamp:  <segundos Unix, string>
x-sichf-assinatura: sha256=<hex(HMAC-SHA256(LIGACAO_IA_WEBHOOK_SECRET, timestamp + "." + corpo_cru))>
```

- O corpo assinado é o **texto cru** do JSON (bytes exatos enviados), não o objeto re-serializado.
- Janela: `|agora − timestamp| ≤ 300 s`. Fora → 401.
- Comparação em tempo constante. Assinatura errada → 401 **e** linha em
  `webhooks_eventos(origem='n8n_ligacao', assinatura_valida=false)`.

Código n8n (nó Code, JavaScript) para assinar o retorno:

```js
const crypto = require('crypto');
const segredo = $env.LIGACAO_IA_WEBHOOK_SECRET;          // credencial do n8n, nunca no JSON do workflow
const corpo = JSON.stringify($json);                     // guarde ESTE texto e mande-o como body
const ts = String(Math.floor(Date.now() / 1000));
const assinatura = 'sha256=' + crypto.createHmac('sha256', segredo).update(ts + '.' + corpo).digest('hex');
return [{ json: { corpo, headers: { 'x-sichf-timestamp': ts, 'x-sichf-assinatura': assinatura, 'content-type': 'application/json' } } }];
```

No nó HTTP Request seguinte: **Body = `{{ $json.corpo }}` (raw, JSON)**,
headers dos campos acima. Não deixe o n8n re-serializar o body.

Para **verificar** o que chega do SIC-HF no LANCADOR (mesmo cálculo, comparar
com `timingSafeEqual`), use o corpo cru do webhook (`$binary` ou opção "Raw Body").

## 1) Saída — SIC-HF → LANCADOR (`POST N8N_WEBHOOK_LIGACAO_URL`)

Disparado pela fila (`processarFilaLigacoesIa`, no cron `POST /api/cron/regua`)
ou na hora pelo botão **"Ligar por IA agora"** (Ficha → Sessão →
`POST /api/jornadas/[id]/ligacoes-ia`).

```json
{
  "ligacao_id": "0d5d2f1e-6a2c-4b8e-9d6a-2f5b7e1c9a10",
  "tentativa": 1,
  "nome": "Maria Aparecida Souza",
  "primeiro_nome": "Maria",
  "telefone": "+5511987654321",
  "assistente_id": "asst_xxx",
  "melhor_horario": {
    "inicio_em": "2026-09-10T18:00:00.000+00:00",
    "fim_em":    "2026-09-10T19:00:00.000+00:00",
    "rotulo":    "quinta-feira, 10 de setembro, às 15h"
  },
  "alternativas": [
    { "inicio_em": "2026-09-11T13:00:00.000+00:00", "fim_em": "2026-09-11T14:00:00.000+00:00", "rotulo": "sexta-feira, 11 de setembro, às 10h" },
    { "inicio_em": "2026-09-11T17:00:00.000+00:00", "fim_em": "2026-09-11T18:00:00.000+00:00", "rotulo": "sexta-feira, 11 de setembro, às 14h" },
    { "inicio_em": "2026-09-14T14:00:00.000+00:00", "fim_em": "2026-09-14T15:00:00.000+00:00", "rotulo": "segunda-feira, 14 de setembro, às 11h" }
  ],
  "callback_url": "https://escritorio.grupoparticipa.app.br/api/webhooks/n8n/ligacao",
  "emitido_em": "2026-09-04T21:30:00.000Z"
}
```

- `rotulo` já está em `America/Sao_Paulo`, por extenso — é o que a assistente fala.
- `inicio_em` é o que a assistente **devolve** (copiar literalmente; não reformatar).
- Resposta esperada do LANCADOR: `2xx`. Se o JSON de resposta trouxer
  `id_externo` (ou `call_id`/`id`) ele é gravado; senão vem depois no evento `discando`.
- Evento de **teste** (botão "Testar" em Admin → Integrações): mesmo endpoint,
  corpo `{"teste": true, "ligacao_id": null, "callback_url": "...", "emitido_em": "..."}` —
  o LANCADOR deve responder `2xx` **sem ligar** quando `teste === true`.

`curl` equivalente (bash):

```bash
SECRET='...'; TS=$(date +%s)
BODY='{"ligacao_id":"0d5d2f1e-6a2c-4b8e-9d6a-2f5b7e1c9a10","tentativa":1,"nome":"Maria","primeiro_nome":"Maria","telefone":"+5511987654321","assistente_id":"asst_xxx","melhor_horario":{"inicio_em":"2026-09-10T18:00:00.000+00:00","fim_em":"2026-09-10T19:00:00.000+00:00","rotulo":"quinta-feira, 10 de setembro, às 15h"},"alternativas":[],"callback_url":"https://escritorio.grupoparticipa.app.br/api/webhooks/n8n/ligacao","emitido_em":"2026-09-04T21:30:00.000Z"}'
SIG="sha256=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')"
curl -sS -X POST "$N8N_WEBHOOK_LIGACAO_URL" -H "content-type: application/json" -H "x-sichf-timestamp: $TS" -H "x-sichf-assinatura: $SIG" --data-binary "$BODY"
```

## 2) Entrada — WEBHOOK n8n → `POST /api/webhooks/n8n/ligacao`

Um POST por mudança de estado. **Sempre** com `id_evento` único por
entrega (ex.: `vapi:<call_id>:<status>` ou o `id` do evento da Vapi) — é a
chave de idempotência (`webhooks_eventos (origem='n8n_ligacao', evento_externo_id)`).

```json
{
  "id_evento": "vapi:call_abc123:end-of-call-report",
  "ligacao_id": "0d5d2f1e-6a2c-4b8e-9d6a-2f5b7e1c9a10",
  "evento": "concluida",
  "id_externo": "call_abc123",
  "horario_escolhido": "2026-09-11T13:00:00.000+00:00",
  "resultado": null,
  "transcricao": "AI: Olá, Maria... USER: ...",
  "resumo": "Cliente escolheu sexta 10h.",
  "gravacao_url": "https://.../recording.wav",
  "custo_usd": 0.1873,
  "duracao_s": 142,
  "motivo_falha": null
}
```

| Campo | Tipo | Regra |
|---|---|---|
| `id_evento` | string ≤ 200 | **obrigatório**, único por entrega |
| `ligacao_id` | uuid | **obrigatório** — o que veio no payload de saída |
| `evento` (alias `estado`) | `discando` · `em_ligacao` · `concluida` · `sem_resposta` · `falhou` | **obrigatório** |
| `horario_escolhido` | ISO 8601 com offset | só em `concluida` quando o cliente escolheu; **tem de ser um dos 4 `inicio_em` enviados** |
| `resultado` | `recusou` · `pediu_retorno` · `caixa_postal` · `numero_invalido` | opcional; nunca `agendou` (isso o banco decide) |
| `transcricao` | string ≤ 200 k | opcional; só armazenada (RLS eh_interno); **não** vai para IA sem `tratamento_ia` |
| `resumo` | string ≤ 4 k | opcional |
| `gravacao_url` | URL | opcional (fica na Vapi; B39) |
| `custo_usd` | number ≥ 0 | `cost` do `end-of-call-report`; ausente → NULL (nunca zero) |
| `duracao_s` (alias `duracao_segundos`) | int ≥ 0 | opcional |
| `motivo_falha` | string ≤ 500 | em `falhou`/`sem_resposta` |

Limite de corpo: **1 MB** (413 acima disso).

### Respostas

| HTTP | Corpo | Significado / o que o n8n faz |
|---|---|---|
| 200 | `{recebido:true, ligacao:{status,resultado,agendamento_id}}` | processado |
| 200 | `{recebido:true, reentrega:true}` | `id_evento` já processado — nada a fazer |
| 200 | `{..., ligacao:{ignorado:'ligacao_encerrada'}}` | ligação já estava em estado terminal (cancelada pela equipe, `concluida` duplicada) |
| 422 | `{recebido:true, erro:'horario_indisponivel'}` | horário fora dos 4 / link vencido / jornada sem pagamento. Ligação vira `falhou` e o cliente recebe o link por e-mail/WhatsApp. **Não reentregar.** |
| 422 | `{erro:'validacao_invalida', detalhes}` | payload fora do contrato. Não reentregar. |
| 404 | `{erro:'ligacao_nao_encontrada'}` | `ligacao_id` desconhecido. Não reentregar. |
| 401 | `{erro:'nao_autorizado'}` | assinatura/timestamp inválidos (fica registrado). |
| 503 | `{erro:'servico_indisponivel'}` | `LIGACAO_IA_WEBHOOK_SECRET` ou `SUPABASE_SERVICE_ROLE_KEY` ausentes no servidor. |
| 500 | `{erro:'falha_ao_processar'}` | erro real; **reentregar** com o mesmo `id_evento` (idempotente). |
| 429 | `{erro:'rate_limited'}` | > 60 req/min por IP. |

### Mapeamento Vapi → evento

| Vapi (server message) | `evento` | Campos |
|---|---|---|
| `status-update` `queued`/`ringing` | `discando` | `id_externo` = `call.id` |
| `status-update` `in-progress` | `em_ligacao` | — |
| `end-of-call-report` com `endedReason` normal e horário extraído pelo assistente (function/structured output) | `concluida` | `horario_escolhido`, `transcricao` = `transcript`, `resumo` = `summary`, `gravacao_url` = `recordingUrl`, `custo_usd` = `cost`, `duracao_s` = `durationSeconds` |
| `end-of-call-report` sem horário (cliente recusou / pediu retorno) | `concluida` | `resultado` = `recusou` \| `pediu_retorno`, demais campos iguais |
| `endedReason` ∈ `customer-did-not-answer`, `voicemail`, `customer-busy` | `sem_resposta` | `resultado` = `caixa_postal` quando for voicemail; `motivo_falha` = `endedReason` |
| `endedReason` ∈ erros do provedor / número inválido | `falhou` | `resultado` = `numero_invalido` quando aplicável; `motivo_falha` = `endedReason` |

`curl` de exemplo (retorno `concluida`):

```bash
SECRET='...'; TS=$(date +%s)
BODY='{"id_evento":"vapi:call_abc123:end","ligacao_id":"0d5d2f1e-6a2c-4b8e-9d6a-2f5b7e1c9a10","evento":"concluida","id_externo":"call_abc123","horario_escolhido":"2026-09-11T13:00:00.000+00:00","transcricao":"...","resumo":"Escolheu sexta 10h.","custo_usd":0.1873,"duracao_s":142}'
SIG="sha256=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')"
curl -sS -X POST https://escritorio.grupoparticipa.app.br/api/webhooks/n8n/ligacao \
  -H "content-type: application/json" -H "x-sichf-timestamp: $TS" -H "x-sichf-assinatura: $SIG" --data-binary "$BODY"
```

Sem secret no servidor (estado local hoje): `curl -X POST localhost:3000/api/webhooks/n8n/ligacao -d '{}'` → **503**.
Com secret e sem assinatura → **401** + linha `assinatura_valida=false`.
Script pronto: `npx tsx scripts/simular-webhook-ligacao.ts --ajuda`.

## 3) O que acontece do lado do SIC-HF

```
pagamento aprovado (SV)  ──[ligacao_ia.automatica=true]──▶ ligacoes_ia(na_fila)
botão "Ligar por IA"     ─────────────────────────────────▶ ligacoes_ia(na_fila) → dispara já
cron /api/cron/regua ──▶ reivindicar (SKIP LOCKED) → discando → prepara oferta (link /p/a + sugestões)
        │                       │
        │                       ├── provedor n8n configurado + horários  → POST LANCADOR
        │                       └── senão                                → tarefa "Ligar para agendar" (rotulada) + concluida/manual
        ▼
n8n → /api/webhooks/n8n/ligacao ──▶ discando / em_ligacao / concluida / sem_resposta / falhou
        concluida + horário  → registrar_horario_ligacao_ia → núcleo 0051 → agendamentos(origem 'ia') → régua D-7 sozinha
        concluida sem horário→ link /p/a por e-mail + WhatsApp (template agendamento_link)
        sem_resposta/falhou  → tentativa nova após intervalo (até max_tentativas) → depois link por e-mail + WhatsApp
reaper (mesmo cron) ──▶ discando/em_ligacao há > timeout_minutos → falhou(timeout_reaper) → mesma regra acima
```

Estados: `na_fila → discando → em_ligacao → concluida | sem_resposta | falhou`; `cancelada`
só a partir de `na_fila`/`discando` (equipe). Estado terminal é imutável (trigger 0053).

## 4) Prompt-base do assistente (Vapi) — B38, vive na Vapi, editável sem deploy

Adaptação do POP 01. Variáveis vêm do payload de saída.

```
Você é a assistente do escritório da Dra. Elaine Montenegro (Time Holding Brasil).
Está ligando para {{primeiro_nome}} para MARCAR a Sessão de Viabilidade que ele(a) contratou.
Fale em português do Brasil, com calma, frases curtas, sem jargão.

1. Cumprimente pelo primeiro nome, diga quem você é e por que está ligando (uma frase).
   Confirme se está falando com {{nome}}. Se não for a pessoa, agradeça e encerre.
2. Explique em UMA frase: a Sessão de Viabilidade é uma conversa online de cerca de uma hora
   com a Dra. Elaine para entender a situação da família e ver o que faz sentido.
3. Ofereça PRIMEIRO o melhor horário: "{{melhor_horario.rotulo}}". Pergunte se serve.
4. Se não servir, ofereça as alternativas, uma de cada vez, na ordem recebida.
5. Você SÓ pode marcar um dos horários que recebeu. Se nenhum servir, diga que a equipe vai
   mandar um link por WhatsApp e e-mail para escolher com calma, e encerre.
6. Ao confirmar, repita o horário por extenso e avise: "Antes da sessão, alguém da equipe
   liga rapidinho, uns cinco minutos, para entender melhor o seu caso."
7. Encerre agradecendo. Diga que o convite com o link da sala chega por e-mail.

NUNCA: falar de preço, honorário, imposto, holding, orientação jurídica, prazo de resultado.
Se perguntarem, diga que isso a Dra. Elaine trata na sessão. Não invente informação.
Se a pessoa pedir para ligar em outro momento, aceite e encerre (resultado: pediu_retorno).
Se recusar a sessão, agradeça e encerre (resultado: recusou).

Ao final, devolva (structured output): horario_escolhido = o campo inicio_em EXATO do horário
aceito (ou null); resultado = agendou | recusou | pediu_retorno.
```

## 5) Workflow no n8n — nós, na ordem do RSVP

1. **LANCADOR** — Webhook (POST, raw body). Verifica HMAC (§assinatura). Se `teste === true` → responde 200 e para. Senão grava na fila do n8n (ou chama o DISPARO direto).
2. **DISPARO** — chama `POST https://api.vapi.ai/call` com `assistantId` = `assistente_id`, `customer.number` = `telefone`, `assistantOverrides.variableValues` = `{primeiro_nome, nome, melhor_horario, alternativas}`; `metadata` = `{ligacao_id}`. Responde ao LANCADOR com `{id_externo: call.id}`.
3. **WEBHOOK** — Server URL da Vapi. Lê `message.type` e `message.call.metadata.ligacao_id`; monta o evento (§mapeamento), assina, `POST callback_url`. Em 500, reentrega com o mesmo `id_evento` (backoff). Em 4xx não reentrega.
4. **REAPER** — não é obrigatório: o SIC-HF tem o seu (`reaperLigacoesIa`, `ligacao_ia.timeout_minutos`). Se existir no n8n, basta mandar `evento:'falhou', motivo_falha:'timeout_n8n'`.

## 6) Segurança (resumo para o pentester)

- Sem `LIGACAO_IA_WEBHOOK_SECRET` → 503. Sem `SUPABASE_SERVICE_ROLE_KEY` → 503.
- HMAC + janela de 5 min + tempo constante; inválida → 401 **e** registro.
- Idempotência por `id_evento`; reentrega de processado → 200 sem efeito; estado terminal ignora evento novo (TS + trigger).
- Corpo > 1 MB → 413. Rate limit 60/min/IP.
- `ligacao_id` inexistente → 404 sem dizer mais nada. O payload não carrega `jornada_id`.
- Horário só entra pelo núcleo do banco; a rota nunca insere em `agendamentos`.
- `ligacoes_ia`: RLS `eh_interno` para SELECT; sem INSERT para authenticated; UPDATE só na coluna `status` (cancelar). `custo_usd`/`transcricao` não são graváveis por quem está logado.
- Transcrição: armazenada, não vai para a IA sem `tratamento_ia` (gate no contexto do briefing).

## 7) Estado real no n8n (05/09/2026)

Workflows criados via MCP (não publicados; código SDK em `tmp/squad/n8n-ligacao-*.js` na máquina do orquestrador):

| Workflow | id | webhook |
|---|---|---|
| `SIC-HF · LIGAÇÃO · LANCADOR → Vapi` | `zh5tjDcSoHaPaRRL` | `POST /webhook/sichf-ligacao-lancador` |
| `SIC-HF · LIGAÇÃO · WEBHOOK Vapi → SIC-HF` | `OXetB37jgJgmif3d` | `POST /webhook/sichf-ligacao-vapi` |

Diferenças em relação ao §5: o LANCADOR já chama a Vapi na mesma execução (não há fila intermediária no n8n); o `metadata` da chamada leva `callback_url`, `ligacao_id`, `tentativa` e `horarios` (os 4 `inicio_em` ofertados) — o WEBHOOK valida `horario_escolhido` contra essa lista antes de assinar; HMAC é feito pelo nó Crypto lendo `$vars.LIGACAO_IA_WEBHOOK_SECRET` (ou `$env`). Pendente de configuração: `LIGACAO_IA_WEBHOOK_SECRET` e `VAPI_PHONE_NUMBER_ID` no n8n; credencial `Vapi API - RSVP` no nó HTTP; Server URL do assistente na Vapi; structured data `{horario_escolhido, resultado}`.

**Reentrega (0061):** uma tentativa com assinatura inválida NÃO ocupa mais o `id_evento` — a entrega válida seguinte substitui o registro e é processada (`src/server/integracoes/livro-razao.ts`).
