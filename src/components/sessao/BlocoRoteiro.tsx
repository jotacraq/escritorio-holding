"use client";

import type { RoteiroBloco } from "@/types/roteiro";
import { useNotaLocal } from "@/components/sessao/useNotasLocais";

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
        <p className="text-xs font-medium uppercase tracking-wide text-tinta-fraca">
          Parte {indice + 1} de {total}
        </p>
        <h2 id="titulo-parte-atual" className="font-serif text-xl font-semibold leading-tight text-tinta sm:text-2xl">
          {bloco.titulo}
        </h2>
        {bloco.objetivo && <p className="text-sm text-tinta-suave">{bloco.objetivo}</p>}
      </header>

      {bloco.acao && (
        <div role="alert" className="flex items-start gap-2.5 rounded-sm border-2 border-ambar-borda bg-ambar-fraco px-4 py-3">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-5 w-5 shrink-0 fill-current text-[color:var(--ambar)]">
            <path d="M10 1.5 19 17H1L10 1.5Zm0 5.4a1 1 0 0 0-1 1v3.4a1 1 0 1 0 2 0V7.9a1 1 0 0 0-1-1Zm0 7.2a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z" />
          </svg>
          <p className="text-base font-semibold leading-snug text-[color:var(--ambar)]">{bloco.acao}</p>
        </div>
      )}

      {bloco.falas.length > 0 && (
        <ul className="flex flex-col gap-3">
          {bloco.falas.map((fala) => (
            <li key={fala.id} className="rounded-sm border-l-4 border-latao bg-papel-elevado px-4 py-3">
              {fala.locutor && <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-tinta-fraca">{fala.locutor}</p>}
              <blockquote className="font-serif text-lg leading-relaxed text-tinta sm:text-xl">“{fala.texto}”</blockquote>
              {fala.rotulo_sim && (
                <p className="mt-1 text-xs font-medium text-[color:var(--latao)]">{fala.rotulo_sim} — ver painel dos 4 SIMs acima</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {bloco.proibido.length > 0 && (
        <div role="alert" className="rounded-sm border-2 border-vermelho bg-vermelho-fraco px-4 py-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[color:var(--vermelho)]">
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
        <div className="rounded-sm border border-azul bg-azul-fraco px-4 py-3">
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-[color:var(--azul)]">Observar na resposta</p>
          <ul className="flex flex-col gap-1 text-sm text-[color:var(--azul)]">
            {bloco.observar.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="nao-imprimir flex flex-col gap-1">
        <label htmlFor={`nota-${bloco.id}`} className="text-xs font-medium text-tinta-fraca">
          Anotação rápida desta parte — fica só neste navegador, não entra no prontuário
        </label>
        <textarea
          id={`nota-${bloco.id}`}
          value={nota.valor}
          onChange={(e) => nota.salvar(e.target.value)}
          rows={2}
          placeholder="Ex.: filho mais velho hesitou ao falar do imóvel da praia…"
          className="w-full resize-y rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5 text-sm text-tinta placeholder:text-tinta-fraca"
        />
      </div>
    </article>
  );
}
