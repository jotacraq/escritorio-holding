/**
 * O TRILHO da jornada — 9 passos, do pagamento à entrega da holding
 * (`docs/ARQUITETURA-FASE-5.md` §8.1). É o mesmo dado de `derivarProximoPasso`
 * visto de outro ângulo: lá "o que fazer agora"; aqui "onde a família está".
 *
 * Pagou → Ligação → Agendou → Confirmou → Sessão → Croqui → Contrato → Execução → Entrega
 *
 * Os três últimos vêm do processo real do escritório
 * (`brain/06 - Materiais/Processo real do escritorio (Drive).md` §1): assinatura
 * do contrato de honorários → cronograma de execução (marcos jurídicos, 60 dias)
 * → entrega (carta, sumário, checklist).
 *
 * ---------------------------------------------------------------------------
 * DUAS REGRAS QUE ESTE ARQUIVO NÃO PODE QUEBRAR
 *
 * 1. **Uma só fonte para "qual é o atual".** O passo `atual` é o que contém
 *    `derivarProximoPasso(sinais).chave`, via `PASSO_POR_CHAVE`. O trilho NÃO
 *    reimplementa precedência — herda a que já está testada em 27 linhas de
 *    mesa (`proximo-passo.ts`, congelado).
 * 2. **`null` é "sem informação", nunca "não".** Um passo só vira `pulado` com
 *    evidência POSITIVA de que a jornada seguiu sem ele (sessão realizada sem
 *    ligação; croqui comprado sem sessão nenhuma). Coluna ausente no payload
 *    (`presencaConfirmada === null`) é `futuro`, jamais `pulado` — senão a tela
 *    acusa o cliente de não ter confirmado quando ninguém perguntou (borda `e`).
 *
 * Inferência a partir de fato positivo é permitida e vem rotulada em `motivo`
 * (ex.: "contrato assinado ⇒ pagou"), no mesmo espírito de `derivarProximoPasso`,
 * que já deduz `pagou` da existência de uma sessão. O que é proibido é deduzir
 * ausência: falta de dado nunca vira "não aconteceu".
 * ---------------------------------------------------------------------------
 *
 * TESTES DE MESA — as 6 bordas do §8.1 estão em `scripts/teste-trilho.ts`
 * (`npx tsx scripts/teste-trilho.ts`), não em comentário: comentário não roda.
 *
 * | # | borda                                        | esperado                                        |
 * |---|----------------------------------------------|-------------------------------------------------|
 * | a | tudo `null`                                  | 9 `futuro`, nenhum `atual`                      |
 * | b | jornada completa até a entrega               | 9 `feito`, nenhum `atual`                       |
 * | c | croqui comprado sem sessão nenhuma           | `agendou`/`confirmou`/`sessao` `pulado`         |
 * | d | sessão realizada e `temLigacao === false`    | `ligacao` `pulado` (não `futuro`)               |
 * | e | `presencaConfirmada === null` (coluna ausente)| `confirmou` `futuro` (nunca `pulado`)           |
 * | f | 4 de 15 marcos de execução                   | `execucao` `atual` com `progresso {4,15}`       |
 *
 * Função pura, sem I/O. `agora` é injetável para teste.
 */
import { derivarProximoPasso, type ChavePasso } from "./proximo-passo";
import type { Sinais } from "./sinais";

export type EstadoPasso = "feito" | "atual" | "futuro" | "pulado";

export type ChaveTrilho =
  | "pagou"
  | "ligacao"
  | "agendou"
  | "confirmou"
  | "sessao"
  | "croqui"
  | "contrato"
  | "execucao"
  | "entrega";

export interface PassoTrilho {
  chave: ChaveTrilho;
  /** Lei de texto (§2): rótulo ≤ 3 palavras, sem sigla. */
  rotulo: string;
  estado: EstadoPasso;
  /** Quando aconteceu (ISO), quando o sinal carrega a data. `null` sem data. */
  quando: string | null;
  /** Por que este estado — só quando a razão não é óbvia. Frase curta. */
  motivo?: string;
  /** Só em `execucao`: marcos concluídos / total do modelo. */
  progresso?: { feitos: number; total: number };
}

/** Ordem fixa do trilho. Índice = posição na linha. */
export const ORDEM_TRILHO: ChaveTrilho[] = [
  "pagou",
  "ligacao",
  "agendou",
  "confirmou",
  "sessao",
  "croqui",
  "contrato",
  "execucao",
  "entrega",
];

