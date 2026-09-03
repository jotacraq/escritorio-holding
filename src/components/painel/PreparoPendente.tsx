import Link from "next/link";
import { Bloco } from "./Bloco";
import { Selo } from "@/components/ui/Selo";
import { formatarDataHora, formatarRelativo } from "@/lib/formatar";
import type { EstadoBloco, PendenciaPreparo } from "@/types/painel-ui";

/**
 * Bloco 2 — sessão marcada e falta formulário, ligação ou briefing.
 * Ordenado por quão perto está a sessão (a view já entrega em janela de 7 dias).
 */
export function PreparoPendente({ estado, aoTentarDeNovo }: { estado: EstadoBloco<PendenciaPreparo>; aoTentarDeNovo: () => void }) {
  return (
    <Bloco
      id="preparo-pendente"
      titulo="Preparo pendente"
      legenda="Sessão marcada nos próximos 7 dias, faltando algo antes dela"
      mensagemNadaPendente="Toda sessão dos próximos 7 dias está com o preparo completo."
      estado={estado}
      aoTentarDeNovo={aoTentarDeNovo}
    >
      {(itens) => {
        const ordenadas = [...itens].sort((a, b) => a.inicio_em.localeCompare(b.inicio_em));
        return (
          <ul className="flex flex-col divide-y divide-linha">
            {ordenadas.map((item) => (
              <li key={item.jornada_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                <Link
                  href={`/jornadas/${item.jornada_id}`}
                  className="min-w-0 flex-1 truncate text-sm font-medium text-tinta underline-offset-2 hover:text-latao-forte hover:underline"
                >
                  {item.nome}
                </Link>

                <span className="whitespace-nowrap text-xs text-tinta-suave" title={formatarDataHora(item.inicio_em)}>
                  sessão {formatarRelativo(item.inicio_em)}
                </span>

                <div className="flex flex-wrap gap-1.5">
                  {item.falta_formulario && <Selo tom="ambar">Falta formulário</Selo>}
                  {item.falta_ligacao && <Selo tom="ambar">Falta ligação</Selo>}
                  {item.falta_briefing && <Selo tom="ambar">Falta briefing</Selo>}
                </div>

                <Link
                  href={`/jornadas/${item.jornada_id}`}
                  className="ml-auto rounded-sm border border-linha-forte bg-papel px-2.5 py-1 text-xs font-medium text-tinta hover:border-latao"
                >
                  Preparar
                </Link>
              </li>
            ))}
          </ul>
        );
      }}
    </Bloco>
  );
}
