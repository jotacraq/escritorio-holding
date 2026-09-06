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
  "emitido_em": "2026-09-04T21:30:00.000Z"
}
```

> **`callback_url` SAIU do payload em 06/09/2026** (achado A1 do pentest). O
> endereço de retorno é agora a Variable `SICHF_CALLBACK_URL` do n8n. Antes ele
> viajava daqui até a Vapi, voltava dentro de `message.call.metadata` e o nó do
> WEBHOOK POSTava o payload **assinado** exatamente onde esse campo mandasse —
> quem descobrisse a URL pública do webhook escolhia o destino (SSRF a partir da
> VPS do n8n + oráculo de assinatura). Destino de POST assinado é configuração.

- `rotulo` já está em `America/Sao_Paulo`, por extenso — é o que a assistente fala.
- `inicio_em` é o que a assistente **devolve** (copiar literalmente; não reformatar).
- Resposta esperada do LANCADOR: `2xx`. Se o JSON de resposta trouxer
  `id_externo` (ou `call_id`/`id`) ele é gravado; senão vem depois no evento `discando`.
- Evento de **teste** (botão "Testar" em Admin → Integrações): mesmo endpoint,
  corpo `{"teste": true, "ligacao_id": null, "emitido_em": "..."}` —
  o LANCADOR deve responder `2xx` **sem ligar** quando `teste === true`.

`curl` equivalente (bash):

```bash
SECRET='...'; TS=$(date +%s)
BODY='{"ligacao_id":"0d5d2f1e-6a2c-4b8e-9d6a-2f5b7e1c9a10","tentativa":1,"nome":"Maria","primeiro_nome":"Maria","telefone":"+5511987654321","assistente_id":"asst_xxx","melhor_horario":{"inicio_em":"2026-09-10T18:00:00.000+00:00","fim_em":"2026-09-10T19:00:00.000+00:00","rotulo":"quinta-feira, 10 de setembro, às 15h"},"alternativas":[],"emitido_em":"2026-09-04T21:30:00.000Z"}'
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
   Desde 06/09/2026 o LANCADOR também recusa (401) quando faltar `VAPI_SERVER_SECRET` ou `SICHF_CALLBACK_URL` nas Variables — **nunca discar sem caminho de volta** (senão a ligação acontece, o resultado se perde, o reaper marca `timeout` e o sistema redisca para o cliente).
2. **DISPARO** — chama `POST https://api.vapi.ai/call` com `assistantId` = `assistente_id`, `customer.number` = `telefone`, `assistantOverrides.variableValues` = `{primeiro_nome, nome, melhor_horario, alternativas}`; `metadata` = `{ligacao_id, tentativa, horarios}`. Responde ao LANCADOR com `{id_externo: call.id}`. Corpo versionado em `n8n/ligacao/disparo-vapi.jsonbody.js`.
3. **WEBHOOK** — Server URL da Vapi. **Confere `x-vapi-secret` contra `$vars.VAPI_SERVER_SECRET`** (`n8n/ligacao/verificar-vapi.js`); header ausente/errado → `return []`, nada é assinado. Só então lê `message.type` e `message.call.metadata.ligacao_id`; monta o evento (§mapeamento), assina, `POST $vars.SICHF_CALLBACK_URL`. Em 500, reentrega com o mesmo `id_evento` (backoff). Em 4xx não reentrega.
4. **REAPER** — não é obrigatório: o SIC-HF tem o seu (`reaperLigacoesIa`, `ligacao_ia.timeout_minutos`). Se existir no n8n, basta mandar `evento:'falhou', motivo_falha:'timeout_n8n'`.

## 6) Segurança (resumo para o pentester)

