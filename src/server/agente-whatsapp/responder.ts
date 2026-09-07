import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import { responderNaConversa } from "@/server/chatwoot/cliente";
import { montarRadar } from "@/server/radar";
import { dentroDaJanela, sanitizarJanela } from "@/server/ligacao-ia/janela";
import { CHAVE_LIGACAO_JANELA, lerConfiguracaoObjeto } from "@/server/integracoes/config";
import type { EventoChatwoot } from "@/server/chatwoot/recebidas";
import type { AcaoAgente, IntencaoAgente } from "@/types/agente";
import { avaliarPorteiro, type ContextoPorteiro, type MotivoSilencio } from "./porteiro";
import { conversaPertenceAoTelefone } from "./conversa";
import { derivarPassoDoAgente, podeEmitirLink, sinaisDoAgente, type PassoDoAgente } from "./passo";
import { classificarDeterministico, textoEsquivaFinal, textoFixo, textoLinkRecente, type ContextoResposta } from "./respostas";
import { emitirLinkDoAgente } from "./links";
import { abrirTarefa, fecharResposta, registrarNaTimeline, reivindicarMensagem, salvarEstado } from "./estado";
import { redigirComIa } from "./ia";

/**
 * O encadeamento: porteiro → passo → (texto fixo | IA) → envio → trilha.
 *
 * D12 — decidir e responder acontecem NO MESMO request do webhook, com
 * orçamento de tempo. Cinco minutos de espera (cron) não é conversa. O caminho
 * fixo — a maioria — responde em uma ida ao banco e uma ao Chatwoot.
 *
 * ORDEM QUE NÃO PODE MUDAR: a claim (`agente_whatsapp_respostas`) acontece
 * ANTES de qualquer chamada a provedor (IA ou Chatwoot). Uma reentrega do
 * mesmo `message_created` não pode virar duas execuções de IA nem duas
 * mensagens no WhatsApp do cliente.
 */

const ORCAMENTO_MS = 12_000;

export interface ResultadoAgente {
  /** `true` = alguma palavra saiu para o cliente. */
  respondeu: boolean;
  motivo:
    | MotivoSilencio
    | "enviada"
    | "sem_texto"
    | "falha_no_envio"
    | "ja_respondida"
    // Trava 15 (pentest da Fase 9): a conversa do payload não é do telefone casado.
    | "conversa_nao_pertence_ao_telefone"
    | "conversa_nao_verificada";
  intencao: IntencaoAgente | null;
  jornadaId: string | null;
}

export interface EntradaAgente {
  evento: EventoChatwoot;
  mensagemRecebidaId: string;
  conversaExternaId: string;
  telefoneBruto: string | null;
  corpo: string;
  temAnexo: boolean;
  agora?: number;
}

