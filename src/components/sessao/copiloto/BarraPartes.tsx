import type { BlocoAtualResolvido } from "@/types/copiloto";

/**
 * Fase 12, Fatia 4 — a linha de comando vira ANDAMENTO das 13 partes. Substitui
 * o texto solto "Agora: <título>"/"ainda identificando…" que vivia em
 * `ConduzirSessaoApp.tsx::LinhaFinaRoteiro`. Fonte: `blocoAtualResolvido.indice`
 * — o MESMO campo que já resolve o `<select>` "Corrigir parte" e a frase
 * "Agora:" (a histerese que decide esse índice já está em produção, servida
 * pelo servidor; muda sozinha, este componente só lê).
 *
 * DENSO, SEM BARRA COLORIDA GRATUITA (regra da casa — Marcio quer denso e
 * chapado, hierarquia por POSIÇÃO/ALTURA, nunca card/cor decorativa):
 *  - Percorrida: `border-linha-forte` CHEIA.
 *  - Atual: cor `--latao` E 2px MAIS ALTA — hierarquia por altura/posição,
 *    não só por cor (um daltônico ou o telão a distância ainda vê QUAL
 *    segmento é maior).
 *  - Restante: `border-linha` vazada (contorno, sem preenchimento).
 *
 * DECISÃO DO DONO (padrão assumido, reversível — documentar aqui se um dia
 * mudar): "percorrido" = `índice < atual`, rotulado como POSIÇÃO
 * ("04 de 13"), NUNCA como "4 cobertas" ou "4 concluídas" — a conversa pode
 * ter pulado partes (a advogada corrige pelo `<select>`, o roteiro nem
 * sempre anda em ordem estrita), então "percorrida" aqui é só "índice menor
 * que o atual na numeração do roteiro", não uma alegação de que aquele
 * bloco foi de fato coberto. Nunca "no ritmo"/tempo: não existe denominador
 * de tempo (a sessão não tem duração-alvo por parte).
 *
 * `origem === "indisponivel"`: os 13 segmentos ficam TODOS vazados (nenhum
 * "percorrido", nenhum "atual" — inventar uma posição seria dado inventado,
 * CLAUDE.md) e o rótulo é "— de 13", nunca "parte 0" — trava do plano:
 * `origem === "indisponivel"` ou `bloco_id === null` NUNCA vira "Parte 0",
 * índice inválido virando 0 seria dado inventado (regra que vivia isolada em
 * `rotuloBlocoAtual`, `ConduzirSessaoApp.tsx`, removida por ter ficado sem
 * chamador — esta é agora a única leitura desse índice).
 *
 * Segmentos NÃO são botões nem têm `onClick`: alvo de toque de 13px seria
 * repetir a lição do "link de 11px" (achado registrado desta base) — um
 * clique acidental no telão fixaria o bloco errado por até 300s no
 * servidor (`fixacao_expira_em`). O único controle de correção continua
 * sendo o `<select>` "Corrigir parte" (`CorrigirParte`, no mesmo arquivo).
 *
 * Altura fixa, sem animação (teto de 2 animações da onda já está esgotado
 * por `CardRecente` e o último turno da transcrição — nenhuma nova aqui).
 */
export function BarraPartes({
  resolvido,
  totalBlocos,
}: {
  resolvido: BlocoAtualResolvido | null;
  /** `estado.roteiro.definicao.blocos.length` — o total real do roteiro
   * ativo, nunca hardcoded a 13 apesar do nome da fatia (o roteiro em uso
   * hoje tem 13 blocos, mas o componente não deve quebrar se um roteiro
   * futuro tiver outro total). */
  totalBlocos: number;
}) {
  const indisponivel = !resolvido || resolvido.origem === "indisponivel" || resolvido.indice === null;
  const indiceAtual = indisponivel ? null : resolvido!.indice;

  const rotulo = indisponivel
    ? `— de ${totalBlocos}`
    : `${String((indiceAtual as number) + 1).padStart(2, "0")} de ${totalBlocos}`;

  // O título vem por extenso do roteiro ativo ("PARTE 01 — Os 4 SIMs") — não
  // é cortado aqui: truncar o prefixo "PARTE NN —" duplicaria a MESMA
  // informação que a numeração da barra já dá, mas na prática o roteiro real
  // usa esse prefixo como parte do nome oficial do bloco (é como a advogada
  // reconhece o bloco em qualquer outro lugar do sistema) — cortar seria
  // inventar uma 2ª forma de nomear a mesma coisa.
  const rotuloTitulo = !indisponivel && resolvido?.titulo ? ` · ${resolvido.titulo}` : "";

  return (
    <div className="flex min-w-0 shrink-0 flex-col gap-1">
      <p className="min-w-0 truncate text-legenda font-medium text-tinta-suave">
        <span aria-hidden="true">{rotulo}</span>
        {rotuloTitulo && <span aria-hidden="true">{rotuloTitulo}</span>}
        <span className="sr-only">
          {indisponivel ? "posição na sessão ainda não identificada" : `parte ${(indiceAtual as number) + 1} de ${totalBlocos}`}
        </span>
      </p>
      {/* Segmentos: nunca botões — só leitura. `role="img"`/`aria-hidden` no
       * contêiner porque o rótulo textual acima já carrega a informação por
       * extenso (incluindo a versão `sr-only`); repetir "segmento 1, segmento
       * 2..." por segmento seria ruído para leitor de tela. */}
      <div aria-hidden="true" className="flex h-2 items-end gap-0.5">
        {Array.from({ length: totalBlocos }, (_, i) => {
          const ehAtual = !indisponivel && i === indiceAtual;
          const ehPercorrido = !indisponivel && indiceAtual !== null && i < indiceAtual;
          return (
            <span
              key={i}
              className={
                ehAtual
                  ? "h-2 w-2.5 shrink-0 rounded-[1px] border border-[color:var(--latao)] bg-[color:var(--latao)]"
                  : ehPercorrido
                    ? "h-1.5 w-2.5 shrink-0 self-end rounded-[1px] border border-linha-forte bg-linha-forte"
                    : "h-1.5 w-2.5 shrink-0 self-end rounded-[1px] border border-linha bg-transparent"
              }
            />
          );
        })}
      </div>
    </div>
  );
}

