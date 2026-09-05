/**
 * RADAR DE DOCUMENTOS — "tem documento X para enviar" (§1.5 e §8.3 de
 * `docs/ARQUITETURA-FASE-5.md`), nos dois lados:
 *
 *   **coleta**  — o que a família precisa mandar ANTES do croqui (IR, matrícula,
 *                 contrato social, certidões…). Hoje isso vive na cabeça de quem
 *                 atende e numa frase genérica ("manda o IR e o contrato social").
 *   **entrega** — o que o escritório precisa devolver DEPOIS da execução (carta,
 *                 sumário, contrato social de cada célula, alvará, cartão CNPJ,
 *                 acordo de sócios). Substitui o `ENTREGA DA HOLDING.xlsx`
 *                 estático de TRUE/FALSE que o escritório usa hoje
 *                 (`brain/06 - Materiais/Processo real do escritorio (Drive).md` §7).
 *
 * A lista é DERIVADA do patrimônio, da família e do modelo do croqui — não há
 * tabela de "checklist". A única coisa que o banco guarda (`documentos_pedidos`,
 * 0065) é o ATO HUMANO: pedi, conferi, dispensei. Por isso existe o quarto
 * estado `a_pedir` (§11.5, CONFLITO 11): a lista nasce sem pedido nenhum, e
 * chamar isso de "pedido" seria mentir na tela.
 *
 * Estados:
 *   `conferido` → `documentos_pedidos.conferido_em` (alguém olhou e validou)
 *   `recebido`  → existe `documentos` casando tipo + item_ref
 *   `pedido`    → `pedido_em` sem documento correspondente
 *   `a_pedir`   → nada aconteceu ainda
 *
 * Item com `dispensado_em` SAI da lista: é decisão humana registrada ("essa
 * família não tem imóvel financiado, não precisa da matrícula"), não ausência.
 *
 * Função pura, sem I/O. Nenhum valor de patrimônio entra no resultado — só
 * descrição e id, porque o radar é lido por quem já vê patrimônio (a rota exige
 * `ve_patrimonio`), mas não há motivo para transportar dinheiro à toa.
 */
import type { ChaveTabelaCroqui, DocumentoTipoRadar, EstadoItemRadar, ItemRadar, ModeloCroquiRadar } from "@/types/jornada-automacoes";

/** Recorte mínimo de `patrimonio_itens` que o radar precisa. */
export interface BemDoRadar {
  id: string;
  tipo: "imovel" | "veiculo" | "investimento" | "previdencia" | "empresa" | "outro";
  descricao: string;
}

/** Recorte mínimo de `familiares`. */
export interface FamiliarDoRadar {
  id: string;
  parentesco: string;
  nome: string | null;
}

/** Recorte mínimo de `documentos` (a coluna `item_ref` chega na 0065). */
export interface DocumentoDoRadar {
  id: string;
  tipo: string;
  criado_em: string;
  item_ref?: string | null;
}

/** Linha de `documentos_pedidos` (0065). */
export interface PedidoDoRadar {
  chave: string;
  tipo: string;
  item_ref: string | null;
  pedido_em: string | null;
  conferido_em: string | null;
  dispensado_em: string | null;
}

/** Travas por tipo: que tabela do croqui fica sem insumo enquanto o documento não chega. */
const TRAVA_POR_TIPO: Record<DocumentoTipoRadar, ChaveTabelaCroqui[]> = {
  imposto_renda: ["formacao_patrimonial", "inventario_atual", "celula_3"],
  contrato_social: ["operacional_pj", "celula_2", "celula_3"],
  matricula_imovel: ["formacao_patrimonial", "itbi", "celula_1", "celula_2", "celula_3"],
  certidao_casamento: ["composicao_familiar"],
  certidao_nascimento: ["composicao_familiar"],
  crlv: ["formacao_patrimonial"],
  extrato_investimento: ["formacao_patrimonial"],
  balanco: ["operacional_pj"],
  comprovante_residencia: ["celula_2", "celula_3"],
  outro: [],
};

/** Nome do documento na tela. Curto, sem sigla no fluxo (lei de texto §2). */
const ROTULO_POR_TIPO: Record<DocumentoTipoRadar, string> = {
  imposto_renda: "Imposto de renda",
  contrato_social: "Contrato social",
  matricula_imovel: "Matrícula",
  certidao_casamento: "Certidão de casamento",
  certidao_nascimento: "Certidão de nascimento",
  crlv: "Documento do veículo",
  extrato_investimento: "Extrato de investimento",
  balanco: "Balanço",
  comprovante_residencia: "Comprovante de residência",
  outro: "Documento",
};

/** Quantas células o modelo tem — define os documentos de entrega. */
const CELULAS_POR_MODELO: Record<ModeloCroquiRadar, string[]> = {
  inventario: [],
  doacao: [],
  celula_1: ["Cofre"],
  celula_2: ["Cofre", "Destino"],
  celula_3: ["Cofre", "Veículo", "Destino"],
};

export function chaveItemRadar(lado: "coleta" | "entrega", tipo: DocumentoTipoRadar, itemRef: string | null, sufixo?: string): string {
  return [lado, tipo, itemRef ?? "-", sufixo].filter((p) => p !== undefined && p !== "").join(":");
}

