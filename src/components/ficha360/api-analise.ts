import type { CategoriaAfirmacao } from "@/server/ia/schema-croqui-analise";
import { CRITERIOS_ARQUITETURA } from "@/server/ia/schema-croqui-analise";
import type { Croqui } from "@/lib/api";

/**
 * Cliente da Análise da Sessão (ARQUITETURA-FASE-3.md §2, onda 3 — agente H).
 * Módulo por feature, ao lado do componente que o consome — `src/lib/api.ts`
 * está TRAVADO (§6 regra 1) e não ganha uma terceira IA aqui: as três rotas
 * abaixo já existem (onda 2, agente E) e não têm chamador nenhum no front
 * (X2 do §5.1) — este arquivo é esse chamador, não uma rota nova.
 *
 * `chamar` de `src/lib/api.ts` não é exportado (é interno daquele módulo) —
 * mesmo padrão de `src/components/sessao/api.ts` (fronteira equivalente):
 * um `chamar` local, wrapper fino de `fetch`, com uma classe de erro própria
 * (`ErroAnalise`) no mesmo formato de `ApiError`.
 */

// ---------------------------------------------------------------------------
// Tipos — espelham os contratos do servidor (import type, custo zero de bundle:
// apagado na compilação, nunca chega ao navegador). Nomes e forma batem
// exatamente com `src/server/ia/schema-croqui-analise.ts` (v1, o que toda
// análise real produz hoje) e `src/server/croqui/schema-analise-v2.ts` (v2,
// ainda não publicada pelo prompt — ver `detectarVersaoAnalise` abaixo).
// ---------------------------------------------------------------------------

export type { CategoriaAfirmacao };

export interface Afirmacao {
  texto: string;
  categoria: CategoriaAfirmacao;
}

export interface DiscDecisor {
  decisor: string;
  perfil_predominante: "D" | "I" | "S" | "C";
  evidencias: string[];
  confianca: number;
}

/** `src/server/ia/schema-croqui-analise.ts` não exporta este tipo (só o
 * schema Zod completo) — reconstruído aqui a partir do array exportado
 * (`CRITERIOS_ARQUITETURA`, valor puro, sem custo de importar). */
export interface CriterioArquitetura {
  criterio: (typeof CRITERIOS_ARQUITETURA)[number];
  resposta: Afirmacao;
  peso_na_decisao: string;
}

/** Análise do Agente do Croqui — as 14 seções carimbadas (§2.1: "mesma coisa
 * que o Agente do Croqui, com outro nome"). Forma v1 (`CroquiAnalise`, hoje a
 * única que uma execução real produz — o prompt v2 ainda não foi publicado,
 * ARQUITETURA-FASE-3.md §3.2/nota em `schema-analise-v2.ts`) mais os dois
 * campos que só existem na v2 (`arquitetura.alocacao`, e `croqui` como objeto
 * tipado em vez de string solta) — opcionais aqui porque, na prática, nunca
 * vêm preenchidos ainda. `detectarVersaoAnalise` decide em runtime qual forma
 * é esta, sem depender de um campo que a API não expõe. */
export interface AnaliseSessao {
  resumo_executivo: string;
  historia: Afirmacao[];
  familia: Afirmacao[];
  patrimonio: Afirmacao[];
  empresas: Afirmacao[];
  objetivos: Afirmacao[];
  riscos: Afirmacao[];
  disc: DiscDecisor[];
  arquitetura: {
    recomendacao: "1_celula" | "2_celulas" | "3_celulas" | "ponto_a_validar";
    criterios: CriterioArquitetura[];
    justificativa_geral: string;
  };
  croqui: unknown[]; // v1: string[] solto; v2: objeto tipado por slide — ver `mapeamentoGraficos.ts`
  narrativa?: { slide: string; como_apresentar: string }[]; // só v1
  perguntas: { pergunta: string; motivo: string }[];
  objecoes: { objecao: string; resposta_recomendada: string }[];
  fechamento: string;
  grau_confianca: number;
  lacunas: string[];
}

export interface TranscricaoSessaoRegistrada {
  id: string;
  conteudo: string;
  tamanho_bytes: number;
  sha256: string;
  importado_em: string;
  arquivo_origem: string;
}

/**
 * `GET /api/croquis/[id]` embute `croqui_analises(id, versao, conteudo,
 * grau_confianca, criado_em)` na resposta (`src/app/api/croquis/[id]/
 * route.ts:29`), mas o TIPO `Croqui` de `src/lib/api.ts` não declara esse
 * campo — a permissão explícita desta onda cobre só os campos aditivos do
 * slide, não este. O dado chega no JSON de qualquer forma (TypeScript só
 * apaga o campo do TIPO, nunca do runtime); este tipo local o reexpõe sem
 * tocar `lib/api.ts` fora do combinado. Pedido ao backend no relatório da
 * onda: declarar isto (e `schema_versao`) direto em `Croqui`. */
export interface CroquiAnaliseEmbed {
  id: string;
  versao: number;
  conteudo: unknown;
  grau_confianca: number | null;
  criado_em: string;
}

