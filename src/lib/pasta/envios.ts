/**
 * A barra "Enviar" da Ficha (Fase 6 §5.2) — quais links públicos existem para
 * ESTA pessoa, em que estado cada um está, e o que impede (ou o que o operador
 * precisa saber antes de) emitir agora.
 *
 * O pedido do João, literal: *"cadê o link pra eu mandar? Eu tenho que ficar
 * caçando onde está o link."* Esta função é a resposta em dado — a tela só
 * desenha o que sai daqui.
 *
 * ---------------------------------------------------------------------------
 * TRÊS REGRAS QUE ESTE ARQUIVO NÃO PODE QUEBRAR
 *
 * 1. **Zero requisição nova.** `links` já vem de `GET /api/jornadas/[id]/links`
 *    e o resto sai da `Ficha360` que a Ficha já carregou. Em particular
 *    `materialAtual.aprovado_em` **está no payload** (`server/jornadas.ts`, o
 *    select de `materiais_gerados`) — por isso a `LinksAba` pode largar o
 *    segundo fetch de `listarMateriais` (B7).
 * 2. **Nenhum motivo inventado.** Cada frase de `motivo` tem fonte no banco ou
 *    na rota, anotada no comentário da regra. O único motivo que NÃO se deriva
 *    é o 503 de `SUPABASE_SERVICE_ROLE_KEY` ausente: isso só se descobre na
 *    resposta da emissão, e por isso entra por `opcoes.motivoDoServidor` — a
 *    tela devolve a mensagem que o servidor deu, não uma que a gente adivinhou.
 * 3. **`podeEmitir === false` é bloqueio; `motivo` é o que a tela mostra.** Há
 *    caso de `motivo` com `podeEmitir === true` (material sem aprovação,
 *    agendamento sem advogada): o João pediu para VER o motivo, não para perder
 *    a ação (§5.2). Quem bloqueia de verdade é o banco, e ele continua
 *    bloqueando.
 * ---------------------------------------------------------------------------
 *
 * Função pura, sem I/O. `agora` é injetável. Teste de mesa em
 * `src/lib/pasta/envios.test.ts` (`npm test`).
 */
import { rotulo } from "@/lib/vocabulario";
import type { Ficha360 } from "@/lib/api";
import type { LinkPublicoResumo } from "@/types/publico";

export type TipoEnvio = "formulario" | "agendamento" | "confirmacao" | "documentos" | "material";

export type EstadoEnvio =
  | "nao_emitido"
  | "ativo"
  | "consumido"
  | "expirado"
  | "revogado"
  | "indisponivel";

/** Ordem da barra: a mesma da esteira, do formulário à entrega do material. */
export const TIPOS_ENVIO: TipoEnvio[] = [
  "formulario",
  "agendamento",
  "confirmacao",
  "documentos",
  "material",
];

/** Nome do link na tela. Lei de texto: o que o operador manda, não o tipo do enum. */
export const ROTULO_ENVIO: Record<TipoEnvio, string> = {
  formulario: "Formulário",
  agendamento: "Agendamento",
  confirmacao: "Confirmação de presença",
  documentos: "Documentos",
  material: "Material",
};

/**
 * As frases, num lugar só, para a tela e o teste de mesa lerem a MESMA string.
 * Cada uma cita a fonte do fato — nenhuma é opinião.
 */