function primeiraPalavra(texto: string | null, alternativa: string): string {
  const limpo = (texto ?? "").trim();
  return limpo.length > 0 ? limpo : alternativa;
}

function encurtar(texto: string, limite = 32): string {
  const limpo = texto.trim().replace(/\s+/g, " ");
  return limpo.length <= limite ? limpo : `${limpo.slice(0, limite - 1)}…`;
}

interface Semente {
  lado: "coleta" | "entrega";
  tipo: DocumentoTipoRadar;
  rotulo: string;
  item_ref: string | null;
  obrigatorio: boolean;
  sufixo?: string;
}

/** Lado da COLETA: derivado do patrimônio, da família e do modelo. */
function sementesDeColeta(bens: BemDoRadar[], familiares: FamiliarDoRadar[], modelo: ModeloCroquiRadar | null): Semente[] {
  const sementes: Semente[] = [
    // O IR do titular é o único documento que não depende de nada: é a base
    // DIRPF de todo o método (aba 2 da planilha do escritório).
    { lado: "coleta", tipo: "imposto_renda", rotulo: `${ROTULO_POR_TIPO.imposto_renda} · titular`, item_ref: null, obrigatorio: true },
  ];

  for (const familiar of familiares) {
    const parentesco = familiar.parentesco.toLowerCase();
    const nome = encurtar(primeiraPalavra(familiar.nome, parentesco));
    if (parentesco === "conjuge" || parentesco === "cônjuge") {
      sementes.push({ lado: "coleta", tipo: "imposto_renda", rotulo: `${ROTULO_POR_TIPO.imposto_renda} · ${nome}`, item_ref: familiar.id, obrigatorio: true });
      sementes.push({ lado: "coleta", tipo: "certidao_casamento", rotulo: ROTULO_POR_TIPO.certidao_casamento, item_ref: familiar.id, obrigatorio: true });
    } else if (parentesco === "filho" || parentesco === "filha") {
      sementes.push({ lado: "coleta", tipo: "certidao_nascimento", rotulo: `${ROTULO_POR_TIPO.certidao_nascimento} · ${nome}`, item_ref: familiar.id, obrigatorio: true });
    }
  }

  for (const bem of bens) {
    const descricao = encurtar(bem.descricao);
    switch (bem.tipo) {
      case "imovel":
        sementes.push({ lado: "coleta", tipo: "matricula_imovel", rotulo: `${ROTULO_POR_TIPO.matricula_imovel} · ${descricao}`, item_ref: bem.id, obrigatorio: true });
        break;
      case "empresa":
        sementes.push({ lado: "coleta", tipo: "contrato_social", rotulo: `${ROTULO_POR_TIPO.contrato_social} · ${descricao}`, item_ref: bem.id, obrigatorio: true });
        sementes.push({ lado: "coleta", tipo: "balanco", rotulo: `${ROTULO_POR_TIPO.balanco} · ${descricao}`, item_ref: bem.id, obrigatorio: false });
        break;
      case "veiculo":
        sementes.push({ lado: "coleta", tipo: "crlv", rotulo: `${ROTULO_POR_TIPO.crlv} · ${descricao}`, item_ref: bem.id, obrigatorio: true });
        break;
      case "investimento":
      case "previdencia":
        sementes.push({ lado: "coleta", tipo: "extrato_investimento", rotulo: `${ROTULO_POR_TIPO.extrato_investimento} · ${descricao}`, item_ref: bem.id, obrigatorio: false });
        break;
      default:
        break;
    }
  }

  // 2 e 3 células usam domicílio em UF vantajosa — o comprovante é o que
  // sustenta a jurisdição do ITCMD escolhida.
  if (modelo === "celula_2" || modelo === "celula_3") {
    sementes.push({ lado: "coleta", tipo: "comprovante_residencia", rotulo: `${ROTULO_POR_TIPO.comprovante_residencia} · domicílio da holding`, item_ref: null, obrigatorio: true });
  }

  return sementes;
}

/**
 * Lado da ENTREGA: derivado das células do modelo. É o cronograma do escritório
 * virando checklist vivo — cada célula entrega constituição, alterações, alvará
 * e cartão CNPJ; o conjunto entrega carta, sumário e (multi-célula) acordo de
 * sócios.
 */
