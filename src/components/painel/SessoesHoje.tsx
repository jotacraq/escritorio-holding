import Link from "next/link";
import { Bloco, LinhaFila } from "./Bloco";
import { LinkBotao } from "./LinkBotao";
import { ChipProximoPasso } from "@/components/esteira/ChipProximoPasso";
import { SeloPresenca } from "@/components/agenda/SeloPresenca";
import { Selo } from "@/components/ui/Selo";
import { formatarHora } from "@/lib/formatar";
import { derivarProximoPasso } from "@/lib/pasta/proximo-passo";
import { sinaisDaSessaoDoDia } from "@/lib/pasta/sinais";
import type { EstadoBloco, SessaoDoDia } from "@/types/painel-ui";

/**
 * Bloco 1 — o que ela olha antes de entrar na primeira reunião: horário,
 * quem, presença confirmada (fato do agendamento, C23 — não o `status`),
 * briefing pronto, link da sala e o próximo passo derivado da MESMA função
 * da Esteira e da Agenda.
 */
export function SessoesHoje({ estado, aoTentarDeNovo }: { estado: EstadoBloco<SessaoDoDia>; aoTentarDeNovo: () => void }) {
  return (
    <Bloco
      id="sessoes-hoje"
      rotulo="Antes de entrar"
      titulo="Sessões de hoje"
      legenda="Próximas 48 horas — o que precisa estar pronto antes de entrar na sala"
      mensagemNadaPendente="Nenhuma sessão marcada para hoje ou amanhã."
      estado={estado}
      aoTentarDeNovo={aoTentarDeNovo}
    >
      {(itens) => {
        const ordenadas = [...itens].sort((a, b) => a.inicio_em.localeCompare(b.inicio_em));
        return (
          <ul className="divide-y divide-linha">
            {ordenadas.map((sessao) => {
              const proximo = derivarProximoPasso(sinaisDaSessaoDoDia(sessao));
              return (
                <LinhaFila key={`${sessao.jornada_id}-${sessao.inicio_em}`}>
                  <div className="flex items-baseline gap-3 sm:contents">
                    <time dateTime={sessao.inicio_em} className="shrink-0 text-sm font-bold tabular-nums text-tinta sm:w-24">
                      {formatarHora(sessao.inicio_em)}–{formatarHora(sessao.fim_em)}
                    </time>
                    <Link href={`/jornadas/${sessao.jornada_id}`} className="-my-3 min-w-0 truncate py-3 text-sm font-bold text-tinta underline-offset-2 hover:text-[color:var(--latao)] hover:underline sm:flex-1">
                      {sessao.nome}
                    </Link>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <SeloPresenca presencaConfirmadaEm={sessao.presenca_confirmada_em} inicioEm={sessao.inicio_em} via={sessao.presenca_confirmada_via} />
                    <Selo tom={sessao.tem_briefing ? "verde" : "ambar"}>{sessao.tem_briefing ? "Briefing pronto" : "Sem briefing"}</Selo>
                  </div>

                  <ChipProximoPasso proximo={proximo} jornadaId={sessao.jornada_id} tamanho="compacto" />

                  {sessao.link_sala ? (
                    <a
                      href={sessao.link_sala}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center justify-center rounded-pilula border border-transparent bg-[color:var(--latao-cta)] px-4 text-sm font-medium text-[color:var(--latao-cta-texto)] shadow-[0_3px_0_0_var(--latao-cta-forte)] transition-transform duration-[var(--transicao-rapida)] hover:-translate-y-px sm:ml-auto"
                    >
                      Abrir sala
                      <span className="sr-only"> (abre em nova aba)</span>
                    </a>
                  ) : (
                    <LinkBotao href={`/jornadas/${sessao.jornada_id}#sessao`} variante="secundario" className="sm:ml-auto">
                      Sem link ainda — colar
                    </LinkBotao>
                  )}
                </LinhaFila>
              );
            })}
          </ul>
        );
      }}
    </Bloco>
  );
}
