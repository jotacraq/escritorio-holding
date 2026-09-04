import type { Ficha360 } from "@/lib/api";
import { acharCroquiIdNaTimeline } from "@/lib/api";
import { CATALOGO_PASTA, type ChaveItemPasta, type ProcedenciaItemPasta } from "./catalogo";

/**
 * 4 estados possíveis por item da Pasta do Cliente — a parte central do
 * plano, não uma simplificação de UI:
 * - `pronto` — existe e está completo.
 * - `em_revisao` — existe mas precisa de olho humano (ex.: croqui com slides
 *   não revisados, material pós-sessão não aprovado).
 * - `falta` — não existe, mas já pode ser feito agora (pré-requisito
 *   satisfeito). É a única cor de alarme real.
 * - `ainda_nao` — não existe, e não é hora ainda (pré-requisito não
 *   atingido). Cor neutra, sem alarme — é isso que evita "8 alarmes
 *   vermelhos" num cliente que está só no início da jornada: um item cujo
 *   pré-requisito não foi atingido NUNCA é `falta`.
 */
export type EstadoItemPasta = "pronto" | "em_revisao" | "falta" | "ainda_nao";

export interface ItemPasta {
  chave: ChaveItemPasta;
  rotulo: string;
  procedencia: ProcedenciaItemPasta;
  estado: EstadoItemPasta;
  /** Texto curto e humano explicando o estado — nunca jargão técnico (CLAUDE.md). */
  nota?: string;
}

/**
 * Função pura — sem I/O, sem fetch. Só lê o objeto `ficha` já carregado (o
 * mesmo tipo devolvido por `montarFicha360`/`GET /api/jornadas/[id]`).
 *
 * Regra de segurança (não negociável, mesma classe do achado de pentest
 * sobre `temAnaliseSessao` em `jornadas/[id]/page.tsx`): item com
 * `requerPatrimonio: true` e `podeVerPatrimonio: false` é OMITIDO do array
 * retornado — nunca aparece com estado `bloqueado` ou similar. A omissão
 * acontece no primeiro filtro, antes de qualquer cálculo de estado, para
 * nenhum ramo de código chegar perto de vazar a existência do item.
 */
