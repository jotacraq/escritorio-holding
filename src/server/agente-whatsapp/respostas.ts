import { placeholdersRestantes } from "@/server/regua/render";
import type { IntencaoAgente } from "@/types/agente";

/**
 * O catálogo de intenções e as RESPOSTAS FIXAS do agente (§C do plano).
 *
 * Tudo aqui é função pura, sem I/O — é o arquivo que os testes de mesa leem.
 *
 * LEI DE TEXTO (B60, Glossário, DESIGN-SYSTEM §texto):
 *  - português do Brasil, "você", cordial e direto; 1 a 3 frases;
 *  - sem emoji, sem "prezado", sem jargão de sistema ("jornada", "etapa",
 *    "link público", "onboarding" não aparecem para o cliente);
 *  - NUNCA preço, honorário, desconto ou forma de pagamento (B61);
 *  - NUNCA orientação jurídica ou tributária;
 *  - NUNCA um estado, prazo ou número que não venha do banco;
 *  - toda frase termina devolvendo o cliente ao passo em que ele está.
 *
 * A detecção determinística vem ANTES da IA de propósito: `duvida_juridica` e
 * `preco_prazo` são exatamente as perguntas em que um modelo bem-intencionado
 * responderia algo plausível — e plausível, aqui, é o erro caro.
 */

/** Só o que o agente pode DIZER. `desconhecida` nunca vira texto. */
export type IntencaoComTextoFixo = Exclude<IntencaoAgente, "duvida_uso_sistema" | "desconhecida">;

export interface ContextoResposta {
  /** Primeiro nome do cliente. Vazio/ausente → a saudação some, não vira "{{nome}}". */
  primeiroNome: string | null;
  /** O verbo do passo derivado (`ProximoPasso.passo`), em linguagem de gente. */
  passo: string;
  /** URL recém-emitida. `null` quando o agente não emitiu link nesta resposta. */
  link: string | null;
  /** Rótulos humanos do que falta (radar). Sem `item_ref`, sem id. */
  faltam: string[];
  /** `true` = agora está dentro de `ligacao_ia.janela` (B59). */
  dentroDaJanela: boolean;
}

// ---------------------------------------------------------------------------
// Detecção determinística
// ---------------------------------------------------------------------------

/**
 * Palavras que caracterizam pergunta JURÍDICA/TRIBUTÁRIA. Conferidas antes de
 * qualquer outra coisa: é a esquiva que não pode depender de modelo.
 * Sem acento e em minúsculas — o texto é normalizado antes de bater.
 */
const TERMOS_JURIDICOS = [
  "itcmd", "itbi", "inventario", "heranca", "herdeiro", "partilha", "usufruto",
  "doacao", "doar", "testamento", "imposto", "tributo", "tributacao",
  "isencao", "sonegacao", "blindagem", "penhora", "divorcio", "meacao",
  "espolio", "sucessao", "legitima", "posso transferir",
];

const TERMOS_PRECO = [
  "preco", "valor", "quanto custa", "quanto fica", "honorario", "orcamento",
  "desconto", "parcelar", "parcelamento", "boleto", "pix", "pagamento", "pagar",
  "quanto e", "quanto sai", "investimento",
];

const TERMOS_HUMANO = [
  "falar com alguem", "falar com uma pessoa", "atendente", "humano",
  "falar com a dra", "falar com a doutora", "falar com elaine", "me liga",
  "quero falar", "pode me ligar", "telefone de voces", "falar com voces",
];

const TERMOS_CONFIRMAR = ["confirmo", "confirmado", "estarei", "vou sim", "pode confirmar", "confirmar presenca", "estarei presente"];

const TERMOS_DOCUMENTO = ["documento", "documentos", "arquivo", "anexo", "mandar o ir", "enviar o ir", "contrato social", "declaracao"];

const TERMOS_O_QUE_FALTA = ["o que falta", "que falta", "falta algo", "falta alguma", "o que preciso", "que preciso", "proximo passo", "e agora"];

