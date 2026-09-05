"use client";

import { use } from "react";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { ApresentarCroqui } from "@/components/croqui/ApresentarCroqui";
import { TelaCheiaApresentacao } from "@/components/croqui/TelaCheiaApresentacao";
import { useCroquiDaRota } from "@/components/croqui/useCroquiDaRota";

/**
 * `/croquis/[croquiId]/apresentar` — a tela projetada para a família: os
 * slides do método com as tabelas do motor, teclado, tela cheia e notas do
 * apresentador atrás da tecla N.
 *
 * Fora do shell do app de propósito (`fixed inset-0`, tema escuro fixo): o
 * que está no projetor é o croqui, não o sistema.
 */
export default function PaginaApresentarCroquiCalculado({
  params,
}: {
  params: Promise<{ croquiId: string }>;
}) {
  const { croquiId } = use(params);
  const { croqui, jornadaId, carregando, erro, recarregar } = useCroquiDaRota(croquiId);

  if (carregando) {
    return (
      <TelaCheiaApresentacao>
        <EstadoCarregando rotulo="Carregando a apresentação…" />
      </TelaCheiaApresentacao>
    );
  }
  if (erro) {
    return (
      <TelaCheiaApresentacao>
        <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não deu para abrir a apresentação" />
      </TelaCheiaApresentacao>
    );
  }
  if (!croqui || !jornadaId) {
    return (
      <TelaCheiaApresentacao>
        <EstadoVazio titulo="Croqui não encontrado" descricao="Volte à ficha do cliente." />
      </TelaCheiaApresentacao>
    );
  }

  return <ApresentarCroqui croquiId={croquiId} jornadaId={jornadaId} titulo={croqui.titulo} />;
}