export const ROTULO_TRILHO: Record<ChaveTrilho, string> = {
  pagou: "Pagou",
  ligacao: "Ligação",
  agendou: "Agendou",
  confirmou: "Confirmou",
  sessao: "Sessão",
  croqui: "Croqui",
  contrato: "Contrato",
  execucao: "Execução",
  entrega: "Entrega",
};

/**
 * Onde cada `ChavePasso` de `derivarProximoPasso` cai no trilho.
 *
 * `sem_informacao` é o único `null`: quando a fonte não sabe o que vem agora,
 * o trilho fica SEM passo aceso — acender um seria inventar posição (borda `a`).
 * (Desvio consciente do §11.4, que congelou `Record<ChavePasso, ChaveTrilho>`:
 * a alternativa seria mapear `sem_informacao` para `pagou` e mentir na tela.)
 */
export const PASSO_POR_CHAVE: Record<ChavePasso, ChaveTrilho | null> = {
  // Itens da Pasta (`catalogo.ts`)
  formulario: "sessao", // preparo da sessão
  ligacao: "ligacao",
  links: "agendou",
  briefing: "sessao",
  sessao: "sessao",
  transcricao: "sessao",
  analise_sessao: "sessao",
  diagnostico_sv: "sessao",
  relatorio_sv: "croqui", // o pós-sessão empurra a família para o croqui
  croqui: "croqui",
  material: "croqui",
  patrimonio: "croqui",
  familiares: "croqui",
  documentos: "croqui",
  // Passos que só existem em `proximo-passo.ts`
  confirmar_presenca: "confirmou",
  colar_link_sala: "sessao",
  enviar_link_croqui: "croqui",
  aguardar_compra: "pagou",
  aguardar_croqui: "croqui",
  aguardar_holding: "contrato",
  // "Holding contratada": o comercial acabou; o que corre agora é o contrato
  // de honorários e, depois dele, a execução (o avanço para `execucao` é feito
  // pela regra do "primeiro passo não concluído", abaixo).
  concluido: "contrato",
  sem_informacao: null,
};

const MS_DIA = 24 * 60 * 60 * 1000;

function passouDaData(iso: string | null, agora: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return !Number.isNaN(t) && t < agora;
}

/** Estado base, antes de acender o passo atual. */
type Base = { estado: Exclude<EstadoPasso, "atual">; quando: string | null; motivo?: string; progresso?: PassoTrilho["progresso"] };

function derivarBases(s: Sinais, agora: number): Record<ChaveTrilho, Base> {
  const nivel = s.nivelPago;
  const pagouNivel = nivel !== null && nivel >= 1;
  const croquiComprado = nivel !== null && nivel >= 2;
  const holdingContratada = nivel !== null && nivel >= 3;
  const temSessao = s.sessaoRealizadaEm !== null || s.proximaSessaoEm !== null;
  const sessaoRealizada = s.sessaoRealizadaEm !== null;
  const sessaoPassou = sessaoRealizada || passouDaData(s.proximaSessaoEm, agora);
  const contratoAssinado = s.contratoAssinadoEm !== null;
  const entregue = s.entregaEm !== null;
  // Evidência positiva de que a jornada passou da sessão SEM ter agendado uma:
  // é o que autoriza `pulado` em agendou/confirmou/sessao (borda `c`).
  const puloASessao = croquiComprado && !temSessao;

  const marcos = s.marcosExecucao;
  const execucaoCompleta = marcos !== null && marcos.total > 0 && marcos.feitos >= marcos.total;

  return {
    pagou: pagouNivel
      ? { estado: "feito", quando: null }
      : temSessao || contratoAssinado || entregue
        ? { estado: "feito", quando: null, motivo: "implícito pelo que veio depois" }
        : { estado: "futuro", quando: null, motivo: nivel === null ? "sem informação" : undefined },

    ligacao:
      s.temLigacao === true
        ? { estado: "feito", quando: null }
        : s.temLigacao === false && sessaoRealizada
          ? { estado: "pulado", quando: null, motivo: "sessão aconteceu sem a ligação" }
          : { estado: "futuro", quando: null, motivo: s.temLigacao === null ? "sem informação" : undefined },

    agendou: temSessao
      ? { estado: "feito", quando: s.proximaSessaoEm ?? s.sessaoRealizadaEm }
      : puloASessao
        ? { estado: "pulado", quando: null, motivo: "croqui contratado sem sessão" }
        : { estado: "futuro", quando: null },

    confirmou:
      s.presencaConfirmada === true
        ? { estado: "feito", quando: s.presencaConfirmadaEm }
        : s.presencaConfirmada === false && sessaoPassou
          ? { estado: "pulado", quando: null, motivo: "sessão sem confirmação" }
          : puloASessao
            ? { estado: "pulado", quando: null, motivo: "croqui contratado sem sessão" }
            : // `null` cai aqui: futuro, nunca `pulado` (borda `e`).
              { estado: "futuro", quando: null, motivo: s.presencaConfirmada === null ? "sem informação" : undefined },

    sessao: sessaoRealizada
      ? { estado: "feito", quando: s.sessaoRealizadaEm }
      : puloASessao
        ? { estado: "pulado", quando: null, motivo: "croqui contratado sem sessão" }
        : { estado: "futuro", quando: s.proximaSessaoEm },

    croqui:
      s.croquiStatus === "apresentado"
        ? { estado: "feito", quando: null }
        : contratoAssinado || entregue
          ? { estado: "feito", quando: null, motivo: "implícito pelo contrato" }
          : holdingContratada && s.croquiStatus === "nenhum"
            ? { estado: "pulado", quando: null, motivo: "holding fechada sem croqui" }
            : { estado: "futuro", quando: null, motivo: s.croquiStatus === null ? "sem informação" : undefined },

    contrato: contratoAssinado
      ? { estado: "feito", quando: s.contratoAssinadoEm }
      : entregue
        ? { estado: "feito", quando: null, motivo: "implícito pela entrega" }
        : marcos !== null && marcos.feitos > 0
          ? { estado: "pulado", quando: null, motivo: "execução começou sem contrato registrado" }
          : { estado: "futuro", quando: null, motivo: holdingContratada ? "aguardando assinatura" : undefined },

    execucao: execucaoCompleta && marcos !== null
      ? { estado: "feito", quando: null, progresso: { feitos: marcos.feitos, total: marcos.total } }
      : entregue && (marcos === null || marcos.feitos === 0)
        ? { estado: "pulado", quando: null, motivo: "entrega registrada sem marcos" }
        : marcos !== null
          ? { estado: "futuro", quando: null, progresso: { feitos: marcos.feitos, total: marcos.total } }
          : { estado: "futuro", quando: null, motivo: "sem informação" },

    entrega: entregue ? { estado: "feito", quando: s.entregaEm } : { estado: "futuro", quando: null },
  };
}

