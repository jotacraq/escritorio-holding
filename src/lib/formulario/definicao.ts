/**
 * Definição do Formulário Estratégico (POP 02) — leitura, rótulo e validação.
 *
 * Existe porque `formularios.definicao` guarda DOIS formatos de `opcoes` e vai
 * guardar os dois para sempre (docs/ARQUITETURA-FASE-7.md §A2.1):
 *
 *   - legado (versões 1..5, semeadas na 0016): `["viuvo", "casado"]` — string
 *     crua, que é ao mesmo tempo o valor gravado na resposta e o texto que o
 *     cliente leu. Misturar os dois é o erro que `rotuloOpcao()` remendava.
 *   - novo (0078 em diante): `[{ valor: "viuvo", rotulo: "Viúvo(a)" }]` — o
 *     valor é a chave estável que já está gravada em `formularios_respostas`;
 *     o rótulo é a frase que a Dra. Elaine reescreve publicando versão nova,
 *     SEM tocar em nenhuma resposta antiga.
 *
 * Não há backfill: reescrever a `definicao` de uma versão publicada é o UPDATE
 * que o repositório proíbe (é o que permite reabrir uma resposta de junho e
 * saber contra qual pergunta ela foi dada). Por isso a leitura dos dois
 * formatos não é dívida — é o caminho do histórico.
 *
 * Tudo aqui é PURO e sem React de propósito: é a mesma regra usada pela tela do
 * cliente (`/p/f`), pela Ficha, pelo editor do Admin — e, desde a rodada 3 do
 * pentest, TAMBÉM pelo servidor (`src/server/formularios/definicao.ts` é um
 * invólucro fino que importa daqui). Havia dois validadores gêmeos em TS, um de
 * cada lado; dois validadores da mesma regra é uma regra que já está divergindo.
 * A direção `@/server` → `@/lib` é a permitida; a inversa não existe, e é por
 * isso que o núcleo mora aqui e não lá.
 *
 * A validação abaixo é o ESPELHO de `app.definicao_formulario_valida` (0078 +
 * 0081) — ela existe para o erro aparecer antes do POST, nunca no lugar dele:
 * quem decide continua sendo o banco.
 */

import { rotuloOpcao } from "@/lib/vocabulario";

export type TipoPergunta = "texto" | "texto_longo" | "numero" | "unica" | "multipla" | "sim_nao";

export interface OpcaoPergunta {
  /** Chave estável — é o que está gravado em `formularios_respostas.respostas`. */
  valor: string;
  /** O que o cliente lê. Pode mudar em versão nova sem mexer em resposta. */
  rotulo: string;
}

export interface CondicionalPergunta {
  depende_de: string;
  contem?: string;
  igual?: string;
}

/**
 * Forma estrutural de uma pergunta. Não importa de `@/types/banco` de propósito:
 * este módulo lê definição de QUALQUER versão (inclusive as antigas, com
 * `opcoes: string[]`), então `opcoes` entra como `unknown` e sai normalizada.
 */
export interface PerguntaDefinicao {
  id: string;
  bloco: string;
  tipo: TipoPergunta;
  rotulo: string;
  opcoes?: unknown;
  obrigatoria?: boolean;
  condicional?: CondicionalPergunta;
}

/**
 * A mesma pergunta, pronta para subir: `opcoes` já normalizada. É o tipo que
 * o cliente HTTP aceita (`PerguntaVersionada` em `@/lib/api`) — `unknown` só
 * vale para LER definição gravada, nunca para escrever.
 */
export interface PerguntaPublicavel extends Omit<PerguntaDefinicao, "opcoes"> {
  opcoes?: OpcaoPergunta[];
}

export const TIPOS_PERGUNTA: TipoPergunta[] = ["texto", "texto_longo", "numero", "unica", "multipla", "sim_nao"];

export const ROTULO_TIPO_PERGUNTA: Record<TipoPergunta, string> = {
  texto: "Texto curto",
  texto_longo: "Texto longo",
  numero: "Número",
  unica: "Escolha única",
  multipla: "Múltipla escolha",
  sim_nao: "Sim ou não",
};