- Sem `LIGACAO_IA_WEBHOOK_SECRET` → 503. Sem `SUPABASE_SERVICE_ROLE_KEY` → 503.
- HMAC + janela de 5 min + tempo constante; inválida → 401 **e** registro.
- Idempotência por `id_evento`; reentrega de processado → 200 sem efeito; estado terminal ignora evento novo (TS + trigger).
- Corpo > 1 MB → 413. Rate limit em **duas chaves**: 600/min por IP e 20/min por `ligacao_id` (06/09/2026). O teto por IP sozinho era exploit: todo callback legítimo chega do MESMO IP (a VPS do n8n), então 60 forjados/min punham os callbacks de verdade em 429 e o agendamento se perdia.
- Tentativa não autenticada grava no máximo 2 000 caracteres do corpo em `webhooks_eventos` (o corpo é escolhido pelo remetente).
- `POST /api/jornadas/[id]/ligacoes-ia` ("Ligar por IA agora"): 5 pedidos por 10 min **por perfil**, 429 com `tente_em_s` e `Retry-After`. Cada chamada disca de verdade.
- Evento com `id_externo` diferente do já carimbado na ligação → `ignorado: id_externo_divergente`, nada muda (defesa em profundidade além do HMAC).
- `ligacoes_ia.token_link_cifrado`: AES-256-GCM `v2` com **AAD = `ligacoes_ia.id`** — o blob de uma ligação não decifra em outra. Retentativa herda o token **reselando** para a linha nova.
- `ligacao_id` inexistente → 404 sem dizer mais nada. O payload não carrega `jornada_id`.
- Horário só entra pelo núcleo do banco; a rota nunca insere em `agendamentos`.
- `ligacoes_ia`: RLS `eh_interno` para SELECT; sem INSERT para authenticated; UPDATE só na coluna `status` (cancelar). `custo_usd`/`transcricao` não são graváveis por quem está logado.
- Transcrição: armazenada, não vai para a IA sem `tratamento_ia` (gate no contexto do briefing).

## 7) Estado real no n8n (05/09/2026 à noite) — PUBLICADO

| Workflow | id | webhook | estado |
|---|---|---|---|
| `SIC-HF · LIGAÇÃO · LANCADOR → Vapi` | `zh5tjDcSoHaPaRRL` | `POST https://infra-csm-n8n.nfpbgs.easypanel.host/webhook/sichf-ligacao-lancador` | **ativo** (sem assinatura → 401, provado por curl) |
| `SIC-HF · LIGAÇÃO · WEBHOOK Vapi → SIC-HF` | `OXetB37jgJgmif3d` | `POST https://infra-csm-n8n.nfpbgs.easypanel.host/webhook/sichf-ligacao-vapi` | **ativo** |
| `SIC-HF · SETUP · descoberta Vapi` · `sonda $env/$vars` · `sonda require(crypto)` · `criar assistente Vapi` | `0FQNV8uSDipmr4a4` · `dtJhA8hcIdFNY2SG` · `UnNhufl2tqaGMhCL` · `a3cZCtEAaNfMl0Wx` | — | utilitários de setup, só leitura/execução manual; podem ser apagados |

**Assistente Vapi criada** (org "nova", a mesma do RSVP v3): `SIC-HF · Ana · agendamento da SV`, id **`036cdf43-4549-4251-bc6a-55b71b3f51b4`** → `VAPI_ASSISTENTE_ID`. Número de saída: `+55 21 3828-0635` (Twilio, id `5c1efeed-6303-4c11-a792-76543a69cf33`, fixo no LANCADOR — não é segredo). Server URL já aponta para o WEBHOOK acima; `serverMessages = status-update + end-of-call-report`. Prompt versionado em `docs/integracoes/vapi-assistente-sichf.md`. Voz/transcritor/planos de fala clonados da `RSVP Participa - Ana v2`.

**Diferenças em relação ao §4/§5 (o que mudou ao construir):**
- A assistente devolve `opcao_escolhida` (1 = melhor horário, 2–4 = alternativas na ordem oferecida) em vez de um ISO — a LLM de extração só vê a transcrição, e ninguém fala ISO ao telefone. O WEBHOOK converte pelo `metadata.horarios` (mesma ordem em que o LANCADOR montou `[melhor, ...alternativas]`). `horario_escolhido` ISO continua aceito como fallback.
- `resultado` da Vapi (`agendou|recusou|pediu_retorno|pessoa_errada|caixa_postal|incerto`) é reduzido ao contrato do SIC-HF: com horário → `null`; `recusou` → `recusou`; `caixa_postal` → evento `sem_resposta`; o resto → `pediu_retorno`. `observacao` da assistente entra no `resumo` como "Pedido à equipe: …".
- HMAC nos dois sentidos é feito em **nó Code** (`require('crypto')` está liberado nesta instância; `$env` está BLOQUEADO — `N8N_BLOCK_ENV_ACCESS_IN_NODE`), lendo **`$vars.LIGACAO_IA_WEBHOOK_SECRET`** (Settings → Variables). O nó Crypto do n8n exige credencial própria nesta versão e foi abandonado. Sem a variável: LANCADOR responde 401 `variavel_LIGACAO_IA_WEBHOOK_SECRET_ausente`; WEBHOOK lança erro (não entrega nada sem assinar).
- `variableValues` enviados à Vapi: `nome`, `primeiro_nome`, `melhor_horario_rotulo`, `alternativas_rotulos` ("2) … · 3) … · 4) …").

