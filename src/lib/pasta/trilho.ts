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
 * TESTES DE MESA — as 6 bordas do §8.1 estão em `src/lib/pasta/trilho.test.ts`
 * (`npm test`, e o CI do GitHub roda em todo PR), não em comentário: comentário
 * não roda.
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
import { faseDoCroqui, type Sinais } from "./sinais";

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
  // Fase 6 §6.2: a "Ligação" do trilho é a ligação HUMANA da equipe (POP 03).
  // Rótulo de passo é <= 1 palavra por desenho; o nome inteiro vai no `title`
  // (`TITULO_TRILHO`). A CHAVE `ligacao` nao muda — e chave, nao texto.
  ligacao: "Contato",
  agendou: "Agendou",
  confirmou: "Confirmou",
  sessao: "Sessão",
  croqui: "Croqui",
  contrato: "Contrato",
  execucao: "Execução",
  entrega: "Entrega",
};

/**
 * O nome inteiro do passo — SÓ para `title`/`aria-label`, nunca no fluxo
 * (lei de texto, `docs/DESIGN-SYSTEM.md` §3.1). Só existe onde o rótulo curto
 * não é o nome inteiro; `undefined` = o rótulo já basta.
 */
export const TITULO_TRILHO: Partial<Record<ChaveTrilho, string>> = {
  ligacao: "Contato da equipe",
};

// ---------------------------------------------------------------------------
// A espinha dorsal: três sessões (Fase 6 §1.2)
// ---------------------------------------------------------------------------

/**
 * O produto gira em torno de TRÊS sessões (`brain/03 - Dominio/Esteira do
 * cliente.md`). Os 9 passos do trilho não mudam: eles se AGRUPAM nelas — 5 na
 * primeira, 1 na segunda, 3 na terceira. Nenhum enum, nenhuma coluna e nenhum
 * contrato da Fase 5 é tocado por este agrupamento.
 */
export type ChaveSessao = "viabilidade" | "croqui" | "entrega";

export const ORDEM_SESSOES: ChaveSessao[] = ["viabilidade", "croqui", "entrega"];

export const ROTULO_SESSAO: Record<ChaveSessao, string> = {
  viabilidade: "Sessão de Viabilidade",
  croqui: "Croqui estrutural",
  entrega: "Entrega da holding",
};

export const SESSAO_POR_PASSO: Record<ChaveTrilho, ChaveSessao> = {
  pagou: "viabilidade",
  ligacao: "viabilidade",
  agendou: "viabilidade",
  confirmou: "viabilidade",
  sessao: "viabilidade",
  croqui: "croqui",
  contrato: "entrega",
  execucao: "entrega",
  entrega: "entrega",
};

export interface BlocoSessao {
  chave: ChaveSessao;
  rotulo: string;
  passos: PassoTrilho[];
  /** `atual` = contém o passo aceso · `feito` = todos feito/pulado · `futuro` = o resto. */
  estado: "feito" | "atual" | "futuro";
  /** "2 de 5" — número primeiro (lei de texto §2.2). Conta só `feito`, como
   *  `progressoDoTrilho`: `pulado` é passo que não aconteceu, não passo feito. */
  resumo: string;
}

/**
 * Agrupa os 9 passos nas 3 sessões, preservando a ordem do trilho dentro de
 * cada bloco.
 *
 * A regra dura é a mesma do trilho: **`null` é "sem informação", nunca "não"**.
 * Sem passo aceso (borda `a` do §8.1 — jornada só com `null`), NENHUMA sessão
 * fica `atual`: acender uma seria inventar posição. E uma sessão só é `feito`
 * quando todos os passos dela saíram do caminho (feito ou pulado) — a de trás
 * de um passo aceso continua `feito` porque seus passos já saíram, não porque
 * o trilho "passou por cima".
 *
 * Função pura. Não relê `derivarProximoPasso`: consome o que `derivarTrilho`
 * já decidiu, para continuar existindo UMA fonte de "qual é o atual".
 */
export function agruparPorSessao(passos: PassoTrilho[]): BlocoSessao[] {
  return ORDEM_SESSOES.map((chave) => {
    const doBloco = passos.filter((p) => SESSAO_POR_PASSO[p.chave] === chave);
    const temAtual = doBloco.some((p) => p.estado === "atual");
    const todosResolvidos =
      doBloco.length > 0 && doBloco.every((p) => p.estado === "feito" || p.estado === "pulado");
    const feitos = doBloco.filter((p) => p.estado === "feito").length;
    return {
      chave,
      rotulo: ROTULO_SESSAO[chave],
      passos: doBloco,
      estado: temAtual ? "atual" : todosResolvidos ? "feito" : "futuro",
      resumo: `${feitos} de ${doBloco.length}`,
    };
  });
}

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
  const faseCroqui = faseDoCroqui(s);

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

    // Fase 8 (D12): a fase sai de `faseDoCroqui()` — a mesma leitura da Pasta
    // e do cartão. `apresentado` é o único que fecha o passo por mérito
    // próprio; `fixado`/`calculado` continuam sendo caminho, não chegada, e o
    // motivo passa a dizer em que pé o croqui parou em vez de calar.
    croqui:
      faseCroqui === "apresentado"
        ? { estado: "feito", quando: null }
        : contratoAssinado || entregue
          ? { estado: "feito", quando: null, motivo: "implícito pelo contrato" }
          : holdingContratada && faseCroqui === "sem_croqui"
            ? { estado: "pulado", quando: null, motivo: "holding fechada sem croqui" }
            : {
                estado: "futuro",
                quando: null,
                motivo:
                  faseCroqui === null
                    ? "sem informação"
                    : faseCroqui === "pronto"
                      ? "pronto para apresentar"
                      : faseCroqui === "fixado"
                        ? "versão fixada"
                        : faseCroqui === "calculado"
                          ? "calculado"
                          : undefined,
              },

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
