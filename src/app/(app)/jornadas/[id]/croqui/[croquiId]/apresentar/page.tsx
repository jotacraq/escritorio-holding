"use client";

import { use, useCallback, useMemo } from "react";
import { buscarCroquiParaApresentar, buscarFicha360, type CriterioParaMatriz } from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { ModoApresentacao } from "@/components/croqui/ModoApresentacao";
import type { DadosGraficosCroqui } from "@/components/croqui/GraficoDoSlide";

/**
 * A tela que o cliente vê (ARQUITETURA-FASE-3.md §3, U6). Fora de
 * `src/app/api/**` (não é rota de API) e não colide com nenhuma outra
 * fronteira da onda — é a página que já existe e só chama
 * `ModoApresentacao` (`src/components/croqui/**`, minha fronteira). Busca o
 * croqui (com a análise mais recente embutida — a mesma que abastece os
 * gráficos aqui e no editor, uma única fonte) e a ficha (patrimônio,
 * família), em paralelo.
 */
export default function PaginaApresentacaoCroqui({ params }: { params: Promise<{ id: string; croquiId: string }> }) {
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

  // A ficha é auxiliar (gráficos) — não bloqueia a apresentação se falhar
  // (ex.: papel sem `ve_patrimonio` chegando aqui por outro caminho): o
  // croqui carregando é o que decide se a tela abre.
  if (carregandoCroqui || carregandoFicha) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f1012] text-[#ece9df]">
        <EstadoCarregando rotulo="Carregando apresentação…" />
      </div>
    );
  }
  if (erroCroqui) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f1012] p-8">
        <EstadoErro erro={erroCroqui} tentarNovamente={recarregar} titulo="Não foi possível abrir a apresentação" />
      </div>
    );
  }
  if (!croqui) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f1012] p-8">
        <EstadoVazio titulo="Croqui não encontrado" descricao="Volte à Ficha 360 e inicie o croqui antes de apresentar." />
      </div>
    );
  }

  return <ModoApresentacao croqui={croqui} jornadaId={jornadaId} dadosGraficos={dadosGraficos} />;
}
