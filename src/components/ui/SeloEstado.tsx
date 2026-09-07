import { ESTADO_SEM_INFORMACAO, estadoDe, type DominioEstado, type TomEstado } from "@/lib/estados/catalogo";
import { IconeEstado } from "@/lib/estados/icones";

/**
 * O ÚNICO selo de status do sistema (Fase 8, D19).
 *
 * Recebe o domínio e o valor **cru do banco** e vai buscar rótulo, glifo e tom
 * no catálogo (`lib/estados/catalogo.ts`). Não existe prop de cor nem de
 * rótulo: se a tela pudesse escolher, "reembolsado" voltaria a ser âmbar numa
 * tela e vermelho na outra, que é o que esta fase veio consertar.
 *
 * Três regras que o componente torna impossíveis de violar:
 *  1. **cor + ícone + rótulo, nunca só cor** — o glifo e o texto vêm sempre
 *     juntos, e o glifo é único dentro do domínio (o que sobra em grayscale);
 *  2. **contraste ≥ 7:1** — o tom de texto é `--estado-*`, medido, não
 *     `--verde`/`--ambar` (que medem 4,5–6:1 e são AA, não AAA);
 *  3. **vazio é vazio** — chave que o catálogo não conhece vira "Sem
 *     informação", nunca um rótulo plausível inventado.
 *
 * Não é um controle: é indicador. Por isso não tem alvo de 44px nem foco —
 * quem clica é o cartão/linha em volta.
 *
 * ```tsx
 * <SeloEstado dominio="croqui" estado={fase} />
 * <SeloEstado dominio="pagamento" estado={pagamento.status} anunciar />
 * ```
 */

const TONS: Record<TomEstado, string> = {
  verde: "bg-verde-fraco text-[color:var(--estado-verde)] border-transparent",
  ambar: "bg-ambar-fraco text-[color:var(--estado-ambar)] border-transparent",
  vermelho: "bg-vermelho-fraco text-[color:var(--estado-vermelho)] border-transparent",
  azul: "bg-azul-fraco text-[color:var(--estado-azul)] border-transparent",
  latao: "bg-latao-fraco text-[color:var(--estado-latao)] border-transparent",
  neutro: "bg-papel text-[color:var(--estado-neutro)] border-linha-forte",
};

export interface SeloEstadoProps {
  /** Qual dicionário do catálogo consultar. */
  dominio: DominioEstado;
  /** O valor como está no banco (`aprovado`, `congelada`, `nao_compareceu`…). */
  estado: string | null | undefined;
  /**
   * `true` = a troca deste selo é assíncrona (webhook, salvamento) e precisa
   * ser ANUNCIADA a quem usa leitor de tela (`role="status"`, item 10 da
   * pesquisa). Selo que já nasce na tela com a página **não** leva: seria uma
   * região viva anunciando algo que ninguém mudou.
   */
  anunciar?: boolean;
  /**
   * `false` esconde o selo quando o estado é desconhecido, em vez de mostrar
   * "Sem informação". Use só onde a ausência já está dita em outro lugar.
   */
  mostrarDesconhecido?: boolean;
  /** Detalhe extra no `title`, depois da explicação do catálogo. */
  detalhe?: string;
  className?: string;
}

export function SeloEstado({
  dominio,
  estado,
  anunciar = false,
  mostrarDesconhecido = true,
  detalhe,
  className = "",
}: SeloEstadoProps) {
  const definicao = estadoDe(dominio, estado);
  if (!definicao && !mostrarDesconhecido) return null;
  const { rotulo, icone, tom, explique } = definicao ?? ESTADO_SEM_INFORMACAO;
  const title = [explique, detalhe].filter(Boolean).join(" · ") || undefined;

  return (
    <span
      role={anunciar ? "status" : undefined}
      title={title}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-legenda font-medium leading-tight ${TONS[tom]} ${className}`}
    >
      <IconeEstado nome={icone} className="h-3.5 w-3.5" />
      <span className="truncate">{rotulo}</span>
    </span>
  );
}
