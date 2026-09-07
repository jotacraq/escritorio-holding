import { Prazo } from "@/components/ui/Prazo";
import { classificarPrazo } from "@/lib/estados/catalogo";
import { rotulo } from "@/lib/vocabulario";
import type { Tarefa } from "@/types/banco";

/**
 * **O que falta e quando vence**, em uma linha, no topo da Ficha.
 *
 * A Ficha já sabia das tarefas abertas (`ficha.tarefasAbertas`, desde a Fase 4)
 * e não mostrava nenhuma: elas só apareciam dentro do cartão específico que as
 * criou — a de croqui na sessão do croqui, a de cobrança em lugar nenhum. Quem
 * abria a Ficha para decidir o que fazer não via a data-limite de nada.
 *
 * A partir da 0085 isso passou a doer de verdade: reembolso, chargeback e
 * boleto vencido criam tarefa com `vence_em`. Se a Ficha não mostra o prazo, o
 * "trava e avisa" (D6) avisa só o banco.
 *
 * É uma linha, não um cartão: prazo é sinal, não conteúdo. Vencido e vencendo
 * hoje vêm primeiro; o resto segue a data. Sem tarefa aberta, o componente não
 * desenha nada — silêncio é a boa notícia, e ela já está no trilho.
 */

const PESO: Record<string, number> = { vencido: 0, hoje: 1, proximo: 2, futuro: 3, sem_prazo: 4 };

export function PrazosDaFicha({ tarefas, agora }: { tarefas: readonly Tarefa[]; agora?: Date }) {
  if (tarefas.length === 0) return null;
  const referencia = agora ?? new Date();
  const ordenadas = [...tarefas].sort(
    (a, b) =>
      PESO[classificarPrazo(a.vence_em, referencia)] - PESO[classificarPrazo(b.vence_em, referencia)] ||
      (a.vence_em ?? "9999").localeCompare(b.vence_em ?? "9999"),
  );

  return (
    <section
      aria-labelledby="prazos-da-ficha"
      className="flex min-h-11 flex-wrap items-center gap-x-item gap-y-1 rounded-cartao border border-linha bg-papel-elevado px-3 py-1.5"
    >
      <h2 id="prazos-da-ficha" className="text-sm font-bold text-tinta">
        {rotulo("prazo")}
        {ordenadas.length > 1 ? "s" : ""} em aberto
      </h2>
      <ul className="flex min-w-0 flex-wrap items-center gap-x-item gap-y-1">
        {ordenadas.map((tarefa) => (
          <li key={tarefa.id} className="flex min-w-0 items-center gap-2">
            <Prazo vence={tarefa.vence_em} rotulo={tarefa.titulo} agora={agora} />
            <span className="truncate text-sm text-tinta-suave" title={tarefa.descricao ?? undefined}>
              {tarefa.titulo}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
