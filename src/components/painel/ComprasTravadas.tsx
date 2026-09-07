import Link from "next/link";
import { Bloco, LinhaFila } from "./Bloco";
import { LinkBotao } from "@/components/ui/LinkBotao";
import { SeloEstado } from "@/components/ui/SeloEstado";
import { formatarRelativo } from "@/lib/formatar";
import { rotulo } from "@/lib/vocabulario";
import type { EstadoBloco } from "@/types/painel-ui";
import type { CompraDoProcesso } from "./dadosDeUrgencia";

/**
 * Bloco de **compras travadas** — o buraco que a Fase 8 abriu na frente A
 * fechou no banco e que nenhuma tela mostrava.
 *
 * Até aqui, um reembolso ou um chargeback mudava o estado em `pagamentos`,
 * escrevia o andamento e criava a tarefa — e o painel do dia continuava
 * dizendo que estava tudo certo. "Trava e avisa" (D6) só vale se alguém for
 * avisado.
 *
 * Duas severidades, com o tom vindo do catálogo (nunca escolhido aqui):
 *  - **revertido** (`cancelado`/`reembolsado`/`estornado`) — o dinheiro voltou:
 *    o processo não avança mais por aquele produto até o pagamento voltar a
 *    constar como aprovado;
 *  - **aguardando dinheiro** (`boleto_gerado`/`expirado`/`atrasado`) — o boleto
 *    saiu e não entrou. Não fecha o processo por si só (B49): vira cobrança.
 *
 * A etapa **não** regride e nada é apagado (D6/B48). Este bloco é o aviso, e o
 * botão leva para onde a decisão é tomada.
 */

function ordenar(itens: CompraDoProcesso[]): CompraDoProcesso[] {
  // Dinheiro que voltou antes de dinheiro que não entrou; dentro de cada
  // grupo, o evento mais recente primeiro (é o que ainda está quente).
  const peso = (c: CompraDoProcesso) => (c.revertido ? 0 : 1);
  return [...itens].sort((a, b) => peso(a) - peso(b) || (b.evento_em ?? "").localeCompare(a.evento_em ?? ""));
}

export function ComprasTravadas({
  estado,
  aoTentarDeNovo,
}: {
  estado: EstadoBloco<CompraDoProcesso>;
  aoTentarDeNovo: () => void;
}) {
  const temReversao = estado.situacao === "ok" && estado.itens.some((c) => c.revertido);
  return (
    <Bloco
      id="compras-travadas"
      rotulo="Pagamento"
      titulo="Compra travada"
      dica="Compra cancelada, reembolsada ou estornada, e boleto que saiu e não entrou. Nada é apagado: a etapa e o histórico continuam como estão — o que trava é o avanço para o produto seguinte."
      mensagemNadaPendente="Nenhuma compra travada."
      estado={estado}
      urgente={temReversao}
      aoTentarDeNovo={aoTentarDeNovo}
    >
      {(itens) => (
        <ul className="divide-y divide-linha">
          {ordenar(itens).map((compra) => {
            const nome = compra.nome ?? null;
            return (
              <LinhaFila key={`${compra.jornada_id}-${compra.produto_tipo ?? "produto"}`}>
                <SeloEstado
                  dominio="pagamento"
                  estado={compra.status}
                  detalhe={compra.evento_hotmart ? `evento ${compra.evento_hotmart}` : undefined}
                  className="shrink-0"
                />

                <div className="min-w-0 sm:flex-1">
                  <p className="truncate text-sm font-bold text-tinta">
                    {nome ? (
                      <Link href={`/jornadas/${compra.jornada_id}`} className="hover:text-[color:var(--latao)] hover:underline">
                        {nome}
                      </Link>
                    ) : (
                      // Sem o nome na mão, o processo é o que se pode dizer com
                      // verdade — nunca um nome plausível.
                      <span className="text-tinta-suave">{rotulo("processo")} sem nome carregado</span>
                    )}
                  </p>
                  <p className="truncate text-legenda text-tinta-suave">{compra.produto_nome ?? "Produto não identificado"}</p>
                </div>

                {compra.evento_em && (
                  <span className="whitespace-nowrap text-legenda text-tinta-fraca">{formatarRelativo(compra.evento_em)}</span>
                )}

                <LinkBotao
                  href={`/jornadas/${compra.jornada_id}`}
                  variante={compra.revertido ? "cta" : "secundario"}
                  className="sm:ml-auto"
                >
                  {compra.revertido ? "Decidir o desfecho" : "Cobrar"}
                </LinkBotao>
              </LinhaFila>
            );
          })}
        </ul>
      )}
    </Bloco>
  );
}
