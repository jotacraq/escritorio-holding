'use strict';

// Este arquivo É o código de um nó Code do n8n: CommonJS e `require` são
// obrigatórios lá (não há bundler, não há ESM). Ver n8n/README.md.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const crypto = require('crypto');

/**
 * Nó "Ler corpo cru e verificar HMAC" do workflow
 * `SIC-HF · LIGAÇÃO · LANCADOR → Vapi` (`zh5tjDcSoHaPaRRL`).
 *
 * ESTE ARQUIVO É A FONTE (ver `n8n/README.md`). A verificação é a MESMA de
 * `src/server/integracoes/assinatura.ts`, do outro lado do fio:
 *
 *   x-sichf-timestamp:  segundos Unix (string)
 *   x-sichf-assinatura: "sha256=" + hex(HMAC-SHA256(segredo, timestamp + "." + corpo_cru))
 *
 * Três coisas que este nó NÃO pode perder, e por isso ele é versionado:
 *  1. o corpo assinado é o TEXTO CRU recebido, não o objeto re-serializado —
 *     `JSON.stringify` de um objeto reordena chaves e quebra o HMAC;
 *  2. janela de ±300 s: fecha replay de um corpo capturado ontem;
 *  3. comparação em tempo constante (`timingSafeEqual`) e fail-CLOSED: sem a
 *     variável `LIGACAO_IA_WEBHOOK_SECRET` o resultado é INVÁLIDO, nunca
 *     "deixa passar porque não dá para conferir".
 *
 * O plano Community não tem Variables (`$vars`); o segredo vem de `$env`
 * (env do container no Easypanel, com `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`).
 * `lerConfig` tenta `$vars` primeiro e cai para `$env`.
 */

const JANELA_SEGUNDOS = 300;

/**
 * @param {{corpoCru: string, timestamp: string, assinatura: string, segredo: string, agoraSegundos?: number}} p
 * @returns {{valido: boolean, motivo: string|null}}
 */
function verificar(p) {
  const segredo = String(p.segredo || '');
  if (!segredo) return { valido: false, motivo: 'variavel_LIGACAO_IA_WEBHOOK_SECRET_ausente' };

  const ts = String(p.timestamp || '');
  const agora = typeof p.agoraSegundos === 'number' ? p.agoraSegundos : Math.floor(Date.now() / 1000);
  if (!/^\d{9,11}$/.test(ts) || Math.abs(agora - Number(ts)) > JANELA_SEGUNDOS) {
    return { valido: false, motivo: 'fora_da_janela' };
  }

  const esperado = 'sha256=' + crypto.createHmac('sha256', segredo).update(ts + '.' + String(p.corpoCru ?? '')).digest('hex');
  const a = Buffer.from(esperado);
  const b = Buffer.from(String(p.assinatura || ''));
  const valido = a.length === b.length && crypto.timingSafeEqual(a, b);
  return valido ? { valido: true, motivo: null } : { valido: false, motivo: 'assinatura_invalida' };
}

/**
 * Extrai o corpo cru do item do webhook do n8n.
 *
 * I2 (pentest 06/09): quando o nó Webhook está SEM "Raw Body", o corpo cru não
 * existe e reserializar o JSON quase sempre reordena chaves → o HMAC falha e o
 * SIC-HF leva um 401 sem explicação. Continua fail-closed, mas agora dá para
 * saber por quê: `cru === null` vira `motivo: 'corpo_cru_ausente'`.
 *
 * @returns {{cru: string, bruto: boolean}} `bruto:false` = reserializado (I2).
 */
function corpoCruDoItem(item) {
  if (item && item.binary && item.binary.data && item.binary.data.data) {
    return { cru: Buffer.from(item.binary.data.data, 'base64').toString('utf8'), bruto: true };
  }
  return { cru: JSON.stringify((item && item.json && item.json.body) || {}), bruto: false };
}

/**
 * Variáveis do n8n que o LANCADOR exige ANTES de discar (correção A1 do
 * pentest, 06/09/2026).
 *
 * POR QUE RECUSAR O DISPARO POR FALTA DE VARIÁVEL: a ligação e o resultado dela
 * são coisas separadas. Sem `SICHF_CALLBACK_URL` o WEBHOOK não sabe para onde
 * mandar o resultado; sem `VAPI_SERVER_SECRET` o WEBHOOK descarta TUDO que
 * chega (fail-closed). Nos dois casos a Vapi liga para o cliente de verdade, a
 * assistente oferece os horários, o cliente escolhe — e nada disso volta. O
 * reaper marca `timeout`, `tratarFalha` conta como tentativa e o sistema
 * REDISCA para a mesma pessoa. Discar sem caminho de volta é pior do que não
 * discar: o custo cai no cliente, não no sistema.
 *
 * @param {{vapiSecret?: unknown, callbackUrl?: unknown}} vars
 * @returns {{ok: boolean, motivo: string|null}}
 */
function verificarVariaveisLancador(vars) {
  const v = vars || {};
  const segredoVapi = typeof v.vapiSecret === 'string' ? v.vapiSecret.trim() : '';
  const callback = typeof v.callbackUrl === 'string' ? v.callbackUrl.trim() : '';
  if (!segredoVapi) return { ok: false, motivo: 'variavel_VAPI_SERVER_SECRET_ausente' };
  if (!callback) return { ok: false, motivo: 'variavel_SICHF_CALLBACK_URL_ausente' };
  return { ok: true, motivo: null };
}

