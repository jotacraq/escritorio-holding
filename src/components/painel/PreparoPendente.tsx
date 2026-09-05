import Link from "next/link";
import { Bloco, LinhaFila } from "./Bloco";
import { LinkBotao } from "./LinkBotao";
import { ChipProximoPasso } from "@/components/esteira/ChipProximoPasso";
import { Selo } from "@/components/ui/Selo";
import { formatarDataHora, formatarRelativo } from "@/lib/formatar";
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
      legenda="Sessão marcada nos próximos 7 dias, faltando algo antes dela"
      mensagemNadaPendente="Toda sessão dos próximos 7 dias está com o preparo completo."
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

                  <div className="flex flex-wrap gap-1.5">
                    {item.falta_formulario && <Selo tom="neutro">Falta formulário</Selo>}
                    {item.falta_ligacao && <Selo tom="neutro">Falta ligação</Selo>}
                    {item.falta_briefing && <Selo tom="neutro">Falta briefing</Selo>}
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
