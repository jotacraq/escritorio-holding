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

/**
 * Estado do envio automático — **uma linha, só para o admin** (Fase 5 §9.1).
 *
 * A Fase 4 punha aqui um cartão com o comando `curl` do cron, o nome da
 * variável de ambiente e três passos de configuração, na segunda tela mais
 * lida do escritório. O que fazer continua existindo, mas onde se faz:
 * Admin → Integrações. Aqui fica estado + quando + um link.
 *
 * O pai já decide se renderiza (não-admin não monta este componente); a
 * checagem de papel não se repete aqui.
 */
export function ProvaDeVidaCron({ regua }: { regua: EstadoRegua }) {
  const { ultimo_cron_em: ultimo, cron_atrasado: atrasado } = regua;
  const emDia = Boolean(ultimo) && !atrasado;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-cartao border border-linha bg-papel px-5 py-3 text-sm text-tinta-suave"
    >
      <span className="font-bold text-tinta" title={titleDe("envio_automatico")}>
        {rotulo("envio_automatico")}
      </span>

      <Selo tom={emDia ? "verde" : "ambar"} icone={emDia ? ICONE_CHECK : undefined}>
        {emDia ? "Rodando" : ultimo ? "Atrasado" : "Nunca rodou"}
      </Selo>

      {ultimo && (
        <time dateTime={ultimo} title={formatarDataHora(ultimo)}>
          {formatarRelativo(ultimo)}
        </time>
      )}

      <Link
        href="/admin#integracoes"
        className="ml-auto inline-flex min-h-11 items-center font-medium text-[color:var(--latao)] underline-offset-2 hover:underline"
      >
        {emDia ? "Ver integrações" : "Configurar"}
      </Link>
    </div>
  );
}
