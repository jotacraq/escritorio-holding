import type { EventoTimeline } from "@/lib/api";
import { formatarDataHora } from "@/lib/formatar";
import { EstadoVazio } from "@/components/ui/Estado";
import { rotulo } from "@/lib/vocabulario";
import { formatarConfianca, formatarDolar, rotuloIntencao, SeloRespondidoPeloAgente } from "@/components/comunicacao/agente";

/**
 * Os **Andamentos** do processo (Fase 8, §B3/D18).
 *
 * O nome mudou de "linha do tempo" para o termo que o advogado brasileiro já
 * lê em PJe e e-SAJ, e vem de `rotulo("andamentos")` — a tabela continua sendo
 * `eventos_timeline` no banco e no código. Rótulo de tela num lugar só; nada
 * de sinônimo inventado componente a componente.
 *
 * Ordem decrescente (o mais recente em cima) é o padrão daqueles sistemas e é
 * o contrato desta lista — o servidor já entrega assim (`server/jornadas.ts`),
 * e a ordenação aqui garante que continue assim se a fonte mudar.
 *
 * Quem quer só a história do croqui usa `AndamentosCroqui`, no cartão do
 * croqui: esta aba é o processo INTEIRO.
 */

const ROTULOS_ATOR: Record<EventoTimeline["ator_tipo"], string> = { humano: "Equipe", sistema: "Sistema", ia: "IA" };

/**
 * Fase 9 — o agente de WhatsApp grava cada resposta aqui (`tipo: 'mensagem'`,
 * `dados.origem: 'agente_whatsapp'`, D26). Sem tratamento, o andamento lia
 * "Sistema", igual a um envio de régua: a equipe não distinguiria o que o robô
 * DISSE do que o sistema mandou. O rótulo passa a dizer quem falou; intenção,
 * certeza, custo e versão do prompt vão para o `title` — a lei de texto (§2.2)
 * manda a explicação longa para lá, e o andamento continua com uma linha.
 */
function detalheDoAgente(dados: Record<string, unknown>): string | undefined {
  if (dados.origem !== "agente_whatsapp") return undefined;
  const partes = ["Resposta do agente de WhatsApp."];
  const intencao = typeof dados.intencao === "string" ? rotuloIntencao(dados.intencao) : null;
  if (intencao) partes.push(`Intenção: ${intencao}.`);
  const confianca = typeof dados.confianca === "number" ? formatarConfianca(dados.confianca) : null;
  if (confianca) partes.push(`${confianca}.`);
  const custo = typeof dados.custo_usd === "number" ? formatarDolar(dados.custo_usd) : null;
  partes.push(custo ? `Custo: ${custo}.` : "Texto fixo: não passou pela IA.");
  if (typeof dados.prompt_versao === "number") partes.push(`Versão do prompt: v${dados.prompt_versao}.`);
  return partes.join(" ");
}

export function TimelineAba({ eventos }: { eventos: EventoTimeline[] }) {
  if (eventos.length === 0) {
    return (
      <EstadoVazio
        titulo={`Sem ${rotulo("andamentos").toLowerCase()} registrados`}
        descricao="Cada movimentação do processo — contato, pagamento, sessão, croqui — entra aqui sozinha, com a data."
      />
    );
  }

  const ordenados = eventos.slice().sort((a, b) => b.ocorrido_em.localeCompare(a.ocorrido_em));

  return (
    <ol className="flex flex-col gap-0">
      {ordenados.map((evento, indice) => {
        const doAgente = detalheDoAgente(evento.dados ?? {});
        return (
          <li key={evento.id} className="relative flex gap-4 pb-5 pl-1">
            {indice < ordenados.length - 1 && <span aria-hidden="true" className="absolute left-[7px] top-4 h-full w-px bg-linha" />}
            <span aria-hidden="true" className="mt-1.5 h-3 w-3 shrink-0 rounded-full border-2 border-[color:var(--latao)] bg-papel-elevado" />
            <div className="flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-tinta" title={doAgente}>
                  {evento.titulo}
                </p>
                {/* `<time>` com `dateTime`: a data é dado, não decoração — é o
                    que faz o leitor de tela e o "copiar" darem a data certa. */}
                <time dateTime={evento.ocorrido_em} className="font-mono text-legenda text-tinta-fraca">
                  {formatarDataHora(evento.ocorrido_em)}
                </time>
              </div>
              {evento.descricao && <p className="text-sm text-tinta-suave">{evento.descricao}</p>}
              {doAgente ? (
                <span className="mt-0.5 inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                  <SeloRespondidoPeloAgente />
                  <span className="text-legenda uppercase tracking-wide text-tinta-fraca" title={doAgente}>
                    {evento.ator_tipo === "ia" ? "redigido pela IA" : "texto fixo"}
                  </span>
                </span>
              ) : (
                <span className="text-legenda uppercase tracking-wide text-tinta-fraca">{ROTULOS_ATOR[evento.ator_tipo]}</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