/** Chave do POP 02. Só ela tem perguntas de sistema (mesma regra da 0078). */
export const CHAVE_FORMULARIO_ESTRATEGICO = "estrategico";

/** Só estes dois tipos têm (e exigem) opções — igual à 0078. */
export function exigeOpcoes(tipo: TipoPergunta): boolean {
  return tipo === "unica" || tipo === "multipla";
}

/**
 * Aceita `["a","b"]` (legado) e `[{valor,rotulo}]` (novo). Qualquer outra coisa
 * é descartada em silêncio: uma opção quebrada não pode derrubar o formulário
 * do cliente no meio da resposta.
 */
export function normalizarOpcoes(opcoes: unknown): OpcaoPergunta[] {
  if (!Array.isArray(opcoes)) return [];
  return opcoes.flatMap<OpcaoPergunta>((opcao) => {
    if (typeof opcao === "string") {
      return opcao.trim() ? [{ valor: opcao, rotulo: rotuloOpcao(opcao) }] : [];
    }
    if (opcao && typeof opcao === "object") {
      const bruta = opcao as { valor?: unknown; rotulo?: unknown };
      if (typeof bruta.valor !== "string" || !bruta.valor.trim()) return [];
      const rotulo = typeof bruta.rotulo === "string" && bruta.rotulo.trim() ? bruta.rotulo : rotuloOpcao(bruta.valor);
      return [{ valor: bruta.valor, rotulo }];
    }
    return [];
  });
}

/**
 * A pergunta APARECE para quem responde?
 *
 * Regra única da `condicional` (ex.: p11 "Quantos imóveis?" só aparece se p10
 * incluir "Imóveis"). Estava escrita três vezes — no formulário do cliente
 * (`CampoPerguntaPublico`), na Ficha (`ficha360/FormularioAba`) e, por
 * omissão, em lugar nenhum do servidor, que por isso cobrava `obrigatoria` de
 * pergunta invisível (achado do Fable, r3). Agora é uma função só, e a 0082 é
 * o espelho dela em SQL: mudar a regra aqui obriga a mudar a migration junto.
 *
 * Comparação por identidade de propósito, igual ao `===`/`includes` do
 * JavaScript: um valor de lista ou objeto nunca casa. `igual` tem precedência
 * sobre `contem` (a validação já proíbe os dois na mesma pergunta), e
 * `condicional` sem operador nenhum não esconde nada.
 */
export function perguntaVisivel(
  pergunta: { condicional?: CondicionalPergunta },
  respostas: Record<string, unknown>,
): boolean {
  if (!pergunta.condicional) return true;
  const valorDependido = respostas[pergunta.condicional.depende_de];
  if (pergunta.condicional.igual !== undefined) return valorDependido === pergunta.condicional.igual;
  if (pergunta.condicional.contem !== undefined) {
    const lista = Array.isArray(valorDependido) ? valorDependido : [];
    return lista.includes(pergunta.condicional.contem);
  }
  return true;
}

/**
 * O texto que uma resposta já dada tem na tela. Antes disto a tela de conclusão
 * do `/p/f` imprimia o valor cru: quem respondeu "Casado(a)" relia "casado".
 * Vazio é vazio — devolve string vazia, nunca "—" nem zero.
 */
export function textoDaResposta(pergunta: PerguntaDefinicao, valor: unknown): string {
  const opcoes = normalizarOpcoes(pergunta.opcoes);
  const rotuloDe = (bruto: unknown): string => {
    const texto = typeof bruto === "string" ? bruto : String(bruto ?? "");
    return opcoes.find((o) => o.valor === texto)?.rotulo ?? (opcoes.length > 0 ? rotuloOpcao(texto) : texto);
  };
  if (valor === undefined || valor === null || valor === "") return "";
  if (Array.isArray(valor)) return valor.map(rotuloDe).filter(Boolean).join(", ");
  if (pergunta.tipo === "sim_nao") return valor === "sim" ? "Sim" : valor === "nao" ? "Não" : String(valor);
  return rotuloDe(valor);
}

