import type { ContextoCopiloto, SugestaoCopiloto, TipoObservacaoCopiloto } from "@/types/copiloto";
import type { SugestaoCopilotoIa } from "./schema";
import {
  MAX_ITENS_COBRIU_NO_BLOCO,
  MAX_ITENS_FALTA_NO_BLOCO,
  MAX_ITENS_FICHA_POR_CHAMADA,
  MAX_ITENS_INVENTARIO_POR_CHAMADA,
  TETO_DESCRICAO_INVENTARIO,
  TETO_EVIDENCIA_BLOCO_INFERIDO,
  TETO_EVIDENCIA_COBRIU,
  TETO_EVIDENCIA_FALTA,
  TETO_EVIDENCIA_FICHA,
  TETO_EVIDENCIA_INVENTARIO,
  TETO_EVIDENCIA_OBSERVACAO,
  TETO_EVIDENCIA_PERGUNTA,
  TETO_ITEM_COBRIU,
  TETO_ITEM_FALTA,
  TETO_MOTIVO_DESVIO,
  TETO_MOTIVO_PERGUNTA,
  TETO_TEXTO_FICHA,
  TETO_TEXTO_OBSERVACAO,
  TETO_TEXTO_PERGUNTA,
  TETO_TITULARIDADE_INVENTARIO,
  TETO_VALOR_MENCIONADO_INVENTARIO,
} from "./schema";

/**
 * Validação pós-Zod da saída do copiloto — Fase 10, Fatia 2 (§4.3 do plano:
 * "a IA propõe, o servidor confere"). Roda DEPOIS que `SugestaoCopilotoIaSchema`
 * já validou a FORMA; esta camada valida o CONTEÚDO contra o contexto real
 * que foi enviado — o Zod não sabe o que é um `bloco_id` válido nem o que é
 * uma citação literal, só sabe que é uma string.
 *
 * Quatro recusas, em ordem, cada uma com efeito diferente (nunca "erro genérico"):
 *  1. `bloco_id` que não existe no roteiro ativo → a SUGESTÃO INTEIRA de
 *     desvio é descartada (campo vira nulo), não "corrigida" para outro bloco
 *     — corrigir seria a IA escolhendo por baixo dos panos, o oposto de
 *     "a IA ordena, não escolhe".
 *  2. `evidencia` que não casa por SUBSTRING com a janela de transcrição (D)
 *     nem com um item do estado factual (C) → só aquele campo `evidencia`
 *     vira nulo, e o nome do campo entra em `campos_evidencia_nao_conferida`
 *     (a sugestão em si sobrevive — a evidência que não bate é rejeitada,
 *     não o julgamento inteiro).
 *  3. termo proibido (preço, alíquota, valor em reais) em QUALQUER campo de
 *     texto da saída → a sugestão inteira é recusada (mesma postura de B61,
 *     `agente-whatsapp/respostas.ts`: defesa em profundidade sobre a SAÍDA,
 *     não só sobre a entrada do cliente).
 *  4. (18/09/2026, `ficha_cliente`/`inventario_mencionado` apenas) evidência
 *     cuja ÚNICA origem, dentre as fontes que casam por substring, é fala da
 *     EQUIPE (advogada/assistente) → o ITEM INTEIRO é descartado —
 *     `evidenciaVemSoDaEquipe`. Evidência ambígua (casa também com fala do
 *     decisor ou com o estado factual) passa: a recusa é só quando a fala da
 *     equipe é a única prova possível (achado do `security-pentester`,
 *     mesmo defeito que gravou um imóvel da advogada como patrimônio do
 *     cliente no inventário em produção).
 *
 * Confiança abaixo de `confiancaMinima` NÃO é validação de conteúdo — é regra
 * de exibição (a sugestão é gravada, só não aparece na tela). Fica de fora
 * deste módulo; quem decide isso é a rota (`copiloto_sessao.confianca_minima`).
 */

