import { Bloco, LinhaFila } from "./Bloco";
import { LinkBotao } from "./LinkBotao";
import { Selo } from "@/components/ui/Selo";
import { formatarRelativo } from "@/lib/formatar";
import type { EstadoBloco, PendenciaSistema, TipoPendenciaSistemaConhecido } from "@/types/painel-ui";

const ROTULO_TIPO: Record<TipoPendenciaSistemaConhecido, string> = {
  webhook_falho: "Pagamento que falhou ao processar",
  mensagem_falhou: "Envio que falhou",
  link_expirando: "Link expirando em breve",
  material_aguardando_aprovacao: "Material aguardando aprovação",
  cron_parado: "Régua parada — cron não passou",
  sessao_sem_sala: "Sessão sem link da sala",
  ligacao_ia_falhou: "Ligação por IA falhou",
};

/** Tipo novo que a tela ainda não conhece vira texto legível — nunca derruba o bloco. */
export function rotuloTipoPendencia(tipo: string): string {
  return (ROTULO_TIPO as Record<string, string>)[tipo] ?? tipo.replace(/_/g, " ");
}

/** Para onde "Resolver" leva quando não há jornada: pendências de sistema puro. */
function destinoSemJornada(tipo: string): string | null {
  if (tipo === "cron_parado" || tipo === "mensagem_falhou") return "/comunicacao";
  if (tipo === "webhook_falho") return "/admin";
  return null;
}

/**
 * Bloco 4 — o que emperrou: mensagem que falhou, sessão sem sala, régua
 * parada, material esperando aprovação. Linha sem `jornada_id` não vira link
 * inventado — vai para a tela do sistema que resolve, ou fica texto.
 */
export function Travado({ estado, aoTentarDeNovo }: { estado: EstadoBloco<PendenciaSistema>; aoTentarDeNovo: () => void }) {
  return (
    <Bloco
      id="travado"
      rotulo="Sistema"
      titulo="Travado"
      legenda="O que emperrou e precisa de uma ação da equipe para destravar"
      mensagemNadaPendente="Nada travado no sistema agora."
      estado={estado}
      aoTentarDeNovo={aoTentarDeNovo}
    >
      {(itens) => (
        <ul className="divide-y divide-linha">
          {itens.map((item) => {
            const destino = item.jornada_id ? `/jornadas/${item.jornada_id}` : destinoSemJornada(item.tipo);
            return (
              <LinhaFila key={item.id}>
                <Selo tom="vermelho">{rotuloTipoPendencia(item.tipo)}</Selo>

                <div className="min-w-0 sm:flex-1">
                  <p className="text-sm font-bold text-tinta sm:truncate">{item.pessoa_nome ?? item.titulo}</p>
                  {item.descricao && <p className="text-xs text-tinta-suave">{item.descricao}</p>}
                </div>

                {item.ocorrido_em && <span className="whitespace-nowrap text-xs text-tinta-fraca">{formatarRelativo(item.ocorrido_em)}</span>}

                {destino ? (
                  <LinkBotao href={destino} className="sm:ml-auto">
                    Resolver
                  </LinkBotao>
                ) : (
                  <span className="text-xs text-tinta-fraca sm:ml-auto">Sem jornada associada</span>
                )}
              </LinhaFila>
            );
          })}
        </ul>
      )}
    </Bloco>
  );
}
