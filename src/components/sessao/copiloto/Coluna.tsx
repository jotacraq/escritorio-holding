import type { HTMLAttributes, ReactNode } from "react";

/**
 * A CÉLULA de cada uma das 3 colunas do mosaico de `PainelCopiloto.tsx`
 * (Fale agora / Cuidado / Transcrição·Inventário) — carrega a cadeia flex
 * inteira UMA vez, num só lugar, para a armadilha de geometria já registrada
 * três vezes nesta base ("`min-h-0` só funciona se um ancestral define a
 * altura") parar de bater arquivo por arquivo.
 *
 * 🔴 Achado do arquiteto (17/09, captura de tela do dono): a COL 1 (linha
 * ~227 de `PainelCopiloto.tsx`) tinha `flex min-h-0 flex-col` e funcionava;
 * a COL 3 (~252) era só `<div className="min-h-0">` — `display: block` por
 * default. Dentro de um container `block`, o `flex-1` de
 * `ColunaTranscricaoInventario` é INERTE (não existe flex context pai): o
 * filho cresce até caber o conteúdo inteiro e estoura o
 * `max-h-[calc(100vh-11rem)]` do avô, que não tem `overflow` para recortar —
 * a transcrição vazava por cima do rodapé "Encerrar copiloto desta sessão".
 *
 * `overflow-hidden` é a TRAVA DURA desta correção: um filho futuro que
 * esqueça o próprio `min-h-0` interno é RECORTADO por esta célula, nunca
 * empurra o rodapé para fora do viewport — o pior caso vira "conteúdo
 * cortado", nunca "layout quebrado". `min-w-0` cobre a mesma armadilha no
 * eixo X (nome de falante longo, célula de grid estreita).
 *
 * `className` extra é só para ajustes que não mudam a geometria de contenção
 * (ex.: `gap-2` da COL 1, que empilha `BlocoFaleAgora` + `PlacarConducao`).
 */
export function Coluna({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) {
  return (
    <div className={`flex min-h-0 min-w-0 flex-col overflow-hidden ${className}`} {...props}>
      {children}
    </div>
  );
}
