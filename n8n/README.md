# `n8n/` — o código dos nós vive AQUI, não só no n8n

Até a Fase 6, o código dos nós Code do n8n existia em um lugar só: dentro do
n8n. Isso significava que ninguém conseguia revisar, testar nem reverter a peça
mais delicada da integração — a que decide se um retorno da Vapi é autêntico e
o que ele quer dizer. Um `slice` a menos ali derruba um agendamento já
conquistado, e o erro só aparece como "422" num log.

**Regra: o repositório é a fonte. O n8n é uma cópia publicada.**

| Arquivo | Nó | Workflow |
|---|---|---|
| `ligacao/verificar-hmac.js` | "Ler corpo cru e verificar HMAC" | `SIC-HF · LIGAÇÃO · LANCADOR → Vapi` — `zh5tjDcSoHaPaRRL` |
| `ligacao/disparo-vapi.jsonbody.js` | "DISPARO · Vapi" (campo `jsonBody`) | `SIC-HF · LIGAÇÃO · LANCADOR → Vapi` — `zh5tjDcSoHaPaRRL` |
| `ligacao/mapear-vapi.js` | "Mapear Vapi → evento SIC-HF e assinar" | `SIC-HF · LIGAÇÃO · WEBHOOK Vapi → SIC-HF` — `OXetB37jgJgmif3d` |
| `ligacao/verificar-vapi.js` | idem — vai colado **antes** do mapeamento, no mesmo nó | `OXetB37jgJgmif3d` |

> **06/09/2026 — os três arquivos do topo mudaram** (achado A1 do pentest da
> Fase 7: o webhook `Vapi → n8n` não autenticava nada e o destino do POST
> assinado vinha do corpo recebido). Os dois workflows precisam ser
> republicados; enquanto não forem, a versão publicada é explorável. Roteiro em
> `docs/integracoes/n8n-ligacao-ia.md` §8.2 e §8.4.

Cada arquivo tem duas partes, separadas por comentário:

1. **a função pura** (`module.exports`), que os testes de
   `src/server/ligacao-ia/*.test.ts` exercitam com payload real da Vapi
   (`npx vitest run`);
2. **o bloco "COLA NO NÓ"**, que é o mesmo código inline mais o que só existe
   dentro do n8n (`$input`, `$vars`, `require('crypto')`).

O n8n **não** faz `require` de arquivo deste repositório — a duplicação é
inevitável. O que o repositório garante é que a versão revisada e testada existe
em algum lugar, e que a diferença é visível.

## Como sincronizar (quem publica é o orquestrador)

1. Mudou a função pura? Rode `npx vitest run` — os testes cobrem
   `status-update` (queued/ringing/in-progress) e `end-of-call-report` para cada
   `endedReason` que a Vapi devolve.
2. **Caminho mecânico (07/09/2026):** `node n8n/gerar-sdk.mjs tmp/squad` monta o
   `jsCode` de cada nó a partir destes arquivos e emite `sdk-lancador.js` /
   `sdk-webhook.js` (n8n Workflow SDK). Passe cada um a `validate_workflow` →
   `update_workflow` (ids `zh5tjDcSoHaPaRRL` / `OXetB37jgJgmif3d`) →
   `publish_workflow` no MCP do n8n. A API **não devolve nem prova credencial**
   do nó HTTP: depois de publicar, abra `DISPARO · Vapi POST /call` e confirme
   `Vapi API - RSVP (org nova)` selecionada.
   *Caminho manual:* abra o workflow no n8n → o nó da tabela acima → cole o
   bloco "COLA NO NÓ" inteiro (ele já inclui a função inline).
3. Salve e **ative**. Confira em Executions que a próxima execução real passou.
4. Anote no `brain/Diário/AAAA-MM-DD.md` o que foi publicado.

## O que NÃO vive aqui

- **Segredos.** São **três** valores de configuração, desde 06/09:
  `LIGACAO_IA_WEBHOOK_SECRET` (também env da Hostinger), `VAPI_SERVER_SECRET`
  (também gravado como Server Secret do assistant na Vapi) e `SICHF_CALLBACK_URL`
  (endereço, não segredo, mas é configuração: é o único destino para onde o n8n
  devolve resultado). Nunca no JSON do workflow, nunca neste repositório.
  **Onde vivem (07/09/2026):** o n8n do João é Community (auto-hospedado no
  Easypanel) e **não tem Variables**. Os nós leem por `lerConfig(nome)`, que
  tenta `$vars` e cai para **`$env`** — variáveis de ambiente do container
  (Easypanel → serviço n8n → Environment), o que exige
  `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` no mesmo lugar. Trade-off aceito: com
  esse flag, qualquer nó Code da instância enxerga todas as envs do container
  (inclusive as do próprio n8n) — aceitável porque a instância tem um único
  usuário; se um dia houver mais gente editando workflows, migrar para o plano
  com Variables e o `lerConfig` passa a usar `$vars` sem mudar nada.
- **O JSON do workflow.** Exportar o workflow inteiro traria ids de credencial e
  ruído de posição de nó; o que importa (e o que quebra) é o código dos nós Code.
- **O prompt da assistente.** Vive na Vapi e está versionado em
  `docs/integracoes/vapi-assistente-sichf.md`.

Contrato completo dos dois sentidos: `docs/integracoes/n8n-ligacao-ia.md`.
