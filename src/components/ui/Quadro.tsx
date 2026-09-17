import type { HTMLAttributes, ReactNode } from "react";

/** Cor só onde significa ALERTA (decisão final do Marcio, 14/09, revendo
 * a proposta anterior de 5 tons por natureza do bloco): medido de novo —
 * `roxo` e `azul` renderizavam a MESMA `var(--azul)` variando só a opacidade
 * do fundo, e `ambar` marcava dois quadros diferentes (5 e 6) sem
 * diferenciá-los. Cinco tons produzindo quatro cores, duas indistinguíveis,
 * não é taxonomia — é decoração. `TomQuadro` estreita para `"ambar" |
 * "vermelho"`: só o quadro 2 (Alerta) e o quadro 7 quando `!acertou` mantêm
 * cor; os quadros 1, 3, 4, 5, 6 e o 7 quando `acertou` ficam sem `tom`
 * (chapados, `--papel-elevado`). Nenhuma informação se perde: todo quadro
 * já tem número + ícone + rótulo por extenso, que é quem carrega o
 * significado — a borda era sempre reforço, nunca sinal único.
 * `bg-*-fraco/40` (fundo tingido) removido: não estava na instrução do mock
 * e é mais enfeite do que a borda fina. Quadro é branco/`--papel-elevado`,
 * ponto — mesmo padrão do `Cartao`. */
export type TomQuadro = "ambar" | "vermelho";

const CORES_TOM: Record<TomQuadro, string> = {
  vermelho: "border-l-[color:var(--vermelho)]",
  ambar: "border-l-[color:var(--ambar)]",
};

interface QuadroProps extends HTMLAttributes<HTMLElement> {
  /** Rótulo do quadro — nome do bloco, não título de marca. `ReactNode` (não
   * só `string`) desde F4 (17/09): o mosaico do Copiloto precisa compor
   * "Fale agora" (peso) + "· 2 novas" (tom mais claro) no MESMO rótulo, sem
   * duas cores concorrendo por igual — `string` continua funcionando sem
   * mudança nos ~30 outros chamadores fora do Copiloto. */
  rotulo: ReactNode;
  /** Ação curta à direita do rótulo (selo, contagem) — nunca um botão decorado. */
  acao?: ReactNode;
  /** `article` para item de uma lista de quadros; `section` (default) para quadro autocontido. */
  como?: "section" | "article" | "div";
  /** Número de ordem do mosaico do Copiloto ("1.", "2."…) — pedido do
   * Marcio (mock): a hierarquia de leitura é por posição E por número
   * visível junto do rótulo, nunca só posição. Ausente = quadro sem número
   * (o resto do sistema, fora do Copiloto). */
  numero?: number;
  /** Ícone pequeno (SVG 16×16, `aria-hidden`) antes do rótulo — reforço
   * visual do tipo do quadro, NUNCA o único sinal (o texto do rótulo já
   * diz "ALERTA", "INSIGHT COMERCIAL" etc. por extenso). */
  icone?: ReactNode;
  /** Borda lateral fina + fundo levemente tingido por NATUREZA do quadro —
   * ver `TomQuadro`. Ausente = quadro chapado de sempre (default de todo o
   * resto do sistema, fora do mosaico do Copiloto). */
  tom?: TomQuadro;
  /** Pedido do Marcio (14/09, redesenho de largura cheia): quadro SEM
   * conteúdo (ex.: "Nada específico registrado", "este dado não existe hoje
   * no sistema") não pode ocupar espaço nobre da primeira dobra como um
   * cartão de ~80px. `recolhido=true` faz o MESMO quadro (número, ícone,
   * rótulo, stub — nada é removido, nada é inventado) caber numa linha fina
   * de ~40px: rótulo + texto do stub na mesma linha, sem o padding vertical
   * do card cheio. Continua sendo o mesmo elemento com o mesmo conteúdo —
   * só a apresentação muda quando não há nada a destacar. */
  recolhido?: boolean;
  children?: ReactNode;
}

/**
 * Quadro chapado — a unidade visual do painel denso de condução de sessão
 * (`/sessoes/[id]/conduzir`, pedido do Marcio, 11-14/09: "tela única, todas
 * as informações à mostra, modelo do Juliano" — referência: borda fina,
 * rótulo pequeno maiúsculo cinza, conteúdo direto, sem sombra, sem
 * gradiente, sem `border-l-4` colorida).
 *
 * 🔴 CORREÇÃO (F4, 17/09) — "sem ícone decorativo" foi REVOGADO pelo dono na
 * mesma sessão que revogou B71: "ícones como AFFORDANCE em botões/
 * cabeçalhos são desejados por ele". `icone` deixa de ser proibido — é
 * SVG 16×16 `aria-hidden`, reforço visual do tipo do quadro, nunca o único
 * sinal (o rótulo por extenso continua carregando o significado). Denso e
 * chapado continua valendo para o resto (sem sombra/gradiente/borda
 * decorativa) — só o veto ao ícone caiu.
 *
 * Deliberadamente DISTINTO de `Cartao`: `Cartao` é a superfície padrão do
 * resto do sistema (sombra marrom, raio grande, realce lateral colorido) —
 * `Quadro` NUNCA usa `shadow-cartao` nem `realce`. Não é upgrade nem
 * substituto de `Cartao`; é o vocabulário de UMA tela específica, a tela
 * que o Marcio pediu "direta, objetiva, sem enfeite, como sistema
 * tradicional". Não usar fora de `/sessoes/[id]/conduzir`.
 *
 * Cor só onde significa: o rótulo do quadro é sempre `text-tinta-fraca`,
 * nunca colorido — quem carrega cor é o CONTEÚDO (um selo de alerta, uma
 * observação âmbar), nunca o wrapper.
 */
export function Quadro({ rotulo, acao, como = "section", numero, icone, tom, recolhido = false, className = "", children, ...props }: QuadroProps) {
  const Tag = como;
  const corTom = tom ? CORES_TOM[tom] : "border-l-transparent";

  if (recolhido) {
    return (
      <Tag
        className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-controle border border-l-2 border-linha bg-papel-elevado px-3 py-2 ${corTom} ${className}`}
        {...props}
      >
        <p className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-tinta">
          {icone}
          {typeof numero === "number" && <span aria-hidden="true">{numero}.</span>}
          {rotulo}
        </p>
        <div className="min-w-0 flex-1 text-sm text-tinta-suave [&_p]:truncate">{children}</div>
        {acao}
      </Tag>
    );
  }

  return (
    <Tag
      className={`flex flex-col gap-2 rounded-controle border border-l-2 border-linha bg-papel-elevado p-3 ${corTom} ${className}`}
      {...props}
    >
      <div className="flex items-center justify-between gap-2">
        {/* F4 (17/09) — rótulo sobe para `text-sm font-semibold text-tinta`
         * (era `text-rotulo font-semibold text-tinta-fraca`, caixa alta
         * pequena e apagada — o mosaico é a tela principal, não uma seção de
         * apoio). `icone` 16px é a AFFORDANCE pedida pelo dono. */}
        <p className="flex items-center gap-1.5 text-sm font-semibold text-tinta">
          {icone}
          {typeof numero === "number" && <span aria-hidden="true">{numero}.</span>}
          {rotulo}
        </p>
        {acao}
      </div>
      {children}
    </Tag>
  );
}
