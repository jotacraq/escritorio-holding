// Monta o código dos nós Code a partir dos arquivos versionados em n8n/ligacao/
// e emite os dois scripts do n8n Workflow SDK (entrada de validate_workflow /
// update_workflow do MCP do n8n). Assim "o repositório é a fonte" vira mecânico.
//
// Uso: node n8n/gerar-sdk.mjs <dir-saida>   (padrão: tmp/squad)
// Saída: sdk-lancador.js · sdk-webhook.js (SDK) · no-lancador.js · no-webhook.js
//        (só o jsCode de cada nó Code, para conferir/colar à mão).
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] || 'tmp/squad';
const ler = (f) => fs.readFileSync(path.join('n8n/ligacao', f), 'utf8');
const entre = (s, ini, fim) => {
  const i = s.indexOf(ini); if (i < 0) throw new Error('não achei: ' + ini.slice(0, 40));
  const j = s.indexOf(fim, i); if (j < 0) throw new Error('não achei o fim: ' + fim.slice(0, 40));
  return s.slice(i, j);
};
// do marcador até a próxima linha de comentário " * " (fecho do bloco COLA NO NÓ)
const ateComentario = (s, ini) => {
  const i = s.indexOf(ini); if (i < 0) throw new Error('não achei: ' + ini.slice(0, 40));
  const resto = s.slice(i);
  const mm = resto.match(/\n \*[ \n]/); if (!mm) throw new Error('sem fecho de comentário');
  return resto.slice(0, mm.index + 1);
};

// LANCADOR: o bloco COLA NO NÓ inteiro (do `const crypto` dentro do bloco até o fecho)
const hmac = ler('verificar-hmac.js');
const lancadorCode = ateComentario(hmac.slice(hmac.indexOf('COLA NO NÓ')), "const crypto = require('crypto');").trimEnd() + '\n';

// WEBHOOK: crypto + mapear (puro) + verificar-vapi (puro) + cauda do COLA NO NÓ
const mapear = ler('mapear-vapi.js');
const vapi = ler('verificar-vapi.js');
const cauda = mapear.slice(mapear.indexOf('COLA NO NÓ'));
const marcador = 'até o fim de `function verificarSegredoVapi(...) { ... }` >>>\n';
const inicioCauda = cauda.slice(cauda.indexOf(marcador) + marcador.length).trimStart().slice(0, 40);
const webhookCode = "const crypto = require('crypto');\n\n"
  + entre(mapear, 'const SEM_RESPOSTA = [', 'module.exports')
  + entre(vapi, "const CABECALHO = 'x-vapi-secret';", 'module.exports')
  + ateComentario(cauda, inicioCauda).trimEnd() + '\n';

const body = ler('disparo-vapi.jsonbody.js');
const jsonBody = body.slice(body.indexOf('*/') + 2).trim();
if (!jsonBody.startsWith('JSON.stringify(')) throw new Error('jsonBody inesperado');

const J = (s) => JSON.stringify(s);
const stickyL = '## SIC-HF · Ligação por IA · LANCADOR + DISPARO\n\nContrato: docs/integracoes/n8n-ligacao-ia.md (repo escritorio-holding). FONTE DO CÓDIGO: n8n/ligacao/verificar-hmac.js (nó Code) e n8n/ligacao/disparo-vapi.jsonbody.js (jsonBody); republicação por n8n/gerar-sdk.mjs. 06/09: correção A1 (recusa discar sem VAPI_SERVER_SECRET e SICHF_CALLBACK_URL). 07/09: configuração por $env (o plano não tem Variables).\n\nENV DO CONTAINER (Easypanel → n8n → Environment; exige N8N_BLOCK_ENV_ACCESS_IN_NODE=false): LIGACAO_IA_WEBHOOK_SECRET (a MESMA da Hostinger) · VAPI_SERVER_SECRET (o mesmo gravado no assistant da Vapi) · SICHF_CALLBACK_URL. Número de saída fixo: +55 21 3828-0635 (org nova). Credencial: Vapi API - RSVP (org nova).\n\nNa Hostinger: N8N_WEBHOOK_LIGACAO_URL = URL de produção deste webhook; VAPI_ASSISTENTE_ID = 036cdf43-4549-4251-bc6a-55b71b3f51b4.';
const stickyW = '## SIC-HF · Ligação por IA · WEBHOOK\n\nServer URL da assistente na Vapi = URL de produção deste webhook (assistente "SIC-HF · Ana", id 036cdf43-4549-4251-bc6a-55b71b3f51b4) + Server Secret = VAPI_SERVER_SECRET.\n\nFONTE DO CÓDIGO: repo escritorio-holding, n8n/ligacao/mapear-vapi.js + verificar-vapi.js (testados com vitest); republicação por n8n/gerar-sdk.mjs. 06/09: correção A1 (confere x-vapi-secret antes de tudo; callback_url vem da configuração, nunca do corpo). 07/09: configuração por $env (o plano não tem Variables).\n\nENV DO CONTAINER (Easypanel; N8N_BLOCK_ENV_ACCESS_IN_NODE=false): LIGACAO_IA_WEBHOOK_SECRET · VAPI_SERVER_SECRET · SICHF_CALLBACK_URL. Eventos fora do mapa são ignorados. 5xx do SIC-HF → retry do nó HTTP (idempotente por id_evento).';

