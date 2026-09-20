"use client";

import { useEffect, useState } from "react";
import type { SegmentoCopiloto } from "@/types/copiloto";

/** Limiares de silêncio na sala, em segundos — `copiloto_sessao.
 * silencio_atencao_s`/`silencio_alerta_s` (migration 0122, valores de
 * fábrica 12/25). 🔴 F3-2 (Fable, rodada 3, 18/09): o payload de polling
 * (`EstadoCopilotoComPolling`) JÁ expõe as duas chaves desde `estado.ts` —
 * `usePollingCopiloto` agora as copia para `silencioAtencaoS`/
 * `silencioAlertaS` e este componente as recebe por PROP (abaixo), nunca
 * mais como constante fixa. Os valores de fábrica só sobrevivem como
 * default de prop, para o instante antes da 1ª resposta do polling. */

/** Recalcula o indicador a cada segundo — o cálculo em si é PURO (função de
 * `agora - ultimaFalaEm`), só o "agora" precisa de um relógio para a cor
 * mudar sozinha mesmo sem nenhum segmento novo chegar (a sala pode ficar
 * calada por 25s sem nenhum evento de polling trazer novidade). */
const INTERVALO_RELOGIO_MS = 1000;

type NivelSilencio = "ouvindo" | "atencao" | "alerta";

/** Cálculo PURO no cliente sobre `segmentos` que o poller já traz — ZERO
 * chamada nova ao backend, exatamente como o plano pede. `null` (sem nenhum
 * segmento ainda) é tratado como "ouvindo" — silêncio antes da 1ª fala não é
 * o mesmo fato que silêncio DEPOIS de já ter havido conversa. Limiares
 * agora vêm do SERVIDOR (`copiloto_sessao.silencio_atencao_s`/
 * `silencio_alerta_s`), nunca mais fixos aqui. */
function calcularNivel(
  ultimaFalaEm: string | null,
  agoraMs: number,
  silencioAtencaoS: number,
  silencioAlertaS: number,
): NivelSilencio {
  if (!ultimaFalaEm) return "ouvindo";
  const segundos = (agoraMs - new Date(ultimaFalaEm).getTime()) / 1000;
  if (segundos >= silencioAlertaS) return "alerta";
  if (segundos >= silencioAtencaoS) return "atencao";
  return "ouvindo";
}

const ROTULO_NIVEL: Record<NivelSilencio, string> = {
  ouvindo: "ouvindo",
  atencao: "sem áudio",
  alerta: "sem captura",
};

/** Tokens `--estado-*` (≥7:1) — nunca `--verde`/`--ambar`/`--vermelho` crus.
 * Cor nunca é o único portador: o rótulo por extenso acompanha sempre. */
const COR_NIVEL: Record<NivelSilencio, string> = {
  ouvindo: "var(--estado-verde)",
  atencao: "var(--estado-ambar)",
  alerta: "var(--estado-vermelho)",
};

/**
 * F4 (18/09) — faixa de 1 linha no rodapé (linha 2 do grid de
 * `PainelCopiloto.tsx`): indicador de saúde da captura + última fala
 * corrente.
 *
 * 🔴 Fase 13 (FE-5, 19/09) — **o overlay saiu inteiro, e com ele o botão
 * "Abrir transcrição"** (~60 linhas, incluindo o SEGUNDO ponto de montagem
 * de `PainelTranscricao` em toda a árvore). O que sobra aqui é o SINAL, e só
 * ele: ponto colorido + rótulo por extenso + última fala com reticências +
 * `sr-only` `aria-live="polite"`. Uma linha, sempre, em qualquer aba.
 *
 * Por que isso importa e não é só "menos código": o achado que desligou esta
 * chave em 18/09 foi "transcrição duplicada" — a COL 3 e o overlay
 * renderizavam a mesma coisa. Depois desta fase **não existe mais um segundo
 * lugar que renderize a transcrição** (ela é uma aba da COL 3, e só), então
 * ligar a chave deixa de ser o estado intermediário que ninguém testou.
 *
 * A separação que o desenho da Fase 13 faz (§A.1): **o SINAL é permanente, o
 * CONTEÚDO é aba.** Se a transcrição vira aba e o sinal some junto, o pedido
 * do dono ("a transcrição é apenas para captar com clareza se o bot está
 * operante") é traído pelo pedido de layout. Esta linha é a resposta
 * permanente a "o bot está vivo?" — custa 44 px do orçamento da dobra
 * (§C.1), e é o que ela não pode perder ao trocar de aba.
 *
 * Indicador tricolor, medido na sessão real citada no plano (fala chega a
 * cada 2,9s em média; p99 8,7s; maior silêncio real observado 15,8s):
 *   🟢 ouvindo (<12s desde a última fala)
 *   🟡 sem áudio há Ns (12–25s)
 *   🔴 sem captura (>25s)
 * 12s fica acima do p99 medido; 25s acima do maior silêncio real E de um
 * ciclo de polling inteiro — nenhum dos dois limiares deveria disparar por
 * ritmo normal de conversa, só por captura de fato interrompida.
 */