export const MOTIVO_ENVIO = {
  /**
   * `emitir_link_publico` recusa jornada fechada (0028:816-818).
   *
   * Fase 8: "processo", não "jornada" — o rótulo de tela vem do Glossário
   * (`rotulo("processo")`), enquanto a chave, a tabela e o resto do código
   * continuam `jornada`. E o **arquivado** ganha frase própria: encerrado é
   * decisão comercial e não tem volta óbvia; arquivado é reversível, e dizer
   * COMO voltar é a diferença entre um aviso e um beco sem saída.
   */
  jornada_encerrada: `Este ${rotulo("processo")} está encerrado.`,
  jornada_arquivada: `Este ${rotulo("processo")} está arquivado. Reabra o ${rotulo("processo")} para enviar links.`,
  /** A rota não inventa advogada quando a sessão não tem uma (`links/route.ts:115-119`). */
  agendamento_sem_advogada:
    "Emite, mas sai sem horários: a sessão ainda não tem advogada.",
  /** `ck_link_confirmacao_agendamento` (0051:285-286): confirmação exige agendamento. */
  confirmacao_sem_agendamento: "Ainda não há sessão marcada para confirmar.",
  /** Sem material, `/p/m` mostra "link não disponível" para o cliente. */
  material_inexistente:
    'Nenhum material foi gerado ainda — o cliente veria "link não disponível".',
  /** A via de sistema exige aprovação (0031:313-318); a da equipe avisa antes. */
  material_nao_aprovado: "O material ainda não foi aprovado.",
} as const;

export interface ItemEnvio {
  tipo: TipoEnvio;
  rotulo: string;
  estado: EstadoEnvio;
  /** Por que não dá (ou o que o operador precisa saber) — 1 linha. `null` quando não há o que dizer. */
  motivo: string | null;
  /** `links_publicos.criado_em` do link mais recente deste tipo. */
  emitidoEm: string | null;
  expiraEm: string | null;
  usos: number;
  /** `false` = botão desabilitado, com `motivo` **na tela** (não só no `title`). */
  podeEmitir: boolean;
  /**
   * `true` quando emitir mata um link ativo — exige a confirmação de 1 linha do
   * §5.4. O banco garante um link ativo por tipo por jornada (`uniq_link_ativo`,
   * 0028:92) e a emissão revoga o anterior na mesma transação (0028:829-833).
   */
  substituiAtivo: boolean;
}

export interface OpcoesEnvios {
  /**
   * Motivo que veio do SERVIDOR na última tentativa de emissão deste tipo
   * (ex.: o 503 de `SUPABASE_SERVICE_ROLE_KEY` ausente, `links/route.ts:126-139`).
   * Não é derivável de payload nenhum: ou o servidor diz, ou a tela cala.
   * Enquanto estiver preenchido, a linha fica `indisponivel` com essa frase.
   */
  motivoDoServidor?: Partial<Record<TipoEnvio, string>>;
}

/** Agendamento que ainda vale para confirmar presença (mesmo filtro de `emitir_link_confirmacao_sistema`, 0051:498). */
const STATUS_AGENDAMENTO_ATIVO = new Set(["agendado", "confirmado"]);

function ehTipoEnvio(valor: string): valor is TipoEnvio {
  return (TIPOS_ENVIO as readonly string[]).includes(valor);
}

/**
 * O link mais recente de cada tipo. `GET .../links` já ordena por `criado_em`
 * desc, mas não dá para depender da ordem de quem chama: reordena aqui.
 *
 * A listagem devolve TODOS os tipos da jornada, inclusive `confirmacao`, que a
 * régua emite sozinha (0051) — `LinkPublicoResumo.tipo` ainda está declarado
 * sem esse valor, então a leitura passa por `ehTipoEnvio` em vez de comparar
 * literais (ver nota no relatório da Fase 6).
 */
function ultimoPorTipo(links: readonly LinkPublicoResumo[]): Map<TipoEnvio, LinkPublicoResumo> {
  const mapa = new Map<TipoEnvio, LinkPublicoResumo>();
  const ordenados = [...links].sort((a, b) => Date.parse(b.criado_em) - Date.parse(a.criado_em));
  for (const link of ordenados) {
    const tipo: string = link.tipo;
    if (!ehTipoEnvio(tipo)) continue;
    if (!mapa.has(tipo)) mapa.set(tipo, link);
  }
  return mapa;
}

/**
 * Estado do link para a tela. `expirado` é calculado também pela DATA: o banco
 * só carimba `estado='expirado'` quando alguém tenta abrir, então um link
 * vencido continua `ativo` na linha até o cliente esbarrar nele. Mostrar
 * "Ativo" para um link vencido é mentir para quem vai mandá-lo.
 */