export function derivarPasta(ficha: Ficha360, podeVerPatrimonio: boolean): ItemPasta[] {
  const sessaoRealizada = Boolean(ficha.sessao?.realizada_em);
  const temAgendamentoAtivo = ficha.agendamentos.some((a) => a.status === "agendado" || a.status === "confirmado");
  const croquiId = acharCroquiIdNaTimeline(ficha.timeline);
  // O evento mais recente de tipo 'croqui' grava `dados.status` (trigger
  // `0014_timeline.sql`, `jsonb_build_object('croqui_id', ..., 'status', ...)`)
  // — já disponível na timeline carregada, sem precisar do conteúdo completo
  // dos slides (esse sim exige `buscarCroquiPorId`, fora desta função pura).
  const eventoCroquiMaisRecente = ficha.timeline.find((e) => e.tipo === "croqui");
  const statusCroqui = typeof eventoCroquiMaisRecente?.dados?.status === "string" ? eventoCroquiMaisRecente.dados.status : null;
  const temAnaliseSessao = ficha.timeline.some((e) => e.tipo === "analise_sessao");
  const temTranscricao = ficha.timeline.some((e) => e.tipo === "transcricao");

  const estados: Record<ChaveItemPasta, () => { estado: EstadoItemPasta; nota?: string }> = {
    formulario: () => (ficha.formulario ? { estado: "pronto" } : { estado: "falta" }),

    ligacao: () =>
      ficha.ligacao?.realizada_em ? { estado: "pronto" } : { estado: "falta" },

    // TODO: não há fonte de dado pronta para contar links emitidos no payload
    // da Ficha 360 (`eventos_timeline` não tem tipo `'link'` — ver
    // `0014_timeline.sql` — e `Ficha360` não traz `links[]`). Declarado como
    // gap no relatório final; sem fonte real, este item nunca sai de
    // `ainda_nao` aqui (não é o pré-requisito que falta, é a leitura — a
    // aba `LinksAba.tsx` continua sendo a única fonte de verdade por ora).
    links: () => ({ estado: "ainda_nao", nota: "Contagem de links ainda não disponível neste resumo — ver aba Links." }),

    briefing: () => {
      if (ficha.briefingAtual) return { estado: "pronto" };
      // Mesmo pré-requisito de `calcularPendencias()`: briefing pode ser
      // gerado a qualquer momento (a porta de completude, não este catálogo,
      // decide se os dados bastam) — não há "ainda não é hora" aqui.
      return { estado: "falta" };
    },

    sessao: () => {
      if (sessaoRealizada) return { estado: "pronto" };
      if (temAgendamentoAtivo) return { estado: "em_revisao", nota: "Sessão agendada, aguardando realização." };
      return { estado: "falta" };
    },

    // Requer patrimônio (achado de pentest, `sessoes/[id]/transcricao/route.ts`
    // já usa `exigirVePatrimonio`) — pré-requisito é a sessão ter acontecido.
    transcricao: () => {
      if (temTranscricao) return { estado: "pronto" };
      if (!sessaoRealizada) return { estado: "ainda_nao", nota: "Só depois da Sessão de Viabilidade acontecer." };
      return { estado: "falta" };
    },

    // Requer patrimônio (mesmo gate de `analise-sessao/route.ts`). Pré-requisito
    // é a sessão ter acontecido — analisar antes da sessão não faz sentido.
    analise_sessao: () => {
      if (temAnaliseSessao) return { estado: "pronto" };
      if (!sessaoRealizada) return { estado: "ainda_nao", nota: "Só depois da Sessão de Viabilidade acontecer." };
      return { estado: "falta" };
    },

    // Diagnóstico da SV ainda não existe como peça no sistema — depende do
    // plano bloqueado "Croqui rico em dados" (Fases D/B31, Diário
    // 2026-09-04), sem decisão do Marcio/Dra. Elaine. Sem código condicional
    // torto: não há fonte de dado para este item em nenhum ramo — é sempre
    // `ainda_nao`, com nota explicando o porquê, até o dia em que a Fase D
    // for implementada.
    diagnostico_sv: () => ({ estado: "ainda_nao", nota: "Recurso ainda não disponível." }),

    // Requer patrimônio (mesmo gate de `relatorios/[id]/route.ts` — aba só
    // existe para quem vê patrimônio). Pré-requisito é a sessão ter
    // acontecido (o relatório é da Sessão de Viabilidade).
    relatorio_sv: () => {
      if (ficha.relatorio) return { estado: "pronto" };
      if (!sessaoRealizada) return { estado: "ainda_nao", nota: "Só depois da Sessão de Viabilidade acontecer." };
      return { estado: "falta" };
    },

    // Requer patrimônio (aba Croqui só existe para quem vê patrimônio).
    // Pré-requisito é a sessão ter acontecido — croqui nasce a partir da
    // Análise da Sessão ou é iniciado manualmente depois da sessão.
    croqui: () => {
      if (!croquiId) {
        if (!sessaoRealizada) return { estado: "ainda_nao", nota: "Só depois da Sessão de Viabilidade acontecer." };
        return { estado: "falta" };
      }
      // `status` vem do próprio evento de timeline (ver acima) — 'rascunho'
      // ainda está em elaboração (sinal de atenção, não erro: a revisão dos
      // 13 slides deixou de ser trava obrigatória, 0049); 'pronto'/'apresentado'
      // contam como pronto. Contagem fina de slides não revisados
      // (`contarRevisaoSlides`) exige o conteúdo completo, que não está
      // neste payload leve — quem mostra isso é `croquiAtalho`
      // (`jornadas/[id]/page.tsx`), não este catálogo.
      if (statusCroqui === "rascunho") return { estado: "em_revisao", nota: "Croqui iniciado, ainda em rascunho." };
      return { estado: "pronto" };
    },

    material: () => {
      // `ficha.materialAtual` é novo neste payload (ver `server/jornadas.ts`).
      // `undefined` (chave nunca populada) é tratado igual a `null` — nunca
      // lança, nunca inventa "pronto".
      const atual = ficha.materialAtual ?? null;
      if (!atual) return { estado: "falta" };
      if (!atual.aprovado_em) return { estado: "em_revisao", nota: "Gerado, aguardando aprovação." };
      return { estado: "pronto" };
    },

    // Requer patrimônio — omitido antes de chegar aqui quando o papel não
    // vê patrimônio (ver filtro abaixo). Sem pré-requisito de etapa: pode
    // ser preenchido a qualquer momento da jornada.
    patrimonio: () => ((ficha.patrimonio?.length ?? 0) > 0 ? { estado: "pronto" } : { estado: "falta" }),

    // Requer patrimônio, mesmo raciocínio de `patrimonio`.
    familiares: () => ((ficha.familiares?.length ?? 0) > 0 ? { estado: "pronto" } : { estado: "falta" }),

    // Requer patrimônio, mesma regra de `calcularPendencias()`: sem gate,
    // "documento pendente" e "não se aplica" ficam indistinguíveis.
    documentos: () => (ficha.documentos.length > 0 ? { estado: "pronto" } : { estado: "falta" }),
  };

  return CATALOGO_PASTA.filter((item) => !item.requerPatrimonio || podeVerPatrimonio).map((item) => {
    const { estado, nota } = estados[item.chave]();
    return { chave: item.chave, rotulo: item.rotulo, procedencia: item.procedencia, estado, nota };
  });
}