/** Minúsculas, sem acento, espaços colapsados — para bater termo sem depender de digitação. */
export function normalizarTexto(bruto: string): string {
  return bruto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function contem(texto: string, termos: string[]): boolean {
  return termos.some((t) => texto.includes(t));
}

export interface EntradaClassificacao {
  texto: string;
  /** O payload trouxe anexo? Anexo é intenção de mandar documento, sempre. */
  temAnexo: boolean;
  /** Chave do passo derivado (`ProximoPasso.chave`) — só ela habilita `confirmar_horario`. */
  passoChave: string;
}

/**
 * Classificação SEM modelo. Devolve `null` quando nada bate — e só aí a IA
 * entra (e só com `tratamento_ia`, B56).
 *
 * Ordem fixa e deliberada:
 *  1. jurídico  → é o que não pode escapar por nada;
 *  2. preço     → idem (B61);
 *  3. humano    → pedido explícito é atendido na hora;
 *  4. anexo     → o cliente já está mandando arquivo;
 *  5. confirmar → SÓ quando o passo é confirmar presença ("sim" isolado pode
 *                 ser resposta a qualquer outra coisa — B58);
 *  6. documento / o que falta.
 */
export function classificarDeterministico(entrada: EntradaClassificacao): IntencaoComTextoFixo | null {
  const t = normalizarTexto(entrada.texto);

  if (contem(t, TERMOS_JURIDICOS)) return "duvida_juridica";
  if (contem(t, TERMOS_PRECO)) return "preco_prazo";
  if (contem(t, TERMOS_HUMANO)) return "falar_com_humano";
  if (entrada.temAnexo) return "enviar_documento";
  if (entrada.passoChave === "confirmar_presenca" && contem(t, TERMOS_CONFIRMAR)) return "confirmar_horario";
  if (contem(t, TERMOS_DOCUMENTO)) return "enviar_documento";
  if (contem(t, TERMOS_O_QUE_FALTA)) return "o_que_falta";
  return null;
}

/**
 * A MESMA lista, aplicada agora à SAÍDA da IA — defesa em profundidade
 * (achado BAIXO do pentest da Fase 9).
 *
 * O classificador determinístico só intercepta jurídico/preço quando o texto
 * do CLIENTE contém um dos termos. Uma pergunta reformulada sem eles ("e se eu
 * passar tudo para os meus filhos agora, sai mais barato?") escapa e vai para
 * o modelo — cuja única defesa passa a ser a instrução do prompt, que é
 * probabilística, não estrutural.
 *
 * Aqui a trava é estrutural: se a frase GERADA fala de valor ou dá orientação
 * jurídica/tributária, ela não sai. O agente cai no texto fixo de esquiva e a
 * equipe recebe tarefa. Custa uma varredura de string; o erro que evita é o
 * número oficial do escritório dando conselho jurídico.
 *
 * Vale só para o que a IA escreve — os textos fixos deste arquivo dizem
 * "valores" e "Dra. Elaine" de propósito, e são a resposta CERTA.
 */
export function contemTermoProibido(texto: string): "juridico" | "preco" | null {
  const t = normalizarTexto(texto);
  if (contem(t, TERMOS_JURIDICOS)) return "juridico";
  if (contem(t, TERMOS_PRECO)) return "preco";
  return null;
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

/**
 * Substitui `{{chave}}` e RECUSA se sobrar placeholder (D16, mesma trava da
 * régua). É por isto que nunca sai "seu link: " com o fim vazio: sem valor, não
 * há mensagem — há tarefa para a equipe.
 */
export function renderizar(modelo: string, valores: Record<string, string>): string | null {
  let corpo = modelo;
  for (const [chave, valor] of Object.entries(valores)) {
    if (!valor) continue;
    corpo = corpo.split(`{{${chave}}}`).join(valor);
  }
  // Linha que ficou só com a saudação vazia não vira espaço duplo.
  corpo = corpo.replace(/[ \t]{2,}/g, " ").replace(/ +\n/g, "\n").trim();
  return placeholdersRestantes(corpo).length > 0 ? null : corpo;
}

function saudacao(primeiroNome: string | null): string {
  return primeiroNome && primeiroNome.trim().length > 1 ? `Oi, ${primeiroNome.trim()}! ` : "Oi! ";
}

function listaHumana(itens: string[]): string {
  const limpos = itens.map((i) => i.trim()).filter(Boolean).slice(0, 6);
  if (limpos.length === 0) return "";
  if (limpos.length === 1) return limpos[0];
  return `${limpos.slice(0, -1).join(", ")} e ${limpos[limpos.length - 1]}`;
}

/**
 * A frase de encaminhamento respeita a janela de atendimento (B59): o agente
 * responde 24/7, mas não promete que "a equipe já te chama" às 2 da manhã.
 */
export function fraseEncaminhamento(dentroDaJanela: boolean): string {
  return dentroDaJanela
    ? "Vou pedir para alguém da equipe falar com você."
    : "Vou pedir para alguém da equipe falar com você no próximo dia útil, de manhã.";
}

/**
 * O texto fixo de cada intenção. `null` quando o contexto não permite montar a
 * frase inteira (ex.: pedir documento sem link e sem lista) — e `null` aqui
 * significa "não manda nada e abre tarefa", nunca "manda algo genérico".
 */
export function textoFixo(intencao: IntencaoComTextoFixo, ctx: ContextoResposta): string | null {
  const nome = saudacao(ctx.primeiroNome);
  const faltam = listaHumana(ctx.faltam);

  switch (intencao) {
    case "confirmar_horario":
      // B58: manda o link, não confirma sozinho. Confirmação é ato auditável.
      if (!ctx.link) return null;
      return renderizar("{{ola}}Para confirmar sua presença, é só tocar aqui: {{link}}", { ola: nome, link: ctx.link });

    case "enviar_documento":
      // C9/D11: o agente NUNCA ingere anexo. O arquivo tem de entrar pelo /p/d,
      // que casa com o item pedido, respeita o limite e guarda em lugar privado.
      if (ctx.link && faltam) {
        return renderizar(
          "{{ola}}Pode mandar por aqui, é só tocar neste link: {{link}}. Ainda faltam: {{faltam}}.",
          { ola: nome, link: ctx.link, faltam },
        );
      }
      if (ctx.link) {
        return renderizar("{{ola}}Pode mandar por aqui, é só tocar neste link: {{link}}", { ola: nome, link: ctx.link });
      }
      return null;

    case "o_que_falta":
      if (faltam) {
        return renderizar("{{ola}}Agora falta: {{faltam}}. O passo de agora é {{passo}}.", {
          ola: nome,
          faltam,
          passo: ctx.passo.toLowerCase(),
        });
      }
      return renderizar("{{ola}}O passo de agora é {{passo}}.", { ola: nome, passo: ctx.passo.toLowerCase() });

    case "duvida_juridica":
      return renderizar(
        "{{ola}}Essa é uma pergunta para a Dra. Elaine — não é coisa que eu deva responder por aqui. {{encaminha}} Enquanto isso, o passo de agora é {{passo}}.",
        { ola: nome, encaminha: fraseEncaminhamento(ctx.dentroDaJanela), passo: ctx.passo.toLowerCase() },
      );

    case "preco_prazo":
      // B61: valor é assunto pessoal da Dra. Elaine. Sem número, nem "a partir de".
      return renderizar(
        "{{ola}}Quem trata de valores é a Dra. Elaine, pessoalmente. {{encaminha}}",
        { ola: nome, encaminha: fraseEncaminhamento(ctx.dentroDaJanela) },
      );

    case "falar_com_humano":
      return renderizar("{{ola}}Claro. {{encaminha}}", { ola: nome, encaminha: fraseEncaminhamento(ctx.dentroDaJanela) });

    case "fora_do_tema":
      return renderizar("{{ola}}Por aqui eu consigo ajudar com o andamento do seu processo. O passo de agora é {{passo}}.", {
        ola: nome,
        passo: ctx.passo.toLowerCase(),
      });
  }
}

/**
 * A 2ª esquiva (B57) não repete a mesma frase: encaminha e abre tarefa. Repetir
 * "por aqui eu consigo ajudar com…" é o que faz um robô parecer robô.
 */
export function textoEsquivaFinal(ctx: ContextoResposta): string | null {
  return renderizar("{{ola}}Essa eu não consigo responder por aqui. {{encaminha}}", {
    ola: saudacao(ctx.primeiroNome),
    encaminha: fraseEncaminhamento(ctx.dentroDaJanela),
  });
}

/**
 * O link do tipo certo já saiu há menos de `intervalo_link_horas` (C5/D15).
 * Reemitir REVOGARIA o anterior — o cliente ficaria com um link morto no
 * histórico da conversa. Então o agente aponta para trás, e não emite.
 */
export function textoLinkRecente(ctx: ContextoResposta): string | null {
  return renderizar("{{ola}}O link que mandei aqui em cima continua valendo — é só tocar nele. O passo de agora é {{passo}}.", {
    ola: saudacao(ctx.primeiroNome),
    passo: ctx.passo.toLowerCase(),
  });
}
