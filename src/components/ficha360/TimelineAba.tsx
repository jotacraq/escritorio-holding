import type { EventoTimeline } from "@/lib/api";
import { formatarDataHora } from "@/lib/formatar";
import { EstadoVazio } from "@/components/ui/Estado";
import { rotulo } from "@/lib/vocabulario";

/**
 * Os **Andamentos** do processo (Fase 8, §B3/D18).
 *
 * O nome mudou de "linha do tempo" para o termo que o advogado brasileiro já
 * lê em PJe e e-SAJ, e vem de `rotulo("andamentos")` — a tabela continua sendo
 * `eventos_timeline` no banco e no código. Rótulo de tela num lugar só; nada
 * de sinônimo inventado componente a componente.
 *
 * Ordem decrescente (o mais recente em cima) é o padrão daqueles sistemas e é
 * o contrato desta lista — o servidor já entrega assim (`server/jornadas.ts`),
 * e a ordenação aqui garante que continue assim se a fonte mudar.
 *
 * Quem quer só a história do croqui usa `AndamentosCroqui`, no cartão do
 * croqui: esta aba é o processo INTEIRO.
 */

const ROTULOS_ATOR: Record<EventoTimeline["ator_tipo"], string> = { humano: "Equipe", sistema: "Sistema", ia: "IA" };

export function TimelineAba({ eventos }: { eventos: EventoTimeline[] }) {
  if (eventos.length === 0) {
    return (
      <EstadoVazio
        titulo={`Sem ${rotulo("andamentos").toLowerCase()} registrados`}
        descricao="Cada movimentação do processo — contato, pagamento, sessão, croqui — entra aqui sozinha, com a data."
      />
    );
  }

  const ordenados = eventos.slice().sort((a, b) => b.ocorrido_em.localeCompare(a.ocorrido_em));

  return (
    <ol className="flex flex-col gap-0">
      {ordenados.map((evento, indice) => (
        <li key={evento.id} className="relative flex gap-4 pb-5 pl-1">
          {indice < ordenados.length - 1 && <span aria-hidden="true" className="absolute left-[7px] top-4 h-full w-px bg-linha" />}
          <span aria-hidden="true" className="mt-1.5 h-3 w-3 shrink-0 rounded-full border-2 border-[color:var(--latao)] bg-papel-elevado" />
          <div className="flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-tinta">{evento.titulo}</p>
              {/* `<time>` com `dateTime`: a data é dado, não decoração — é o
                  que faz o leitor de tela e o "copiar" darem a data certa. */}
              <time dateTime={evento.ocorrido_em} className="font-mono text-legenda text-tinta-fraca">
                {formatarDataHora(evento.ocorrido_em)}
              </time>
            </div>
            {evento.descricao && <p className="text-sm text-tinta-suave">{evento.descricao}</p>}
            <span className="text-legenda uppercase tracking-wide text-tinta-fraca">{ROTULOS_ATOR[evento.ator_tipo]}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