function estadoDoLink(link: LinkPublicoResumo, agora: number): EstadoEnvio {
  if (link.estado === "revogado") return "revogado";
  if (link.estado === "usado") return "consumido";
  if (link.estado === "expirado") return "expirado";
  const expira = Date.parse(link.expira_em);
  if (!Number.isNaN(expira) && expira <= agora) return "expirado";
  return "ativo";
}

export function derivarEnvios(
  links: readonly LinkPublicoResumo[],
  ficha: Ficha360,
  agora: number = Date.now(),
  opcoes: OpcoesEnvios = {},
): ItemEnvio[] {
  const porTipo = ultimoPorTipo(links);
  const jornadaEncerrada = ficha.jornada.desfecho !== "aberta";
  const arquivado = ficha.jornada.desfecho === "congelada";
  const temAgendamentoAtivo = ficha.agendamentos.some((a) => STATUS_AGENDAMENTO_ATIVO.has(a.status));
  const sessaoSemAdvogada = !ficha.sessao?.advogada_id;
  const material = ficha.materialAtual;

  return TIPOS_ENVIO.map((tipo): ItemEnvio => {
    const link = porTipo.get(tipo) ?? null;
    const estadoLink = link ? estadoDoLink(link, agora) : "nao_emitido";
    const base = {
      tipo,
      rotulo: ROTULO_ENVIO[tipo],
      emitidoEm: link?.criado_em ?? null,
      expiraEm: link?.expira_em ?? null,
      usos: link?.usos ?? 0,
      substituiAtivo: estadoLink === "ativo",
    };

    // 1. Processo fechado trava TODOS os tipos — é a RPC que recusa (0028:816-818).
    if (jornadaEncerrada) {
      const motivo = arquivado ? MOTIVO_ENVIO.jornada_arquivada : MOTIVO_ENVIO.jornada_encerrada;
      return { ...base, estado: "indisponivel", motivo, podeEmitir: false, substituiAtivo: false };
    }

    // 2. O servidor já disse por que não deu (503 de service_role, por exemplo).
    //    Vale enquanto a tela não tentar de novo — e é a frase DELE, não a nossa.
    const doServidor = opcoes.motivoDoServidor?.[tipo];
    if (doServidor) {
      return { ...base, estado: "indisponivel", motivo: doServidor, podeEmitir: false };
    }

    // 3. Confirmação sem agendamento ativo: o `check` do banco recusaria
    //    (`ck_link_confirmacao_agendamento`, 0051:285-286) e a RPC nem acha o
    //    agendamento (0051:498-501). Bloqueio de verdade, não aviso.
    if (tipo === "confirmacao" && !temAgendamentoAtivo) {
      return { ...base, estado: "indisponivel", motivo: MOTIVO_ENVIO.confirmacao_sem_agendamento, podeEmitir: false };
    }

    // 4. Agendamento sem advogada: EMITE, e sai sem horário. A rota já devolve
    //    esse aviso na resposta (`links/route.ts:167-168`); a barra o diz ANTES,
    //    para o operador escolher resolver a agenda primeiro.
    if (tipo === "agendamento" && sessaoSemAdvogada) {
      return { ...base, estado: estadoLink, motivo: MOTIVO_ENVIO.agendamento_sem_advogada, podeEmitir: true };
    }

    // 5/6. Material: os dois motivos aparecem, e a ação continua existindo
    //      atrás da confirmação que a tela já tem (§5.2).
    if (tipo === "material" && material === null) {
      return { ...base, estado: estadoLink, motivo: MOTIVO_ENVIO.material_inexistente, podeEmitir: true };
    }
    if (tipo === "material" && material !== null && !material.aprovado_em) {
      return { ...base, estado: estadoLink, motivo: MOTIVO_ENVIO.material_nao_aprovado, podeEmitir: true };
    }

    return { ...base, estado: estadoLink, motivo: null, podeEmitir: true };
  });
}
