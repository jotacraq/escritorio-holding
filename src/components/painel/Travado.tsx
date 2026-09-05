import { Bloco, LinhaFila } from "./Bloco";
import { LinkBotao } from "./LinkBotao";
import { Selo } from "@/components/ui/Selo";
import { formatarRelativo } from "@/lib/formatar";
import { titleDe } from "@/lib/vocabulario";
import type { PapelEquipe } from "@/lib/api";
import { pendenciaVisivelPara } from "./blocosPorPapel";
import type { EstadoBloco, PendenciaSistema, TipoPendenciaSistemaConhecido } from "@/types/painel-ui";

/**
 * Rótulo humano de cada tipo (§9.2). "Régua parada — cron não passou" e
 * "Pagamento que falhou ao processar (webhook)" eram dívida técnica escrita
 * na tela de quem só queria saber com quem falar: viraram nome de negócio,
 * com a sigla no `title`.
 */
const ROTULO_TIPO: Record<TipoPendenciaSistemaConhecido, string> = {
  webhook_falho: "Pagamento não entrou",
  mensagem_falhou: "Envio falhou",
  link_expirando: "Link expirando",
  material_aguardando_aprovacao: "Material a aprovar",
  cron_parado: "Envio automático parado",
  sessao_sem_sala: "Sessão sem sala",
  ligacao_ia_falhou: "Ligação por IA falhou",
};

/** A sigla do método/infra que fica no `title` da linha — nunca no fluxo. */
const TITLE_TIPO: Partial<Record<TipoPendenciaSistemaConhecido, string | undefined>> = {
  webhook_falho: titleDe("aviso_pagamento"),
  cron_parado: titleDe("envio_automatico"),
  mensagem_falhou: titleDe("regua"),
  ligacao_ia_falhou: titleDe("provedor_ligacao"),
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
 * Bloco 4 — o que emperrou e depende de uma ação. Linha sem `jornada_id` não
 * vira link inventado: vai para a tela do sistema que resolve, ou fica texto.
 *
 * Fase 5: filtrado por papel. Quem não é admin não vê conserto de
 * infraestrutura (aviso de pagamento, envio automático parado) — vê só o que
 * uma pessoa resolve. O filtro é no array, antes do render: o item some do
 * DOM, não fica escondido por CSS.
 */
export function Travado({
  estado,
  papel,
  aoTentarDeNovo,
}: {
  estado: EstadoBloco<PendenciaSistema>;
  papel: PapelEquipe | null;
  aoTentarDeNovo: () => void;
}) {
  // `cron_parado` nunca entra aqui: para o admin ele já é a linha "Envio
  // automático" da seção Sistema, e para os demais é ruído de infra. Contar
  // duas vezes a mesma pendência é o que faz o painel parecer cheio.
  const filtrado: EstadoBloco<PendenciaSistema> =
    estado.situacao === "ok"
      ? { situacao: "ok", itens: estado.itens.filter((i) => i.tipo !== "cron_parado" && pendenciaVisivelPara(papel, i.tipo)) }
      : estado;

  return (
    <Bloco
      id="travado"
      rotulo="Travado"
      titulo="Precisa de alguém"
      dica="O que emperrou e só destrava com uma ação da equipe: sessão sem sala, envio que falhou, material esperando aprovação."
      mensagemNadaPendente="Nada travado."
      estado={filtrado}
      aoTentarDeNovo={aoTentarDeNovo}
    >
      {(itens) => (
        <ul className="divide-y divide-linha">
          {itens.map((item) => {
            const destino = item.jornada_id ? `/jornadas/${item.jornada_id}` : destinoSemJornada(item.tipo);
            return (
              <LinhaFila key={item.id}>
                <span title={TITLE_TIPO[item.tipo as TipoPendenciaSistemaConhecido]} className="inline-flex">
                  <Selo tom="vermelho">{rotuloTipoPendencia(item.tipo)}</Selo>
                </span>

                {/* A descrição longa saiu do fluxo (lei de texto) e virou `title` da linha:
                    continua acessível a quem procura, sem virar parágrafo no cartão. */}
                <div className="min-w-0 sm:flex-1">
                  <p className="text-sm font-bold text-tinta sm:truncate" title={item.descricao ?? undefined}>
                    {item.pessoa_nome ?? item.titulo}
                  </p>
                </div>

                {item.ocorrido_em && <span className="whitespace-nowrap text-xs text-tinta-fraca">{formatarRelativo(item.ocorrido_em)}</span>}

                {destino ? (
                  <LinkBotao href={destino} className="sm:ml-auto">
                    Resolver
                  </LinkBotao>
                ) : (
                  <span className="text-xs text-tinta-fraca sm:ml-auto">Sem cliente ligado</span>
                )}
              </LinhaFila>
            );
          })}
        </ul>
      )}
    </Bloco>
  );
}
