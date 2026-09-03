import Link from "next/link";
import { Bloco } from "./Bloco";
import { Selo } from "@/components/ui/Selo";
import { formatarRelativo } from "@/lib/formatar";
import type { EstadoBloco, PendenciaSistema, TipoPendenciaSistema } from "@/types/painel-ui";

const ROTULO_TIPO: Record<TipoPendenciaSistema, string> = {
  webhook_falho: "Mensagem que falhou ao processar",
  mensagem_falhou: "Envio que falhou",
  link_expirando: "Link expirando em breve",
  material_aguardando_aprovacao: "Material aguardando aprovação",
};

/**
 * Bloco 4 — o que emperrou: mensagem que falhou, documento pedido e não
 * enviado, croqui pago sem apresentação marcada, material esperando
 * aprovação. Linha sem `jornada_id` não vira link inventado — fica texto.
 */
export function Travado({ estado, aoTentarDeNovo }: { estado: EstadoBloco<PendenciaSistema>; aoTentarDeNovo: () => void }) {
  return (
    <Bloco
      id="travado"
      titulo="Travado"
      legenda="O que emperrou e precisa de uma ação da equipe para destravar"
      mensagemNadaPendente="Nada travado no sistema agora."
      estado={estado}
      aoTentarDeNovo={aoTentarDeNovo}
    >
      {(itens) => (
        <ul className="flex flex-col divide-y divide-linha">
          {itens.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2"
            >
              <Selo tom="vermelho">{ROTULO_TIPO[item.tipo]}</Selo>

              <div className="min-w-0 sm:flex-1">
                <p className="text-sm font-medium text-tinta sm:truncate">{item.pessoa_nome ?? item.titulo}</p>
                {item.descricao && <p className="text-xs text-tinta-suave sm:truncate">{item.descricao}</p>}
              </div>

              {item.ocorrido_em && (
                <span className="whitespace-nowrap text-xs text-tinta-fraca">{formatarRelativo(item.ocorrido_em)}</span>
              )}

              {item.jornada_id ? (
                <Link
                  href={`/jornadas/${item.jornada_id}`}
                  className="self-start rounded-sm border border-linha-forte bg-papel px-2.5 py-1 text-xs font-medium text-tinta hover:border-latao sm:self-auto"
                >
                  Resolver
                </Link>
              ) : (
                <span className="text-xs text-tinta-fraca">Sem jornada associada</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Bloco>
  );
}
