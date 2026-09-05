"use client";

import { use } from "react";
import { CabecalhoPagina } from "@/components/ui/CabecalhoPagina";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { CroquiCalculado } from "@/components/croqui/CroquiCalculado";
import { useCroquiDaRota } from "@/components/croqui/useCroquiDaRota";
import { rotulo } from "@/lib/vocabulario";

/**
 * `/croquis/[croquiId]` — o Croqui Estrutural calculado: as 19 tabelas do
 * método, com procedência por célula.
 *
 * Rota própria (e não uma aba a mais na Ficha) porque é a peça que o
 * escritório vende: a advogada abre, confere, fixa a versão e apresenta. A
 * Ficha aponta para cá (M5); nada aqui depende de ter vindo de lá.
 */
export default function PaginaCroquiCalculado({ params }: { params: Promise<{ croquiId: string }> }) {
  const { croquiId } = use(params);
  const { croqui, jornadaId, carregando, erro, recarregar } = useCroquiDaRota(croquiId);

  if (carregando) return <EstadoCarregando rotulo="Abrindo o croqui…" />;
  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não deu para abrir o croqui" />;
  if (!croqui || !jornadaId) {
    return <EstadoVazio titulo="Croqui não encontrado" descricao="Volte à ficha do cliente." />;
  }

  return (
    <div className="flex flex-col gap-secao">
      <CabecalhoPagina rotulo={rotulo("croqui")} titulo={croqui.titulo} />
      <CroquiCalculado
        jornadaId={jornadaId}
        croquiId={croquiId}
        voltar={{ href: `/jornadas/${jornadaId}#croqui`, rotulo: "Ficha" }}
        hrefSimular={`/croquis/${croquiId}/simular`}
        hrefApresentar={`/croquis/${croquiId}/apresentar`}
      />
    </div>
  );
}
