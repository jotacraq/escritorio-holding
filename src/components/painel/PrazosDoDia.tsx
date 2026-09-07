import Link from "next/link";
import { Bloco, LinhaFila } from "./Bloco";
import { LinkBotao } from "@/components/ui/LinkBotao";
import { Prazo } from "@/components/ui/Prazo";
import { classificarPrazo } from "@/lib/estados/catalogo";
import { rotulo } from "@/lib/vocabulario";
import type { EstadoBloco } from "@/types/painel-ui";
import type { PrazoAberto } from "./dadosDeUrgencia";

/**
 * Bloco de **Prazos** (Fase 8, §B3/D18 e item 8 da pesquisa).
 *
 * No Astrea, no ADVBOX e no PJe a data-limite não se mistura com o status do
 * andamento: é a informação que o advogado procura primeiro e a que tem
 * destaque próprio. Até a Fase 7 o SIC-HF criava tarefas com `vence_em`
 * (0051, 0085) e **nenhuma tela mostrava a data** — a tarefa só aparecia
 * dentro da Ficha de quem já tinha aberto a Ficha.
 *
 * Cada linha diz três coisas na ordem em que se decide: quanto falta
 * (`ui/Prazo`, vermelho vencido · âmbar hoje/em breve · neutro no prazo), de
 * quem é o processo, e o botão que resolve. Tarefa de sistema sem processo
 * ligado não vira link inventado — fica texto.
 */

/** Vencido e "vence hoje" primeiro; sem prazo por último. */
function ordenar(itens: PrazoAberto[], agora: Date): PrazoAberto[] {
  const peso = (p: PrazoAberto) => {
    const classe = classificarPrazo(p.vence_em, agora);
    return classe === "vencido" ? 0 : classe === "hoje" ? 1 : classe === "proximo" ? 2 : classe === "futuro" ? 3 : 4;
  };
  return [...itens].sort((a, b) => peso(a) - peso(b) || (a.vence_em ?? "9999").localeCompare(b.vence_em ?? "9999"));
}

/** `true` quando há pelo menos um prazo vencido ou vencendo hoje. */
export function haPrazoUrgente(itens: readonly PrazoAberto[], agora: Date = new Date()): boolean {
  return itens.some((p) => {
    const classe = classificarPrazo(p.vence_em, agora);
    return classe === "vencido" || classe === "hoje";
  });
}

export function PrazosDoDia({
  estado,
  agora,
  aoTentarDeNovo,
}: {
  estado: EstadoBloco<PrazoAberto>;
  /** Injetável para a captura e o teste não dependerem do relógio. */
  agora?: Date;
  aoTentarDeNovo: () => void;
}) {
  const referencia = agora ?? new Date();
  return (
    <Bloco
      id="prazos"
      rotulo={rotulo("prazo")}
      titulo="Prazos abertos"
      dica="Toda tarefa em aberto com data-limite: cobrança de boleto, montagem do croqui, envio de link. Vencido e vencendo hoje vêm primeiro."
      mensagemNadaPendente="Nenhum prazo em aberto."
      estado={estado}
      urgente={estado.situacao === "ok" && haPrazoUrgente(estado.itens, referencia)}
      aoTentarDeNovo={aoTentarDeNovo}
    >
      {(itens) => (
        <ul className="divide-y divide-linha">
          {ordenar(itens, referencia).map((item) => (
            <LinhaFila key={item.id}>
              {/* O prazo vem ANTES do nome: é ele que decide a ordem de
                  atendimento, e é o que o advogado procura na varredura. */}
              <Prazo vence={item.vence_em} rotulo={rotulo("prazo")} agora={agora} className="shrink-0" />

              <div className="min-w-0 sm:flex-1">
                <p className="truncate text-sm font-bold text-tinta" title={item.descricao ?? undefined}>
                  {item.titulo}
                </p>
                {item.nome && (
                  <p className="truncate text-legenda text-tinta-suave">
                    {item.jornada_id ? (
                      <Link href={`/jornadas/${item.jornada_id}`} className="hover:text-[color:var(--latao)] hover:underline">
                        {item.nome}
                      </Link>
                    ) : (
                      item.nome
                    )}
                  </p>
                )}
              </div>

              {item.jornada_id ? (
                <LinkBotao href={`/jornadas/${item.jornada_id}`} className="sm:ml-auto">
                  Abrir o {rotulo("processo").toLowerCase()}
                </LinkBotao>
              ) : (
                <span className="text-legenda text-tinta-fraca sm:ml-auto">Sem cliente ligado</span>
              )}
            </LinhaFila>
          ))}
        </ul>
      )}
    </Bloco>
  );
}
