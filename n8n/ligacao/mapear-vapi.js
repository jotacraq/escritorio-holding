'use strict';

/**
 * Nó "Mapear Vapi → evento SIC-HF e assinar" do workflow
 * `SIC-HF · LIGAÇÃO · WEBHOOK Vapi → SIC-HF` (`OXetB37jgJgmif3d`).
 *
 * ESTE ARQUIVO É A FONTE. O que está publicado no n8n é uma cópia — quando
 * mudar aqui, republique (ver `n8n/README.md`). O corpo da função é puro de
 * propósito: dá para testar cada `endedReason` da Vapi sem n8n, sem rede e sem
 * relógio (`npx vitest run`).
 *
 * O QUE MUDOU EM RELAÇÃO AO QUE ESTÁ PUBLICADO (06/09/2026, Fase 7 · agente LIG)
 * — tudo motivado por um jeito real de PERDER um agendamento já conquistado:
 *
 *  F1. TRUNCAGEM. `POST /api/webhooks/n8n/ligacao` valida com Zod:
 *      `transcricao` ≤ 200 000, `resumo` ≤ 4 000, `motivo_falha` ≤ 500. Uma
 *      ligação longa estourava `resumo`/`transcricao` e o evento INTEIRO voltava
 *      422 — inclusive quando trazia o horário que o cliente escolheu. Agora o
 *      mapeamento corta no limite (com "…" no fim) em vez de perder o evento.
 *  F2. `gravacao_url` só vai quando é URL de verdade. A Vapi manda `""` quando a
 *      gravação está desligada, e `z.string().url()` recusa string vazia → 422.
 *  F3. FALLBACKS de campo. Payloads recentes da Vapi entregam
 *      `transcript`/`summary`/`recordingUrl` dentro de `artifact`/`analysis`.
 *      Sem isso a transcrição chegava nula em ligação que teve transcrição.
 *  F4. `cost` cai para `costBreakdown.total` quando ausente, e é limitado a
 *      1 000 (teto do Zod). NULL continua NULL — nunca vira zero.
 *  F5. `durationSeconds` cai para `durationMs / 1000` e, na falta dos dois, para
 *      `endedAt − startedAt`. Limitado a 86 400 s.
 *  F6. `opcao_escolhida` válida mas `metadata.horarios` vazio não vira mais
 *      `pediu_retorno` mudo: registra `motivo_falha: 'sem_horarios_no_metadata'`,
 *      que é o que de fato aconteceu (o LANCADOR não mandou os horários).
 *  F7. `id_evento` limitado a 200 caracteres (limite do Zod e da coluna).
 *
 * O CONTRATO NÃO MUDOU: mesmos eventos, mesmos `resultado`, mesmo `id_evento`.
 *
 * ---------------------------------------------------------------------------
 * F8 (06/09/2026, correção do achado A1 do pentest — ALTO · CWE-918 + CWE-287)
 *
 * O `callback_url` NÃO VEM MAIS DO `metadata`. Ele agora é PARÂMETRO da função
 * e, no nó, vem de `$vars.SICHF_CALLBACK_URL` (fail-closed: sem a variável, o
 * nó lança).
 *
 * O que era: `metadata.callback_url` chegava dentro do corpo do webhook —
 * ou seja, ERA ENTRADA DE QUEM CHAMA. Quem descobrisse a URL pública do
 * webhook mandava um corpo com `callback_url` próprio e o n8n assinava o
 * payload com o `LIGACAO_IA_WEBHOOK_SECRET` real e o entregava lá:
 *   (a) SSRF a partir da VPS do n8n (rede interna, endpoint de metadata);
 *   (b) oráculo de assinatura para `POST /api/webhooks/n8n/ligacao`.
 * Destino de POST assinado é decisão de CONFIGURAÇÃO, nunca de payload.
 *
 * A segunda metade da correção vive em `verificar-vapi.js`: antes de mapear
 * qualquer coisa, o nó confere `x-vapi-secret` contra `$vars.VAPI_SERVER_SECRET`.
 * ---------------------------------------------------------------------------
 */