export async function processarMensagemDoAgente(admin: SupabaseClient, entrada: EntradaAgente): Promise<ResultadoAgente> {
  const agora = entrada.agora ?? Date.now();
  const comecou = Date.now();

  const porteiro = await avaliarPorteiro(admin, {
    evento: entrada.evento,
    telefoneBruto: entrada.telefoneBruto,
    agora,
  });

  if (!porteiro.responder) {
    await pendenciaDeSilencio(admin, porteiro.motivo, porteiro.jornadaId, porteiro.detalhe);
    return { respondeu: false, motivo: porteiro.motivo, intencao: null, jornadaId: porteiro.jornadaId };
  }

  const ctx = porteiro.contexto;

  // ---- CLAIM (trava 14) — antes de qualquer provedor ------------------------
  const claim = await reivindicarMensagem(admin, {
    mensagemRecebidaId: entrada.mensagemRecebidaId,
    jornadaId: ctx.jornadaId,
    conversaExternaId: entrada.conversaExternaId,
  });
  if (claim.situacao === "ja_claimada") {
    return { respondeu: false, motivo: "ja_respondida", intencao: null, jornadaId: ctx.jornadaId };
  }
  if (claim.situacao === "indisponivel") {
    registrarErro("agente-whatsapp/responder#claim", new Error(claim.erro), { jornada_id: ctx.jornadaId });
    return { respondeu: false, motivo: "falha_ao_avaliar", intencao: null, jornadaId: ctx.jornadaId };
  }

  // ---- TRAVA 15 — a conversa é mesmo de quem o payload diz? ----------------
  // Achado MÉDIO do pentest: `conversation.id` vem do corpo do webhook e nada
  // o amarrava ao telefone casado. A checagem vem DEPOIS da claim (para uma
  // reentrega forjada não repetir a chamada ao Chatwoot) e ANTES de decidir
  // qualquer coisa — não gasta IA, não emite link, não fala.
  const daConversa = await conversaPertenceAoTelefone(entrada.conversaExternaId, ctx.telefoneE164);
  if (!daConversa.ok) {
    await fecharResposta(admin, claim.respostaId, {
      intencao: null,
      confianca: null,
      acao: null,
      texto: null,
      execucaoIaId: null,
      custoUsd: null,
      provedorId: null,
      enviadaEm: null,
      erro: daConversa.erro,
    });
    await abrirTarefa(admin, {
      jornadaId: ctx.jornadaId,
      tipo: "agente_whatsapp_conversa_divergente",
      titulo: "Conversa de WhatsApp não confere com o cliente",
      descricao: daConversa.detalhe,
    });
    registrarErro("agente-whatsapp/responder#conversa", new Error(daConversa.erro), {
      jornada_id: ctx.jornadaId,
      conversa: entrada.conversaExternaId,
    });
    return { respondeu: false, motivo: daConversa.erro, intencao: null, jornadaId: ctx.jornadaId };
  }

  try {
    return await decidirEResponder(admin, ctx, entrada, claim.respostaId, agora, comecou);
  } catch (erro) {
    registrarErro("agente-whatsapp/responder", erro, { jornada_id: ctx.jornadaId });
    await fecharResposta(admin, claim.respostaId, {
      intencao: null,
      confianca: null,
      acao: null,
      texto: null,
      execucaoIaId: null,
      custoUsd: null,
      provedorId: null,
      enviadaEm: null,
      erro: erro instanceof Error ? erro.message.slice(0, 300) : "erro",
    });
    await abrirTarefa(admin, {
      jornadaId: ctx.jornadaId,
      tipo: "agente_whatsapp_falhou",
      titulo: "Responder no WhatsApp (o agente falhou)",
      descricao: `O cliente escreveu e o agente não conseguiu responder. Mensagem: "${entrada.corpo.slice(0, 200)}"`,
    });
    return { respondeu: false, motivo: "falha_ao_avaliar", intencao: null, jornadaId: ctx.jornadaId };
  }
}

