import Link from "next/link";
import { Bloco } from "./Bloco";
import { formatarData } from "@/lib/formatar";
import type { EstadoBloco, PagoSemContato } from "@/types/painel-ui";

function rotuloDias(dias: number): string {
  const arredondado = Math.max(0, Math.round(dias));
  if (arredondado === 0) return "pagou hoje";
  return `há ${arredondado} dia${arredondado === 1 ? "" : "s"} sem contato`;
}

/**
 * Bloco 3 — o furo que mais dói: dinheiro entrou e o cliente está esperando.
 * Se este bloco tem linha, é a coisa mais urgente da tela (por isso o realce
 * vermelho no `Bloco` pai, `urgente`, e o texto de dias em destaque aqui).
 */
export function PagosSemContato({ estado, aoTentarDeNovo }: { estado: EstadoBloco<PagoSemContato>; aoTentarDeNovo: () => void }) {
  return (
    <Bloco
      id="pagos-sem-contato"
      titulo="Pagou e ninguém falou com essa pessoa"
      legenda="Pagamento aprovado, sem ligação e sem mensagem registrada ainda"
      mensagemNadaPendente="Todo mundo que pagou já foi contatado."
      estado={estado}
      urgente
      aoTentarDeNovo={aoTentarDeNovo}
    >
      {(itens) => {
        const ordenadas = [...itens].sort((a, b) => b.dias_desde_pagamento - a.dias_desde_pagamento);
        return (
          <ul className="flex flex-col divide-y divide-linha">
            {ordenadas.map((item) => (
              <li
                key={item.jornada_id}
                className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2"
              >
                <Link
                  href={`/jornadas/${item.jornada_id}`}
                  className="min-w-0 truncate text-sm font-medium text-tinta underline-offset-2 hover:text-latao-forte hover:underline sm:flex-1"
                >
                  {item.nome}
                </Link>

                <span className="whitespace-nowrap text-xs text-tinta-suave" title={`Pago em ${formatarData(item.pago_em)}`}>
                  pago em {formatarData(item.pago_em)}
                </span>

                <span className="whitespace-nowrap text-sm font-semibold text-[color:var(--vermelho)]">
                  {rotuloDias(item.dias_desde_pagamento)}
                </span>

                <Link
                  href={`/jornadas/${item.jornada_id}`}
                  className="self-start rounded-sm border border-[color:var(--vermelho)] bg-vermelho-fraco px-2.5 py-1 text-xs font-semibold text-[color:var(--vermelho)] hover:bg-transparent sm:ml-auto sm:self-auto"
                >
                  Contatar agora
                </Link>
              </li>
            ))}
          </ul>
        );
      }}
    </Bloco>
  );
}