const cond = (left) => `{ conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, combinator: 'and', conditions: [{ leftValue: expr(${J('{{ ' + left + ' }}')}), rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }] } }`;

const sdkLancador = `import { workflow, node, trigger, sticky, ifElse, expr } from '@n8n/workflow-sdk';

const lancador = trigger({ type: 'n8n-nodes-base.webhook', version: 2.1,
  config: { name: 'LANCADOR (SIC-HF → n8n)', parameters: { httpMethod: 'POST', path: 'sichf-ligacao-lancador', responseMode: 'responseNode', options: { rawBody: true } } } });

const verificar = node({ type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Ler corpo cru e verificar HMAC', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: ${J(lancadorCode)} } } });

const assinaturaValida = ifElse({ version: 2.3, config: { name: 'Assinatura válida?', parameters: ${cond('$json.valido')} } });
const ehTeste = ifElse({ version: 2.3, config: { name: 'É teste?', parameters: ${cond('$json.dados.teste')} } });

const responderTeste = node({ type: 'n8n-nodes-base.respondToWebhook', version: 1.5,
  config: { name: 'Responder teste OK', parameters: { respondWith: 'json', responseBody: '{"ok":true,"teste":true}', options: { responseCode: 200 } } } });

const disparo = node({ type: 'n8n-nodes-base.httpRequest', version: 4.4,
  config: { name: 'DISPARO · Vapi POST /call', parameters: {
    method: 'POST', url: 'https://api.vapi.ai/call',
    authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
    sendBody: true, contentType: 'json', specifyBody: 'json',
    jsonBody: expr(${J('{{ ' + jsonBody + ' }}')}),
    options: { timeout: 20000 } },
    credentials: { httpHeaderAuth: { id: '6a1uFzfl7OV2tr6C', name: 'Vapi API - RSVP (org nova)' } } } });

const responderId = node({ type: 'n8n-nodes-base.respondToWebhook', version: 1.5,
  config: { name: 'Responder id_externo', parameters: { respondWith: 'json', responseBody: expr('{{ JSON.stringify({ id_externo: $json.id ?? null }) }}'), options: { responseCode: 200 } } } });

const responder401 = node({ type: 'n8n-nodes-base.respondToWebhook', version: 1.5,
  config: { name: 'Responder 401', parameters: { respondWith: 'json', responseBody: expr('{{ JSON.stringify({ erro: "nao_autorizado", motivo: $json.motivo ?? null }) }}'), options: { responseCode: 401 } } } });

export default workflow('sichf-ligacao-lancador', 'SIC-HF · LIGAÇÃO · LANCADOR → Vapi')
  .add(sticky(${J(stickyL)}, [lancador, verificar], { color: 5 }))
  .add(lancador)
  .to(verificar)
  .to(assinaturaValida
    .onTrue(ehTeste.onTrue(responderTeste).onFalse(disparo.to(responderId)))
    .onFalse(responder401));
`;

const sdkWebhook = `import { workflow, node, trigger, sticky, expr } from '@n8n/workflow-sdk';

const webhook = trigger({ type: 'n8n-nodes-base.webhook', version: 2.1,
  config: { name: 'WEBHOOK (Vapi → n8n)', parameters: { httpMethod: 'POST', path: 'sichf-ligacao-vapi', responseMode: 'onReceived', options: {} } } });

const mapear = node({ type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Mapear Vapi → evento SIC-HF e assinar', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: ${J(webhookCode)} } } });

const callback = node({ type: 'n8n-nodes-base.httpRequest', version: 4.4,
  config: { name: 'POST callback SIC-HF', retryOnFail: true, parameters: {
    method: 'POST', url: expr('{{ $json.callback_url }}'),
    sendHeaders: true, specifyHeaders: 'keypair',
    headerParameters: { parameters: [
      { name: 'content-type', value: 'application/json' },
      { name: 'x-sichf-timestamp', value: expr('{{ $json.ts }}') },
      { name: 'x-sichf-assinatura', value: expr('{{ $json.assinatura }}') } ] },
    sendBody: true, specifyBody: 'string', contentType: 'raw', rawContentType: 'application/json', body: expr('{{ $json.corpo }}'),
    options: { timeout: 30000, response: { response: { fullResponse: true, neverError: false } } } } } });

export default workflow('sichf-ligacao-webhook', 'SIC-HF · LIGAÇÃO · WEBHOOK Vapi → SIC-HF')
  .add(sticky(${J(stickyW)}, [webhook, mapear], { color: 5 }))
  .add(webhook)
  .to(mapear)
  .to(callback);
`;

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'sdk-lancador.js'), sdkLancador);
fs.writeFileSync(path.join(out, 'sdk-webhook.js'), sdkWebhook);
fs.writeFileSync(path.join(out, 'no-lancador.js'), lancadorCode);
fs.writeFileSync(path.join(out, 'no-webhook.js'), webhookCode);
console.log('ok', { lancador: lancadorCode.length, webhook: webhookCode.length, jsonBody: jsonBody.length });
