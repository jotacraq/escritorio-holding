"use client";

import { useCallback, useMemo, useState } from "react";
import {
  acharCroquiIdNaTimeline,
  buscarCroquiPorId,
  criarCroqui,
  atualizarCroqui,
  ApiError,
  type EventoTimeline,
  type Ficha360,
} from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";
import { criarEsqueletoSlides } from "@/lib/croqui";
import type { DadosGraficosCroqui } from "@/components/croqui/GraficoDoSlide";
import { type CroquiComAnalises } from "@/components/ficha360/api-analise";
import type { CroquiConteudo } from "@/server/ia/schema-croqui-slides";

/**
 * Estado do Croqui compartilhado entre as duas abas de topo que dependem
 * dele — "Análise da Sessão" e "Croqui" (ambas no grupo "Sessão"/"Patrimônio"
 * respectivamente, ver `jornadas/[id]/page.tsx`). Antes desta extração, as
 * duas eram sub-abas do mesmo componente (`CroquiAba`) e compartilhavam este
 * estado por closure — a dívida documentada em `CroquiAba.tsx` (agora paga).
 *
 * Recebe `ficha` por prop (já carregada pelo pai via `useFicha360`) em vez de
 * buscar de novo — Tarefa 5 do plano: elimina a segunda chamada a
 * `buscarFicha360` que a antiga `CroquiAba` fazia só para extrair
 * `sessao.id`/`pessoa`/`familiares`/`patrimonio`.
 */
export function useCroquiDaJornada({ jornadaId, ficha, timeline }: { jornadaId: string; ficha: Ficha360; timeline: EventoTimeline[] }) {
  const croquiId = acharCroquiIdNaTimeline(timeline);

  const buscarCroqui = useCallback(
    () => (croquiId ? buscarCroquiPorId(croquiId).then((r) => r.croqui as CroquiComAnalises) : Promise.resolve(null)),
    [croquiId],
  );
  const { dados: croqui, carregando: carregandoCroqui, erro: erroCroqui, recarregar: recarregarCroqui } = useRecurso(buscarCroqui, [croquiId]);

  const [criando, setCriando] = useState(false);
  const [erroCriar, setErroCriar] = useState<string | null>(null);
  const [croquiRecemAtualizado, setCroquiRecemAtualizado] = useState<CroquiComAnalises | null>(null);

  const croquiAtual = croquiRecemAtualizado ?? croqui ?? null;

  const sessaoId = ficha.sessao?.id ?? null;

  const dadosGraficos: DadosGraficosCroqui = useMemo(
    () => ({
      pessoa: { id: ficha.pessoa.id, nome: ficha.pessoa.nome },
      familiares: ficha.familiares ?? null,
      patrimonio: ficha.patrimonio ?? null,
      criterios: null,
      recomendacaoArquitetura: null,
    }),
    [ficha],
  );

  const ultimaAnaliseSalva = useMemo(() => {
    const lista = croquiAtual?.croqui_analises ?? [];
    if (lista.length === 0) return null;
    const maisRecente = [...lista].sort((a, b) => b.versao - a.versao)[0];
    return { conteudo: maisRecente.conteudo, grau_confianca: maisRecente.grau_confianca, criado_em: maisRecente.criado_em };
  }, [croquiAtual]);

  async function iniciarCroqui() {
    setCriando(true);
    setErroCriar(null);
    try {
      const res = await criarCroqui(jornadaId, { titulo: "Croqui Estrutural", conteudo: { slides: criarEsqueletoSlides() } });
      // A timeline só ganha o evento no próximo carregamento da Ficha 360;
      // mostramos o croqui recém-criado direto da resposta do POST.
      setCroquiRecemAtualizado(res.croqui as CroquiComAnalises);
    } catch (e) {
      setErroCriar(e instanceof ApiError ? e.message : "Não foi possível criar o croqui.");
    } finally {
      setCriando(false);
    }
  }

  async function aoAnaliseGerada(resultado: { croqui_id: string }) {
    try {
      const r = await buscarCroquiPorId(resultado.croqui_id);
      setCroquiRecemAtualizado(r.croqui as CroquiComAnalises);
    } catch {
      // Best-effort — se falhar, o croqui aparece na próxima vez que a aba recarregar.
      recarregarCroqui();
    }
  }

  async function aoAplicarAoCroqui(conteudo: CroquiConteudo) {
    if (!croquiAtual) throw new Error("sem_croqui_para_aplicar");
    const res = await atualizarCroqui(croquiAtual.id, { conteudo });
    // A resposta do PATCH não reembute `croqui_analises` (a rota não seleciona
    // essa coluna) — preserva o que já estava carregado em vez de perder.
    setCroquiRecemAtualizado({ ...croquiAtual, ...res.croqui, croqui_analises: croquiAtual.croqui_analises });
  }

  // `nao_encontrado` (croqui_id da timeline sem registro correspondente em
  // `croquis`) é estado VAZIO, não erro — drift de dado observado nesta base
  // em mais de uma nota do brain. Qualquer outro código (rede, 500,
  // sem_permissao...) continua sendo erro de verdade.
  const croquiInexistente = erroCroqui instanceof ApiError && erroCroqui.codigo === "nao_encontrado";

  return {
    croqui,
    croquiAtual,
    carregandoCroqui,
    erroCroqui,
    croquiInexistente,
    recarregarCroqui,
    criando,
    erroCriar,
    iniciarCroqui,
    sessaoId,
    dadosGraficos,
    ultimaAnaliseSalva,
    aoAnaliseGerada,
    aoAplicarAoCroqui,
  };
}

export type EstadoCroquiDaJornada = ReturnType<typeof useCroquiDaJornada>;
