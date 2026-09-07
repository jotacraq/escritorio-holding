import type { EventoTimeline } from "@/lib/api";
import { formatarDataHora } from "@/lib/formatar";
import { SeloEstado } from "@/components/ui/SeloEstado";
import { LinkBotao } from "@/components/ui/LinkBotao";
import { rotulo } from "@/lib/vocabulario";
import type { CroquiFase } from "@/lib/pasta/sinais";
import { proximaFaseDoCroqui } from "@/lib/pasta/sinais";

/**
 * **Andamentos do croqui** (Fase 8, D14) — a linha de vida do croqui dentro da
 * Ficha, no formato que o advogado brasileiro já lê em PJe e e-SAJ: **datado,
 * do mais recente para o mais antigo**, uma linha por movimentação.
 *
 * O nome não é escolha de gosto: "Andamento" é a entrada nova do
 * `Glossario.md` para `eventos_timeline`, e vem de `rotulo("andamentos")` —
 * ninguém escreve o rótulo à mão aqui.
 *
 * Por que um componente próprio e não um filtro da aba Andamentos: a aba
 * mostra o processo INTEIRO (pagamento, sessão, documentos, IA). Quem está no
 * croqui quer a história do croqui — quando calculou, qual versão fixou,
 * quando exportou, quando apresentou. Eram quatro tipos de evento que existiam
 * no banco desde a 0070 e não chegavam a nenhuma tela.
 *
 * Vazio não é erro: é 1 linha dizendo o que não aconteceu + 1 ação (DS §7).
 */

/** Os quatro tipos que a 0070 separou. `croqui` é o único que carrega `status`. */
const TIPOS_CROQUI = new Set(["croqui", "croqui_calculo", "croqui_exportacao", "croqui_narrativa"]);

/**
 * O que aparece na frente da data. O título gravado pelo trigger já é uma
 * frase ("Croqui pronto", "Relatório exportado"); a etiqueta diz de que
 * NATUREZA é a movimentação, para o olho varrer a coluna sem ler tudo.
 */
const ETIQUETA: Record<string, string> = {
  croqui: "Documento",
  croqui_calculo: "Cálculo",
  croqui_exportacao: "Exportação",
  croqui_narrativa: "Narrativa",
};

export function AndamentosCroqui({
  eventos,
  fase,
  hrefCroqui,
  limite = 8,
}: {
  /** A timeline completa da Ficha, já carregada — nenhuma requisição nova. */
  eventos: EventoTimeline[];
  /** A fase vigente (`faseDoCroqui`), para o selo e para "o que falta". */
  fase: CroquiFase | null;
  /** Destino do "o que falta" — a tela do croqui. `null` quando não há croqui. */
  hrefCroqui?: string | null;
  /** Quantos andamentos mostrar. O resto continua na aba de Andamentos. */
  limite?: number;
}) {
  // A timeline já vem em ordem decrescente do servidor (`server/jornadas.ts`);
  // a ordenação aqui é a garantia de que continua assim se a fonte mudar —
  // "do mais recente para o mais antigo" é o contrato desta lista, não um
  // detalhe de implementação de quem a alimenta.
  const doCroqui = eventos
    .filter((e) => TIPOS_CROQUI.has(e.tipo))
    .slice()
    .sort((a, b) => b.ocorrido_em.localeCompare(a.ocorrido_em));

  const proxima = proximaFaseDoCroqui(fase);

  return (
    <section aria-labelledby="andamentos-croqui" className="flex flex-col gap-item">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="andamentos-croqui" className="text-subtitulo font-bold text-tinta">
          {rotulo("andamentos")} do croqui
        </h3>
        <SeloEstado dominio="croqui" estado={fase} />
      </div>

      {proxima && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-tinta-suave">
          <span>{proxima.falta}</span>
          {hrefCroqui && (
            <LinkBotao href={hrefCroqui} variante="fantasma">
              {proxima.acao}
            </LinkBotao>
          )}
        </p>
      )}

      {doCroqui.length === 0 ? (
        <p className="text-sm text-tinta-suave">
          Nenhum andamento do croqui ainda. O que acontecer aqui — cálculo, versão fixada, exportação, apresentação — aparece nesta lista com a data.
        </p>
      ) : (
        <ol className="flex flex-col gap-0">
          {doCroqui.slice(0, limite).map((evento, indice, lista) => (
            <li key={evento.id} className="relative flex gap-3 pb-3 pl-1">
              {indice < lista.length - 1 && <span aria-hidden="true" className="absolute left-[5px] top-3 h-full w-px bg-linha" />}
              <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-[color:var(--latao)] bg-papel-elevado" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <p className="text-sm font-medium text-tinta">{evento.titulo}</p>
                  {/* A data SEMPRE visível — é o que faz disto um andamento e
                      não uma lista de avisos (padrão PJe/e-SAJ). */}
                  <time dateTime={evento.ocorrido_em} className="font-mono text-legenda text-tinta-fraca">
                    {formatarDataHora(evento.ocorrido_em)}
                  </time>
                </div>
                {evento.descricao && <p className="text-sm text-tinta-suave">{evento.descricao}</p>}
                <span className="text-legenda uppercase tracking-wide text-tinta-fraca">{ETIQUETA[evento.tipo] ?? evento.tipo}</span>
              </div>
            </li>
          ))}
        </ol>
      )}

      {doCroqui.length > limite && (
        <p className="text-legenda text-tinta-fraca">
          Mostrando os {limite} mais recentes de {doCroqui.length}. O restante fica na aba {rotulo("andamentos")}.
        </p>
      )}
    </section>
  );
}
