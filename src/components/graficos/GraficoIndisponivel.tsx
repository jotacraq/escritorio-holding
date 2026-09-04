import type { ItemFaltante } from "./tipos";

interface GraficoIndisponivelProps {
  /** Título do gráfico que faltou nascer, ex.: "Composição patrimonial". */
  titulo: string;
  /** O que falta, item a item — nome do campo em português. Regra dura:
   * gráfico só existe se o dado existir; isto é o que diz por que não existe. */
  itensFaltantes: ItemFaltante[];
  /** Modo Apresentação: com o cliente na frente, buraco rotulado não aparece —
   * o slide simplesmente não mostra o bloco de gráfico. */
  modoApresentacao?: boolean;
  className?: string;
}

/**
 * O componente mais importante da lista (instrução do agente C). Ocupa a
 * mesma moldura de um gráfico real — nem maior, nem menor, para o layout da
 * Ficha 360 e do Modo Apresentação nunca "pular" quando o dado chega depois.
 *
 * Nunca escrito como mensagem de erro (isto não é uma falha do sistema) —
 * é um estado normal e esperado: a família ainda não trouxe aquele dado.
 */
export function GraficoIndisponivel({ titulo, itensFaltantes, modoApresentacao = false, className = "" }: GraficoIndisponivelProps) {
  if (modoApresentacao) return null;

  return (
    <div
      role="status"
      aria-label={`Gráfico "${titulo}" ainda não pode ser desenhado — dado incompleto.`}
      className={`flex min-h-[220px] flex-col justify-center gap-3 rounded-sm border border-dashed border-linha-forte bg-papel-elevado px-5 py-6 ${className}`}
    >
      <div className="flex items-start gap-2.5 text-tinta-suave">
        <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 fill-current">
          <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h11A1.5 1.5 0 0 1 17 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15.5v-11Zm2 2v7h10v-7H5Zm2 1.5h2v4H7v-4Zm4 1.5h2v2.5h-2V9.5Z" />
        </svg>
        <div>
          <p className="font-medium text-tinta">{titulo} — ainda sem dado suficiente</p>
          <p className="text-sm">Este gráfico aparece assim que a informação abaixo estiver preenchida.</p>
        </div>
      </div>
      <ul className="flex flex-col gap-1.5 border-t border-linha pt-3 text-sm">
        {itensFaltantes.map((item) => (
          <li key={item.campo} className="flex items-baseline gap-2">
            <span aria-hidden="true" className="text-tinta-fraca">
              ·
            </span>
            <span className="text-tinta">{item.campo}</span>
            {item.onde && <span className="text-tinta-fraca">— {item.onde}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