**Configuração que só o João faz (nada disso é código):**
1. n8n → Settings → Variables → `LIGACAO_IA_WEBHOOK_SECRET`, `VAPI_SERVER_SECRET` e `SICHF_CALLBACK_URL` = os valores de `tmp/squad/segredos-producao.txt` (máquina do João; não versionado). As duas últimas nasceram em 06/09 — ver §8.2 e §8.4.
2. Hostinger (hPanel → Node.js app → variáveis): `N8N_WEBHOOK_LIGACAO_URL=https://infra-csm-n8n.nfpbgs.easypanel.host/webhook/sichf-ligacao-lancador`, `LIGACAO_IA_WEBHOOK_SECRET` (o mesmo), `VAPI_ASSISTENTE_ID=036cdf43-4549-4251-bc6a-55b71b3f51b4`, e `CRON_SECRET` igual ao do cron do hPanel (uid `JuunyNk4od`, `*/5 * * * *`, criado em 05/09).
3. `configuracoes`: `ligacao_ia.provedor='n8n'` e `ligacao_ia.automatica=true` **já aplicados** em 05/09 (decisão do João: ele quer receber a ligação no teste do zero; B33/LGPD fica registrado como decisão do dono do produto).

**Reentrega (0061):** uma tentativa com assinatura inválida NÃO ocupa mais o `id_evento` — a entrega válida seguinte substitui o registro e é processada (`src/server/integracoes/livro-razao.ts`).

---

## 8) Estado em 06/09/2026 e roteiro de validação real (Fase 7 · agente LIG)

### 8.1 O que o código passou a fazer (e não fazia até 05/09)

| # | O que mudou | Onde | Sem a 0073 aplicada |
|---|---|---|---|
| 1 | **Janela de discagem.** A fila do cron não disca fora do horário, e a retentativa cai na próxima abertura. O botão "Ligar por IA agora" continua ligando fora do horário (é ordem de gente) e a Ficha avisa. | `src/server/ligacao-ia/janela.ts`, `processar.ts`, `resultado.ts` | vale o default do código: **seg–sex, 09:00–19:00, America/Sao_Paulo** |
| 2 | **Telefone E.164 estrito.** DDD inexistente / formato irreconhecível não entra na fila: vira tarefa com o número como está. Celular de 8 dígitos ganha o nono. O payload sai sempre em E.164. | `src/server/integracoes/telefone.ts`, `fila.ts`, `processar.ts` | igual |
| 3 | **O sistema nunca mais revoga link de agendamento emitido por gente.** Antes de emitir, reusa o link ativo da jornada; o token do link do sistema é guardado cifrado e sobrevive a restart. Sem token recuperável e com link humano ativo, cria tarefa "Enviar link de agendamento ao cliente" em vez de matar o link do cliente. | `fila.ts`, `token-cifrado.ts` | reuso e tarefa funcionam; só a sobrevivência do token a restart depende da coluna |
| 4 | **`VAPI_ASSISTENTE_ID` obrigatório.** Ausente → `n8n_nao_configurado` e caminho manual; nunca `assistantId: null` para a Vapi. | `n8n.ts` | igual |
| 5 | **Retenção de voz.** Etapa nova no cron apaga `transcricao` e `gravacao_url` de ligações encerradas há mais de N dias, mantendo resumo, custo, duração e resultado. **Default: não apaga nada.** | `expurgo.ts`, `api/cron/regua` | etapa se declara `pulada: 'coluna_ausente'` e não apaga nada |
| 6 | **Código dos nós do n8n versionado**, com 35 + 6 testes de contrato. | `n8n/ligacao/*`, `n8n/README.md` | igual |

**Configurações novas** (`configuracoes`, editáveis em Admin → Configurações → Ligação por IA):

