"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Fase 12, F7 (17/09) — extraído de `PainelTranscricao.tsx` (estava
 * duplicado ali e inline em `CardRecente`, `PainelCopiloto.tsx`): o CONTRATO
 * de todo gatilho visual do "sistema vivo" pedido pelo dono. Dispara UMA vez
 * por `chave` (ref de chaves já vistas, nunca em re-render), reinicia só
 * quando a CHAVE muda — nunca se repete no mesmo item, mesmo que `ativo`
 * oscile (ex.: o item deixa de ser o mais recente e volta a ser, o que não
 * acontece hoje mas não deve reacender o realce se acontecer).
 *
 * 🔴 CORREÇÃO (Fable, 17/09) — a versão anterior soltava a classe de
 * destaque num `requestAnimationFrame` (1 frame depois de ligar), herança do
 * mecanismo ANTIGO (`.transicao-realce-insight`, uma `transition` de
 * `background-color`): ali remover a classe DISPARAVA a volta ao neutro —
 * era o gatilho certo. A migração para `@keyframes`
 * (`anim-decair-destaque`/`anim-pulsar-uma-vez`) manteve o toggle de 1 frame
 * por engano: em CSS Animations, remover a classe que carrega
 * `animation-name` CANCELA a animação em andamento — o navegador nunca chega
 * a pintar o keyframe. Resultado medido: 6 gatilhos do "sistema vivo"
 * animavam 1 frame e paravam (efetivamente nada visível).
 *
 * A duração agora é dada pelo chamador (`duracaoMs`) e tem de CASAR com a
 * duração do `@keyframes` aplicado pela classe CSS correspondente — é a
 * classe que ainda decide a curva/timing da animação; este hook só decide
 * POR QUANTO TEMPO ela fica montada no DOM. Errar a duração aqui não quebra
 * a animação (ela toca do jeito que o CSS descreve), mas ou solta a classe
 * antes do fim (corta o "decair" no meio) ou segura além da duração real
 * (classe presente sem efeito visual, inofensivo mas sujo). `prefers-
 * reduced-motion` é tratado GLOBALMENTE em `globals.css` — este hook nunca
 * duplica a media query.
 *
 * Uso: `const destacar = useRealceUmaVez(condicaoDeSerONovo, chaveUnica,
 * 5000);` — o componente aplica a classe de animação (`anim-entrar-e-decair`,
 * `anim-pulsar-uma-vez` etc.) enquanto `destacar` é `true`, com `duracaoMs`
 * igual à duração do `@keyframes` daquela classe.
 */
export function useRealceUmaVez(ativo: boolean, chave: string, duracaoMs: number): boolean {
  const [comDestaque, setComDestaque] = useState(ativo);
  const chaveJaRealcadaRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ativo || chaveJaRealcadaRef.current === chave) {
      setComDestaque(false);
      return;
    }
    chaveJaRealcadaRef.current = chave;
    setComDestaque(true);
    const temporizador = setTimeout(() => setComDestaque(false), duracaoMs);
    return () => clearTimeout(temporizador);
  }, [ativo, chave, duracaoMs]);

  return comDestaque;
}