/**
 * @param sinais ver `sinais.ts` (os 3 campos novos vêm de `sinaisComExecucao`)
 * @param agora  injetável para teste; default `Date.now()`
 */
export function derivarTrilho(sinais: Sinais, agora: number = Date.now()): PassoTrilho[] {
  const bases = derivarBases(sinais, agora);
  const passos: PassoTrilho[] = ORDEM_TRILHO.map((chave) => ({
    chave,
    rotulo: ROTULO_TRILHO[chave],
    estado: bases[chave].estado,
    quando: bases[chave].quando,
    ...(bases[chave].motivo ? { motivo: bases[chave].motivo } : {}),
    ...(bases[chave].progresso ? { progresso: bases[chave].progresso } : {}),
  }));

  // ---- Único ponto que decide "qual é o atual" -----------------------------
  const alvo = PASSO_POR_CHAVE[derivarProximoPasso(sinais, agora).chave];
  if (alvo === null) return passos; // sem informação: nenhum passo aceso (borda `a`)

  const inicio = ORDEM_TRILHO.indexOf(alvo);
  // O alvo pode já estar concluído (ex.: contrato assinado, execução correndo):
  // acende o PRIMEIRO passo daí para frente que ainda não terminou. Se todos
  // terminaram, o trilho fica sem `atual` — a jornada acabou (borda `b`).
  for (let i = inicio; i < passos.length; i += 1) {
    if (passos[i].estado === "feito" || passos[i].estado === "pulado") continue;
    passos[i] = { ...passos[i], estado: "atual" };
    if (passos[i].motivo === "sem informação") delete passos[i].motivo;
    break;
  }
  return passos;
}

/** Quantos passos já ficaram para trás (feito ou pulado) — para o "N de 9" compacto. */
export function progressoDoTrilho(passos: PassoTrilho[]): { feitos: number; total: number } {
  return { feitos: passos.filter((p) => p.estado === "feito").length, total: passos.length };
}

/** Passo aceso agora, ou `null` quando não há informação suficiente. */
export function passoAtual(passos: PassoTrilho[]): PassoTrilho | null {
  return passos.find((p) => p.estado === "atual") ?? null;
}

/** Dias inteiros até a data de um passo; `null` sem data. Serve ao "sessão em 5 dias". */
export function diasAtePasso(passo: PassoTrilho, agora: number = Date.now()): number | null {
  if (!passo.quando) return null;
  const t = Date.parse(passo.quando);
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - agora) / MS_DIA);
}