/**
 * As perguntas que o SERVIDOR lê por string literal (§A2.2). Tirar uma delas do
 * formulário não dá erro na hora: quebra em silêncio, semanas depois. A RPC da
 * 0078 recusa publicar sem elas; aqui a tela desabilita o botão de remover e
 * diz o porquê, para ninguém chegar ao beco sem saída.
 *
 * A lista mora em código dos dois lados (aqui e na função SQL) de propósito:
 * mudá-la exige mudar o código que lê, então exige migration junto.
 */
export const PERGUNTAS_DE_SISTEMA: { id: string; motivo: string }[] = [
  { id: "p1", motivo: "O nome é excluído do prompt do briefing por esta chave — sem ela, o nome do cliente vaza para a IA." },
  { id: "p2", motivo: "A cidade é excluída do prompt do briefing por esta chave." },
  { id: "p9", motivo: "É daqui que sai a faixa de patrimônio do Kanban, da Ficha e do briefing." },
  { id: "p16", motivo: "É a dor que o material pós-sessão usa para escolher o texto." },
];

/** Só a chave `estrategico` tem perguntas de sistema (mesma regra da 0078). */
export function perguntasDeSistema(chave: string): { id: string; motivo: string }[] {
  return chave === "estrategico" ? PERGUNTAS_DE_SISTEMA : [];
}

export function motivoDePerguntaDeSistema(chave: string, id: string): string | null {
  return perguntasDeSistema(chave).find((p) => p.id === id)?.motivo ?? null;
}

export interface ProblemaDefinicao {
  /** Mesmo código do `raise` da 0078/0081 — a tela pode casar os dois lados. */
  codigo: string;
  /** Id da pergunta com o problema; `null` quando é da definição inteira. */
  perguntaId: string | null;
  mensagem: string;
}

const ID_VALIDO = /^[a-z][a-z0-9_]{0,39}$/;
const CHAVE_VALIDA = /^[a-z][a-z0-9_]{0,49}$/;

export const LIMITE_PERGUNTAS = 60;

/**
 * Teto de opções por pergunta (0081). Não é estética: a definição inteira sai
 * para todo cliente anônimo em `app.payload_link_formulario`, e uma pergunta com
 * 5.000 opções é peso de rede pago pelo celular de quem responde.
 */
export const LIMITE_OPCOES = 30;

/**
 * O id vira CHAVE de um objeto JS em `formularios_respostas.respostas` —
 * `respostas["p16"]` (src/server/material/sinais.ts). Nome herdado do protótipo
 * devolveria a função do `Object` quando a chave não existisse. Mesma lista de
 * `app.definicao_formulario_valida` (0078).
 */
const IDS_RESERVADOS = ["constructor", "prototype", "tostring", "valueof", "hasownproperty", "isprototypeof"];

/** Chave de formulário: o mesmo slug que `publicar_formulario_versao` exige. */
export function chaveFormularioValida(chave: unknown): boolean {
  return typeof chave === "string" && CHAVE_VALIDA.test(chave);
}

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function comoTexto(valor: unknown): string | null {
  return typeof valor === "string" ? valor : null;
}

/**
 * Lê `formularios.definicao` (jsonb `unknown`) como lista de perguntas. Nunca
 * lança: definição gravada é histórico, e histórico não pode derrubar tela.
 */
export function lerDefinicao(definicao: unknown): PerguntaDefinicao[] {
  if (!Array.isArray(definicao)) return [];
  return definicao.filter(ehObjeto).map((p) => ({
    id: String(p.id ?? ""),
    bloco: typeof p.bloco === "string" ? p.bloco : "",
    tipo: TIPOS_PERGUNTA.includes(p.tipo as TipoPergunta) ? (p.tipo as TipoPergunta) : "texto",
    rotulo: typeof p.rotulo === "string" ? p.rotulo : "",
    opcoes: Array.isArray(p.opcoes) ? p.opcoes : undefined,
    obrigatoria: typeof p.obrigatoria === "boolean" ? p.obrigatoria : undefined,
    condicional: ehObjeto(p.condicional)
      ? {
          depende_de: String(p.condicional.depende_de ?? ""),
          contem: typeof p.condicional.contem === "string" ? p.condicional.contem : undefined,
          igual: typeof p.condicional.igual === "string" ? p.condicional.igual : undefined,
        }
      : undefined,
  }));
}