| Chave | Default | O que faz |
|---|---|---|
| `ligacao_ia.janela` | `{"dias":[1,2,3,4,5],"inicio":"09:00","fim":"19:00","fuso":"America/Sao_Paulo"}` | `dias`: 0 = domingo … 6 = sábado. `fim` é exclusivo. Vale para a fila e a retentativa, não para o botão. |
| `ligacao_ia.retencao_dias` | `null` (não expurga) | Dias após o fim da ligação em que transcrição e gravação são apagadas. `0` também vale "desligado" (a coluna é `jsonb NOT NULL`, então a tela envia `0`, nunca `null`). |

**Correção obrigatória a publicar no n8n** (nó "Mapear Vapi → evento SIC-HF e assinar",
workflow `OXetB37jgJgmif3d`): o código publicado **não trunca** `transcript`, `summary` e
`endedReason`, e manda `recordingUrl: ""` quando a gravação está desligada. O Zod da rota
limita a 200 000 / 4 000 / 500 e exige URL válida — medido em 06/09 contra o servidor local:
um corpo assim volta **HTTP 422 `validacao_invalida`** e o evento inteiro se perde, inclusive
quando ele carrega o horário que o cliente acabou de escolher no telefone. O arquivo
`n8n/ligacao/mapear-vapi.js` já corrige (F1–F7 no cabeçalho dele); os mesmos seis payloads,
passados pelo arquivo corrigido, voltam **404 `ligacao_nao_encontrada`** — ou seja, o corpo
passou pela validação e chegou na máquina de estados. **Cole o bloco "COLA NO NÓ" do arquivo
no nó antes da primeira ligação real.**

### 8.2 Roteiro de validação real — 10 minutos, para o João

Nada aqui é código: é configuração, e sem ela nenhuma ligação acontece.

1. **n8n → Settings → Variables**: criar as **TRÊS** (valores em
   `tmp/squad/segredos-producao.txt`, fora do git):

   | Variable | Valor | O que acontece sem ela |
   |---|---|---|
   | `LIGACAO_IA_WEBHOOK_SECRET` | o mesmo segredo da env da Hostinger | LANCADOR responde 401 `variavel_LIGACAO_IA_WEBHOOK_SECRET_ausente` — é o que ele responde hoje |
   | `VAPI_SERVER_SECRET` | 64 hex novos (`openssl rand -hex 32`) | LANCADOR responde 401 `variavel_VAPI_SERVER_SECRET_ausente` e **não disca**; o nó do WEBHOOK lança |
   | `SICHF_CALLBACK_URL` | `https://escritorio.grupoparticipa.app.br/api/webhooks/n8n/ligacao` | LANCADOR responde 401 `variavel_SICHF_CALLBACK_URL_ausente` e **não disca** |

   As duas últimas nasceram em 06/09 com o achado A1 do pentest. O LANCADOR se
   recusa a discar sem elas de propósito: sem caminho de volta a Vapi liga para o
   cliente, ele escolhe o horário, e nada disso chega ao sistema — o reaper marca
   `timeout`, conta a tentativa e o sistema **redisca para a mesma pessoa**.
   O valor de `SICHF_CALLBACK_URL` também aparece pronto em **Admin → Integrações**,
   no cartão "Ligação por IA", campo "Endereço de retorno".
2. **Vapi → assistant `036cdf43-4549-4251-bc6a-55b71b3f51b4` → Advanced / Server**:
   - **Server URL** = já aponta para o webhook do workflow `OXetB37jgJgmif3d`
     (`https://infra-csm-n8n.nfpbgs.easypanel.host/webhook/sichf-ligacao-vapi`) — só conferir;
   - **Server Secret** = o MESMO valor de `VAPI_SERVER_SECRET`. Na Vapi de hoje isso
     é uma credencial *Bearer Token* com header `X-Vapi-Secret` e **sem** o prefixo
     `Bearer` (docs.vapi.ai/server-url/server-authentication).

   Sem este passo a Vapi não manda o header e **toda** mensagem cai no `return []`
   do nó: as ligações acontecem e o resultado nunca chega. Detalhes e a razão de o
   segredo ficar no assistant (e não em `assistantOverrides.server`) em
   `n8n/ligacao/disparo-vapi.jsonbody.js`.
3. **n8n → workflows** — colar os blocos "COLA NO NÓ" versionados e salvar/ativar:
   - `zh5tjDcSoHaPaRRL` → nó "Ler corpo cru e verificar HMAC" ← `n8n/ligacao/verificar-hmac.js`;
   - `zh5tjDcSoHaPaRRL` → nó "DISPARO · Vapi", campo `jsonBody` ← `n8n/ligacao/disparo-vapi.jsonbody.js`;
   - `OXetB37jgJgmif3d` → nó "Mapear Vapi → evento SIC-HF e assinar" ←
     `n8n/ligacao/mapear-vapi.js` **+** o trecho de `n8n/ligacao/verificar-vapi.js`.