export interface CroquiComAnalises extends Croqui {
  croqui_analises?: CroquiAnaliseEmbed[];
}

export interface ResultadoAnaliseSessao {
  croqui_id: string;
  croqui_criado_agora: boolean;
  execucao_id: string;
  analise_id: string;
  analise: AnaliseSessao;
  custo_usd: number | null;
}

// ---------------------------------------------------------------------------
// Núcleo HTTP — mesmo contrato de erro de todo o projeto (`{erro, mensagem}`
// no corpo, `respostaErro`/`ErroIa`), reproduzido aqui como em
// `src/components/sessao/api.ts` (mesma fronteira, mesmo motivo: `chamar` de
// `src/lib/api.ts` é privado do módulo).
// ---------------------------------------------------------------------------

export class ErroAnalise extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
    readonly codigo?: string,
  ) {
    super(mensagem);
    this.name = "ErroAnalise";
  }
}

async function chamar<T>(caminho: string, init?: RequestInit): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(caminho, {
      credentials: "include",
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ErroAnalise("Sem conexão com o servidor. Verifique a rede e tente de novo.", 0, "rede");
  }

  const texto = await resposta.text();
  let corpo: unknown = null;
  if (texto) {
    try {
      corpo = JSON.parse(texto);
    } catch {
      corpo = null;
    }
  }

  if (!resposta.ok) {
    const objeto = (corpo ?? {}) as { erro?: string; mensagem?: string; detalhes?: unknown };
    throw new ErroAnalise(objeto.mensagem || objeto.erro || `Falha na requisição (${resposta.status})`, resposta.status, objeto.erro);
  }

  return corpo as T;
}

/**
 * GET /api/sessoes/[id]/transcricao — a transcrição da SV mais recente
 * persistida para esta sessão, se houver.
 */
export function buscarTranscricaoSessao(sessaoId: string) {
  return chamar<{ transcricao: TranscricaoSessaoRegistrada | null; total_versoes: number }>(
    `/api/sessoes/${sessaoId}/transcricao`,
  );
}

/**
 * POST /api/sessoes/[id]/transcricao — persiste a transcrição da Sessão de
 * Viabilidade. Não exige consentimento (dado do escritório) — só ANALISAR
 * exige (§2.2).
 */
export function salvarTranscricaoSessao(sessaoId: string, conteudo: string) {
  return chamar<{ transcricao: TranscricaoSessaoRegistrada; ja_existia: boolean }>(
    `/api/sessoes/${sessaoId}/transcricao`,
    { method: "POST", body: JSON.stringify({ conteudo }) },
  );
}

/**
 * POST /api/jornadas/[id]/analise-sessao — a porta fina que a tela chama
 * (§2.2): garante um croqui `rascunho` e roda a MESMA IA do Agente do Croqui.
 * `transcricaoSessao` ausente → o servidor lê a última persistida da jornada;
 * nenhuma das duas → 409 `transcricao_ausente`.
 */
export function rodarAnaliseSessao(jornadaId: string, transcricaoSessao?: string) {
  return chamar<ResultadoAnaliseSessao>(`/api/jornadas/${jornadaId}/analise-sessao`, {
    method: "POST",
    body: JSON.stringify(transcricaoSessao ? { transcricao_sessao: transcricaoSessao } : {}),
  });
}

/** Mensagem amigável por status — mesmo padrão de `PainelBriefingSessao.tsx`
 * (`mensagemErroGerar`): a tela nunca mostra `erro.message` cru quando o
 * código HTTP já identifica a causa. */
export function mensagemErroAnalise(erro: ErroAnalise): string {
  if (erro.status === 503) {
    return "IA indisponível agora (sem chave configurada, ou modo demonstração desligado). Nenhuma análise de mentira é mostrada aqui.";
  }
  if (erro.status === 409) {
    return "Consentimento de tratamento por IA não registrado para esta pessoa, ou não há transcrição (persistida ou colada) para analisar.";
  }
  if (erro.status === 429) {
    return "Limite de gerações de IA atingido por agora. Tente de novo em instantes.";
  }
  if (erro.status === 400) {
    return "Transcrição muito curta para uma análise responsável — cole o texto completo da sessão.";
  }
  return erro.message;
}

/** A saída bruta é sempre o exemplo fixo de demonstração quando a chave de IA
 * não está configurada (`src/server/ia/demonstracao.ts`, EXEMPLO_CROQUI_ANALISE)
 * — reconhecível por este prefixo literal, o mesmo texto que o Briefing usa
 * (`RASCUNHO_EXEMPLO_BRIEFING`/`RASCUNHO_EXEMPLO_CROQUI_ANALISE`). GET
 * /api/croquis/[id] não expõe `execucoes_ia.modo`/`origem_dado` no embed de
 * `croqui_analises` hoje (pedido ao backend, ver relatório da onda) — este
 * prefixo é o único jeito confiável de distinguir demonstração de análise
 * real sem esse campo. */
export function ehAnaliseDeDemonstracao(analise: Pick<AnaliseSessao, "resumo_executivo">): boolean {
  return analise.resumo_executivo.startsWith("EXEMPLO GERADO SEM IA");
}
