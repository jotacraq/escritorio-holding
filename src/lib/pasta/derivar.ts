import type { Ficha360 } from "@/lib/api";
import { CATALOGO_PASTA, type ChaveItemPasta, type DonoItemPasta, type ProcedenciaItemPasta } from "./catalogo";
import { derivarProximoPasso, type ProximoPasso } from "./proximo-passo";
import { sinaisDaFicha, type Sinais } from "./sinais";

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
  /** Quem precisa agir para o item existir (Fase 4 §6.2, `catalogo.ts`). */
  dono: DonoItemPasta;
  /** Texto curto e humano explicando o estado — nunca jargão técnico (CLAUDE.md). */
  nota?: string;
}

/**
 * Função pura — sem I/O, sem fetch. Só lê o objeto `ficha` já carregado (o
 * mesmo tipo devolvido por `montarFicha360`/`GET /api/jornadas/[id]`).
 *
 * Fase 4 §6: os fatos compartilhados (sessão realizada, croqui, material,
 * relatório, agendamento ativo) saem de `sinaisDaFicha()` — a MESMA leitura
 * que alimenta `derivarProximoPasso()` no chip de toda tela. Um fato, uma
 * leitura; a Pasta e o chip nunca discordam sobre "a sessão aconteceu?".
 *
 * Regra de segurança (não negociável, mesma classe do achado de pentest
 * sobre `temAnaliseSessao` em `jornadas/[id]/page.tsx`): item com
 * `requerPatrimonio: true` e `podeVerPatrimonio: false` é OMITIDO do array
 * retornado — nunca aparece com estado `bloqueado` ou similar. A omissão
 * acontece no primeiro filtro, antes de qualquer cálculo de estado, para
 * nenhum ramo de código chegar perto de vazar a existência do item.
 */
export function derivarPasta(ficha: Ficha360, podeVerPatrimonio: boolean): ItemPasta[] {
  const sinais = sinaisDaFicha(ficha);
  return derivarPastaDeSinais(ficha, sinais, podeVerPatrimonio);
}