export function RodapeTranscricao({
  segmentos,
  sessaoEncerrada,
  silencioAtencaoS = 12,
  silencioAlertaS = 25,
}: {
  segmentos: SegmentoCopiloto[];
  sessaoEncerrada: boolean;
  /** `copiloto_sessao.silencio_atencao_s`/`silencio_alerta_s` (0122) — vêm
   * de `usePollingCopiloto` (F3-2). Defaults só cobrem o instante antes da
   * 1ª resposta do polling (mesmos valores de fábrica da migration). */
  silencioAtencaoS?: number;
  silencioAlertaS?: number;
}) {
  const [agoraMs, setAgoraMs] = useState(() => Date.now());

  const ultimoSegmento = segmentos.length > 0 ? segmentos[segmentos.length - 1] : null;

  // Relógio de 1 tick/s SÓ existe enquanto há uma última fala para o nível
  // poder envelhecer — sem nenhum segmento ainda, o nível é sempre "ouvindo"
  // (`calcularNivel` com `ultimaFalaEm=null`) e não muda com o tempo, então
  // nenhum timer é necessário. Além de economizar um timer sempre-ligado sem
  // propósito, isto evita um efeito colateral medido: um `setInterval`
  // concorrendo com o timer de `usePollingCopiloto` sob `vi.useFakeTimers()`
  // atrasava a resolução de promises mockadas em testes que nem exercitam
  // este componente (`PainelCopiloto.test.tsx`, suíte "Me ajuda agora").
  useEffect(() => {
    if (sessaoEncerrada || !ultimoSegmento) return;
    const id = window.setInterval(() => setAgoraMs(Date.now()), INTERVALO_RELOGIO_MS);
    return () => window.clearInterval(id);
  }, [sessaoEncerrada, ultimoSegmento]);

  const nivel: NivelSilencio = sessaoEncerrada
    ? "ouvindo"
    : calcularNivel(ultimoSegmento?.criado_em ?? null, agoraMs, silencioAtencaoS, silencioAlertaS);
  const segundosSemFala = ultimoSegmento ? Math.floor((agoraMs - new Date(ultimoSegmento.criado_em).getTime()) / 1000) : null;

  const rotulo =
    nivel === "ouvindo"
      ? "ouvindo"
      : nivel === "atencao"
        ? `sem áudio há ${segundosSemFala}s`
        : `sem captura há ${segundosSemFala}s`;

  return (
    <div className="flex min-h-11 items-center gap-2 rounded-controle border border-linha bg-papel-elevado px-3 py-1.5 text-sm">
      <span
        aria-hidden="true"
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: COR_NIVEL[nivel] }}
      />
      <span className="shrink-0 font-medium text-tinta" style={{ color: nivel === "ouvindo" ? undefined : COR_NIVEL[nivel] }}>
        {ROTULO_NIVEL[nivel]}
      </span>
      <span className="sr-only" role="status" aria-live="polite">
        {sessaoEncerrada ? "transcrição encerrada" : rotulo}
      </span>

      {ultimoSegmento ? (
        <p className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-tinta-suave" title={ultimoSegmento.texto}>
          &ldquo;{ultimoSegmento.texto}&rdquo;
        </p>
      ) : (
        <p className="min-w-0 flex-1 text-tinta-fraca">Aguardando a fala da sessão.</p>
      )}
    </div>
  );
}
