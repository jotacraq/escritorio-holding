"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type TomToast = "sucesso" | "erro" | "aviso" | "info";

export interface OpcoesToast {
  tom?: TomToast;
  titulo: string;
  /** Uma linha a mais — em erro, sempre o que fazer. */
  descricao?: string;
  /** Ação inline (ex.: "Desfazer", "Ver"). */
  acao?: { rotulo: string; aoClicar: () => void };
  /** ms; erro não some sozinho por padrão. */
  duracao?: number;
}

interface ToastVivo extends OpcoesToast {
  id: number;
  tom: TomToast;
}

interface ContextoToast {
  notificar: (opcoes: OpcoesToast) => number;
  fechar: (id: number) => void;
}

const Contexto = createContext<ContextoToast | null>(null);

const DURACAO_PADRAO: Record<TomToast, number> = { sucesso: 4000, info: 5000, aviso: 7000, erro: 0 };
const MAXIMO_VISIVEL = 4;

const ESTILO: Record<TomToast, { faixa: string; icone: ReactNode }> = {
  sucesso: {
    faixa: "bg-[color:var(--verde)]",
    icone: <path d="M4.5 10.5l3.6 3.5 7.4-8" />,
  },
  erro: {
    faixa: "bg-[color:var(--vermelho)]",
    icone: <path d="M10 6v5M10 14.2v.1M4 16h12L10 4 4 16z" />,
  },
  aviso: {
    faixa: "bg-ambar-borda",
    icone: <path d="M10 6.5v4.5M10 14.2v.1M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14z" />,
  },
  info: {
    faixa: "bg-[color:var(--azul)]",
    icone: <path d="M10 9v5M10 6.2v.1M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14z" />,
  },
};

/**
 * Feedback de ação, sem biblioteca. Empilha até 4 no canto inferior direito
 * (embaixo no celular), cada um com faixa colorida + ícone + texto (nunca só
 * cor). `aria-live="polite"` para sucesso/info e `assertive` para erro —
 * duas regiões separadas, para o leitor de tela não engolir um erro atrás
 * de um sucesso. Erro fica até ser fechado.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastVivo[]>([]);
  const contador = useRef(0);

  const fechar = useCallback((id: number) => {
    setToasts((lista) => lista.filter((t) => t.id !== id));
  }, []);

  const notificar = useCallback((opcoes: OpcoesToast) => {
    const id = ++contador.current;
    const tom = opcoes.tom ?? "info";
    setToasts((lista) => [...lista.slice(-(MAXIMO_VISIVEL - 1)), { ...opcoes, tom, id }]);
    return id;
  }, []);

  const valor = useMemo(() => ({ notificar, fechar }), [notificar, fechar]);

  const educados = toasts.filter((t) => t.tom !== "erro");
  const urgentes = toasts.filter((t) => t.tom === "erro");

  return (
    <Contexto.Provider value={valor}>
      {children}
      <div className="nao-imprimir pointer-events-none fixed inset-x-3 bottom-3 z-[60] flex flex-col items-end gap-2 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-96">
        <div role="status" aria-live="polite" className="contents">
          {educados.map((t) => (
            <ItemToast key={t.id} toast={t} aoFechar={fechar} />
          ))}
        </div>
        <div role="alert" aria-live="assertive" className="contents">
          {urgentes.map((t) => (
            <ItemToast key={t.id} toast={t} aoFechar={fechar} />
          ))}
        </div>
      </div>
    </Contexto.Provider>
  );
}

function ItemToast({ toast, aoFechar }: { toast: ToastVivo; aoFechar: (id: number) => void }) {
  const duracao = toast.duracao ?? DURACAO_PADRAO[toast.tom];
  const [pausado, setPausado] = useState(false);

  useEffect(() => {
    if (!duracao || pausado) return;
    const id = window.setTimeout(() => aoFechar(toast.id), duracao);
    return () => window.clearTimeout(id);
  }, [duracao, pausado, toast.id, aoFechar]);

  const estilo = ESTILO[toast.tom];
  return (
    <div
      className="anim-surgir pointer-events-auto flex w-full items-stretch overflow-hidden rounded-controle border border-linha bg-papel-elevado shadow-flutuante"
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      onFocus={() => setPausado(true)}
      onBlur={() => setPausado(false)}
    >
      <span aria-hidden="true" className={`w-1.5 shrink-0 ${estilo.faixa}`} />
      <div className="flex min-w-0 flex-1 items-start gap-3 px-3.5 py-3">
        <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-5 w-5 shrink-0 text-tinta" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {estilo.icone}
        </svg>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-tinta">{toast.titulo}</p>
          {toast.descricao && <p className="mt-0.5 text-xs text-tinta-suave">{toast.descricao}</p>}
          {toast.acao && (
            <button
              type="button"
              onClick={() => {
                toast.acao?.aoClicar();
                aoFechar(toast.id);
              }}
              className="mt-1.5 inline-flex min-h-11 items-center text-sm font-bold text-[color:var(--latao)] underline-offset-4 hover:underline"
            >
              {toast.acao.rotulo}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => aoFechar(toast.id)}
          aria-label="Fechar aviso"
          className="-mr-1.5 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-tinta-fraca transition-colors duration-[var(--transicao-rapida)] hover:bg-papel hover:text-tinta"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * `const { notificar } = useToast(); notificar({ tom: "sucesso", titulo: "Salvo" })`.
 * Fora do provider (teste, storybook) vira no-op em vez de quebrar a tela.
 */
export function useToast(): ContextoToast {
  const ctx = useContext(Contexto);
  return ctx ?? { notificar: () => 0, fechar: () => undefined };
}
