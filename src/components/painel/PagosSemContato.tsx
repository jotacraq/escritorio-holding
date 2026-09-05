import Link from "next/link";
import { Bloco, LinhaFila } from "./Bloco";
import { LinkBotao } from "./LinkBotao";
import { ChipProximoPasso } from "@/components/esteira/ChipProximoPasso";
import { formatarData } from "@/lib/formatar";
import { derivarProximoPasso, hrefDoPasso } from "@/lib/pasta/proximo-passo";
import { sinaisDoPagoSemContato } from "@/lib/pasta/sinais";
import type { EstadoBloco, PagoSemContato } from "@/types/painel-ui";

function rotuloDias(dias: number): string {
  const arredondado = Math.max(0, Math.round(dias));
  if (arredondado === 0) return "pagou hoje";
  return `${arredondado} dia${arredondado === 1 ? "" : "s"} sem contato`;
}

/**
 * Bloco 3 — o furo que mais dói: dinheiro entrou e o cliente está esperando.
 * Se este bloco tem linha, é a coisa mais urgente da tela (por isso o realce
 * vermelho no `Bloco` pai, `urgente`, e o texto de dias em destaque aqui).
 */
export function PagosSemContato({ estado, aoTentarDeNovo }: { estado: EstadoBloco<PagoSemContato>; aoTentarDeNovo: () => void }) {
  const proximo = derivarProximoPasso(sinaisDoPagoSemContato());
  return (
    <Bloco
      id="pagos-sem-contato"
      rotulo="Urgente"
      titulo="Pagou, sem contato"
      dica="Pagamento aprovado e nenhuma ligação ou mensagem registrada ainda. É o furo que mais dói: o dinheiro entrou e o cliente está esperando."
      mensagemNadaPendente="Ninguém esperando contato."
      estado={estado}
      urgente
      aoTentarDeNovo={aoTentarDeNovo}
    >
      {(itens) => {
        const ordenadas = [...itens].sort((a, b) => b.dias_desde_pagamento - a.dias_desde_pagamento);
        return (
          <ul className="divide-y divide-linha">
            {ordenadas.map((item) => (
              <LinhaFila key={item.jornada_id}>
                <Link href={`/jornadas/${item.jornada_id}`} className="-my-3 min-w-0 truncate py-3 text-sm font-bold text-tinta underline-offset-2 hover:text-[color:var(--latao)] hover:underline sm:flex-1">
                  {item.nome}
                </Link>

                <span className="whitespace-nowrap text-xs text-tinta-suave" title="Data do pagamento aprovado">
                  {formatarData(item.pago_em)}
                </span>

                <span className="whitespace-nowrap text-sm font-bold text-[color:var(--vermelho)]">{rotuloDias(item.dias_desde_pagamento)}</span>

                <ChipProximoPasso proximo={proximo} jornadaId={item.jornada_id} tamanho="compacto" />

                <LinkBotao href={hrefDoPasso(item.jornada_id, proximo)} variante="cta" className="sm:ml-auto">
                  Contatar agora
                </LinkBotao>
              </LinhaFila>
            ))}
          </ul>
        );
      }}
    </Bloco>
  );
}
