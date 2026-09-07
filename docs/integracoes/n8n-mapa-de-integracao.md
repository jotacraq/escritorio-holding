# Mapa de integração n8n ↔ SIC-HF ("terreno preparado")

Escrito em 07/09/2026 (diagnóstico + auditoria da instância n8n). Três frentes,
estados bem diferentes: (a) publicada e testável, (b) código pronto sem env,
(c) não existe workflow.

## Regra da instância (vale para as três)

Segredo de integração n8n = **env do container** (Easypanel → serviço n8n →
Environment), não Variables (plano Community não tem). Nós Code leem por
`lerConfig(nome)`: tenta `$vars`, cai para `$env` — exige
`N8N_BLOCK_ENV_ACCESS_IN_NODE=false` no Environment do serviço, senão
`access to env vars denied`. Bloco pronto para colar:
`C:\Users\João\Downloads\n8n-easypanel.env` (hoje só as 3 chaves da ligação —
falta acrescentar `INTEGRACOES_WEBHOOK_SECRET`/sala quando esse workflow
existir). Publicação mecânica dos nós Code: `n8n/gerar-sdk.mjs <dir-saída>` lê
`n8n/ligacao/*.js` (fonte é o repo) e emite os scripts do n8n Workflow SDK
para `validate_workflow`/`update_workflow` via MCP. A API pública **não
devolve nem grava credencial** de nó HTTP — conferir na UI depois de publicar.

Todo segredo entre SIC-HF e n8n viaja como **HMAC do corpo cru**:
`x-sichf-timestamp` (epoch, ±5 min) + `x-sichf-assinatura` =
`sha256=HMAC-SHA256(segredo, timestamp + "." + corpo_cru)`, tempo constante
(`src/server/*/assinatura.ts`). Nunca reserializar o JSON antes de assinar.

---

## (a) Ligação por IA — Vapi via n8n — PUBLICADA

| | |
|---|---|
| Estado | Publicada e testada de forma determinística (Fase 7, 06/09). Falta só a primeira ligação real com telefone do João. |
| Workflows n8n | `SIC-HF · LIGAÇÃO · LANCADOR → Vapi` (`zh5tjDcSoHaPaRRL`) · `SIC-HF · LIGAÇÃO · WEBHOOK Vapi → SIC-HF` (`OXetB37jgJgmif3d`) |
| Fonte do código dos nós | `n8n/ligacao/verificar-hmac.js`, `disparo-vapi.jsonbody.js`, `mapear-vapi.js`, `verificar-vapi.js` — repo é a fonte, n8n é cópia publicada (`n8n/README.md`) |

**SIC-HF → n8n (saída):**
- Rota: `POST /api/cron/regua` (fila) ou `POST /api/jornadas/[id]/ligacoes-ia` (botão "Ligar por IA agora")
- Destino: `N8N_WEBHOOK_LIGACAO_URL` (env Hostinger) → webhook LANCADOR
- Assina com `LIGACAO_IA_WEBHOOK_SECRET`
- Payload: `docs/integracoes/n8n-ligacao-ia.md` §1 (`ligacao_id`, `melhor_horario`, `alternativas`, `assistente_id`)

**n8n → SIC-HF (entrada):**
- Rota SIC-HF: `POST /api/webhooks/n8n/ligacao` (contrato §2 do mesmo doc)
- n8n assina com `LIGACAO_IA_WEBHOOK_SECRET` (mesmo segredo, os dois sentidos)
- Vapi → n8n WEBHOOK exige `x-vapi-secret` = `VAPI_SERVER_SECRET` (achado ALTO do pentest 06/09, fechado)
- Destino do callback fixo em env do n8n (`SICHF_CALLBACK_URL`) — **não** viaja mais no payload (era SSRF, corrigido 06/09)

**Envs do container n8n (Easypanel):** `LIGACAO_IA_WEBHOOK_SECRET`, `VAPI_SERVER_SECRET`, `SICHF_CALLBACK_URL`, `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` — bloco em `Downloads\n8n-easypanel.env`.
**Envs do SIC-HF (Hostinger):** `N8N_WEBHOOK_LIGACAO_URL`, `LIGACAO_IA_WEBHOOK_SECRET`, `VAPI_ASSISTENTE_ID`.
**Credencial manual (API não prova):** `Vapi API - RSVP (org nova)` no nó `DISPARO · Vapi POST /call` do LANCADOR — conferir na UI.

