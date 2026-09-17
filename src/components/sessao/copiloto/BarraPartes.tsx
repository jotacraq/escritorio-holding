"use client";

import type { BlocoAtualResolvido } from "@/types/copiloto";
import { useRealceUmaVez } from "./useRealceUmaVez";

const IconeLista = () => (
  <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-tinta-fraca" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5.5 4h7M5.5 8h7M5.5 12h7M2.5 4h.01M2.5 8h.01M2.5 12h.01" />
  </svg>
);

/**
 * Fase 12, Fatia 4 — a linha de comando vira ANDAMENTO das 13 partes. Substitui
 * o texto solto "Agora: <título>"/"ainda identificando…" que vivia em
 * `ConduzirSessaoApp.tsx::LinhaFinaRoteiro`. Fonte: `blocoAtualResolvido.indice`
 * — o MESMO campo que já resolve o `<select>` "Corrigir parte" e a frase
 * "Agora:" (a histerese que decide esse índice já está em produção, servida
 * pelo servidor; muda sozinha, este componente só lê).
 *
 * 🔴 CORREÇÃO (F1, 17/09) — o desenho anterior desenhava segmentos VAZADOS
 * (`bg-transparent`, `border-linha` #e7e2dc sobre branco = 1,29:1): invisível
 * por construção, com "vazio no meio da linha" — é o defeito que o dono
 * circulou na captura de tela. Vira PÍLULAS num TRILHO DE LARGURA FIXA
 * (`w-[13rem]`, `flex`, cada pílula `flex-1`): a largura do trilho nunca
 * varia com `totalBlocos`, então a barra nunca "some" visualmente por
 * segmentos finos demais. Percorrida `bg-[color:var(--acento,var(--latao))]`;
 * restante `bg-[color:var(--acento-trilho,var(--linha))]` — chapado, sem
 * contorno vazado. `items-end`/altura maior no ATUAL é a 2ª diferença NÃO
 * cromática (hierarquia por altura/posição, não só cor — um daltônico ou o
 * telão a distância ainda vê qual segmento é maior).
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
 * F7 — "sistema vivo": quando o índice ATUAL muda (`key={indiceAtual}` no
 * trilho, `key={i}` mantida por segmento), a pílula que passa a ser "atual"
 * ganha `anim-preencher-pilula` (background-color, 300ms — nunca largura) e
 * o rótulo troca por crossfade (`key={indiceAtual}` no texto). O próprio
 * trilho recebe `anim-decair-destaque-curta` (1,5s) na troca — via
 * `useRealceUmaVez(…, 1500)`, o MESMO hook de todos os gatilhos da tela, que
 * SOLTA a classe ao fim da duração.
 *
 * 🔴 CORREÇÃO (Fable, 17/09, 3ª rodada): a classe estava PERMANENTE no
 * `className` (o "reinício" vinha só da `key`, remontando o trilho). Com o
 * bloco estático de `prefers-reduced-motion` em `globals.css` — que pinta
 * fundo/borda ENQUANTO a classe existir, para "a cor trocar sem animar" —
 * o trilho ficaria verde-claro fixo do primeiro render ao fim da sessão:
 * um sinal "preso" que nunca sinaliza mudança nenhuma. Agora a classe só
 * existe por 1,5s por troca de parte, nos dois modos de motion. Casar
 * 1500 ↔ `1.5s` é o contrato do hook. Nenhuma classe daqui carrega
 * `role`/`aria-live` (o `sr-only` abaixo já cobre o anúncio).
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

  // Chave = a posição atual; "indisponivel" nunca acende (não há mudança de
  // parte a sinalizar — e acender aqui seria inventar um evento).
  const destacarTrilho = useRealceUmaVez(!indisponivel, `trilho-${indiceAtual ?? "indisponivel"}`, 1500);

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
    <div className="flex min-w-0 shrink-0 items-center gap-2">
      <IconeLista />
      <div className="flex min-w-0 flex-col gap-1">
        <p key={`rotulo-${indiceAtual ?? "indisponivel"}`} className="min-w-0 truncate text-sm font-semibold text-tinta anim-esmaecer">
          <span aria-hidden="true" className="tabular-nums">
            {rotulo}
          </span>
          {rotuloTitulo && (
            <span aria-hidden="true" className="font-normal text-tinta-suave">
              {rotuloTitulo}
            </span>
          )}
          <span className="sr-only">
            {indisponivel ? "posição na sessão ainda não identificada" : `parte ${(indiceAtual as number) + 1} de ${totalBlocos}`}
          </span>
        </p>
        {/* Trilho de largura FIXA — nunca "some" por segmentos finos demais
         * (o defeito relatado). Segmentos: nunca botões — só leitura.
         * `aria-hidden` no contêiner porque o rótulo textual acima já carrega
         * a informação por extenso (incluindo a versão `sr-only`); repetir
         * "segmento 1, segmento 2..." por segmento seria ruído para leitor de
         * tela. A classe de destaque só existe enquanto `destacarTrilho` —
         * nunca permanente (ver correção do Fable no docblock). */}
        <div
          key={`trilho-${indiceAtual ?? "indisponivel"}`}
          aria-hidden="true"
          className={`flex h-1.5 w-[13rem] items-end gap-[3px]${destacarTrilho ? " anim-decair-destaque-curta" : ""}`}
        >
          {Array.from({ length: totalBlocos }, (_, i) => {
            const ehAtual = !indisponivel && i === indiceAtual;
            const ehPercorrido = !indisponivel && indiceAtual !== null && i < indiceAtual;
            return (
              <span
                key={i}
                className={
                  ehAtual
                    ? "h-2.5 flex-[1.6] shrink-0 self-end rounded-full bg-[color:var(--acento,var(--latao))] anim-preencher-pilula"
                    : ehPercorrido
                      ? "h-1.5 flex-1 shrink-0 self-end rounded-full bg-[color:var(--acento,var(--latao))]"
                      : "h-1.5 flex-1 shrink-0 self-end rounded-full bg-[color:var(--acento-trilho,var(--linha))]"
                }
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
