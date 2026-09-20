"use client";

import { useEffect, useRef, useState } from "react";
import { chamar } from "@/lib/api";
import type { RetrospectoDaSessao } from "@/types/copiloto";
import { CorpoRetrospecto } from "@/components/sessao/copiloto/CorpoRetrospecto";
import { EstadoCarregando } from "@/components/ui/Estado";

/** Caminho do documento e do JSON — um lugar só, para a rota e o download
 * nunca divergirem de letra. */
export function caminhoRetrospecto(sessaoId: string, formato?: "docx"): string {
  return formato ? `/api/sessoes/${sessaoId}/copiloto/retrospecto?formato=${formato}` : `/api/sessoes/${sessaoId}/copiloto/retrospecto`;
}

/** O que conta como parada de Tab dentro do diálogo. `[tabindex="-1"]` fica
 * de fora de propósito: a RAIZ do diálogo é `-1` (foco programático ao
 * abrir), e ela não pode virar uma parada do ciclo. */
const SELETOR_FOCAVEL =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

type EstadoDoCorpo =
  | { tipo: "carregando" }
  | { tipo: "pronto"; retrospecto: RetrospectoDaSessao }
  /** Stub ROTULADO — nunca um retrospecto vazio disfarçado de retrospecto
   * real. `podeTentarDeNovo` separa "não existe" (404: a montagem falhou no
   * servidor, ou o kill-switch estava desligado) de "não consegui buscar
   * agora" (rede, 500) — a segunda é a única em que insistir muda alguma
   * coisa. */
  | { tipo: "stub"; podeTentarDeNovo: boolean };

/**
 * Fase 13, FE-6/FE-7 — o pop-up do **Retrospecto da Sessão**, o fim escrito
 * do copiloto.
 *
 * **Quando abre, e quando NÃO abre** (CONFLITO C-3 do plano, decidido pelo
 * orquestrador em 19/09): abre SÓ no encerramento MANUAL, pela ação dela.
 * O encerramento por duração máxima (ou qualquer caminho automático) grava o
 * retrospecto do mesmo jeito, mas **não abre modal nenhum** — ela continua
 * com o cliente na sala, e uma janela que se abre sozinha na cara de quem
 * não clicou em nada é interrupção, não entrega. O automático fica
 * disponível em `/jornadas/<id>#retrospecto`.
 *
 * **Falha do backend nunca vira corpo vazio.** O retrospecto é escrito num
 * `try/catch` isolado do encerramento (§D.4): se a montagem falhar, a sessão
 * encerra assim mesmo e a rota responde `retrospecto: null`. Aqui isso vira
 * um stub ROTULADO ("não foi possível montar o retrospecto desta sessão") —
 * jamais um documento com seções vazias, que ela leria como "a sessão não
 * teve nada".
 *
 * **Encerrar duas vezes mostra o MESMO papel, nunca dois.** A idempotência é
 * invariante de banco (`sessao_id` é PK de `copiloto_retrospectos`); do lado
 * da tela, quando o encerramento não devolve retrospecto (porque a sessão já
 * estava encerrada), este componente BUSCA o que já existe em vez de esperar
 * um novo.
 *
 * A11y: `role="dialog"` + `aria-modal`, foco na raiz ao abrir, `Esc` fecha,
 * e o foco volta a quem abriu (responsabilidade de `aoFechar`, como no
 * padrão já usado nesta base). Mesmo desenho de `Apresentacao.tsx`.
 */
