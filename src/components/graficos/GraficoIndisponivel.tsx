import { PALETA_GRAFICO } from "./paleta";
import type { GraficoBaseProps, ItemFaltante } from "./tipos";

interface GraficoIndisponivelProps extends Pick<GraficoBaseProps, "tema" | "modoApresentacao" | "className"> {
  /** Título do gráfico que faltou nascer, ex.: "Composição patrimonial". */
  titulo: string;
  /** O que falta, item a item — nome do campo em português. Regra dura:
   * gráfico só existe se o dado existir; isto é o que diz por que não existe. */
  itensFaltantes: ItemFaltante[];
}

/**
 * O componente mais importante da lista (instrução do agente C). Ocupa a
 * mesma moldura de um gráfico real — nem maior, nem menor, para o layout da
 * Ficha 360 e do Modo Apresentação nunca "pular" quando o dado chega depois.
 *
 * Cor explícita por `tema`, igual à `Moldura` e ao SVG dos outros 7 gráficos
 * (§3.5 da arquitetura): se este card dependesse do `.dark` ambiente, ele
 * apareceria claro dentro do Modo Apresentação (fundo fixo escuro) sempre que
 * a tela em volta não tivesse alternado o tema global — exatamente o "detalhe
 * pequeno" que a arquitetura avisa que produz gráfico (aqui, estado vazio)
 * incoerente na apresentação.
 *
 * Nunca escrito como mensagem de erro (isto não é uma falha do sistema) —
 * é um estado normal e esperado: a família ainda não trouxe aquele dado.
 */
export function GraficoIndisponivel({ titulo, itensFaltantes, tema = "claro", modoApresentacao = false, className = "" }: GraficoIndisponivelProps) {
  if (modoApresentacao) return null;

  const cores = PALETA_GRAFICO[tema];

  return (
    <div
      role="status"
      aria-label={`Gráfico "${titulo}" ainda não pode ser desenhado — dado incompleto.`}
      className={`flex min-h-[220px] flex-col justify-center gap-3 rounded-controle border border-dashed px-5 py-6 ${className}`}
      style={{ borderColor: cores.linhaForte, background: cores.superficieElevada }}
    >
      <div className="flex items-start gap-2.5" style={{ color: cores.tintaSuave }}>
        <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 fill-current">
          <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h11A1.5 1.5 0 0 1 17 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15.5v-11Zm2 2v7h10v-7H5Zm2 1.5h2v4H7v-4Zm4 1.5h2v2.5h-2V9.5Z" />
        </svg>
        <div>
          <p className="font-medium" style={{ color: cores.tinta }}>
            {titulo} — ainda sem dado suficiente
          </p>
          <p className="text-sm">Este gráfico aparece assim que a informação abaixo estiver preenchida.</p>
        </div>
      </div>
      <ul className="flex flex-col gap-1.5 border-t pt-3 text-sm" style={{ borderColor: cores.linha }}>
        {itensFaltantes.map((item) => (
          <li key={item.campo} className="flex items-baseline gap-2">
            <span aria-hidden="true" style={{ color: cores.tintaFraca }}>
              ·
            </span>
            <span style={{ color: cores.tinta }}>{item.campo}</span>
            {item.onde && <span style={{ color: cores.tintaFraca }}>— {item.onde}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