/**
 * Rótulo humano de UMA resposta gravada, contra a definição da VERSÃO em que ela
 * foi dada. Diferente de `textoDaResposta` de propósito: aqui o valor que não
 * existe mais nas opções sai CRU, sem embelezar. É o que vai para o dossiê do
 * titular (LGPD art. 18) e para o PDF assinado — imprimir "Faixa extinta" no
 * lugar de `faixa_extinta` seria o sistema inventando uma opção que a pessoa
 * nunca leu.
 */
export function rotuloDaResposta(pergunta: { opcoes?: unknown } | null | undefined, valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  const opcoes = normalizarOpcoes(pergunta?.opcoes);
  const traduzir = (v: unknown): string => {
    const bruto = typeof v === "string" ? v : String(v);
    return opcoes.find((o) => o.valor === bruto)?.rotulo ?? bruto;
  };
  if (Array.isArray(valor)) return valor.map(traduzir).join(", ");
  return traduzir(valor);
}

/**
 * ESPELHO de `app.definicao_formulario_valida(jsonb, text)` (0078 + 0081).
 *
 * Aceita `unknown` de propósito: é a MESMA função que roda no editor do Admin
 * (onde a entrada já é `PerguntaDefinicao[]`) e na borda de `POST
 * /api/formularios` (onde a entrada é o corpo cru do cliente HTTP). Um núcleo
 * só — validar a mesma regra em dois arquivos é como as duas listas divergem.
 *
 * Devolve TODOS os problemas, não só o primeiro: a RPC para no primeiro `raise`,
 * e uma tela que corrige um erro por vez é uma tela que cansa.
 */