/** Versão que aceita sinais já calculados (evita derivar duas vezes na mesma tela). */
export function derivarPastaDeSinais(ficha: Ficha360, sinais: Sinais, podeVerPatrimonio: boolean): ItemPasta[] {
  const sessaoRealizada = Boolean(sinais.sessaoRealizadaEm);
  const temAgendamentoAtivo = sinais.proximaSessaoEm !== null;
  const temAnaliseSessao = ficha.timeline.some((e) => e.tipo === "analise_sessao");
  const temTranscricao = ficha.timeline.some((e) => e.tipo === "transcricao");
  const SO_DEPOIS_DA_SESSAO = "Só depois da Sessão de Viabilidade acontecer.";

  const estados: Record<ChaveItemPasta, () => { estado: EstadoItemPasta; nota?: string }> = {
    formulario: () => (sinais.temFormulario ? { estado: "pronto" } : { estado: "falta" }),

    ligacao: () => (sinais.temLigacao ? { estado: "pronto" } : { estado: "falta" }),

    // TODO: não há fonte de dado pronta para contar links emitidos no payload
    // da Ficha 360 (`eventos_timeline` não tem tipo `'link'` — ver
    // `0014_timeline.sql` — e `Ficha360` não traz `links[]`). Declarado como
    // gap no relatório final; sem fonte real, este item nunca sai de
    // `ainda_nao` aqui (não é o pré-requisito que falta, é a leitura — a
    // aba `LinksAba.tsx` continua sendo a única fonte de verdade por ora).
    links: () => ({ estado: "ainda_nao", nota: "Contagem de links ainda não disponível neste resumo — ver aba Links." }),

    briefing: () => {
      if (sinais.temBriefing) return { estado: "pronto" };
      // Briefing pode ser gerado a qualquer momento (a porta de completude,
      // não este catálogo, decide se os dados bastam) — não há "ainda não é hora".
      return { estado: "falta" };
    },

    sessao: () => {
      if (sessaoRealizada) return { estado: "pronto" };
      if (temAgendamentoAtivo) {
        // Presença confirmada pelo cliente (0051) é fato sobre o agendamento —
        // muda a nota, não o estado. `null` = coluna ainda não existe: silêncio.
        if (sinais.presencaConfirmada === true) return { estado: "em_revisao", nota: "Sessão agendada e presença confirmada pelo cliente." };
        if (sinais.presencaConfirmada === false) return { estado: "em_revisao", nota: "Sessão agendada, aguardando o cliente confirmar presença." };
        return { estado: "em_revisao", nota: "Sessão agendada, aguardando realização." };
      }
      return { estado: "falta" };
    },

    // Requer patrimônio (achado de pentest, `sessoes/[id]/transcricao/route.ts`
    // já usa `exigirVePatrimonio`) — pré-requisito é a sessão ter acontecido.
    transcricao: () => {
      if (temTranscricao) return { estado: "pronto" };
      if (!sessaoRealizada) return { estado: "ainda_nao", nota: SO_DEPOIS_DA_SESSAO };
      return { estado: "falta" };
    },

    // Requer patrimônio (mesmo gate de `analise-sessao/route.ts`). Pré-requisito
    // é a sessão ter acontecido — analisar antes da sessão não faz sentido.
    analise_sessao: () => {
      if (temAnaliseSessao) return { estado: "pronto" };
      if (!sessaoRealizada) return { estado: "ainda_nao", nota: SO_DEPOIS_DA_SESSAO };
      return { estado: "falta" };
    },

    // Diagnóstico da SV (0058, agente D): `temDiagnostico` só sai de `null`
    // quando `Ficha360.diagnosticoAtual` passar a existir no payload. Até lá,
    // sem fonte de dado, é sempre `ainda_nao` com nota — nunca um "falta"
    // inventado sobre um recurso que a tela não consegue ler.
    diagnostico_sv: () => {
      if (sinais.temDiagnostico === true) return { estado: "pronto" };
      if (sinais.temDiagnostico === null) return { estado: "ainda_nao", nota: "Recurso ainda não disponível." };
      if (!sessaoRealizada) return { estado: "ainda_nao", nota: SO_DEPOIS_DA_SESSAO };
      return { estado: "falta" };
    },

    // Requer patrimônio (mesmo gate de `relatorios/[id]/route.ts` — aba só
    // existe para quem vê patrimônio). Pré-requisito é a sessão ter
    // acontecido (o relatório é da Sessão de Viabilidade).
    relatorio_sv: () => {
      if (sinais.temRelatorio) return { estado: "pronto" };
      if (!sessaoRealizada) return { estado: "ainda_nao", nota: SO_DEPOIS_DA_SESSAO };
      return { estado: "falta" };
    },

    // Requer patrimônio (aba Croqui só existe para quem vê patrimônio).
    // Pré-requisito é a sessão ter acontecido — croqui nasce a partir da
    // Análise da Sessão ou é iniciado manualmente depois da sessão.
    croqui: () => {
      if (sinais.croquiStatus === "nenhum" || sinais.croquiStatus === null) {
        if (!sessaoRealizada) return { estado: "ainda_nao", nota: SO_DEPOIS_DA_SESSAO };
        return { estado: "falta" };
      }
      // `status` vem do evento de timeline (0014) — 'rascunho' ainda está em
      // elaboração (sinal de atenção, não erro: a revisão dos 13 slides deixou
      // de ser trava obrigatória, 0049); 'pronto'/'apresentado' contam como
      // pronto. Contagem fina de slides não revisados exige o conteúdo
      // completo, que não está neste payload — quem mostra isso é
      // `croquiAtalho` (`jornadas/[id]/page.tsx`), não este catálogo.
      if (sinais.croquiStatus === "rascunho") return { estado: "em_revisao", nota: "Croqui iniciado, ainda em rascunho." };
      return { estado: "pronto" };
    },

    material: () => {
      // `ficha.materialAtual` é novo neste payload (ver `server/jornadas.ts`).
      // `undefined` (chave nunca populada) é tratado igual a `null` — nunca
      // lança, nunca inventa "pronto".
      if (sinais.materialEstado === "aprovado") return { estado: "pronto" };
      if (sinais.materialEstado === "rascunho") return { estado: "em_revisao", nota: "Gerado, aguardando aprovação." };
      return { estado: "falta" };
    },

    // Requer patrimônio — omitido antes de chegar aqui quando o papel não
    // vê patrimônio (ver filtro abaixo). Sem pré-requisito de etapa: pode
    // ser preenchido a qualquer momento da jornada.
    patrimonio: () => ((ficha.patrimonio?.length ?? 0) > 0 ? { estado: "pronto" } : { estado: "falta" }),

    // Requer patrimônio, mesmo raciocínio de `patrimonio`.
    familiares: () => ((ficha.familiares?.length ?? 0) > 0 ? { estado: "pronto" } : { estado: "falta" }),

    // Requer patrimônio: sem gate, "documento pendente" e "não se aplica"
    // ficam indistinguíveis.
    documentos: () => (sinais.temDocumentos ? { estado: "pronto" } : { estado: "falta" }),
  };

  return CATALOGO_PASTA.filter((item) => !item.requerPatrimonio || podeVerPatrimonio).map((item) => {
    const { estado, nota } = estados[item.chave]();
    return { chave: item.chave, rotulo: item.rotulo, procedencia: item.procedencia, estado, dono: item.dono, nota };
  });
}

/**
 * Atalho para a Ficha 360 / Pasta (agente H, Onda 2): o MESMO chip que a
 * Esteira, o Painel e a Agenda mostram — derivado do payload já carregado.
 */
export function proximoPassoDaFicha(ficha: Ficha360, agora?: number): ProximoPasso {
  return derivarProximoPasso(sinaisDaFicha(ficha), agora);
}
