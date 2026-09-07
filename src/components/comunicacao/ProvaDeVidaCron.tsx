import Link from "next/link";
import { Selo } from "@/components/ui/Selo";
import { formatarDataHora, formatarRelativo } from "@/lib/formatar";
import { rotulo, titleDe } from "@/lib/vocabulario";
import type { EstadoRegua } from "./api-comunicacao";

const ICONE_CHECK = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 10.5l3.6 3.5 7.4-8" />
  </svg>
);

const ICONE_ALERTA = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 shrink-0 fill-current" >
    <path d="M10 1.5 19 17H1L10 1.5Zm0 5.4a1 1 0 0 0-1 1v3.4a1 1 0 1 0 2 0V7.9a1 1 0 0 0-1-1Zm0 7.2a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z" />
  </svg>
);

/**
 * Estado do envio automático — **só para o admin** (Fase 5 §9.1).
 *
 * A Fase 4 punha aqui um cartão com o comando `curl` do cron, o nome da
 * variável de ambiente e três passos de configuração, na segunda tela mais
 * lida do escritório. O que fazer continua existindo, mas onde se faz:
 * Admin → Integrações.
 *
 * Fase 8: **rodando e parado não podem ter o mesmo peso.** Quando a régua
 * está em dia, isto continua sendo uma linha discreta — é confirmação, e
 * confirmação que grita treina o time a fechar tudo sem ler. Quando ela
 * parou, deixa de ser um selo âmbar no meio de uma linha cinza e vira um
 * aviso com as três coisas que faltavam: o que está acontecendo, a
 * consequência (as mensagens da fila NÃO saem) e o botão que resolve.
 *
 * `role="alert"` só no estado ruim: uma região viva anunciando "rodando" a
 * cada carregamento seria ruído para quem usa leitor de tela.
 *
 * O pai já decide se renderiza (não-admin não monta este componente); a
 * checagem de papel não se repete aqui.
 */
export function ProvaDeVidaCron({ regua }: { regua: EstadoRegua }) {
  const { ultimo_cron_em: ultimo, cron_atrasado: atrasado } = regua;
  const emDia = Boolean(ultimo) && !atrasado;

  if (emDia) {
    return (
      <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-cartao border border-linha bg-papel px-5 py-3 text-sm text-tinta-suave">
        <span className="font-bold text-tinta" title={titleDe("envio_automatico")}>
          {rotulo("envio_automatico")}
        </span>
        <Selo tom="verde" icone={ICONE_CHECK}>
          Rodando
        </Selo>
        {ultimo && (
          <time dateTime={ultimo} title={formatarDataHora(ultimo)}>
            {formatarRelativo(ultimo)}
          </time>
        )}
        <Link href="/admin#integracoes" className="ml-auto inline-flex min-h-11 items-center font-medium text-[color:var(--latao)] underline-offset-2 hover:underline">
          Ver integrações
        </Link>
      </div>
    );
  }

  const nuncaRodou = !ultimo;

  return (
    <div
      role="alert"
      className="flex flex-col gap-item rounded-cartao border border-[color:var(--ambar)] bg-ambar-fraco px-cartao py-item sm:flex-row sm:items-center sm:gap-cartao"
    >
      <p className="flex min-w-0 flex-1 items-start gap-2 text-[color:var(--estado-ambar)]">
        <span className="mt-0.5">{ICONE_ALERTA}</span>
        <span>
          <strong className="block text-corpo font-bold" title={titleDe("envio_automatico")}>
            {nuncaRodou ? `${rotulo("envio_automatico")} nunca rodou` : `${rotulo("envio_automatico")} parado`}
          </strong>
          <span className="block text-sm">
            {nuncaRodou
              ? "Enquanto ele não rodar, nada da fila abaixo sai sozinho — nem os e-mails."
              : "As mensagens da fila abaixo não estão saindo sozinhas."}
            {ultimo && (
              <>
                {" Último envio "}
                <time dateTime={ultimo} title={formatarDataHora(ultimo)}>
                  {formatarRelativo(ultimo)}
                </time>
                {"."}
              </>
            )}
          </span>
        </span>
      </p>
      <Link
        href="/admin#integracoes"
        className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-controle border border-[color:var(--ambar)] bg-papel-elevado px-3.5 text-sm font-bold text-tinta transition-colors duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)] hover:text-[color:var(--latao)]"
      >
        Configurar o envio
      </Link>
    </div>
  );
}