async function decidirEResponder(
  admin: SupabaseClient,
  ctx: ContextoPorteiro,
  entrada: EntradaAgente,
  respostaId: string,
  agora: number,
  comecou: number,
): Promise<ResultadoAgente> {
  const sinais = sinaisDoAgente(ctx.sinais);
  const passo = derivarPassoDoAgente(sinais, agora);
  const janela = dentroDaJanela(new Date(agora), sanitizarJanela(await lerConfiguracaoObjeto(admin, CHAVE_LIGACAO_JANELA)));

  // Classificação determinística primeiro — `duvida_juridica` e `preco_prazo`
  // são exatamente as perguntas em que um modelo responderia algo plausível.
  const fixa = classificarDeterministico({
    texto: entrada.corpo,
    temAnexo: entrada.temAnexo,
    passoChave: passo.proximo.chave,
  });

  let intencao: IntencaoAgente = fixa ?? "fora_do_tema";
  let acao: AcaoAgente = "nenhuma";
  let confianca: number | null = null;
  let execucaoIaId: string | null = null;
  let custoUsd: number | null = null;
  let promptVersao: number | null = null;
  let usouIa = false;
  let esquivas = ctx.estado?.esquivas_seguidas ?? 0;

  const faltam = await rotulosDoQueFalta(admin, ctx.jornadaId, intencao, passo);
  const base: ContextoResposta = {
    primeiroNome: ctx.primeiroNome,
    passo: passo.proximo.passo,
    link: null,
    faltam,
    dentroDaJanela: janela,
  };

  let texto: string | null = null;

  if (fixa) {
    esquivas = 0;
    const linkResolvido = await resolverLink(admin, ctx, passo, fixa, agora);
    base.link = linkResolvido.url;
    if (linkResolvido.situacao === "recente") {
      texto = textoLinkRecente(base);
      acao = "nenhuma";
    } else {
      texto = textoFixo(fixa, base);
      acao = linkResolvido.url ? "enviar_link" : fixa === "duvida_juridica" || fixa === "preco_prazo" || fixa === "falar_com_humano" ? "encaminhar_humano" : "nenhuma";
    }
    if (linkResolvido.emitiu) {
      await salvarEstado(admin, ctx.jornadaId, ctx.estado, { linkEmitido: linkResolvido.emitiu }, agora);
    }
  } else if (!ctx.podeUsarIa) {
    // B56 — sem `tratamento_ia`, NENHUMA palavra do cliente vai ao modelo. O
    // agente responde com o texto fixo de devolução ao passo e conta a esquiva.
    esquivas += 1;
    intencao = "fora_do_tema";
    texto = esquivas >= ctx.config.esquivasAteHumano ? textoEsquivaFinal(base) : textoFixo("fora_do_tema", base);
    acao = esquivas >= ctx.config.esquivasAteHumano ? "encaminhar_humano" : "nenhuma";
  } else if (Date.now() - comecou > ORCAMENTO_MS) {
    // D13 — estourou o orçamento de tempo: NÃO envia nada, abre tarefa.
    await encerrarSemResposta(admin, ctx, entrada, respostaId, "orcamento_de_tempo_estourado");
    return { respondeu: false, motivo: "sem_texto", intencao: null, jornadaId: ctx.jornadaId };
  } else {
    const ia = await redigirComIa(admin, {
      jornadaId: ctx.jornadaId,
      entrada: { mensagem: entrada.corpo, passo: passo.proximo.passo, faltam },
      tetoDia: ctx.config.tetoIaDia,
      tetoJornadaDia: ctx.config.tetoIaJornadaDia,
      agora,
    });

    if (ia.situacao !== "ok") {
      // Prompt inativo, orçamento estourado, saída recusada: o agente cai no
      // texto fixo de devolução ao passo. Nunca em "não entendi, repita".
      esquivas += 1;
      intencao = "fora_do_tema";
      execucaoIaId = ia.situacao === "recusada" ? ia.execucaoId : null;

      // Saída descartada por CONTEÚDO (a IA escreveu preço ou orientação
      // jurídica) não espera a 2ª esquiva: vai direto para a esquiva final e
      // para a fila da equipe. É sinal de que o prompt está derivando, e quem
      // decide o que dizer sobre valor e sobre imposto é gente.
      const porConteudo = ia.situacao === "recusada" && ia.motivo.startsWith("conteudo_proibido");
      const encaminha = porConteudo || esquivas >= ctx.config.esquivasAteHumano;
      texto = encaminha ? textoEsquivaFinal(base) : textoFixo("fora_do_tema", base);
      acao = encaminha ? "encaminhar_humano" : "nenhuma";
    } else {
      usouIa = true;
      execucaoIaId = ia.execucaoId;
      custoUsd = ia.custoUsd;
      promptVersao = ia.promptVersao;
      confianca = ia.saida.confianca;
      intencao = ia.saida.intencao as IntencaoAgente;
      esquivas = intencao === "fora_do_tema" ? esquivas + 1 : 0;

      // D21 — o modelo REDIGE, o banco DECIDE. `enviar_link` só é obedecida
      // quando o passo derivado já previa aquele link.
      if (ia.saida.acao === "enviar_link" && podeEmitirLink(passo, intencao)) {
        const linkResolvido = await resolverLink(admin, ctx, passo, intencao, agora);
        base.link = linkResolvido.url;
        if (linkResolvido.emitiu) {
          await salvarEstado(admin, ctx.jornadaId, ctx.estado, { linkEmitido: linkResolvido.emitiu }, agora);
        }
        acao = linkResolvido.url ? "enviar_link" : "nenhuma";
        texto = linkResolvido.situacao === "recente" ? textoLinkRecente(base) : ia.saida.resposta;
      } else {
        acao = ia.saida.acao === "enviar_link" ? "nenhuma" : ia.saida.acao;
        texto = esquivas >= ctx.config.esquivasAteHumano && intencao === "fora_do_tema" ? textoEsquivaFinal(base) : ia.saida.resposta;
        if (esquivas >= ctx.config.esquivasAteHumano && intencao === "fora_do_tema") acao = "encaminhar_humano";
      }
    }
  }

  if (!texto) {
    await encerrarSemResposta(admin, ctx, entrada, respostaId, "sem_texto_montavel");
    return { respondeu: false, motivo: "sem_texto", intencao, jornadaId: ctx.jornadaId };
  }

  const envio = await responderNaConversa(entrada.conversaExternaId, texto);

  await fecharResposta(admin, respostaId, {
    intencao,
    confianca,
    acao,
    // O texto é gravado MESMO quando o envio falha: sem isso a equipe teria de
    // adivinhar o que o robô ia dizer. Quem diz se saiu é `enviada_em`, não a
    // presença do texto — `texto` nulo significa "não houve o que dizer".
    texto,
    execucaoIaId,
    custoUsd,
    provedorId: envio.provedorId,
    enviadaEm: envio.sucesso ? new Date().toISOString() : null,
    erro: envio.sucesso ? null : envio.erro,
  });

  await salvarEstado(
    admin,
    ctx.jornadaId,
    ctx.estado,
    { passoUltimo: passo.proximo.chave, ultimaIntencao: intencao, esquivasSeguidas: esquivas },
    agora,
  );

  if (!envio.sucesso) {
    await abrirTarefa(admin, {
      jornadaId: ctx.jornadaId,
      tipo: "agente_whatsapp_falhou",
      titulo: "Responder no WhatsApp (o envio falhou)",
      descricao: `O agente montou a resposta e o Chatwoot recusou (${envio.erro ?? "sem detalhe"}). Mensagem do cliente: "${entrada.corpo.slice(0, 200)}"`,
    });
    return { respondeu: false, motivo: "falha_no_envio", intencao, jornadaId: ctx.jornadaId };
  }

  await registrarNaTimeline(admin, {
    jornadaId: ctx.jornadaId,
    texto,
    intencao,
    confianca,
    custoUsd,
    promptVersao,
    usouIa,
  });

  if (acao === "encaminhar_humano") {
    await abrirTarefa(admin, {
      jornadaId: ctx.jornadaId,
      tipo: "agente_whatsapp_encaminhou",
      titulo: "Falar com o cliente no WhatsApp",
      descricao: `O agente devolveu ao passo e avisou que a equipe vai chamar (intenção: ${intencao}). Mensagem do cliente: "${entrada.corpo.slice(0, 200)}"`,
    });
  }

  return { respondeu: true, motivo: "enviada", intencao, jornadaId: ctx.jornadaId };
}