export function PopupRetrospecto({
  sessaoId,
  retrospectoInicial = null,
  aoFechar,
}: {
  sessaoId: string;
  /** O que a resposta de `POST …/encerrar` trouxe. `null` = a rota não
   * devolveu retrospecto (falha isolada, ou sessão já encerrada): o
   * componente busca o que existir por conta própria. */
  retrospectoInicial?: RetrospectoDaSessao | null;
  aoFechar: () => void;
}) {
  const raizRef = useRef<HTMLDivElement>(null);
  const [estado, setEstado] = useState<EstadoDoCorpo>(() =>
    retrospectoInicial ? { tipo: "pronto", retrospecto: retrospectoInicial } : { tipo: "carregando" },
  );

  // Nova tentativa do botão "Tentar de novo" — contador, não booleano:
  // incrementar sempre reexecuta o efeito, mesmo que o valor anterior já
  // fosse "verdadeiro".
  const [tentativa, setTentativa] = useState(0);

  // Mesma disciplina de `useRecurso` (e pelo mesmo motivo escrito no docblock
  // dele): o `setEstado` mora na CONTINUAÇÃO assíncrona (`.then`/`.catch`),
  // nunca no corpo síncrono do efeito — setState síncrono ali dispara
  // cascata de renders (e a regra `react-hooks/set-state-in-effect` desta
  // base reprova). Quem volta o estado para "carregando" é o handler de
  // clique, que é evento, não efeito.
  useEffect(() => {
    if (retrospectoInicial) return;
    let vivo = true;
    chamar<RetrospectoDaSessao>(caminhoRetrospecto(sessaoId))
      .then((retrospecto) => {
        if (vivo) setEstado({ tipo: "pronto", retrospecto });
      })
      .catch((erro: unknown) => {
        if (!vivo) return;
        const status = (erro as { status?: number } | null)?.status;
        // 404 é ESTADO ("não existe retrospecto para esta sessão"), não falha
        // transiente: insistir não faz um documento existir, então nem
        // aparece o botão de tentar de novo.
        setEstado({ tipo: "stub", podeTentarDeNovo: status !== 404 });
      });
    return () => {
      vivo = false;
    };
  }, [sessaoId, retrospectoInicial, tentativa]);

  useEffect(() => {
    raizRef.current?.focus();
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        aoFechar();
        return;
      }
      if (e.key !== "Tab") return;
      // FOCUS TRAP (D-5, veredito do Fable): `aria-modal="true"` PROMETE ao
      // leitor de tela que o resto da página não existe enquanto o diálogo
      // está aberto. Sem prender o Tab, quem navega por teclado sai do
      // diálogo para uma árvore que a tecnologia assistiva já declarou
      // inexistente — a promessa vira mentira. A lista é recalculada a CADA
      // Tab (não memoizada): o corpo do diálogo troca de "carregando" para
      // documento/stub, e cada estado tem controles diferentes.
      const raiz = raizRef.current;
      if (!raiz) return;
      // Filtro por ATRIBUTO, não por geometria (`getClientRects()`): em
      // jsdom nada tem caixa, e um filtro geométrico esvaziaria a lista
      // inteira — o teste passaria a provar o ramo errado (o de "não há nada
      // focável"). `disabled`, `aria-hidden` e `[hidden]` cobrem o que
      // precisa sair, e valem igual nos dois ambientes.
      const focaveis = [...raiz.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL)].filter(
        (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true" && el.closest("[hidden]") === null,
      );
      if (focaveis.length === 0) {
        // Estado "carregando": nada focável dentro ainda. O foco fica na
        // raiz (que é `tabIndex={-1}`), nunca escapa para o `<body>`.
        e.preventDefault();
        raiz.focus();
        return;
      }
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      const ativo = document.activeElement;
      const foraDoDialogo = !(ativo instanceof Node) || !raiz.contains(ativo);
      if (e.shiftKey) {
        if (foraDoDialogo || ativo === primeiro || ativo === raiz) {
          e.preventDefault();
          ultimo.focus();
        }
        return;
      }
      if (foraDoDialogo || ativo === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const jornadaId = estado.tipo === "pronto" ? (estado.retrospecto.jornada_id ?? null) : null;

  return (
    <div
      ref={raizRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="retrospecto-titulo"
      // `z-[60]`, não `z-50`: o `z-50` é a camada compartilhada de overlay
      // desta base (`ui/Gaveta`, `ui/ConfirmarAcao`, `ui/Dica`), e empatar
      // com ela deixa a ordem visual por conta da ordem do DOM — que numa
      // árvore com `AppShell` acima não é estável. O pop-up de FIM DE SESSÃO
      // é o documento que ela leva embora; nada pode ficar por cima dele.
      // (`70` continua reservado ao "pular para o conteúdo", que precisa
      // vencer até isto.)
      className="fixed inset-0 z-[60] flex flex-col gap-3 bg-papel p-4 outline-none"
    >
      <div className="mx-auto flex w-full max-w-4xl shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 id="retrospecto-titulo" className="text-subtitulo font-bold text-tinta">
            Retrospecto da sessão
          </h2>
          <p className="text-legenda text-tinta-suave">O que o copiloto observou enquanto a sessão acontecia.</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {estado.tipo === "pronto" && (
            // FE-7 — download por `<a href download>` + `Content-Disposition`
            // da rota, o padrão provado da casa (`croqui/BaixarRelatorio.tsx`):
            // funciona com botão direito, com "abrir em nova aba" e sem
            // JavaScript, e a página NÃO troca ao clicar. Nada de `fetch` +
            // `Blob` + `createObjectURL` — aquilo existe noutro lugar porque
            // a rota de lá faz 302 para o Storage (cross-origin); este
            // documento não passa por Storage.
            <a
              href={caminhoRetrospecto(sessaoId, "docx")}
              download
              className="inline-flex min-h-11 items-center justify-center rounded-controle border border-linha-forte bg-papel-elevado px-3.5 text-sm font-medium text-tinta transition-colors duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--latao-cta)]"
            >
              Baixar (.docx)
            </a>
          )}
          <button
            type="button"
            onClick={aoFechar}
            className="min-h-11 rounded-controle border border-linha-forte px-3 text-sm font-medium text-tinta transition-colors duration-[var(--transicao-rapida)] hover:bg-papel-elevado focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--foco)]"
          >
            Fechar <kbd className="ml-1 text-legenda">Esc</kbd>
          </button>
        </div>
      </div>

      {/* `max-w-4xl` porque isto é DOCUMENTO, não painel de vigilância: num
       * monitor de 1536 px, uma linha de texto de 1.500 px é ilegível (a
       * mesma razão pela qual o `AppShell` limita as outras ~30 telas). A
       * exceção de largura cheia vale para a tela de condução, não para o
       * papel que ela leva embora. */}
      <div className="mx-auto min-h-0 w-full max-w-4xl flex-1 overflow-y-auto rounded-cartao border border-linha bg-papel-elevado p-cartao">
        {estado.tipo === "carregando" && <EstadoCarregando rotulo="Montando o retrospecto desta sessão…" />}

        {estado.tipo === "stub" && (
          <div className="flex flex-col items-start gap-2">
            <p className="text-corpo font-semibold text-tinta">Não foi possível montar o retrospecto desta sessão.</p>
            <p className="text-sm text-tinta-suave">
              A sessão foi encerrada e a transcrição está consolidada — só este documento não pôde ser gerado agora.
            </p>
            {estado.podeTentarDeNovo && (
              <button
                type="button"
                onClick={() => {
                  setEstado({ tipo: "carregando" });
                  setTentativa((n) => n + 1);
                }}
                className="min-h-11 rounded-controle border border-linha-forte px-3 text-sm font-medium text-tinta transition-colors duration-[var(--transicao-rapida)] hover:bg-papel focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--foco)]"
              >
                Tentar de novo
              </button>
            )}
          </div>
        )}

        {estado.tipo === "pronto" && <CorpoRetrospecto retrospecto={estado.retrospecto} />}
      </div>

      {jornadaId !== null && (
        <p className="mx-auto w-full max-w-4xl shrink-0 text-legenda text-tinta-suave">
          Este documento continua disponível na ficha do cliente:{" "}
          <a
            href={`/jornadas/${jornadaId}#retrospecto`}
            className="font-medium text-tinta underline decoration-[color:var(--latao)] underline-offset-2"
          >
            abrir o retrospecto na ficha
          </a>
          .
        </p>
      )}
    </div>
  );
}

/**
 * D-4 (veredito do Fable) — **o caminho para o documento quando o pop-up NÃO
 * abre.**
 *
 * O encerramento por duração máxima grava o retrospecto do mesmo jeito, mas
 * não abre modal nenhum (C-3: a advogada ainda está com o cliente na sala, e
 * janela que abre sozinha na cara de quem não clicou é interrupção). Sem este
 * link, o documento existia e ninguém achava.
 *
 * **Só aparece se o documento existir de verdade.** Uma requisição, UMA vez,
 * depois que a sessão acabou — o polling já parou, então não há caminho
 * quente para engordar. 404 (ou kill-switch, ou falha na montagem) → nenhum
 * link: nunca um "Ver retrospecto" que leva a uma gaveta vazia. `jornada_id`
 * sai do próprio documento, então não é preciso descer uma prop nova por três
 * níveis de componente só para montar uma URL.
 *
 * A linha sóbria continua sóbria: isto é um `<a>` de texto ao lado dela, não
 * um botão, não um alerta, não um modal.
 */
export function LinkRetrospecto({ sessaoId }: { sessaoId: string }) {
  const [jornadaId, setJornadaId] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    chamar<RetrospectoDaSessao>(caminhoRetrospecto(sessaoId))
      .then((r) => {
        if (vivo && typeof r.jornada_id === "string") setJornadaId(r.jornada_id);
      })
      .catch(() => {
        // Sem retrospecto (404), kill-switch desligado ou rede fora: fica sem
        // link. Silêncio é o certo — a sessão acabou e isto é um extra da
        // linha de status, nunca um erro que ela precise resolver agora.
      });
    return () => {
      vivo = false;
    };
  }, [sessaoId]);

  if (jornadaId === null) return null;

  return (
    <a
      href={`/jornadas/${jornadaId}#retrospecto`}
      className="ml-1.5 inline-flex min-h-11 items-center font-medium text-tinta underline decoration-[color:var(--latao)] underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--foco)]"
    >
      Ver o retrospecto
    </a>
  );
}