export function validarDefinicao(definicao: unknown, chave?: string | null): ProblemaDefinicao[] {
  const problemas: ProblemaDefinicao[] = [];
  const erro = (codigo: string, perguntaId: string | null, mensagem: string) => problemas.push({ codigo, perguntaId, mensagem });

  if (!Array.isArray(definicao)) {
    erro("definicao_invalida", null, "A definição precisa ser uma lista de perguntas.");
    return problemas;
  }
  if (definicao.length === 0) {
    erro("definicao_vazia", null, "O formulário precisa de pelo menos uma pergunta.");
    return problemas;
  }
  if (definicao.length > LIMITE_PERGUNTAS) {
    erro("definicao_longa", null, `Máximo de ${LIMITE_PERGUNTAS} perguntas — o POP 02 promete 3 minutos ao cliente.`);
  }

  const vistos: string[] = [];
  const porId = new Map<string, Record<string, unknown>>();

  definicao.forEach((bruta: unknown, indice) => {
    const posicao = indice + 1;
    if (!ehObjeto(bruta)) {
      erro("pergunta_invalida", null, `A pergunta ${posicao} não é um objeto.`);
      return;
    }
    const item = bruta;

    const id = comoTexto(item.id) ?? "";
    if (!ID_VALIDO.test(id)) {
      erro("id_invalido", id || null, `Pergunta ${posicao}: o identificador "${id || "(vazio)"}" precisa ser minúsculas, dígitos e _ (até 40).`);
      return;
    }
    if (vistos.includes(id)) {
      erro("id_duplicado", id, `"${id}" aparece duas vezes.`);
      return;
    }
    if (IDS_RESERVADOS.includes(id)) {
      erro("id_reservado", id, `"${id}" é nome herdado de objeto e não pode ser identificador de pergunta.`);
      return;
    }

    const bloco = (comoTexto(item.bloco) ?? "").trim();
    if (bloco.length < 1 || bloco.length > 80) erro("bloco_invalido", id, `${id}: escolha um bloco (1 a 80 caracteres).`);

    const rotulo = (comoTexto(item.rotulo) ?? "").trim();
    if (rotulo.length < 1 || rotulo.length > 300) erro("rotulo_invalido", id, `${id}: escreva o enunciado (1 a 300 caracteres).`);

    const tipo = comoTexto(item.tipo);
    const tipoConhecido = tipo !== null && TIPOS_PERGUNTA.includes(tipo as TipoPergunta);
    if (!tipoConhecido) erro("tipo_invalido", id, `${id}: tipo "${tipo ?? "(vazio)"}" desconhecido.`);

    if ("obrigatoria" in item && item.obrigatoria !== undefined && typeof item.obrigatoria !== "boolean") {
      erro("obrigatoria_invalida", id, `${id}: "obrigatória" precisa ser sim ou não.`);
    }

    // --- opções -------------------------------------------------------------
    if (tipoConhecido && exigeOpcoes(tipo as TipoPergunta)) {
      const brutas = Array.isArray(item.opcoes) ? (item.opcoes as unknown[]) : null;
      if (!brutas || brutas.length < 2) {
        erro("opcoes_insuficientes", id, `${id}: uma pergunta de escolha precisa de pelo menos 2 opções.`);
      } else if (brutas.length > LIMITE_OPCOES) {
        erro("opcoes_demais", id, `${id}: no máximo ${LIMITE_OPCOES} opções por pergunta.`);
      } else {
        const valores: string[] = [];
        for (const opcao of brutas) {
          let valor: string | null = null;
          if (typeof opcao === "string") {
            valor = opcao; // legado
          } else if (ehObjeto(opcao)) {
            valor = comoTexto(opcao.valor);
            const texto = (comoTexto(opcao.rotulo) ?? "").trim();
            if (texto.length < 1 || texto.length > 200) {
              erro("rotulo_opcao_invalido", id, `${id}: a opção "${valor ?? "(vazio)"}" está sem texto para o cliente.`);
            }
          } else {
            erro("opcao_invalida", id, `${id}: a opção precisa ser texto ou {valor, rótulo}.`);
            continue;
          }
          const limpo = (valor ?? "").trim();
          if (limpo.length < 1 || (valor ?? "").length > 120) {
            erro("valor_opcao_invalido", id, `${id}: há uma opção sem valor.`);
            continue;
          }
          if (valores.includes(valor as string)) {
            erro("valor_opcao_duplicado", id, `${id}: o valor "${valor}" se repete nas opções.`);
            continue;
          }
          valores.push(valor as string);
        }
      }
    } else if (item.opcoes !== undefined) {
      // A 0078 recusa pela PRESENÇA da chave, não pelo conteúdo — e é por isso
      // que `prepararParaPublicar` tira a chave em vez de mandar `[]`.
      erro("opcoes_indevidas", id, `${id}: perguntas de ${ROTULO_TIPO_PERGUNTA[tipo as TipoPergunta] ?? tipo} não aceitam opções.`);
    }

    // --- condicional --------------------------------------------------------
    if (item.condicional !== undefined) {
      const cond = item.condicional;
      if (!ehObjeto(cond)) {
        erro("condicional_invalida", id, `${id}: a condição está em formato inválido.`);
      } else {
        const dependeDe = comoTexto(cond.depende_de);
        const temIgual = cond.igual !== undefined;
        const temContem = cond.contem !== undefined;
        const alvo = dependeDe ? porId.get(dependeDe) : undefined;
        if (!dependeDe) {
          erro("condicional_sem_alvo", id, `${id}: a condição não diz de qual pergunta depende.`);
        } else if (!alvo) {
          // Cobre "aponta para frente" e "aponta para si mesma" — a referência
          // circular morre por construção, exatamente como na 0078.
          erro("condicional_adiante", id, `${id}: depende de "${dependeDe}", que não vem antes dela.`);
        } else {
          const tipoAlvo = comoTexto(alvo.tipo) as TipoPergunta | null;
          if (temIgual === temContem) {
            erro("condicional_operador", id, `${id}: escolha exatamente um entre "igual a" e "contém".`);
          } else if (temContem && tipoAlvo !== "multipla") {
            erro("condicional_contem", id, `${id}: "contém" só vale sobre uma pergunta de múltipla escolha.`);
          } else if (temIgual && tipoAlvo !== "unica" && tipoAlvo !== "sim_nao") {
            erro("condicional_igual", id, `${id}: "igual a" só vale sobre escolha única ou sim/não.`);
          } else {
            const comparado = String((temContem ? cond.contem : cond.igual) ?? "");
            if (tipoAlvo !== null && exigeOpcoes(tipoAlvo) && !normalizarOpcoes(alvo.opcoes).some((o) => o.valor === comparado)) {
              erro("condicional_valor", id, `${id}: compara "${dependeDe}" com "${comparado}", que não existe nas opções dela.`);
            }
          }
        }
      }
    }

    vistos.push(id);
    porId.set(id, item);
  });

  for (const sistema of perguntasDeSistema(chave ?? "")) {
    if (!vistos.includes(sistema.id)) {
      erro("pergunta_de_sistema_removida", sistema.id, `A pergunta ${sistema.id} não pode sair: ${sistema.motivo}`);
    }
  }

  return problemas;
}