**Falta:** validação real (`docs/integracoes/n8n-ligacao-ia.md` §8.2, 10 min, só o João) + Server URL/Secret configurados no assistant `036cdf43…` na Vapi.

---

## (b) Chatwoot (canal WhatsApp) — CÓDIGO PRONTO, SEM ENV

| | |
|---|---|
| Estado | Todo o código SIC-HF↔Chatwoot existe e está testado; zero envs configuradas. Não passa por n8n — é integração direta SIC-HF ↔ API do Chatwoot. |
| n8n envolvido? | **Não.** Citado aqui só porque compartilha a régua "Admin → Integrações" com (a) e (c). |

**SIC-HF → Chatwoot (saída, envio de WhatsApp):**
- `src/server/chatwoot/cliente.ts:118` `enviarWhatsapp({telefone, texto, nome})` — POST na API do Chatwoot (`CHATWOOT_URL`/`CHATWOOT_ACCOUNT_ID`/`CHATWOOT_INBOX_ID`, Bearer `CHATWOOT_API_TOKEN`)
- `src/server/chatwoot/cliente.ts:144` `testarChatwoot()` — botão "Testar" do Admin
- `src/server/chatwoot/cliente.ts:16-24` `faltamChatwootEnvio()`/`faltamChatwoot()`/`chatwootConfigurado()` — usadas por `src/components/admin/abas/IntegracoesAba.tsx:46` para pintar o card verde/cinza

**Chatwoot → SIC-HF (entrada, webhook):**
- `src/app/api/webhooks/chatwoot/route.ts:17` `POST /api/webhooks/chatwoot?token=<CHATWOOT_WEBHOOK_SECRET>` — autenticação por token de query (não HMAC — é o padrão do Chatwoot, diferente de n8n/Hotmart)
- `src/app/api/webhooks/chatwoot/route.ts:34-36` sem `CHATWOOT_WEBHOOK_SECRET` → fail-closed

**Envs (Hostinger, nenhuma existe hoje):** `CHATWOOT_URL`, `CHATWOOT_ACCOUNT_ID`, `CHATWOOT_API_TOKEN`, `CHATWOOT_INBOX_ID`, `CHATWOOT_WEBHOOK_SECRET` (`src/app/api/diagnostico/route.ts:42-46` já lista as 5 no healthcheck).

**Falta:** só configuração — João decide se instala/paga um Chatwoot (self-host ou cloud), cria a inbox de WhatsApp, gera o token e cola as 5 envs. Zero código pendente.

---

## (c) Sala automática (Meet/Zoom) — WORKFLOW NÃO EXISTE

| | |
|---|---|
| Estado | SIC-HF tem os dois lados do contrato prontos e testados (adapter `n8n`, fallback `manual`, webhook de entrada); **o workflow n8n em si nunca foi criado**. |
| Hoje em produção | `sala.provedor` (config, banco) fica em `manual` — advogada cola o link à mão na Ficha → Sessão (`src/components/ficha360/SessaoSala.tsx`). |

**O que o SIC-HF já tem pronto:**
- `src/server/sala/tipos.ts` — contrato `ProvedorSala` (`manual` | `n8n`), `PedidoSala`, `ResultadoPedidoSala`
- `src/server/sala/n8n.ts:1-46` `provedorSalaN8n.solicitar(pedido)` — POST assinado (mesmo padrão HMAC) em `N8N_WEBHOOK_SALA_URL`, timeout 10 s, espera `{id | executionId}` opcional na resposta síncrona
- `src/server/sala/sincronizar.ts` — roda dentro do cron (`POST /api/cron/regua`, etapa 4), janela de 7 dias, retentativa em 1h, idempotente por `sessoes_viabilidade.sala_solicitada_em` (carimba ANTES de chamar o n8n — trava contra corrida de duas passagens do cron)
- `src/app/api/webhooks/n8n/sala/route.ts` — `POST /api/webhooks/n8n/sala`, mesmo nível de segurança do webhook de ligação: fail-closed sem `INTEGRACOES_WEBHOOK_SECRET`, HMAC ±5 min tempo-constante, Zod (`id_evento`, `sessao_id` uuid, `link_sala` https, `provedor?`), rate limit 60/min/IP, idempotente por `(origem='n8n_sala', id_evento)`, grava via RPC `registrar_link_sala` (service_role)
- `src/server/sala/assinatura.ts` — mesmas funções de HMAC/janela/tempo-constante que a ligação (reuso, não duplicação)

