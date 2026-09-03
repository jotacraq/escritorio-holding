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
            <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
              <Selo tom="vermelho">{ROTULO_TIPO[item.tipo]}</Selo>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-tinta">{item.pessoa_nome ?? item.titulo}</p>
                {item.descricao && <p className="truncate text-xs text-tinta-suave">{item.descricao}</p>}
              </div>

              {item.ocorrido_em && (
                <span className="whitespace-nowrap text-xs text-tinta-fraca">{formatarRelativo(item.ocorrido_em)}</span>
              )}

              {item.jornada_id ? (
                <Link
                  href={`/jornadas/${item.jornada_id}`}
                  className="rounded-sm border border-linha-forte bg-papel px-2.5 py-1 text-xs font-medium text-tinta hover:border-latao"
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
