import Link from "next/link";
import { Bloco } from "./Bloco";
import { Selo } from "@/components/ui/Selo";
import { formatarHora } from "@/lib/formatar";
import type { EstadoBloco, SessaoDoDia } from "@/types/painel-ui";

/**
 * Bloco 1 — o que ele olha antes de entrar na primeira reunião.
 * Horário, quem, se confirmou presença, link da sala, se o briefing está pronto.
 */
export function SessoesHoje({ estado, aoTentarDeNovo }: { estado: EstadoBloco<SessaoDoDia>; aoTentarDeNovo: () => void }) {
  return (
    <Bloco
      id="sessoes-hoje"
      titulo="Sessões de hoje"
      legenda="Próximas 48h, o que precisa estar pronto antes de entrar"
      mensagemNadaPendente="Nenhuma sessão marcada para hoje ou amanhã."
      estado={estado}
      aoTentarDeNovo={aoTentarDeNovo}
    >
      {(itens) => {
        const ordenadas = [...itens].sort((a, b) => a.inicio_em.localeCompare(b.inicio_em));
        return (
          <ul className="flex flex-col divide-y divide-linha">
            {ordenadas.map((sessao) => (
              <li
                key={sessao.jornada_id}
                className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2"
              >
                <div className="flex items-baseline gap-3 sm:contents">
                  <div className="shrink-0 font-mono text-sm tabular-nums text-tinta sm:w-20">
                    {formatarHora(sessao.inicio_em)}–{formatarHora(sessao.fim_em)}
                  </div>
                  <Link
                    href={`/jornadas/${sessao.jornada_id}`}
                    className="min-w-0 truncate text-sm font-medium text-tinta underline-offset-2 hover:text-latao-forte hover:underline sm:flex-1"
                  >
                    {sessao.nome}
                  </Link>
                </div>

                <Selo tom={sessao.status === "confirmado" ? "verde" : "neutro"}>
                  {sessao.status === "confirmado" ? "Confirmou presença" : "Não confirmou"}
                </Selo>

                <Selo tom={sessao.tem_briefing ? "verde" : "vermelho"}>
                  {sessao.tem_briefing ? "Briefing pronto" : "Sem briefing"}
                </Selo>

                {sessao.link_sala ? (
                  <a
                    href={sessao.link_sala}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-sm border border-linha-forte bg-latao-fraco px-2.5 py-1 text-xs font-medium text-tinta hover:border-latao"
                  >
                    Abrir sala
                  </a>
                ) : (
                  <span className="rounded-sm border border-dashed border-linha-forte px-2.5 py-1 text-xs text-tinta-fraca">
                    Sem link ainda
                  </span>
                )}
              </li>
            ))}
          </ul>
        );
      }}
    </Bloco>
  );
}