const SEM_RESPOSTA = [
  'customer-did-not-answer',
  'voicemail',
  'customer-busy',
  'twilio-failed-to-connect-call',
  'silence-timed-out',
];

const LIMITE = {
  transcricao: 200000,
  resumo: 4000,
  motivo_falha: 500,
  gravacao_url: 2000,
  id_evento: 200,
  id_externo: 200,
  custo_usd: 1000,
  duracao_s: 86400,
};

function texto(valor, limite) {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  if (limpo.length === 0) return null;
  return limpo.length <= limite ? limpo : limpo.slice(0, limite - 1) + '…';
}

function url(valor) {
  const t = texto(valor, LIMITE.gravacao_url);
  if (!t) return null;
  return /^https?:\/\//i.test(t) ? t : null;
}

function numero(valor, maximo) {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0) return null;
  return Math.min(valor, maximo);
}

/** Segundos de duração: `durationSeconds` → `durationMs` → `endedAt - startedAt`. */
function duracao(m) {
  const direto = numero(m.durationSeconds, LIMITE.duracao_s);
  if (direto !== null) return Math.round(direto);
  const ms = numero(m.durationMs, LIMITE.duracao_s * 1000);
  if (ms !== null) return Math.round(ms / 1000);
  const inicio = Date.parse(m.startedAt ?? '');
  const fim = Date.parse(m.endedAt ?? '');
  if (Number.isFinite(inicio) && Number.isFinite(fim) && fim >= inicio) {
    return Math.min(Math.round((fim - inicio) / 1000), LIMITE.duracao_s);
  }
  return null;
}

function custo(m) {
  const direto = numero(m.cost, LIMITE.custo_usd);
  if (direto !== null) return Math.round(direto * 10000) / 10000;
  const quebra = m.costBreakdown && numero(m.costBreakdown.total, LIMITE.custo_usd);
  return quebra === null || quebra === undefined ? null : Math.round(quebra * 10000) / 10000;
}

/**
 * Trava final do destino (F8). O valor já vem só da configuração
 * (`$vars.SICHF_CALLBACK_URL`); esta função existe para que um dia em que
 * alguém volte a passar `metadata.callback_url` aqui por engano, o
 * `http://169.254.169.254/latest/meta-data/` da PoC do pentest continue não
 * saindo daqui. `http://` só para `localhost`/`127.0.0.1` (o `simular-webhook`
 * roda contra o dev server).
 */