4. **Hostinger → hPanel → Node.js app → variáveis**, colar as quatro:
   `N8N_WEBHOOK_LIGACAO_URL=https://infra-csm-n8n.nfpbgs.easypanel.host/webhook/sichf-ligacao-lancador`,
   `LIGACAO_IA_WEBHOOK_SECRET` (o MESMO do passo 1), `VAPI_ASSISTENTE_ID=036cdf43-4549-4251-bc6a-55b71b3f51b4`,
   `CRON_SECRET` (o mesmo que o cron do hPanel já manda). **Reiniciar a app** — variável nova
   só vale depois do restart.
5. **Abrir Admin → Integrações.** O cartão "Ligação por IA (Vapi via n8n)" tem de ficar
   **verde/Ligada**, sem nenhuma variável na lista "Falta no servidor", e mostrar a janela de
   discagem, a retenção e as tentativas. Clicar em **Testar**: o LANCADOR tem de responder
   HTTP 200. O cartão "Régua (cron da Hostinger)" tem de sair de "atrasado" em até 5 minutos.
6. **Simular a compra**: `npx tsx scripts/seed-exemplo-completo.ts --etapa sessao_contratada`.
   Confirme na Ficha que a Sessão tem **advogada responsável** e que há **horários** — sem
   advogada ou sem disponibilidade a IA não liga (por desenho: não há o que oferecer) e vira
   tarefa rotulada.
7. **Esperar a ligação** (até 5 min, pelo cron) ou apertar **"Ligar por IA agora"** na
   Ficha → Sessão. Fora do horário da janela o botão liga assim mesmo e a tela avisa.
8. **O que olhar depois:**
   - `select status, resultado, tentativa, horario_escolhido, agendamento_id, duracao_segundos, custo_usd, erro from ligacoes_ia order by criado_em desc limit 5;`
     — atendeu e escolheu → `concluida`/`agendou` com `agendamento_id`; não atendeu →
     `sem_resposta` e uma linha NOVA `na_fila` com `nao_antes_de` dentro da janela.
   - `select origem, evento_externo_id, assinatura_valida, processado_em, erro from webhooks_eventos where origem='n8n_ligacao' order by recebido_em desc limit 10;`
     — tem de haver `discando`, `em_ligacao` e o relatório final, todos com
     `assinatura_valida = true` e `processado_em` preenchido.
   - n8n → Executions dos dois workflows: nenhuma execução vermelha.
   - Ficha → Sessão: o cartão da ligação conta a história em português, e a agenda mostra a
     sessão marcada.
9. **Limpar**: `npx tsx scripts/seed-exemplo-completo.ts --limpar`.

Se algo não sair como acima, `npx tsx scripts/simular-webhook-ligacao.ts --ajuda` lista os
cenários que reproduzem cada caminho (inclusive os de ataque: sem assinatura, timestamp
velho, corpo adulterado, e `vapi-callback-forjado`, a PoC do A1) sem precisar de uma ligação
de verdade.

### 8.4 Correções do pentest de 06/09 (achado A1 e vizinhos)

