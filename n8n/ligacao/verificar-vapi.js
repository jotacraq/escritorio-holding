'use strict';

// Este arquivo É o código de um nó Code do n8n: CommonJS e `require` são
// obrigatórios lá (não há bundler, não há ESM). Ver n8n/README.md.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const crypto = require('crypto');

/**
 * Autenticação do webhook `Vapi → n8n` (workflow `OXetB37jgJgmif3d`).
 *
 * POR QUE ISTO EXISTE (achado A1 do pentest da Fase 7, 06/09/2026 — ALTO):
 * o path do webhook é público e versionado. Sem esta verificação, QUALQUER um
 * que descobrisse a URL POSTava uma "mensagem da Vapi" forjada; o n8n a
 * assinava com o `LIGACAO_IA_WEBHOOK_SECRET` real e entregava ao SIC-HF. Ou
 * seja: o n8n virava um oráculo de assinatura. Com `ligacao_id` válido em mãos,
 * o forjador dirigia a máquina de estados (agendar sem o cliente, rediscar,
 * envenenar `resumo`/`transcricao` — que alimentam o briefing da advogada).
 *
 * COMO A VAPI AUTENTICA: quando o assistant (ou a org) tem um `server.secret`
 * configurado, a Vapi manda o valor no header `X-Vapi-Secret` de TODA mensagem
 * de servidor. Ver https://docs.vapi.ai/server-url/server-authentication —
 * "Vapi will send your token in the X-Vapi-Secret header".
 *
 * FAIL-CLOSED em três níveis, e a diferença entre eles importa:
 *  - variável `VAPI_SERVER_SECRET` ausente no n8n → `fatal: true`. O nó deve
 *    `throw`: é DEFEITO DE CONFIGURAÇÃO, tem de aparecer vermelho na lista de
 *    execuções, não sumir como "nada a fazer".
 *  - header ausente ou diferente → `fatal: false`. O nó deve `return []`:
 *    é tentativa de terceiro, não é erro nosso, e nada é assinado.
 *  - qualquer outra coisa → inválido. Nunca "deixa passar porque não dá para
 *    conferir".
 *
 * A comparação é feita sobre o SHA-256 dos dois lados: `timingSafeEqual` exige
 * buffers do mesmo tamanho, e comparar comprimento cru já vazaria o tamanho do
 * segredo. Com o digest, os dois lados têm sempre 32 bytes.
 */

const CABECALHO = 'x-vapi-secret';

/** Header, sem depender da caixa (o n8n normaliza para minúsculas; outros não). */
function cabecalho(headers, nome) {
  if (!headers || typeof headers !== 'object') return '';
  const direto = headers[nome];
  if (typeof direto === 'string') return direto;
  const alvo = nome.toLowerCase();
  for (const chave of Object.keys(headers)) {
    if (chave.toLowerCase() === alvo) {
      const v = headers[chave];
      return typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : '';
    }
  }
  return '';
}

function digest(valor) {
  return crypto.createHash('sha256').update(String(valor), 'utf8').digest();
}

/**
 * @param {Record<string, unknown>} headers  `item.json.headers` do nó Webhook.
 * @param {string|null|undefined} segredo    `$vars.VAPI_SERVER_SECRET`.
 * @returns {{valido: boolean, motivo: string|null, fatal: boolean}}
 */
function verificarSegredoVapi(headers, segredo) {
  const esperado = typeof segredo === 'string' ? segredo.trim() : '';
  if (!esperado) {
    return { valido: false, motivo: 'variavel_VAPI_SERVER_SECRET_ausente', fatal: true };
  }

  const recebido = cabecalho(headers, CABECALHO).trim();
  if (!recebido) {
    return { valido: false, motivo: 'segredo_vapi_ausente', fatal: false };
  }

  const valido = crypto.timingSafeEqual(digest(recebido), digest(esperado));
  return valido ? { valido: true, motivo: null, fatal: false } : { valido: false, motivo: 'segredo_vapi_invalido', fatal: false };
}

module.exports = { verificarSegredoVapi: verificarSegredoVapi, CABECALHO_SEGREDO_VAPI: CABECALHO };
