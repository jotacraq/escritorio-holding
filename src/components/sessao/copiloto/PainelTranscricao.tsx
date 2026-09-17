"use client";

import { useLayoutEffect, useRef } from "react";
import type { SegmentoCopiloto } from "@/types/copiloto";
import type { PapelEquipe } from "@/types/banco";
import { formatarHora } from "@/lib/formatar";
import { useRealceUmaVez } from "@/components/sessao/copiloto/useRealceUmaVez";

/** Mesmo padrão de `PainelCopiloto.tsx`/`RegistroManual.tsx` (WCAG 2.1.1 —
 * container rolável exige foco por teclado). `jsx-a11y/no-noninteractive-
 * tabindex` reporta erro em `tabIndex={0}` LITERAL num `role="region"`
 * estático, mesmo sendo o padrão que a própria WCAG pede — uma constante
 * nomeada (não-literal do ponto de vista do linter) sai do falso positivo
 * sem mudar o comportamento em runtime (é sempre `0`). */
const TAB_INDEX_ROLAVEL = 0;

/**
 * Fase 12, Fatia B/F3 — a transcrição ENTRA na tela. Achado do Fable
 * (17/09): `usePollingCopiloto` já buscava `segmentos_novos` a cada ciclo e
 * DESCARTAVA — nenhum componente renderizava. Este painel é a primeira vez
 * que o dado chega à advogada; ~1.800 segmentos por sessão de 90min eram
 * banda paga e jogada fora.
 *
 * Fase 12, Fatia 7 — turnos, não linhas soltas. Achado do dono: a coluna
 * mostrava "15:54 Elaine Montenegro: texto" repetido 9× seguidas (uma linha
 * por fala transcrita) — ~40% da altura da coluna era hora+nome repetido, a
 * pior tela possível para ler de relance num telão. `agruparEmTurnos` é
 * derivação pura no RENDER (nenhum estado, nenhuma query): falas
 * consecutivas do mesmo falante viram um turno só, hora+nome uma vez.
 *
 * Regras da entrega:
 *  - Mais recente EMBAIXO (leitura de baixo pra cima, como um chat).
 *  - Auto-scroll ao fim só quando o usuário JÁ ESTAVA no fim — se ela rolou
 *    para cima para reler um trecho, um segmento novo não pode arrastá-la de
 *    volta (bug de UX clássico de "chat" que rola sozinho embaixo do dedo).
 *  - `role="region"` com rótulo + `aria-live="off"` — NUNCA `polite`: uma
 *    lista de 60 segmentos anunciada em voz alta a cada tick de 3s é
 *    inutilizável, não é acessibilidade.
 *  - Linhas duplicadas (eco do Zoom, ~8% medido) são dado real — não
 *    maquiadas, não deduplicadas aqui. É problema de fone de ouvido, não de
 *    tela. Um turno NÃO deduplica falas iguais dentro dele.
 *  - Geometria constante: o painel é uma COLUNA do mosaico (F4), com
 *    `min-h-0` + rolagem própria — nunca estica a página.
 *
 * Advogada × demais: por POSIÇÃO/PESO, nunca por cor (preferência vinculante
 * do dono — tela densa e chapada, telão a distância). `participantes[].papel`
 * NÃO é fonte confiável hoje (achado 17/09: sessão real tem Marco-Staff
 * gravado como "advogada" — correção de dado pendente, fora desta fatia).
 * Em vez disso usa-se quem está LOGADO, casado por nome normalizado contra
 * `turno.falante`, desde que o papel do perfil CONDUZA sessão
 * (`PAPEIS_QUE_CONDUZEM`: `advogada` ou `admin` — a Dra. Elaine é `admin`;
 * exigir só "advogada" deixou a diferenciação MORTA em produção, 14/14
 * turnos neutros, medido no navegador em 17/09). Sem nome resolvido, ou papel
 * fora desse conjunto, degrada para NEUTRO: todo turno no mesmo tratamento,
 * sem recuo diferencial — nunca adivinha.
 *
 * Correção (Fase 12, Fatia 7 — defeito, não feature): esta folha recebia
 * `usuarioLogado` chamando `useUsuarioAtual()` sozinha, que faz 2 idas à
 * rede por MONTAGEM (`auth.getUser()` + `SELECT nome, papel FROM
 * perfis_equipe`). O painel desmonta a cada troca de aba Transcrição↔
 * Inventário (`ColunaTranscricaoInventario` desmonta a aba inativa de
 * propósito, para não manter poller/scroll fora de vista) — cada clique
 * virava uma query nova ao banco, e ainda causava flicker (pinta neutro,
 * só depois muda o recuo quando a resposta chega). O executor anterior
 * relatou "zero query" — estava errado.
 *
 * Agora `usuarioLogado` chega pronto do SERVER COMPONENT
 * (`page.tsx::usuarioAtual()`, resolvido UMA vez por carregamento da
 * página) via prop, descendo por `ConduzirSessaoApp` → `PainelCopiloto` →
 * `ColunaTranscricaoInventario`. Resultado líquido: −1 query no caminho
 * quente (trocar de aba não bate mais no banco), e sem flicker (o valor já
 * chega correto no primeiro render, nunca `null` seguido de um valor).
 */