function sementesDeEntrega(modelo: ModeloCroquiRadar | null): Semente[] {
  if (modelo === null) return [];
  const celulas = CELULAS_POR_MODELO[modelo];
  if (celulas.length === 0) return [];

  const sementes: Semente[] = [
    { lado: "entrega", tipo: "outro", rotulo: "Carta de entrega", item_ref: null, obrigatorio: true, sufixo: "carta" },
    { lado: "entrega", tipo: "outro", rotulo: "Sumário jurídico", item_ref: null, obrigatorio: true, sufixo: "sumario" },
  ];

  for (const celula of celulas) {
    const referencia = celula.toLowerCase();
    sementes.push({ lado: "entrega", tipo: "contrato_social", rotulo: `Contrato social · ${celula}`, item_ref: referencia, obrigatorio: true, sufixo: "constituicao" });
    sementes.push({ lado: "entrega", tipo: "contrato_social", rotulo: `Alterações · ${celula}`, item_ref: referencia, obrigatorio: true, sufixo: "alteracoes" });
    sementes.push({ lado: "entrega", tipo: "outro", rotulo: `Alvará · ${celula}`, item_ref: referencia, obrigatorio: true, sufixo: "alvara" });
    sementes.push({ lado: "entrega", tipo: "outro", rotulo: `Cartão CNPJ · ${celula}`, item_ref: referencia, obrigatorio: true, sufixo: "cnpj" });
  }

  if (celulas.length > 1) {
    sementes.push({ lado: "entrega", tipo: "outro", rotulo: "Acordo de sócios", item_ref: null, obrigatorio: true, sufixo: "acordo" });
  }

  return sementes;
}

/**
 * @param bens        `patrimonio_itens` ativos (`null` quando o papel não vê patrimônio → só o IR do titular)
 * @param familiares  `familiares` ativos (`null` = sem informação)
 * @param modelo      modelo do croqui em jogo; `null` = ainda não definido (o lado da entrega fica vazio)
 * @param documentos  `documentos` da jornada
 * @param pedidos     `documentos_pedidos` da jornada (vazio antes da 0065)
 */
export function derivarRadarDocumentos(
  bens: BemDoRadar[] | null,
  familiares: FamiliarDoRadar[] | null,
  modelo: ModeloCroquiRadar | null,
  documentos: DocumentoDoRadar[],
  pedidos: PedidoDoRadar[],
): ItemRadar[] {
  const sementes = [...sementesDeColeta(bens ?? [], familiares ?? [], modelo), ...sementesDeEntrega(modelo)];

  const porChave = new Map<string, PedidoDoRadar>();
  for (const pedido of pedidos) porChave.set(pedido.chave, pedido);

  const itens: ItemRadar[] = [];
  for (const semente of sementes) {
    const chave = chaveItemRadar(semente.lado, semente.tipo, semente.item_ref, semente.sufixo);
    const pedido = porChave.get(chave) ?? null;

    // Dispensa é decisão humana registrada — o item sai do radar, não vira "ok".
    if (pedido?.dispensado_em) continue;

    const documento = acharDocumento(documentos, semente);
    const estado: EstadoItemRadar = pedido?.conferido_em
      ? "conferido"
      : documento
        ? "recebido"
        : pedido?.pedido_em
          ? "pedido"
          : "a_pedir";

    itens.push({
      chave,
      tipo: semente.tipo,
      rotulo: semente.rotulo,
      item_ref: semente.item_ref,
      lado: semente.lado,
      estado,
      pedido_em: pedido?.pedido_em ?? null,
      recebido_em: documento?.criado_em ?? null,
      obrigatorio: semente.obrigatorio,
      trava: TRAVA_POR_TIPO[semente.tipo],
    });
  }

  // A pedir primeiro (é o que exige ação), depois pedido, recebido, conferido.
  const peso: Record<EstadoItemRadar, number> = { a_pedir: 0, pedido: 1, recebido: 2, conferido: 3 };
  return itens.sort((a, b) => peso[a.estado] - peso[b.estado] || a.lado.localeCompare(b.lado) || a.rotulo.localeCompare(b.rotulo, "pt-BR"));
}

/**
 * Casamento documento ↔ item. Exato por `item_ref` quando o documento tem a
 * coluna preenchida (0065). Sem `item_ref`, só casa item que também não tem —
 * NUNCA distribui "3 matrículas soltas" entre 3 imóveis: marcaria o imóvel
 * errado como resolvido, que é exatamente o tipo de chute que este projeto
 * proíbe. `outro` só casa por `item_ref` (senão um único documento genérico
 * quitaria a entrega inteira).
 */
function acharDocumento(documentos: DocumentoDoRadar[], semente: Semente): DocumentoDoRadar | null {
  const candidatos = documentos.filter((d) => d.tipo === semente.tipo);
  if (candidatos.length === 0) return null;

  const exato = candidatos.filter((d) => (d.item_ref ?? null) !== null && d.item_ref === semente.item_ref);
  if (exato.length > 0) return maisAntigo(exato);

  if (semente.tipo === "outro") return null;
  if (semente.item_ref !== null) return null;

  const soltos = candidatos.filter((d) => (d.item_ref ?? null) === null);
  return soltos.length > 0 ? maisAntigo(soltos) : null;
}

function maisAntigo(lista: DocumentoDoRadar[]): DocumentoDoRadar {
  return lista.reduce((menor, atual) => (atual.criado_em < menor.criado_em ? atual : menor));
}

/** Contagem por lado, para o cabeçalho "3 de 10 prontos" (número primeiro, §2). */
export function resumoDoRadar(itens: ItemRadar[], lado: "coleta" | "entrega"): { prontos: number; total: number } {
  const doLado = itens.filter((i) => i.lado === lado);
  return { prontos: doLado.filter((i) => i.estado === "recebido" || i.estado === "conferido").length, total: doLado.length };
}
