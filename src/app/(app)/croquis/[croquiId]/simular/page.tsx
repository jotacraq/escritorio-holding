"use client";

import { use } from "react";
import { CabecalhoPagina } from "@/components/ui/CabecalhoPagina";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Simulador } from "@/components/croqui/Simulador";
import { useCroquiDaRota } from "@/components/croqui/useCroquiDaRota";

/**
 * `/croquis/[croquiId]/simular` — o "e se…" ao vivo, na frente da família.
 *
 * A conta é pura e roda no navegador: mexer no valor de mercado de um imóvel
 * ou trocar de arquitetura muda o comparativo na hora, sem uma chamada de
 * rede. Substitui a advogada navegando por 19 abas de planilha durante a
 * sessão. Nada é gravado até "Fixar como versão", e mesmo aí quem calcula é
 * o servidor.
 */
export default function PaginaSimularCroqui({ params }: { params: Promise<{ croquiId: string }> }) {
  const { croquiId } = use(params);
  const { croqui, jornadaId, carregando, erro, recarregar } = useCroquiDaRota(croquiId);

  if (carregando) return <EstadoCarregando rotulo="Abrindo o simulador…" />;
  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não deu para abrir o simulador" />;
  if (!croqui || !jornadaId) {
    return <EstadoVazio titulo="Croqui não encontrado" descricao="Volte à ficha do cliente." />;
  }

  return (
    <div className="flex flex-col gap-secao">
      <CabecalhoPagina rotulo="Simulação" titulo={croqui.titulo} />
      <Simulador
        jornadaId={jornadaId}
        croquiId={croquiId}
        voltar={{ href: `/croquis/${croquiId}`, rotulo: "Croqui" }}
      />
    </div>
  );
}