function destinoValido(valor) {
  if (typeof valor !== 'string') return null;
  const url = valor.trim();
  if (/^https:\/\/[^\s/]+\//.test(url) || /^https:\/\/[^\s/]+$/.test(url)) return url;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url)) return url;
  return null;
}

function comuns(m) {
  const artefato = m.artifact || {};
  const analise = m.analysis || {};
  return {
    transcricao: texto(m.transcript ?? artefato.transcript, LIMITE.transcricao),
    resumo: texto(m.summary ?? analise.summary ?? artefato.summary, LIMITE.resumo),
    gravacao_url: url(m.recordingUrl ?? artefato.recordingUrl ?? (artefato.recording && artefato.recording.stereoUrl)),
    custo_usd: custo(m),
    duracao_s: duracao(m),
  };
}

/**
 * Traduz `message` da Vapi no corpo que `POST /api/webhooks/n8n/ligacao` espera.
 *
 * @param {object} mensagem      `body.message` do webhook da Vapi.
 * @param {string} callbackUrl   Destino do POST assinado. VEM DA CONFIGURAÇÃO
 *   (`$vars.SICHF_CALLBACK_URL`), NUNCA do corpo recebido — ver F8 no topo.
 * @returns {{payload: object, callback_url: string}|null}
 *          `null` = nada a mandar (tipo ignorado, status intermediário,
 *          ligação sem `metadata.ligacao_id` — não é nossa — ou destino não
 *          configurado).
 */
function mapear(mensagem, callbackUrl) {
  const m = mensagem || {};
  const call = m.call || {};
  const meta = call.metadata || {};
  const ligacaoId = meta.ligacao_id;
  const destino = destinoValido(callbackUrl);
  if (!ligacaoId || !destino) return null;

  const tipo = m.type;
  let evento = null;
  let extra = {};

  if (tipo === 'status-update') {
    const s = m.status;
    if (s === 'queued' || s === 'ringing') evento = 'discando';
    else if (s === 'in-progress') evento = 'em_ligacao';
    else return null;
  } else if (tipo === 'end-of-call-report') {
    const reason = String(m.endedReason ?? '');
    const sd = (m.analysis && m.analysis.structuredData) || {};
    const falhaProvedor = /error|failed|invalid|unknown-error|pipeline/i.test(reason) && !SEM_RESPOSTA.includes(reason);
    const comum = comuns(m);

    if (SEM_RESPOSTA.includes(reason) || sd.resultado === 'caixa_postal') {
      evento = 'sem_resposta';
      extra = Object.assign(
        {
          resultado: reason === 'voicemail' || sd.resultado === 'caixa_postal' ? 'caixa_postal' : null,
          motivo_falha: texto(reason, LIMITE.motivo_falha) || 'caixa_postal',
        },
        comum,
      );
    } else if (falhaProvedor) {
      evento = 'falhou';
      extra = Object.assign(
        {
          resultado: /invalid|number/i.test(reason) ? 'numero_invalido' : null,
          motivo_falha: texto(reason, LIMITE.motivo_falha) || 'falha_no_provedor',
        },
        comum,
      );
    } else {
      evento = 'concluida';
      const horarios = Array.isArray(meta.horarios) ? meta.horarios.filter(Boolean) : [];
      const opcao = Number(sd.opcao_escolhida);
      const opcaoValida = Number.isInteger(opcao) && opcao >= 1;

      let horario = null;
      let motivoFalha = null;
      if (opcaoValida && opcao <= horarios.length) {
        horario = horarios[opcao - 1];
      } else if (sd.horario_escolhido && horarios.includes(String(sd.horario_escolhido))) {
        horario = String(sd.horario_escolhido);
      } else if (opcaoValida && horarios.length === 0) {
        // F6: a assistente escolheu, mas o LANCADOR não mandou `metadata.horarios`.
        // Não é "pediu retorno" — é defeito de integração, e tem de aparecer.
        motivoFalha = 'sem_horarios_no_metadata';
      }

      const r = String(sd.resultado ?? '');
      let resultado = null;
      if (horario) resultado = null;
      else if (r === 'recusou') resultado = 'recusou';
      else resultado = 'pediu_retorno';

      extra = Object.assign({ horario_escolhido: horario, resultado }, comum);
      if (motivoFalha) extra.motivo_falha = motivoFalha;
      if (sd.observacao) {
        extra.resumo = texto([extra.resumo, 'Pedido à equipe: ' + String(sd.observacao)].filter(Boolean).join(' · '), LIMITE.resumo);
      }
    }
  } else {
    return null;
  }

  const payload = Object.assign(
    {
      id_evento: String('vapi:' + (call.id || 'sem-id') + ':' + tipo + ':' + evento).slice(0, LIMITE.id_evento),
      ligacao_id: ligacaoId,
      evento: evento,
      id_externo: texto(call.id, LIMITE.id_externo),
    },
    extra,
  );

  return { payload: payload, callback_url: destino };
}

module.exports = { mapear: mapear, destinoValido: destinoValido, SEM_RESPOSTA: SEM_RESPOSTA, LIMITE: LIMITE };

/* ===========================================================================
 * COLA NO NÓ (n8n → workflow OXetB37jgJgmif3d → nó "Mapear Vapi → evento
 * SIC-HF e assinar", tipo Code · JavaScript · Run Once for All Items).
 *
 * VERSÃO 07/09/2026 · substitui a anterior INTEIRA (06/09: correção A1 do
 * pentest; 07/09: `lerConfig` $vars → $env). Novidades: (1) confere `x-vapi-secret` ANTES de qualquer coisa;
 *            (2) `callback_url` vem de `$vars.SICHF_CALLBACK_URL`, nunca do corpo.
 *
 * O n8n não faz `require` de arquivo do repo: o bloco abaixo é o MESMO código
 * acima, inline, mais a assinatura HMAC. O plano Community não tem Variables:
 * `lerConfig` tenta `$vars` e cai para `$env` (env do container no Easypanel,
 * exige `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`). São TRÊS:
 *   LIGACAO_IA_WEBHOOK_SECRET · VAPI_SERVER_SECRET · SICHF_CALLBACK_URL
 * ===========================================================================

const crypto = require('crypto');

// <<< cole aqui, sem alterar, de `const SEM_RESPOSTA = [` até o fim de `function mapear(...) { ... }` >>>
// <<< e, de `n8n/ligacao/verificar-vapi.js`, de `const CABECALHO = ` até o fim de `function verificarSegredoVapi(...) { ... }` >>>

// Configuração (07/09/2026): o plano Community do n8n não tem Variables.
// Lê `$vars` (se um dia existir) e cai para `$env` — env do container no
// Easypanel, que exige N8N_BLOCK_ENV_ACCESS_IN_NODE=false. Fail-closed: vazio = ''.
function lerConfig(nome) {
  try { const v = $vars && $vars[nome]; if (v != null && String(v).trim() !== '') return String(v).trim(); } catch (e) {}
  try { const v = $env && $env[nome]; if (v != null && String(v).trim() !== '') return String(v).trim(); } catch (e) {}
  return '';
}

const item = $input.first();

// 1. AUTENTICAÇÃO. Sem isto, qualquer um POSTa uma "mensagem da Vapi" forjada
//    e o n8n a assina com o segredo real (achado A1 — ALTO).
const segredoVapi = lerConfig('VAPI_SERVER_SECRET');
const auth = verificarSegredoVapi(item.json.headers || {}, segredoVapi);
if (auth.fatal) throw new Error('Variável VAPI_SERVER_SECRET ausente no n8n (env do container no Easypanel)');
if (!auth.valido) return [];   // tentativa de terceiro: nada é assinado, nada sai

// 2. DESTINO fixo da configuração — NUNCA do corpo recebido.
const callbackUrl = lerConfig('SICHF_CALLBACK_URL');
if (!callbackUrl) throw new Error('Variável SICHF_CALLBACK_URL ausente no n8n (env do container no Easypanel)');

const entrada = item.json;
const resultado = mapear(entrada.body?.message ?? entrada.message ?? {}, callbackUrl);
if (!resultado) return [];

const corpo = JSON.stringify(resultado.payload);
const ts = String(Math.floor(Date.now() / 1000));
const segredo = lerConfig('LIGACAO_IA_WEBHOOK_SECRET');
if (!segredo) throw new Error('Variável LIGACAO_IA_WEBHOOK_SECRET ausente no n8n (env do container no Easypanel)');
const assinatura = 'sha256=' + crypto.createHmac('sha256', segredo).update(ts + '.' + corpo).digest('hex');
return [{ json: { corpo, ts, assinatura, callback_url: resultado.callback_url } }];

 * Depois: nó HTTP Request `POST {{ $json.callback_url }}`, Body = Raw/JSON
 * `{{ $json.corpo }}` (NÃO deixe o n8n re-serializar — o HMAC é sobre estes
 * bytes exatos), headers `x-sichf-timestamp` / `x-sichf-assinatura`,
 * `content-type: application/json`, timeout 30 s, `retryOnFail: true`.
 *
 * ATENÇÃO: o webhook da Vapi responde `onReceived` (200 imediato). Falha no
 * callback NÃO volta para a Vapi — a única reentrega é o retry deste nó HTTP.
 *
 * PRÉ-REQUISITO NA VAPI (só o João faz, uma vez): o assistant
 * `036cdf43-4549-4251-bc6a-55b71b3f51b4` precisa ter Server URL = a URL deste
 * webhook e um Server Secret igual a `$vars.VAPI_SERVER_SECRET`. Sem isso a
 * Vapi não manda `x-vapi-secret` e TODA mensagem cai no `return []` — as
 * ligações acontecem e o resultado nunca chega. Ver
 * `docs/integracoes/n8n-ligacao-ia.md` §8.4.
 * =========================================================================== */
