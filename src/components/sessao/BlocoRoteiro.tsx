"use client";

import type { RoteiroBloco } from "@/types/roteiro";
import { useNotaLocal } from "@/components/sessao/useNotasLocais";
import { AreaTexto, Campo } from "@/components/ui/Campo";

/**
 * Uma PARTE do roteiro, por vez. A hierarquia visual é a regra de negócio:
 * FALA (o que dizer, palavra por palavra) > AÇÃO (o que fazer/não fazer,
 * ex. "FICAR CALADO até o cliente perguntar o preço") > PROIBIDO (o que
 * nunca dizer) > OBSERVAR (o que reparar na resposta do cliente). Perder a
 * "AÇÃO" no meio do texto é o erro que esta tela existe para evitar.
 */
export function BlocoRoteiro({ sessaoId, bloco, indice, total }: { sessaoId: string; bloco: RoteiroBloco; indice: number; total: number }) {
  const nota = useNotaLocal(sessaoId, bloco.id);

  return (
    <article aria-labelledby="titulo-parte-atual" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <p className="text-rotulo font-medium uppercase text-[color:var(--latao)]">
          Parte {String(indice).padStart(2, "0")} de {total - 1}
        </p>
        <h2 id="titulo-parte-atual" className="text-titulo font-bold text-tinta sm:text-display">
          {bloco.titulo}
        </h2>
        {bloco.objetivo && <p className="text-corpo text-tinta-suave">{bloco.objetivo}</p>}
      </header>

      {bloco.acao && (
        <div role="alert" className="flex items-start gap-2.5 rounded-controle border-2 border-ambar-borda bg-ambar-fraco px-4 py-3">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-5 w-5 shrink-0 fill-current text-[color:var(--ambar)]">
            <path d="M10 1.5 19 17H1L10 1.5Zm0 5.4a1 1 0 0 0-1 1v3.4a1 1 0 1 0 2 0V7.9a1 1 0 0 0-1-1Zm0 7.2a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z" />
          </svg>
          <p className="text-subtitulo font-bold leading-snug text-[color:var(--ambar)]">{bloco.acao}</p>
        </div>
      )}

      {bloco.falas.length > 0 && (
        <ul className="flex flex-col gap-3">
          {bloco.falas.map((fala) => (
            <li key={fala.id} className="rounded-controle border-l-4 border-l-[color:var(--latao-cta)] bg-papel px-4 py-3">
              {fala.locutor && <p className="mb-1 text-rotulo font-medium uppercase text-tinta-fraca">{fala.locutor}</p>}
              <blockquote className="text-subtitulo leading-relaxed text-tinta sm:text-[1.25rem]">“{fala.texto}”</blockquote>
              {fala.rotulo_sim && (
                <p className="mt-1 text-xs font-medium text-[color:var(--latao)]">{fala.rotulo_sim} — ver painel dos 4 SIMs acima</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {bloco.proibido.length > 0 && (
        <div role="alert" className="rounded-controle border-2 border-[color:var(--vermelho)] bg-vermelho-fraco px-4 py-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-rotulo font-bold uppercase text-[color:var(--vermelho)]">
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-current">
              <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm3.5 4.5-7 7m0-7 7 7" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
            </svg>
            Nunca diga
          </p>
          <ul className="flex flex-col gap-1 text-sm text-[color:var(--vermelho)]">
            {bloco.proibido.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {bloco.observar.length > 0 && (
        <div className="rounded-controle border border-[color:var(--azul)] bg-azul-fraco px-4 py-3">
          <p className="mb-1.5 text-rotulo font-bold uppercase text-[color:var(--azul)]">Observar na resposta</p>
          <ul className="flex flex-col gap-1 text-sm text-[color:var(--azul)]">
            {bloco.observar.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="nao-imprimir">
        <Campo rotulo="Anotação rápida desta parte" ajuda="Fica só neste navegador — não entra no prontuário." id={`nota-${bloco.id}`}>
          <AreaTexto value={nota.valor} onChange={(e) => nota.salvar(e.target.value)} rows={2} placeholder="Ex.: filho mais velho hesitou ao falar do imóvel da praia…" />
        </Campo>
      </div>
    </article>
  );
}
