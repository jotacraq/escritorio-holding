import Link from "next/link";
import { Bloco, LinhaFila } from "./Bloco";
import { LinkBotao } from "./LinkBotao";
import { ChipProximoPasso } from "@/components/esteira/ChipProximoPasso";
import { Selo } from "@/components/ui/Selo";
import { formatarDataHora, formatarRelativo } from "@/lib/formatar";
import { titleDe } from "@/lib/vocabulario";
import { derivarProximoPasso, hrefDoPasso } from "@/lib/pasta/proximo-passo";
import { sinaisDoPreparo } from "@/lib/pasta/sinais";
import type { EstadoBloco, PendenciaPreparo } from "@/types/painel-ui";

/**
 * Bloco 2 — sessão marcada e falta formulário, ligação ou briefing.
 * Ordenado por quão perto está a sessão (a view já entrega em janela de 7 dias).
 * O chip diz qual dos três vem primeiro e de quem é — a mesma regra da Esteira.
 */
export function PreparoPendente({ estado, aoTentarDeNovo }: { estado: EstadoBloco<PendenciaPreparo>; aoTentarDeNovo: () => void }) {
  return (
    <Bloco
      id="preparo-pendente"
      rotulo="Preparo"
      titulo="Preparo pendente"
      tituloTitle={titleDe("briefing_etapa")}
      dica="Sessão marcada para os próximos 7 dias com algo faltando antes dela: formulário, ligação estratégica ou briefing."
      mensagemNadaPendente="Preparo completo nos próximos 7 dias."
      estado={estado}
      aoTentarDeNovo={aoTentarDeNovo}
    >
      {(itens) => {
        const ordenadas = [...itens].sort((a, b) => a.inicio_em.localeCompare(b.inicio_em));
        return (
          <ul className="divide-y divide-linha">
            {ordenadas.map((item) => {
              const proximo = derivarProximoPasso(sinaisDoPreparo(item));
              return (
                <LinhaFila key={item.jornada_id}>
                  <Link href={`/jornadas/${item.jornada_id}`} className="-my-3 min-w-0 truncate py-3 text-sm font-bold text-tinta underline-offset-2 hover:text-[color:var(--latao)] hover:underline sm:flex-1">
                    {item.nome}
                  </Link>

                  <span className="whitespace-nowrap text-xs text-tinta-suave" title={formatarDataHora(item.inicio_em)}>
                    sessão {formatarRelativo(item.inicio_em)}
                  </span>

                  {/* Rótulo humano no fluxo; a sigla do POP/método só no `title` (§9.2). */}
                  <div className="flex flex-wrap gap-1.5">
                    {item.falta_formulario && (
                      <span title={titleDe("pop02")} className="inline-flex">
                        <Selo tom="neutro">Falta formulário</Selo>
                      </span>
                    )}
                    {item.falta_ligacao && (
                      <span title={titleDe("pop03")} className="inline-flex">
                        <Selo tom="neutro">Falta ligação</Selo>
                      </span>
                    )}
                    {item.falta_briefing && (
                      <span title={titleDe("briefing_etapa")} className="inline-flex">
                        <Selo tom="neutro">Falta preparo</Selo>
                      </span>
                    )}
                  </div>

                  <ChipProximoPasso proximo={proximo} jornadaId={item.jornada_id} tamanho="compacto" />

                  <LinkBotao href={hrefDoPasso(item.jornada_id, proximo)} className="sm:ml-auto">
                    Preparar
                  </LinkBotao>
                </LinhaFila>
              );
            })}
          </ul>
        );
      }}
    </Bloco>
  );
}