// ---------------------------------------------------------------------------

async function encerrarSemResposta(
  admin: SupabaseClient,
  ctx: ContextoPorteiro,
  entrada: EntradaAgente,
  respostaId: string,
  motivo: string,
): Promise<void> {
  await fecharResposta(admin, respostaId, {
    intencao: null,
    confianca: null,
    acao: null,
    texto: null,
    execucaoIaId: null,
    custoUsd: null,
    provedorId: null,
    enviadaEm: null,
    erro: motivo,
  });
  await abrirTarefa(admin, {
    jornadaId: ctx.jornadaId,
    tipo: "agente_whatsapp_sem_resposta",
    titulo: "Responder no WhatsApp",
    descricao: `O cliente escreveu e o agente preferiu não responder (${motivo}). Mensagem: "${entrada.corpo.slice(0, 200)}"`,
  });
}

interface LinkResolvido {
  situacao: "emitido" | "recente" | "indisponivel" | "nao_previsto";
  url: string | null;
  emitiu: "formulario" | "documentos" | "confirmacao" | null;
}

async function resolverLink(
  admin: SupabaseClient,
  ctx: ContextoPorteiro,
  passo: PassoDoAgente,
  intencao: IntencaoAgente,
  agora: number,
): Promise<LinkResolvido> {
  if (!podeEmitirLink(passo, intencao) || !passo.linkPrevisto) {
    return { situacao: "nao_previsto", url: null, emitiu: null };
  }
  const r = await emitirLinkDoAgente(admin, {
    jornadaId: ctx.jornadaId,
    tipo: passo.linkPrevisto,
    estado: ctx.estado,
    intervaloLinkHoras: ctx.config.intervaloLinkHoras,
    agora,
  });
  if (r.situacao === "emitido") return { situacao: "emitido", url: r.url, emitiu: r.tipo };
  if (r.situacao === "recente") return { situacao: "recente", url: null, emitiu: null };
  return { situacao: "indisponivel", url: null, emitiu: null };
}