/**
 * O nome que o editor do Admin usa. Mesma função, assinatura estreitada para o
 * rascunho já tipado da tela.
 */
export function validarDefinicaoNoCliente(definicao: PerguntaDefinicao[], chave?: string): ProblemaDefinicao[] {
  return validarDefinicao(definicao, chave);
}

/**
 * Deixa a definição no formato que a RPC aceita, antes do POST:
 *
 *   - `opcoes` sempre no formato novo `[{valor,rotulo}]` — a versão publicada
 *     nasce com rótulo próprio, e nenhuma resposta antiga é tocada;
 *   - a CHAVE `opcoes` some das perguntas que não são de escolha (a 0078 recusa
 *     `opcoes_indevidas` pela presença da chave, não pelo conteúdo);
 *   - `obrigatoria: false` não vai — ausência já é o padrão;
 *   - `condicional` sai com exatamente um operador, ou não sai.
 */
export function prepararParaPublicar(definicao: PerguntaDefinicao[]): PerguntaPublicavel[] {
  return definicao.map((pergunta) => {
    const preparada: PerguntaPublicavel = {
      id: (pergunta.id ?? "").trim(),
      bloco: (pergunta.bloco ?? "").trim(),
      tipo: pergunta.tipo,
      rotulo: (pergunta.rotulo ?? "").trim(),
    };
    if (pergunta.obrigatoria) preparada.obrigatoria = true;
    if (exigeOpcoes(pergunta.tipo)) preparada.opcoes = normalizarOpcoes(pergunta.opcoes);
    const condicional = pergunta.condicional;
    if (condicional?.depende_de) {
      if (condicional.igual !== undefined && condicional.igual !== "") {
        preparada.condicional = { depende_de: condicional.depende_de, igual: condicional.igual };
      } else if (condicional.contem !== undefined && condicional.contem !== "") {
        preparada.condicional = { depende_de: condicional.depende_de, contem: condicional.contem };
      }
    }
    return preparada;
  });
}

/** Resumo da barra de publicação: "17 perguntas · 5 blocos · 3 obrigatórias". */
export function resumoDaDefinicao(definicao: PerguntaDefinicao[]): string {
  const blocos = new Set(definicao.map((p) => (p.bloco ?? "").trim()).filter(Boolean));
  const obrigatorias = definicao.filter((p) => p.obrigatoria).length;
  const partes = [
    `${definicao.length} ${definicao.length === 1 ? "pergunta" : "perguntas"}`,
    `${blocos.size} ${blocos.size === 1 ? "bloco" : "blocos"}`,
    obrigatorias === 0 ? "nenhuma obrigatória" : `${obrigatorias} ${obrigatorias === 1 ? "obrigatória" : "obrigatórias"}`,
  ];
  return partes.join(" · ");
}
