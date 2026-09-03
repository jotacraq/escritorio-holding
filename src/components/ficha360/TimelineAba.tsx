import type { EventoTimeline } from "@/lib/api";
import { formatarDataHora } from "@/lib/formatar";
import { EstadoVazio } from "@/components/ui/Estado";

const ROTULOS_ATOR: Record<EventoTimeline["ator_tipo"], string> = { humano: "Equipe", sistema: "Sistema", ia: "IA" };

export function TimelineAba({ eventos }: { eventos: EventoTimeline[] }) {
  if (eventos.length === 0) {
    return <EstadoVazio titulo="Sem eventos registrados" descricao="A linha do tempo é alimentada automaticamente conforme a jornada avança." />;
  }
  return (
    <ol className="flex flex-col gap-0">
      {eventos.map((evento, indice) => (
        <li key={evento.id} className="relative flex gap-4 pb-5 pl-1">
          {indice < eventos.length - 1 && <span aria-hidden="true" className="absolute left-[7px] top-4 h-full w-px bg-linha" />}
          <span aria-hidden="true" className="mt-1.5 h-3 w-3 shrink-0 rounded-full border-2 border-[color:var(--latao)] bg-papel-elevado" />
          <div className="flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-tinta">{evento.titulo}</p>
              <span className="font-mono text-[11px] text-tinta-fraca">{formatarDataHora(evento.ocorrido_em)}</span>
            </div>
            {evento.descricao && <p className="text-sm text-tinta-suave">{evento.descricao}</p>}
            <span className="text-[11px] uppercase tracking-wide text-tinta-fraca">{ROTULOS_ATOR[evento.ator_tipo]}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