/**
 * Os rótulos humanos do que falta (radar). Sem `item_ref`, sem id, sem valor —
 * é o que pode ir para o WhatsApp e o que pode ir para o modelo (D20).
 * Só é consultado quando a intenção precisa da lista: o radar tem cache de 60 s
 * (0069), mas nem por isso vale chamá-lo em toda mensagem.
 */
async function rotulosDoQueFalta(
  admin: SupabaseClient,
  jornadaId: string,
  intencao: IntencaoAgente,
  passo: PassoDoAgente,
): Promise<string[]> {
  const precisa = intencao === "enviar_documento" || intencao === "o_que_falta" || passo.linkPrevisto === "documentos";
  if (!precisa) return [];
  try {
    const radar = await montarRadar(admin, jornadaId);
    return radar.itens
      .filter((i) => i.lado === "coleta" && (i.estado === "a_pedir" || i.estado === "pedido"))
      .slice(0, 6)
      .map((i) => i.rotulo);
  } catch (erro) {
    registrarErro("agente-whatsapp/responder.rotulosDoQueFalta", erro, { jornada_id: jornadaId });
    return [];
  }
}

/**
 * O que a equipe vê quando o agente CALA.
 *
 * `numero_desconhecido` e `telefone_ambiguo` NÃO viram tarefa: não há jornada
 * onde pendurá-la, e a `vw_pendencias_sistema` (0089) já mostra a linha
 * derivada com o texto e a hora. Duplicar o mesmo fato em dois lugares é o que
 * treina o time a ignorar a fila.
 */
async function pendenciaDeSilencio(
  admin: SupabaseClient,
  motivo: MotivoSilencio,
  jornadaId: string | null,
  detalhe: string,
): Promise<void> {
  if (!jornadaId) return;
  const comTarefa: Partial<Record<MotivoSilencio, { tipo: string; titulo: string }>> = {
    sem_jornada_aberta: { tipo: "cliente_escreveu_fora_de_processo", titulo: "Cliente sem processo aberto escreveu" },
    sem_pagamento: { tipo: "lead_escreveu_sem_contratar", titulo: "Lead escreveu antes de contratar" },
    sem_consentimento_whatsapp: { tipo: "escreveu_sem_consentimento", titulo: "Escreveu sem consentimento de WhatsApp" },
    teto_respostas_hora: { tipo: "agente_atingiu_teto", titulo: "Assumir a conversa no WhatsApp" },
  };
  const alvo = comTarefa[motivo];
  if (!alvo) return;
  await abrirTarefa(admin, { jornadaId, tipo: alvo.tipo, titulo: alvo.titulo, descricao: detalhe });
}