const TERMOS_VALOR = [
  "r$",
  "reais",
  "real,",
  " real ",
  "honorario",
  "honorário",
  "desconto",
  "aliquota",
  "alíquota",
  "porcento",
  "por cento",
  " % ",
  "parcela de",
  "investimento de",
];

function normalizarTexto(bruto: string): string {
  return bruto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Varre TODOS os campos de texto livre da saída — não só os que a tela
 * mostra em destaque. Um termo proibido em `motivo` é tão grave quanto em
 * `texto`. */
function contemTermoDeValor(saida: SugestaoCopilotoIa): boolean {
  const textos: string[] = [];
  if (saida.proxima_pergunta) {
    textos.push(saida.proxima_pergunta.texto, saida.proxima_pergunta.motivo, saida.proxima_pergunta.evidencia);
  }
  for (const item of saida.falta_no_bloco) {
    textos.push(item.item, item.evidencia);
  }
  for (const item of saida.cobriu_no_bloco) {
    textos.push(item.item, item.evidencia);
  }
  if (saida.observacao) {
    textos.push(saida.observacao.texto, saida.observacao.evidencia);
  }
  if (saida.desvio_sugerido) {
    textos.push(saida.desvio_sugerido.motivo);
  }
  if (saida.bloco_inferido) {
    textos.push(saida.bloco_inferido.evidencia);
  }
  for (const item of saida.inventario_mencionado) {
    textos.push(item.descricao, item.evidencia);
    if (item.titularidade) textos.push(item.titularidade);
    if (item.valor_mencionado) textos.push(item.valor_mencionado);
  }
  for (const item of saida.ficha_cliente) {
    textos.push(item.texto, item.evidencia);
  }

  const normalizados = textos.map(normalizarTexto);
  // '%' varre sem normalizar acento (não é letra) — checagem à parte, mesmo raciocínio de TERMOS_VALOR.
  if (normalizados.some((t) => t.includes("%"))) return true;
  return normalizados.some((t) => TERMOS_VALOR.some((termo) => t.includes(normalizarTexto(termo))));
}

/** Piso de comprimento da evidência (achado do `fable-orchestrator`, item
 * menor da correção do gate): sem mínimo, uma "evidência" de 2-3 caracteres
 * casa por substring com quase qualquer trecho da janela/estado e vira
 * `<blockquote>` na tela como se fosse citação real. 12 é curto o bastante
 * para não cortar citação legítima (§4.3 pede frase, não palavra solta) e
 * longo o bastante para não ser ruído ("sim", "não", "ok"). */
const PISO_COMPRIMENTO_EVIDENCIA = 12;

/** Citação literal: a evidência precisa casar por SUBSTRING (não igualdade
 * exata — a IA pode citar um trecho, não a linha inteira) com algo que
 * REALMENTE foi enviado no contexto (janela D + itens do estado factual C),
 * e ter pelo menos `PISO_COMPRIMENTO_EVIDENCIA` caracteres. Comparação
 * normalizada (minúsculas, sem acento) — o modelo pode transcrever
 * maiúscula/acento de forma levemente diferente do original sem que isso
 * signifique que ele inventou o fato. */
function evidenciaConferida(evidencia: string, contexto: ContextoCopiloto): boolean {
  const bruta = evidencia.trim();
  if (bruta.length < PISO_COMPRIMENTO_EVIDENCIA) return false;

  const alvo = normalizarTexto(bruta);
  if (alvo.length === 0) return false;

  const fontes = [
    ...contexto.janela_transcricao,
    ...contexto.estado_factual.sims_registrados,
    ...contexto.estado_factual.blocos_percorridos,
    ...contexto.estado_factual.campos_pendentes_no_bloco,
  ].map(normalizarTexto);

  return fontes.some((fonte) => fonte.includes(alvo));
}

/** Papéis da EQUIPE do escritório (`participantes.ts::PapelFala`) — nunca o
 * decisor. `decisor_N`/`acompanhante_N`/`participante` (fallback) são o
 * CLIENTE do outro lado da mesa; só estes dois rótulos descrevem quem
 * conduz/apoia a sessão pelo escritório. */
const PAPEIS_DE_EQUIPE = new Set(["advogada", "assistente"]);

/** Extrai o papel do prefixo de uma linha da janela (`"${papel}: ${texto}"`,
 * formato fixo montado em `contexto.ts::montarJanelaTranscricaoDeSegmentos`
 * / `rotuloFalante` — papel é sempre um dos valores fechados de `PapelFala`
 * ou `"participante"`, nunca contém `": "`). `null` quando a linha não segue
 * o formato esperado (defensivo — nunca deveria acontecer). */
function papelDaLinhaJanela(linha: string): string | null {
  const fim = linha.indexOf(": ");
  return fim === -1 ? null : linha.slice(0, fim);
}

/** 18/09/2026 (achado do `security-pentester`, mesma classe de defeito que
 * queimou em produção no inventário: um imóvel da advogada virou "patrimônio
 * do cliente"). A `janela_transcricao` mistura falas de TODOS os papéis —
 * `evidenciaConferida` confere só a citação literal, sem saber de quem é a
 * fala. Esta função responde a pergunta seguinte: "a ÚNICA fonte que contém
 * esta evidência é fala da equipe?" Se sim, o item não pode entrar em
 * `ficha_cliente`/`inventario_mencionado` — regra explícita do dono: "não
 * pode captar informação pessoal do advogado, só do decisor".
 *
 * Fail-OPEN de propósito quando há AMBIGUIDADE: se a evidência casa com
 * fala da equipe E TAMBÉM com alguma fonte não-equipe (fala do decisor, ou
 * um item do estado factual C, que nunca é fala da equipe), o item é
 * ACEITO — recusar aqui apagaria dado legítimo do cliente por causa de uma
 * coincidência de substring (pedido explícito de quem revisou: "fail-closed
 * aqui geraria falso negativo"). A recusa só vale quando a ÚNICA origem
 * possível, dentre as fontes que casam, é a equipe.
 *
 * `janelaComPapeis` pode ser `undefined` (chamador antigo/teste que ainda
 * não migrou) — nesse caso não há como saber o papel, e a função devolve
 * `false` (não recusa nada), IDÊNTICO ao comportamento anterior a esta
 * correção. Isso nunca acontece no caminho real (`ciclo.ts`/rota sempre
 * repassam `contexto.janela_transcricao`), só em teste de mesa antigo.
 */
function evidenciaVemSoDaEquipe(evidencia: string, contexto: ContextoCopiloto): boolean {
  const alvo = normalizarTexto(evidencia.trim());
  if (alvo.length === 0) return false;

  let casouComEquipe = false;
  let casouComNaoEquipe = false;

  for (const linha of contexto.janela_transcricao) {
    if (!normalizarTexto(linha).includes(alvo)) continue;
    const papel = papelDaLinhaJanela(linha);
    if (papel !== null && PAPEIS_DE_EQUIPE.has(papel)) casouComEquipe = true;
    else casouComNaoEquipe = true;
  }

  // Fontes fora da transcrição (estado factual C) nunca são fala da equipe.
  const fontesNaoTranscricao = [
    ...contexto.estado_factual.sims_registrados,
    ...contexto.estado_factual.blocos_percorridos,
    ...contexto.estado_factual.campos_pendentes_no_bloco,
  ];
  if (fontesNaoTranscricao.some((fonte) => normalizarTexto(fonte).includes(alvo))) casouComNaoEquipe = true;

  return casouComEquipe && !casouComNaoEquipe;
}

function cortar(texto: string, teto: number): string {
  return texto.length > teto ? texto.slice(0, teto) : texto;
}

export interface ResultadoValidacao {
  /** `null` quando a saída inteira foi recusada (termo proibido) — nada é gravado. */
  sugestao: SugestaoCopiloto | null;
  motivoRecusaTotal: "termo_proibido" | null;
}

/**
 * Valida e monta o `SugestaoCopiloto` final. NUNCA lança — toda recusa vira
 * `sugestao: null` ou campo anulado, para a rota decidir o que gravar/expor.
 *
 * `acertoErroAtivo` (17/09/2026, migration 0119) — `copiloto_sessao.
 * acerto_erro_ativo`, LIDO PELO CHAMADOR (mesma disciplina desta função:
 * `validarSugestaoCopiloto` é pura, zero I/O — ver comentário de topo do
 * arquivo; `ciclo.ts` lê a config junto das outras leituras de
 * `configuracoes` do ciclo e repassa aqui). `true` por padrão (parâmetro
 * opcional) para não quebrar os testes/chamadas existentes que não conhecem
 * este parâmetro ainda. Desligado (`false`): `cobriu_no_bloco` sai sempre
 * `[]`, mesmo que a IA tenha proposto itens — mesmo padrão fail-CLOSED de
 * `falta_no_bloco`/`bloco_inferido` para dado que ACUSA/AVALIA a advogada
 * (diferente do fail-OPEN de `dossieClienteEstaAtivo`, que é sobre dado
 * CADASTRAL, não avaliação de condução).
 */
export function validarSugestaoCopiloto(
  saidaIa: SugestaoCopilotoIa,
  contexto: ContextoCopiloto,
  acertoErroAtivo = true,
): ResultadoValidacao {
  if (contemTermoDeValor(saidaIa)) {
    return { sugestao: null, motivoRecusaTotal: "termo_proibido" };
  }

  const camposNaoConferidos: string[] = [];
  const blocosValidos = new Set(contexto.roteiro_ativo_blocos_ids);

  // -- proxima_pergunta -------------------------------------------------
  let proximaPergunta: SugestaoCopiloto["proxima_pergunta"] = null;
  if (saidaIa.proxima_pergunta) {
    const evidenciaOk = evidenciaConferida(saidaIa.proxima_pergunta.evidencia, contexto);
    if (!evidenciaOk) camposNaoConferidos.push("proxima_pergunta.evidencia");
    proximaPergunta = {
      texto: cortar(saidaIa.proxima_pergunta.texto, TETO_TEXTO_PERGUNTA),
      motivo: cortar(saidaIa.proxima_pergunta.motivo, TETO_MOTIVO_PERGUNTA),
      evidencia: evidenciaOk ? cortar(saidaIa.proxima_pergunta.evidencia, TETO_EVIDENCIA_PERGUNTA) : null,
    };
  }

  // -- falta_no_bloco (máx. 4 — §4.3 do plano) ---------------------------
  // 🔴 O interruptor vale para os DOIS lados do placar, não só para o verde.
  // A versão anterior desta fatia desligava apenas `cobriu_no_bloco`, com o
  // argumento de que `falta_no_bloco` já rodava desde a 0094 — mas isso
  // deixava o kill-switch com o escopo invertido: desligava o ELOGIO e
  // mantinha a ACUSAÇÃO. O vermelho é justamente a metade que aponta o erro
  // da advogada numa tela que ela pode estar compartilhando com o cliente;
  // se há um lado que precisa ser desligável em segundos, é esse.
  const faltaNoBloco: SugestaoCopiloto["falta_no_bloco"] = (acertoErroAtivo ? saidaIa.falta_no_bloco : [])
    .slice(0, MAX_ITENS_FALTA_NO_BLOCO)
    .map((item, indice) => {
      const evidenciaOk = evidenciaConferida(item.evidencia, contexto);
      if (!evidenciaOk) camposNaoConferidos.push(`falta_no_bloco[${indice}].evidencia`);
      return {
        item: cortar(item.item, TETO_ITEM_FALTA),
        evidencia: evidenciaOk ? cortar(item.evidencia, TETO_EVIDENCIA_FALTA) : null,
      };
    });

  // -- cobriu_no_bloco (17/09/2026, migration 0119): mesmo teto de itens de
  // `falta_no_bloco`, mas regra de evidência MAIS SEVERA — mesmo raciocínio
  // de `inventario_mencionado` abaixo, não o de `falta_no_bloco` acima. Um
  // "acerto" sem citação comprovada é a IA fabricando elogio à advogada; o
  // ITEM INTEIRO é descartado (nunca só a evidência anulada), e — DIFERENTE
  // de `inventario_mencionado` — o item descartado por evidência fraca
  // TAMBÉM entra em `camposNaoConferidos`, para telemetria mostrar que a IA
  // tentou propor um acerto que não se sustentou (§ pedido do dono: "na
  // dúvida, não marque — ausência de acerto NÃO é erro" é sobre o VERMELHO;
  // aqui o registro serve para auditar se a IA está inflando acertos).
  // `acertoErroAtivo=false` zera a lista inteira ANTES de processar — mesmo
  // efeito de a IA nunca ter proposto nada, sem gastar ciclo de validação.
  const cobriuNoBloco: NonNullable<SugestaoCopiloto["cobriu_no_bloco"]> = acertoErroAtivo
    ? saidaIa.cobriu_no_bloco
        .slice(0, MAX_ITENS_COBRIU_NO_BLOCO)
        .map((item, indice) => {
          const evidenciaOk = evidenciaConferida(item.evidencia, contexto);
          if (!evidenciaOk) camposNaoConferidos.push(`cobriu_no_bloco[${indice}].evidencia`);
          return evidenciaOk
            ? { item: cortar(item.item, TETO_ITEM_COBRIU), evidencia: cortar(item.evidencia, TETO_EVIDENCIA_COBRIU) }
            : null;
        })
        .filter((item): item is { item: string; evidencia: string } => item !== null)
    : [];

  // -- observacao ---------------------------------------------------------
  let observacao: SugestaoCopiloto["observacao"] = null;
  if (saidaIa.observacao) {
    const evidenciaOk = evidenciaConferida(saidaIa.observacao.evidencia, contexto);
    if (!evidenciaOk) camposNaoConferidos.push("observacao.evidencia");
    observacao = {
      tipo: normalizarTipoObservacao(saidaIa.observacao.tipo),
      texto: cortar(saidaIa.observacao.texto, TETO_TEXTO_OBSERVACAO),
      evidencia: evidenciaOk ? cortar(saidaIa.observacao.evidencia, TETO_EVIDENCIA_OBSERVACAO) : null,
      confianca: clampConfianca(saidaIa.observacao.confianca),
    };
  }

  // -- desvio_sugerido: bloco_id fora do roteiro ativo → DESCARTA a sugestão
  // inteira de desvio (não corrige para outro bloco — §4.3: "descartada, não
  // corrigida"). Diferente da evidência: aqui não há "campo anulado", o
  // desvio inteiro deixa de existir, porque um bloco_id não é uma citação
  // que se possa simplesmente omitir — é a própria ação sugerida.
  let desvioSugerido: SugestaoCopiloto["desvio_sugerido"] = null;
  if (saidaIa.desvio_sugerido) {
    if (blocosValidos.has(saidaIa.desvio_sugerido.bloco_id)) {
      desvioSugerido = {
        bloco_id: saidaIa.desvio_sugerido.bloco_id,
        motivo: cortar(saidaIa.desvio_sugerido.motivo, TETO_MOTIVO_DESVIO),
        confianca: clampConfianca(saidaIa.desvio_sugerido.confianca),
      };
    }
    // bloco_id inválido: desvioSugerido permanece null — sugestão descartada, sem registro de campo "não conferido"
    // (não é uma questão de evidência, é uma questão de existência do alvo).
  }

  // -- bloco_inferido (Fase 12, Fatia 1): MESMA regra de `desvio_sugerido` —
  // bloco_id fora do roteiro ativo DESCARTA o campo inteiro, nunca "corrige"
  // para outro bloco. Evidência abaixo do piso/não conferida também descarta
  // o campo inteiro (diferente de `proxima_pergunta`/`falta_no_bloco`, que só
  // anulam a EVIDÊNCIA e mantêm o resto) — aqui não faz sentido um "bloco
  // inferido sem evidência": a inferência OU tem lastro na fala real, OU não
  // deveria existir.
  let blocoInferido: SugestaoCopiloto["bloco_inferido"] = null;
  if (saidaIa.bloco_inferido) {
    const alvoValido = blocosValidos.has(saidaIa.bloco_inferido.bloco_id);
    const evidenciaOk = alvoValido && evidenciaConferida(saidaIa.bloco_inferido.evidencia, contexto);
    if (alvoValido && evidenciaOk) {
      blocoInferido = {
        bloco_id: saidaIa.bloco_inferido.bloco_id,
        confianca: clampConfianca(saidaIa.bloco_inferido.confianca),
        evidencia: cortar(saidaIa.bloco_inferido.evidencia, TETO_EVIDENCIA_BLOCO_INFERIDO),
      };
    }
    // bloco_id inválido OU evidência não conferida: blocoInferido permanece
    // null — mesmo raciocínio de desvio_sugerido.
  }

  // -- inventario_mencionado (17/09/2026): DIFERENTE de `falta_no_bloco` —
  // aqui a evidência não conferida DESCARTA O ITEM INTEIRO, nunca só anula o
  // campo evidência. Um item de patrimônio sem citação literal comprovada
  // não é "um fato com prova fraca", é invenção (regra do pedido: "sem
  // citação conferida contra a transcrição, o item não entra"). Mesmo
  // raciocínio de `bloco_inferido` acima — a evidência É a razão de existir
  // do item, não um detalhe a mais dele. Teto de itens POR CHAMADA
  // (`MAX_ITENS_INVENTARIO_POR_CHAMADA`) é aplicado ANTES da conferência de
  // evidência (mesma ordem de `falta_no_bloco`: cortar primeiro, validar o
  // que sobrou — nunca o inverso, que descartaria itens válidos por estarem
  // depois de itens inválidos na lista da IA).
  //
  // 🔴 18/09/2026 (achado do `security-pentester`, defeito medido em produção
  // na sessão do Carlos Alberto: um imóvel da Dra. Elaine virou "patrimônio
  // do cliente"). `evidenciaConferida` sozinha só prova que a citação é
  // LITERAL — não de QUEM. `evidenciaVemSoDaEquipe` fecha essa lacuna: se a
  // ÚNICA fala que sustenta a evidência é da equipe (advogada/assistente), o
  // item é descartado junto com os que falham em `evidenciaConferida` —
  // mesma severidade, mesmo "item inteiro fora". Evidência ambígua (casa com
  // fala da equipe E com fala do decisor/estado factual) passa — a recusa é
  // só para a origem EXCLUSIVA da equipe (ver comentário da função).
  const inventarioMencionado = saidaIa.inventario_mencionado
    .slice(0, MAX_ITENS_INVENTARIO_POR_CHAMADA)
    .filter((item) => evidenciaConferida(item.evidencia, contexto) && !evidenciaVemSoDaEquipe(item.evidencia, contexto))
    .map((item) => ({
      categoria: item.categoria,
      descricao: cortar(item.descricao, TETO_DESCRICAO_INVENTARIO),
      titularidade: item.titularidade ? cortar(item.titularidade, TETO_TITULARIDADE_INVENTARIO) : null,
      posse: item.posse,
      valor_mencionado: item.valor_mencionado ? cortar(item.valor_mencionado, TETO_VALOR_MENCIONADO_INVENTARIO) : null,
      evidencia: cortar(item.evidencia, TETO_EVIDENCIA_INVENTARIO),
    }));

  // -- ficha_cliente (18/09/2026): MESMA regra de `inventario_mencionado` —
  // evidência não conferida DESCARTA O ITEM INTEIRO, nunca só anula o campo
  // evidência. Um item de dor/objeção/desejo/fato_decisor sem citação
  // literal comprovada não é "um fato com prova fraca", é a IA inventando
  // dor de cliente real — a mesma severidade que motivou a decisão do dono
  // (`docs`/plano: "sem citação conferida contra a transcrição, o item não
  // entra"). Teto de itens POR CHAMADA aplicado ANTES da conferência de
  // evidência (mesma ordem de `inventario_mencionado`/`falta_no_bloco`).
  //
  // 🔴 18/09/2026 (achado do `security-pentester`, MESMA classe de defeito de
  // `inventario_mencionado` acima — é o campo que nasce mais exposto a ele:
  // a Ficha existe justamente para capturar dor/objeção/desejo do DECISOR, e
  // a regra do dono é explícita e não negociável: "não pode captar
  // informação pessoal do advogado". `evidenciaVemSoDaEquipe` recusa o item
  // cuja única fala de sustentação é da equipe — ver comentário da função.
  const fichaCliente = saidaIa.ficha_cliente
    .slice(0, MAX_ITENS_FICHA_POR_CHAMADA)
    .filter((item) => evidenciaConferida(item.evidencia, contexto) && !evidenciaVemSoDaEquipe(item.evidencia, contexto))
    .map((item) => ({
      categoria: item.categoria,
      texto: cortar(item.texto, TETO_TEXTO_FICHA),
      evidencia: cortar(item.evidencia, TETO_EVIDENCIA_FICHA),
    }));

  return {
    sugestao: {
      proxima_pergunta: proximaPergunta,
      falta_no_bloco: faltaNoBloco,
      cobriu_no_bloco: cobriuNoBloco,
      observacao,
      desvio_sugerido: desvioSugerido,
      confianca_geral: clampConfianca(saidaIa.confianca_geral),
      campos_evidencia_nao_conferida: camposNaoConferidos,
      bloco_inferido: blocoInferido,
      inventario_mencionado: inventarioMencionado,
      ficha_cliente: fichaCliente,
    },
    motivoRecusaTotal: null,
  };
}

function clampConfianca(valor: number): number {
  if (!Number.isFinite(valor)) return 0;
  return Math.min(1, Math.max(0, valor));
}

/**
 * §4.3 do plano: confiança abaixo de `copiloto_sessao.confianca_minima` "NÃO
 * aparece na tela, vira histórico com o motivo". A sugestão É GRAVADA de
 * qualquer forma (§4.3/§9 "solidificação": é o dado que, em N sessões, dirá
 * se o copiloto acerta) — só o campo `sugestao` da resposta HTTP vira nulo.
 * Função pura, extraída da rota para ser testável sem I/O.
 */
export function sugestaoEVisivel(confiancaGeral: number, confiancaMinima: number): boolean {
  return confiancaGeral >= confiancaMinima;
}

const TIPOS_VALIDOS: readonly TipoObservacaoCopiloto[] = ["fato", "hipotese", "inferencia", "recomendacao"];

/** Tipo fora da lista fechada (o modelo "inventou" um 5º valor apesar do
 * enum Zod) cai em `hipotese` — nunca `fato`, que é a leitura mais forte e a
 * que exigiria mais certeza, não menos. */
function normalizarTipoObservacao(bruto: string): TipoObservacaoCopiloto {
  return (TIPOS_VALIDOS as readonly string[]).includes(bruto) ? (bruto as TipoObservacaoCopiloto) : "hipotese";
}
