import type { ReactNode } from "react";
import { CORES_APRESENTACAO } from "./Apresentacao";

/**
 * O fundo escuro de tela cheia dos estados (carregando, erro, vazio) das
 * rotas de apresentação — antes copiado em seis lugares como
 * `bg-[#16171a]`, e já divergindo: a rota irmã do croqui antigo usa
 * `#0f1012` para o mesmo estado.
 *
 * A cor sai de `CORES_APRESENTACAO.fundo`, a mesma que a apresentação usa:
 * o estado de carregamento e o primeiro slide não podem ter fundos
 * diferentes, senão a tela pisca na frente da família.
 */
export function TelaCheiaApresentacao({ children }: { children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-8"
      style={{ background: CORES_APRESENTACAO.fundo, color: CORES_APRESENTACAO.tinta }}
    >
      {children}
    </div>
  );
}