**O que falta (workflow n8n, não existe nenhum node):**

**Envs a acrescentar quando existir:**
- Container n8n (Easypanel): `INTEGRACOES_WEBHOOK_SECRET` (mesmo segredo dos dois lados), mais a credencial da API do Meet/Zoom escolhido
- SIC-HF (Hostinger): `N8N_WEBHOOK_SALA_URL`, `INTEGRACOES_WEBHOOK_SECRET`
- Banco: `UPDATE configuracoes SET valor='"n8n"' WHERE chave='sala.provedor'` (senão o adapter fica pulado mesmo com envs certas — `sincronizar.ts` checa provedor configurado ANTES das envs)

**Esqueleto do workflow (só texto, nós na ordem — não implementado):**

1. **Webhook trigger** — recebe `POST` do SIC-HF (payload `PedidoSala`: `sessao_id`, `jornada_id`, `inicio_em`, `fim_em`, `titulo`, `callback_url`)
2. **Code — Verificar HMAC** — replica `verificar-hmac.js` da ligação (mesmo padrão, outro segredo: `INTEGRACOES_WEBHOOK_SECRET` via `lerConfig`); `x-sichf-timestamp` ±5 min, `x-sichf-assinatura` tempo-constante; sem bater, responde 401 e para
3. **IF — `teste === true`?** (mesmo padrão do botão "Testar" da ligação) → responde 200 sem criar sala
4. **HTTP Request — criar reunião** na API do provedor escolhido (Google Calendar API com Meet automático, ou Zoom Meetings API) usando `inicio_em`/`fim_em`/`titulo`; credencial OAuth do provedor fica no n8n (não no SIC-HF)
5. **Code — Montar resposta síncrona** — `{ id: <id da reunião> }` de volta no `HTTP Response` do webhook (para `id_externo` gravado na hora, se quiser)
6. **Code — Assinar callback** — monta `{id_evento: "n8n_sala:"+<id da reunião>, sessao_id, link_sala, provedor}`, HMAC com o mesmo `INTEGRACOES_WEBHOOK_SECRET` (padrão do bloco "assinar" já documentado em `n8n-ligacao-ia.md`)
7. **HTTP Request — POST** para `{{ $json.body.callback_url }}` **fixo do payload recebido no passo 1** (aqui pode vir do payload porque o SIC-HF é quem manda, não a Vapi — sem o SSRF que a ligação teve) com headers `x-sichf-timestamp`/`x-sichf-assinatura`
8. **Respond to Webhook** — `2xx` para o passo 1 se ainda não respondeu

Quem faz o quê: João decide o provedor (Meet ou Zoom, "o que a casa tiver" —
`docs/ARQUITETURA-FASE-4.md` B10) e cria a credencial OAuth; n8n monta o
workflow acima (delegar ao orquestrador quando houver ordem); zero código novo
no SIC-HF — os dois lados já estão prontos e testados.

---

## Onde cada coisa mora (referência rápida)

| Frente | SIC-HF código | n8n workflow | Env que falta |
|---|---|---|---|
| (a) Ligação IA | `src/app/api/webhooks/n8n/ligacao/*`, `n8n/ligacao/*.js` | `zh5tjDcSoHaPaRRL` + `OXetB37jgJgmif3d` (publicados) | nenhuma do lado n8n (feito 07/09); Hostinger pendente (`CONTINUAR-AQUI.md` topo) |
| (b) Chatwoot | `src/server/chatwoot/cliente.ts`, `src/app/api/webhooks/chatwoot/route.ts` | nenhum (direto) | 5 envs Hostinger, zero n8n |
| (c) Sala | `src/server/sala/*`, `src/app/api/webhooks/n8n/sala/route.ts` | **não existe** | workflow n8n + 2 envs (n8n) + 2 envs (Hostinger) + `configuracoes['sala.provedor']` |
