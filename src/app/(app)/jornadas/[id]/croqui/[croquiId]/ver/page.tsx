"use client";

import { use, useCallback, useMemo } from "react";
import Link from "next/link";
import { buscarCroquiParaApresentar, buscarFicha360, type CriterioParaMatriz } from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Botao } from "@/components/ui/Botao";
import { DeckImpressao } from "@/components/croqui/DeckImpressao";
import { contarRevisaoSlides } from "@/lib/croqui";
import type { DadosGraficosCroqui } from "@/components/croqui/GraficoDoSlide";

/**
 * F4 ("A Pasta do Cliente") — "Ver e explicar o Croqui": a mesma rolagem
 * contínua e clara do `DeckImpressao` (hoje só existente em `@media print`
 * dentro de `ModoApresentacao`), promovida para tela cheia navegável — leitura
 * de documento, com notas visíveis por padrão (ao contrário do modo
 * Apresentar, que as esconde de propósito atrás da tecla N) e um botão
 * "Salvar em PDF". Rota irmã de `.../apresentar/page.tsx`: mesmo par de
 * buscas em paralelo (croqui + ficha, para os gráficos), reaproveitadas sem
 * query nova — nenhuma migration, nenhuma escrita nova nesta tela.
 *
 * Ao contrário de `apresentar` (tela isolada, `fixed inset-0`), esta vive
 * dentro do shell normal do app (`(app)/layout.tsx` → `AppShell`) — por
 * design: é uma leitura de documento, não uma apresentação ao vivo, então
 * mantém a navegação do sistema ao redor (inclusive o caminho de volta para
 * a Ficha 360). O conteúdo do deck em si continua sempre em papel/tinta
 * claro, por design (mesma razão documentada em `DeckImpressao.tsx`) —
 * independente do tema claro/escuro ativo na navegação ao redor.
 */
export default function PaginaVerCroqui({ params }: { params: Promise<{ id: string; croquiId: string }> }) {
  const { id: jornadaId, croquiId } = use(params);

  const buscarCroqui = useCallback(() => buscarCroquiParaApresentar(croquiId), [croquiId]);
  const { dados: resposta, carregando: carregandoCroqui, erro: erroCroqui, recarregar } = useRecurso(buscarCroqui, [croquiId]);
  const croqui = resposta?.croqui ?? null;

  const buscarFicha = useCallback(() => buscarFicha360(jornadaId), [jornadaId]);
  const { dados: ficha, carregando: carregandoFicha } = useRecurso(buscarFicha, [jornadaId]);

  const dadosGraficos: DadosGraficosCroqui = useMemo(() => ({
    pessoa: ficha ? { id: ficha.pessoa.id, nome: ficha.pessoa.nome } : null,
    familiares: ficha?.familiares ?? null,
    patrimonio: ficha?.patrimonio ?? null,
    criterios: (resposta?.graficos.criterios ?? null) as CriterioParaMatriz[] | null,
    recomendacaoArquitetura: resposta?.graficos.recomendacao_arquitetura ?? null,
  }), [ficha, resposta]);

  const slides = croqui?.conteudo.slides ?? [];
  const { pendentes } = contarRevisaoSlides(slides);

  if (carregandoCroqui || carregandoFicha) {
    return <EstadoCarregando rotulo="Carregando croqui…" />;
  }
  if (erroCroqui) {
    return <EstadoErro erro={erroCroqui} tentarNovamente={recarregar} titulo="Não foi possível abrir o croqui" />;
  }
  if (!croqui || slides.length === 0) {
    return <EstadoVazio titulo="Croqui não encontrado" descricao="Volte à Ficha 360 e inicie o croqui antes de ver e explicar." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="nao-imprimir flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/jornadas/${jornadaId}#croqui`}
          className="rounded-controle text-sm text-tinta-suave underline decoration-linha-forte hover:text-tinta"
        >
          ← Voltar à Ficha 360
        </Link>
        <div className="flex items-center gap-2">
          {pendentes > 0 && (
            <span className="rounded-controle border border-ambar-borda bg-ambar-fraco px-2 py-1 text-xs font-medium text-[color:var(--ambar)]">
              {pendentes} slide{pendentes > 1 ? "s" : ""} sem revisão
            </span>
          )}
          <Botao variante="primario" onClick={() => window.print()}>Salvar em PDF</Botao>
        </div>
      </div>

      {/* `DeckImpressao` com `modoTela` — mesma marcação da impressão,
          visível na tela. Fundo/texto claros fixos, mesmo em tema escuro na
          navegação ao redor (ver justificativa em DeckImpressao.tsx). */}
      <div className="overflow-hidden rounded-controle border border-linha-forte">
        <DeckImpressao slides={slides} dadosGraficos={dadosGraficos} modoTela />
      </div>
    </div>
  );
}
