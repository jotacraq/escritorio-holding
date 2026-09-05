import Link from "next/link";
import { Cartao } from "@/components/ui/Cartao";
import { SeloStub } from "@/components/ui/Selo";
import { formatarDataHora, formatarRelativo } from "@/lib/formatar";
import type { EstadoRegua } from "./api-comunicacao";

/**
 * Prova de vida do cron (§1.6): a régua só sai sozinha se
 * `POST /api/cron/regua` for chamado a cada 5 min pelo hPanel da Hostinger.
 * Três estados, sempre com o que fazer: rodando (verde) · parado há mais de
 * 15 min (âmbar) · nunca rodou (âmbar + texto exato do §1.9 e o que
 * configurar). Sem polling — o pai recarrega no botão "Atualizar".
 */
export function ProvaDeVidaCron({ regua }: { regua: EstadoRegua }) {
  const { ultimo_cron_em: ultimo, cron_atrasado: atrasado } = regua;

  if (!atrasado && ultimo) {
    return (
      <Cartao realce="verde" preenchimento="compacto" como="div" aria-live="polite">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <p className="text-subtitulo font-bold text-tinta">A régua está rodando</p>
          <p className="text-sm text-tinta-suave">
            Última passagem {formatarRelativo(ultimo)} ({formatarDataHora(ultimo)}). O cron passa a cada 5 minutos e envia o que
            estiver na hora.
          </p>
        </div>
      </Cartao>
    );
  }

  const nuncaRodou = !ultimo;
  return (
    <Cartao realce="ambar" preenchimento="compacto" como="div" role="status">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <p className="text-subtitulo font-bold text-tinta">{nuncaRodou ? "A régua nunca rodou" : `Cron parado ${formatarRelativo(ultimo)}`}</p>
          {!nuncaRodou && <p className="text-sm text-tinta-suave">Última passagem em {formatarDataHora(ultimo)}. Nada sai sozinho até a próxima.</p>}
        </div>
        {regua.aviso && <SeloStub texto={regua.aviso} />}
        <div className="text-sm text-tinta-suave">
          <p className="font-medium text-tinta">O que precisa ser configurado (fora deste sistema):</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            <li>
              No hPanel da Hostinger, criar um cron a cada 5 minutos com{" "}
              <code className="mt-1 block max-w-full whitespace-pre-wrap break-all rounded-controle bg-papel px-2.5 py-1.5 text-xs text-tinta">
                curl -X POST -H &quot;x-cron-secret: $CRON_SECRET&quot; https://escritorio.grupoparticipa.app.br/api/cron/regua
              </code>
              .
            </li>
            <li>
              Usar o <code className="text-xs">CRON_SECRET</code> de produção — o do ambiente local é diferente.
            </li>
            <li>
              Conferir as chaves de envio em{" "}
              <Link href="/admin#integracoes" className="font-medium text-[color:var(--latao)] underline-offset-2 hover:underline">
                Admin → Integrações
              </Link>
              .
            </li>
          </ol>
          <p className="mt-2">Enquanto isso, o WhatsApp continua saindo pela sua mão (abaixo). E-mail fica na fila.</p>
        </div>
      </div>
    </Cartao>
  );
}