module.exports = {
  verificar: verificar,
  corpoCruDoItem: corpoCruDoItem,
  verificarVariaveisLancador: verificarVariaveisLancador,
  JANELA_SEGUNDOS: JANELA_SEGUNDOS,
};

/* ===========================================================================
 * COLA NO NÓ (workflow zh5tjDcSoHaPaRRL → nó "Ler corpo cru e verificar HMAC",
 * tipo Code · JavaScript · Run Once for All Items). É o código acima inline.
 *
 * VERSÃO 07/09/2026 · substitui a anterior INTEIRA. 06/09: correção A1 do pentest;
 * 07/09: `lerConfig` ($vars → $env) porque o plano não tem Variables.
 * Novidades: (1) `motivo: 'corpo_cru_ausente'` quando falta o Raw Body (I2);
 *            (2) recusa o disparo se `VAPI_SERVER_SECRET` ou `SICHF_CALLBACK_URL`
 *                não existirem — nunca discar sem caminho de volta.
 * ===========================================================================

const crypto = require('crypto');
// Configuração (07/09/2026): o plano Community do n8n não tem Variables.
// Lê `$vars` (se um dia existir) e cai para `$env` — env do container no
// Easypanel, que exige N8N_BLOCK_ENV_ACCESS_IN_NODE=false. Fail-closed: vazio = ''.
function lerConfig(nome) {
  try { const v = $vars && $vars[nome]; if (v != null && String(v).trim() !== '') return String(v).trim(); } catch (e) {}
  try { const v = $env && $env[nome]; if (v != null && String(v).trim() !== '') return String(v).trim(); } catch (e) {}
  return '';
}
const item = $input.first();
let cru = '';
let bruto = false;
if (item.binary && item.binary.data && item.binary.data.data) {
  cru = Buffer.from(item.binary.data.data, 'base64').toString('utf8');
  bruto = true;
} else {
  cru = JSON.stringify(item.json.body ?? {});
}
const ts = String(item.json.headers?.['x-sichf-timestamp'] ?? '');
const assinatura = String(item.json.headers?.['x-sichf-assinatura'] ?? '');
const agora = Math.floor(Date.now() / 1000);
const naJanela = /^\d{9,11}$/.test(ts) && Math.abs(agora - Number(ts)) <= 300;
let dados = item.json.body ?? {};
if (!dados || Object.keys(dados).length === 0) { try { dados = JSON.parse(cru); } catch (e) { dados = {}; } }
const segredo = lerConfig('LIGACAO_IA_WEBHOOK_SECRET');
const segredoVapi = lerConfig('VAPI_SERVER_SECRET');
const callbackUrl = lerConfig('SICHF_CALLBACK_URL');
let valido = false;
let motivo = null;
if (!segredo) motivo = 'variavel_LIGACAO_IA_WEBHOOK_SECRET_ausente';
else if (!naJanela) motivo = 'fora_da_janela';
else {
  const esperado = 'sha256=' + crypto.createHmac('sha256', segredo).update(ts + '.' + cru).digest('hex');
  const a = Buffer.from(esperado); const b = Buffer.from(assinatura);
  valido = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!valido) motivo = bruto ? 'assinatura_invalida' : 'corpo_cru_ausente';
}
// Só DEPOIS de autenticar: estado de configuração não se conta a estranho.
if (valido && !segredoVapi) { valido = false; motivo = 'variavel_VAPI_SERVER_SECRET_ausente'; }
if (valido && !callbackUrl) { valido = false; motivo = 'variavel_SICHF_CALLBACK_URL_ausente'; }
return [{ json: { valido, motivo, dados, callback_url: callbackUrl, segredo_vapi_ok: Boolean(segredoVapi) } }];

 * Nós seguintes:
 *  - IF `{{ $json.valido }}` → falso: Respond to Webhook 401
 *    `{ erro: "nao_autorizado", motivo: {{ $json.motivo }} }`.
 *  - IF `{{ $json.dados.teste }}` → verdadeiro: Respond 200 `{ok:true,teste:true}`.
 *    (O "Testar" do Admin passa a acusar 401 enquanto faltar qualquer das três
 *    variáveis — é exatamente o que a tela precisa mostrar.)
 *  - DISPARO · Vapi `POST https://api.vapi.ai/call` — jsonBody em
 *    `n8n/ligacao/disparo-vapi.jsonbody.js`.
 *  - Respond to Webhook 200 `{ id_externo: {{ $json.id ?? null }} }`.
 *
 * POR QUE `segredo_vapi_ok` É BOOLEANO, e não o segredo: o `json` de cada item
 * fica gravado nos dados de execução do n8n e é lido por qualquer um que abra a
 * execução na UI. Como o segredo é gravado no ASSISTANT da Vapi (ver
 * `disparo-vapi.jsonbody.js`), o LANCADOR só precisa SABER que ele existe —
 * carregar o valor pelo fluxo seria vazá-lo no log sem necessidade.
 *
 * `metadata.horarios` é OBRIGATÓRIO no DISPARO: é por ele que o WEBHOOK converte
 * a `opcao_escolhida` da assistente em ISO. Sem ele o mapeamento devolve
 * `motivo_falha: 'sem_horarios_no_metadata'` (ver `mapear-vapi.js`, F6).
 * =========================================================================== */