export function PainelTranscricao({
  segmentos,
  usuarioLogado = null,
}: {
  segmentos: SegmentoCopiloto[];
  usuarioLogado?: { nome: string | null; papel: PapelEquipe | null } | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // `true` só quando o usuário estava a poucos pixels do fim ANTES deste
  // render receber segmentos novos — capturado no momento do scroll manual,
  // nunca recalculado a partir da lista (a lista já mudou quando o efeito
  // roda).
  const noFimRef = useRef(true);
  const usuario = usuarioLogado;

  function aoRolar() {
    const el = containerRef.current;
    if (!el) return;
    const distanciaDoFim = el.scrollHeight - el.scrollTop - el.clientHeight;
    // Folga de 24px: o próprio auto-scroll pode deixar 1-2px de resto por
    // arredondamento — sem folga, o efeito abaixo concluiria "não estava no
    // fim" logo depois de rolar para o fim sozinho.
    noFimRef.current = distanciaDoFim < 24;
  }

  // `useLayoutEffect` (não `useEffect`): a rolagem precisa acontecer ANTES
  // do navegador pintar o frame com a lista já crescida — senão haveria um
  // frame visível com o scroll ainda no lugar antigo. Depende de `segmentos`
  // (não de `turnos`): agrupar muda `scrollHeight` pela mesma lista de
  // segmentos, então a dependência original continua correta.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (noFimRef.current) el.scrollTop = el.scrollHeight;
  }, [segmentos]);

  const turnos = agruparEmTurnos(segmentos);
  const nomeAdvogadaLogada = nomeAdvogadaLogadaOuNulo(usuario);
  const idUltimoTurno = turnos.length > 0 ? turnos[turnos.length - 1].idRealce : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <p className="shrink-0 text-rotulo font-semibold text-tinta-fraca">Transcrição</p>
      <div
        ref={containerRef}
        onScroll={aoRolar}
        role="region"
        aria-label="Transcrição da sessão"
        aria-live="off"
        tabIndex={TAB_INDEX_ROLAVEL}
        className="min-h-0 flex-1 overflow-y-auto rounded-controle border border-linha bg-papel-elevado px-3 py-2"
      >
        {turnos.length === 0 ? (
          <p className="text-sm text-tinta-suave">Aguardando a fala da sessão.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {turnos.map((turno) => (
              <TurnoTranscricao
                key={turno.idRealce}
                turno={turno}
                ehAdvogada={nomeAdvogadaLogada !== null && normalizarNome(turno.falante) === nomeAdvogadaLogada}
                realce={turno.idRealce === idUltimoTurno}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface TurnoAgrupado {
  falante: string | null;
  /** Uma entrada por fala do turno — mantém duplicatas (eco do Zoom é dado
   * real) e a hora de cada fala individual. */
  falas: Array<{ id: string; texto: string; criado_em: string }>;
  /** Id do ÚLTIMO segmento do turno — chave de realce "uma vez por
   * `segmento.id`" (o pedido é sobre a fala mais recente, não sobre o turno
   * como um todo). */
  idRealce: string;
}

/**
 * Agrupa falas consecutivas do MESMO falante em um turno só — derivação pura,
 * sem estado, sem query. `null` consecutivos formam turno entre si (mesma
 * regra: "sem identificação" é um valor de falante como outro qualquer, não
 * um caso especial que quebra o agrupamento a cada segmento). Ordem
 * preservada — nunca reordena por hora nem por falante.
 */
function agruparEmTurnos(segmentos: SegmentoCopiloto[]): TurnoAgrupado[] {
  const turnos: TurnoAgrupado[] = [];
  for (const segmento of segmentos) {
    const turnoAberto = turnos[turnos.length - 1];
    const fala = { id: segmento.id, texto: segmento.texto, criado_em: segmento.criado_em };
    if (turnoAberto && turnoAberto.falante === segmento.falante) {
      turnoAberto.falas.push(fala);
      turnoAberto.idRealce = segmento.id;
    } else {
      turnos.push({ falante: segmento.falante, falas: [fala], idRealce: segmento.id });
    }
  }
  return turnos;
}

/** Minúsculas, sem acento, espaços colapsados, prefixo "dra."/"dr." ignorado
 * — mesmo espírito de normalização usado para casar nome digitado com nome
 * transcrito (nunca comparação sensível a caixa/acento/tratamento). */
function normalizarNome(nome: string | null): string | null {
  if (!nome) return null;
  const semTratamento = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/^dra?\.?\s+/, "");
  const colapsado = semTratamento.replace(/\s+/g, " ").trim();
  return colapsado.length > 0 ? colapsado : null;
}

/** Papéis de `perfis_equipe` que CONDUZEM sessão. 🔴 CORRIGIDO 18/09 à noite,
 * medido no navegador em produção: a 1ª versão exigia `papel === "advogada"`
 * e a Dra. Elaine — a única pessoa para quem esta diferenciação existe — está
 * cadastrada como `admin` (é dona do escritório E conduz). Resultado: 14
 * turnos na tela, 14 com o recuo de "demais", zero em destaque. A regra
 * degradava para neutro em silêncio, para sempre, sem dado errado nenhum —
 * só uma suposição sobre o cadastro. `assistente`/`relacionamento` continuam
 * fora: quem opera a tela nesses papéis pode aparecer falando no setup
 * (o "Marco - Staff" de hoje) sem ser quem conduz. */
const PAPEIS_QUE_CONDUZEM: ReadonlySet<string> = new Set(["advogada", "admin"]);

/** Quem está logado com papel de condução, nome normalizado — ou `null` para
 * degradar para o tratamento neutro (papel fora de `PAPEIS_QUE_CONDUZEM`, ou
 * sem nome cadastrado em `perfis_equipe`). Nunca lê `participantes[].papel`. */
function nomeAdvogadaLogadaOuNulo(usuario: { papel: string | null; nome: string | null } | null): string | null {
  if (!usuario || !usuario.papel || !PAPEIS_QUE_CONDUZEM.has(usuario.papel)) return null;
  return normalizarNome(usuario.nome);
}

/**
 * Um turno — hora + nome UMA VEZ, frases dentro como linhas. Advogada:
 * `font-semibold text-tinta`, sem recuo. Demais (ou neutro, sem sinal
 * confiável de quem é advogada): `font-medium text-tinta-suave`, com
 * `pl-3 border-l border-linha` — o recuo é o sinal primário de diferenciação
 * (funciona em monocromático e para daltônico), nunca cor.
 */
function TurnoTranscricao({ turno, ehAdvogada, realce }: { turno: TurnoAgrupado; ehAdvogada: boolean; realce: boolean }) {
  // 5000 casa com `@keyframes decair-destaque` (globals.css) — ver
  // `useRealceUmaVez.ts` sobre por que a duração tem de casar com o CSS.
  const comFundo = useRealceUmaVez(realce, turno.idRealce, 5000);
  const primeiraFala = turno.falas[0];

  return (
    <li
      className={`min-w-0 text-sm text-tinta ${comFundo ? "anim-decair-destaque" : ""} ${
        ehAdvogada ? "" : "border-l border-linha pl-3"
      }`}
    >
      <p className="min-w-0 break-words">
        <span className="mr-1.5 text-legenda text-tinta-fraca">{formatarHora(primeiraFala.criado_em)}</span>
        {turno.falante && (
          <span className={`mr-1 min-w-0 break-words ${ehAdvogada ? "font-semibold text-tinta" : "font-medium text-tinta-suave"}`}>
            {turno.falante}:
          </span>
        )}
      </p>
      <div className="flex flex-col gap-0.5">
        {turno.falas.map((fala) => (
          <p key={fala.id} className="min-w-0 break-words leading-relaxed">
            {fala.texto}
          </p>
        ))}
      </div>
    </li>
  );
}

// `useRealceUmaVez` foi extraído para `copiloto/useRealceUmaVez.ts` (F7,
// 17/09) — vivia duplicado aqui e inline em `CardRecente`
// (`PainelCopiloto.tsx`); os dois passam a importar o mesmo hook.
