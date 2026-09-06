/* ===========================================================================
 * jsonBody do nó "DISPARO · Vapi" (`POST https://api.vapi.ai/call`) do workflow
 * `SIC-HF · LIGAÇÃO · LANCADOR → Vapi` (`zh5tjDcSoHaPaRRL`).
 *
 * Este arquivo não é executado por ninguém: é a FONTE VERSIONADA do campo
 * `jsonBody` do nó HTTP Request. Ver `n8n/README.md`.
 *
 * VERSÃO 06/09/2026 — correção A1 do pentest. Um único delta em relação ao que
 * está publicado: **`metadata.callback_url` SAIU**.
 *
 * Por quê: o WEBHOOK (`OXetB37jgJgmif3d`) lia o destino do POST assinado de
 * `message.call.metadata.callback_url`, ou seja, de dentro do corpo que
 * chegava pela internet. Quem descobrisse a URL pública do webhook mandava o
 * destino que quisesse e o n8n assinava o payload com o
 * `LIGACAO_IA_WEBHOOK_SECRET` real e o entregava lá (SSRF a partir da VPS +
 * oráculo de assinatura). Agora o destino é `$vars.SICHF_CALLBACK_URL`, e o
 * SIC-HF nem manda mais o campo (`src/server/ligacao-ia/n8n.ts`).
 *
 * ---------------------------------------------------------------------------
 * O SEGREDO DO SERVER FICA NO ASSISTANT, NÃO AQUI — e isso é uma decisão, não
 * um esquecimento.
 *
 * A documentação da Vapi (docs.vapi.ai/server-url/setting-server-urls,
 * consultada em 06/09/2026) lista QUATRO lugares onde o Server URL pode ser
 * definido — ferramenta, assistant, número de telefone e organização — e **não
 * documenta a chamada (`assistantOverrides.server`) como um deles**. A página
 * de autenticação (docs.vapi.ai/server-url/server-authentication) confirma o
 * mecanismo do header: *"Vapi will send your token in the `X-Vapi-Secret`
 * header"*, configurado por credencial Bearer Token com header `X-Vapi-Secret`
 * e sem prefixo `Bearer`.
 *
 * Como mandar um campo que a API pode recusar transformaria TODA ligação num
 * 400, o `assistantOverrides.server` NÃO entra aqui. O caminho é o documentado:
 * o João grava Server URL + Server Secret no assistant
 * `036cdf43-4549-4251-bc6a-55b71b3f51b4` (uma vez, na Vapi), e o LANCADOR
 * apenas EXIGE que `$vars.VAPI_SERVER_SECRET` e `$vars.SICHF_CALLBACK_URL`
 * existam antes de discar — porque sem elas o resultado da ligação não tem como
 * voltar, o reaper marca `timeout` e o sistema REDISCA para o cliente.
 * Passo a passo em `docs/integracoes/n8n-ligacao-ia.md` §8.4.
 * =========================================================================== */

JSON.stringify({
  assistantId: $json.dados.assistente_id,
  phoneNumberId: "5c1efeed-6303-4c11-a792-76543a69cf33",
  customer: { number: $json.dados.telefone, name: $json.dados.nome },
  assistantOverrides: {
    variableValues: {
      nome: $json.dados.nome,
      primeiro_nome: $json.dados.primeiro_nome,
      melhor_horario_rotulo: $json.dados.melhor_horario?.rotulo ?? "",
      alternativas_rotulos: (($json.dados.alternativas ?? []).length
        ? ($json.dados.alternativas ?? []).map((a, i) => (i + 2) + ") " + a.rotulo).join(" · ")
        : "nenhuma alternativa: só a opção 1"),
    },
  },
  metadata: {
    ligacao_id: $json.dados.ligacao_id,
    tentativa: $json.dados.tentativa,
    horarios: [$json.dados.melhor_horario, ...($json.dados.alternativas ?? [])].filter(Boolean).map((h) => h.inicio_em),
  },
})