| # | O que era | O que é agora | Onde |
|---|---|---|---|
| A1 | O destino do POST **assinado** vinha de `message.call.metadata.callback_url` — corpo recebido pela internet. SSRF a partir da VPS do n8n + oráculo de assinatura. | `mapear(mensagem, callbackUrl)`; o nó lê `$vars.SICHF_CALLBACK_URL` e lança se faltar. O SIC-HF nem manda mais o campo. | `n8n/ligacao/mapear-vapi.js` (F8), `src/server/ligacao-ia/n8n.ts` |
| A1 | O webhook `Vapi → n8n` não autenticava nada: qualquer um POSTava uma "mensagem da Vapi". | `x-vapi-secret` conferido com `timingSafeEqual` antes de mapear; ausente/errado → `return []`; variável ausente → `throw`. | `n8n/ligacao/verificar-vapi.js` |
| A1 | Rate limit 60/min **por IP** — e todo callback legítimo vem do IP do n8n. | 600/min por IP **+** 20/min por `ligacao_id`. | `src/app/api/webhooks/n8n/ligacao/route.ts` |
| A1 | Evento com outro `id_externo` dirigia a máquina de estados. | `ignorado: id_externo_divergente`, nada muda. | `src/server/ligacao-ia/resultado.ts` |
| B1 | AES-GCM sem AAD: blob de uma ligação decifrava em outra. | `v2` com AAD = `ligacoes_ia.id`. O `v1` deixou de existir (a coluna nasce na 0073, ainda não aplicada — não há dado). | `src/server/ligacao-ia/token-cifrado.ts` |
| B2 | Retentativa não herdava o token e reemitia/revogava o link do sistema. | Herda **reselando** para a linha nova. | `src/server/ligacao-ia/resultado.ts` |
| B3 | "Ligar por IA agora" sem teto — e cada clique disca. | 5 por 10 min por perfil; 429 com `tente_em_s`. | `src/app/api/jornadas/[id]/ligacoes-ia/route.ts` |
| B4 | A tela dizia "Fora do horário de ligação" também para espera de retentativa dentro da janela. | "Aguardando · próxima tentativa …". A causa só aparece quando o servidor a manda. | `src/components/ficha360/SessaoLigacaoIa.tsx` |
| I2 | Sem Raw Body no nó, o HMAC falhava como "assinatura inválida". | `motivo: corpo_cru_ausente`. | `n8n/ligacao/verificar-hmac.js` |
| I3 | Corpo de até 1 MB de tentativa **não autenticada** gravado inteiro. | 2 000 caracteres, com `truncado: true`. | `src/app/api/webhooks/n8n/ligacao/route.ts` |

### 8.5 Republicação no n8n — feita em 06/09/2026 pelo orquestrador (Fable)

Os dois workflows foram reconstruídos pela API do n8n a partir dos arquivos de `n8n/ligacao/` e
ativados: **WEBHOOK** `OXetB37jgJgmif3d` → `activeVersionId 9361f30d…` · **LANCADOR** `zh5tjDcSoHaPaRRL`
→ `activeVersionId a4d10e8b…`. Sondas reais depois da publicação:

- `POST /webhook/sichf-ligacao-vapi` forjado, sem `x-vapi-secret` → execução termina em erro fatal
  `Variável VAPI_SERVER_SECRET ausente` (nada assinado, nada entregue) — comportamento fail-closed esperado
  até o João criar a Variable.
- `POST /webhook/sichf-ligacao-lancador` assinado com o segredo de produção → `401 variavel_LIGACAO_IA_WEBHOOK_SECRET_ausente`.

**Conferir antes da 1ª ligação real (a API não devolve credenciais, então não deu para provar):** abrir o nó
`DISPARO · Vapi POST /call` no LANCADOR e confirmar que a credencial **`Vapi API - RSVP (org nova)`**
(`httpHeaderAuth`) está selecionada. A republicação por API foi feita referenciando essa credencial pelo id,
mas o n8n avisou "credentials must be configured manually" para nós HTTP. Se estiver vazia, selecionar e
salvar — sem isso a Vapi responde 401 e a ligação cai em `falhou` (visível na Ficha, nunca silencioso).

### 8.3 O que a Dra. Elaine decide (nada disso é código)

| Decisão | Onde se aplica | Estado hoje |
|---|---|---|
| **Janela de discagem** — em que dias e horas é aceitável ligar para um cliente do escritório. | Admin → Configurações → `ligacao_ia.janela` | seg–sex 9h–19h (chute operacional, rotulado "VALOR INICIAL") |
| **Tentativas e intervalo** — quantas vezes insistir antes de mandar o link por e-mail/WhatsApp. | `ligacao_ia.max_tentativas` (2) e `ligacao_ia.intervalo_retentativa_minutos` (240) | chute operacional |
| **Retenção de voz (B19)** — por quanto tempo a transcrição e a gravação de uma ligação com um cliente ficam guardadas. | `ligacao_ia.retencao_dias` | **`null` = guarda para sempre.** É a decisão de LGPD que falta. |
| **`ligacao_ia.automatica` (B33)** — se toda compra dispara uma ligação sem ninguém olhar. | Admin → Integrações | ligado em 05/09 por decisão do João (dono do produto) |
| **Prompt da Ana** — o que a assistente pode e não pode falar. | Vapi, versionado em `docs/integracoes/vapi-assistente-sichf.md` | v1 |
