"use client";

import { use, useCallback } from "react";
import { buscarCroquiPorId } from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { ModoApresentacao } from "@/components/croqui/ModoApresentacao";

export default function PaginaApresentacaoCroqui({ params }: { params: Promise<{ id: string; croquiId: string }> }) {
  const { croquiId } = use(params);
  const buscar = useCallback(() => buscarCroquiPorId(croquiId).then((r) => r.croqui), [croquiId]);
  const { dados: croqui, carregando, erro, recarregar } = useRecurso(buscar, [croquiId]);

  if (carregando) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f1012] text-[#ece9df]">
        <EstadoCarregando rotulo="Carregando apresentação…" />
      </div>
    );
  }
  if (erro) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f1012] p-8">
        <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível abrir a apresentação" />
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

  return <ModoApresentacao croqui={croqui} />;
}
