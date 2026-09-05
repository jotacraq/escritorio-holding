"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { listarJornadas, ApiError, type JornadaKanban } from "@/lib/api";
import { ITENS_NAVEGACAO } from "@/components/shell/Nav";
import { formatarCidadeUf } from "@/lib/formatar";
import { useTema } from "@/hooks/useTema";

/**
 * U7 — paleta de comandos (Ctrl+K / Cmd+K): buscar um cliente e pular para
 * uma tela sem navegar por menu. Três grupos: "Ir para" (telas, com a
 * descrição de uma linha da navegação), "Clientes" (busca em `/api/jornadas`
 * — sem endpoint novo, com debounce e cancelamento) e "Ações" (coisas que
 * não são tela: tema, imprimir).
 */

type Opcao =
  | { tipo: "pagina"; id: string; rotulo: string; descricao: string; href: string }
  | { tipo: "jornada"; id: string; rotulo: string; descricao: string; href: string }
  | { tipo: "acao"; id: string; rotulo: string; descricao: string; executar: () => void };

const MIN_CARACTERES_BUSCA_JORNADA = 2;
const ATRASO_DEBOUNCE_MS = 250;

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function contem(alvo: string, ...campos: string[]): boolean {
  return !alvo || campos.some((c) => normalizar(c).includes(alvo));
}

function jornadaParaOpcao(j: JornadaKanban): Opcao {
  const detalhe = [formatarCidadeUf(j.cidade, j.uf), j.faixa_patrimonio_declarada].filter(Boolean).join(" · ");
  return { tipo: "jornada", id: j.id, rotulo: j.nome, descricao: detalhe || j.origem, href: `/jornadas/${j.id}` };
}

const ICONE: Record<Opcao["tipo"], ReactNode> = {
  pagina: <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 14.5v-9ZM7 8h6M7 11h4" />,
  jornada: <path d="M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 7a6 6 0 0 1 12 0" />,
  acao: <path d="M11 3 5 11h4l-1 6 6-8h-4l1-6Z" />,
};

export function PaletaComandos({ aberta, aoFechar }: { aberta: boolean; aoFechar: () => void }) {
  const router = useRouter();
  const { tema, alternar } = useTema();
  const [consulta, setConsulta] = useState("");
  const [resultadosJornada, setResultadosJornada] = useState<Opcao[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [erroBusca, setErroBusca] = useState<string | null>(null);
  const [indiceAtivo, setIndiceAtivo] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const fecharRef = useRef<HTMLButtonElement>(null);
  const listaRef = useRef<HTMLUListElement>(null);
  const focoAnteriorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!aberta) return;
    focoAnteriorRef.current = document.activeElement as HTMLElement | null;
    /* eslint-disable react-hooks/set-state-in-effect */
    setConsulta("");
    setResultadosJornada([]);
    setErroBusca(null);
    setIndiceAtivo(0);
    /* eslint-enable react-hooks/set-state-in-effect */
    const documentoOriginal = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = documentoOriginal;
      window.clearTimeout(id);
      focoAnteriorRef.current?.focus();
    };
  }, [aberta]);

  useEffect(() => {
    if (!aberta) return;
    const termo = consulta.trim();
    if (termo.length < MIN_CARACTERES_BUSCA_JORNADA) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setResultadosJornada([]);
      setBuscando(false);
      setErroBusca(null);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }
    let vivo = true;
    setBuscando(true);
    const temporizador = window.setTimeout(() => {
      listarJornadas({ busca: termo, incluir_fechadas: true })
        .then((res) => {
          if (!vivo) return;
          setResultadosJornada(res.itens.slice(0, 8).map(jornadaParaOpcao));
          setErroBusca(null);
          setIndiceAtivo(0);
        })
        .catch((e) => {
          if (!vivo) return;
          setResultadosJornada([]);
          setErroBusca(e instanceof ApiError ? e.message : "Não foi possível buscar agora. Tente de novo em instantes.");
        })
        .finally(() => {
          if (vivo) setBuscando(false);
        });
    }, ATRASO_DEBOUNCE_MS);
    return () => {
      vivo = false;
      window.clearTimeout(temporizador);
    };
  }, [consulta, aberta]);

  const alvo = normalizar(consulta.trim());

  const opcoesPagina = useMemo<Opcao[]>(
    () =>
      ITENS_NAVEGACAO.filter((item) => contem(alvo, item.rotulo, item.descricao, item.grupo)).map((item) => ({
        tipo: "pagina" as const,
        id: item.href,
        rotulo: item.rotulo,
        descricao: item.descricao,
        href: item.href,
      })),
    [alvo],
  );

  const opcoesAcao = useMemo<Opcao[]>(() => {
    const todas: Opcao[] = [
      {
        tipo: "acao",
        id: "tema",
        rotulo: tema === "escuro" ? "Usar tema claro" : "Usar tema escuro",
        descricao: "Troca as cores do sistema inteiro.",
        executar: alternar,
      },
      {
        tipo: "acao",
        id: "imprimir",
        rotulo: "Imprimir esta tela",
        descricao: "Abre a impressão do navegador (ou salvar em PDF).",
        executar: () => window.print(),
      },
    ];
    return todas.filter((a) => contem(alvo, a.rotulo, a.descricao, "tema", "imprimir", "pdf"));
  }, [alvo, tema, alternar]);

  const grupos = useMemo(
    () =>
      [
        { rotulo: "Ir para", opcoes: opcoesPagina },
        { rotulo: "Clientes", opcoes: resultadosJornada },
        { rotulo: "Ações", opcoes: opcoesAcao },
      ].filter((g) => g.opcoes.length > 0),
    [opcoesPagina, resultadosJornada, opcoesAcao],
  );
  const opcoes = useMemo(() => grupos.flatMap((g) => g.opcoes), [grupos]);

  const ativar = useCallback(
    (opcao: Opcao) => {
      if (opcao.tipo === "acao") {
        aoFechar();
        // Depois de fechar, para o foco voltar antes da ação (imprimir bloqueia).
        window.setTimeout(opcao.executar, 0);
        return;
      }
      router.push(opcao.href);
      aoFechar();
    },
    [router, aoFechar],
  );

  function aoTeclarInput(evento: React.KeyboardEvent<HTMLInputElement>) {
    if (evento.key === "ArrowDown") {
      evento.preventDefault();
      setIndiceAtivo((i) => Math.min(i + 1, Math.max(opcoes.length - 1, 0)));
    } else if (evento.key === "ArrowUp") {
      evento.preventDefault();
      setIndiceAtivo((i) => Math.max(i - 1, 0));
    } else if (evento.key === "Home" && opcoes.length > 0) {
      evento.preventDefault();
      setIndiceAtivo(0);
    } else if (evento.key === "End" && opcoes.length > 0) {
      evento.preventDefault();
      setIndiceAtivo(opcoes.length - 1);
    } else if (evento.key === "Enter") {
      evento.preventDefault();
      const opcao = opcoes[indiceAtivo];
      if (opcao) ativar(opcao);
    } else if (evento.key === "Escape") {
      evento.preventDefault();
      aoFechar();
    } else if (evento.key === "Tab" && !evento.shiftKey) {
      evento.preventDefault();
      fecharRef.current?.focus();
    }
  }

  function aoTeclarFechar(evento: React.KeyboardEvent<HTMLButtonElement>) {
    if (evento.key === "Escape") {
      evento.preventDefault();
      aoFechar();
    } else if (evento.key === "Tab" && evento.shiftKey) {
      evento.preventDefault();
      inputRef.current?.focus();
    }
  }

  useEffect(() => {
    const item = listaRef.current?.querySelector<HTMLElement>(`[data-indice="${indiceAtivo}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [indiceAtivo]);

  if (!aberta) return null;

  const idAtivo = opcoes[indiceAtivo] ? `opcao-${opcoes[indiceAtivo].tipo}-${opcoes[indiceAtivo].id}` : undefined;
  const termoLongo = consulta.trim().length >= MIN_CARACTERES_BUSCA_JORNADA;
  let indiceGlobal = -1;

  return (
    <div
      className="anim-esmaecer fixed inset-0 z-50 flex items-start justify-center bg-[color:var(--veu)] px-3 pt-[10vh] sm:px-4"
      onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Buscar cliente ou tela"
        className="anim-surgir flex w-full max-w-xl flex-col overflow-hidden rounded-cartao border border-linha bg-papel-elevado shadow-flutuante"
      >
        <div className="flex items-center gap-3 border-b border-linha px-4 py-2">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 shrink-0 fill-current text-tinta-fraca">
            <path d="M8.5 3a5.5 5.5 0 1 0 3.42 9.83l3.63 3.62a1 1 0 0 0 1.41-1.41l-3.62-3.63A5.5 5.5 0 0 0 8.5 3Zm-3.5 5.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0Z" />
          </svg>
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls="lista-paleta-comandos"
            aria-activedescendant={idAtivo}
            aria-autocomplete="list"
            aria-label="Buscar cliente, tela ou ação"
            value={consulta}
            onChange={(e) => {
              setConsulta(e.target.value);
              setIndiceAtivo(0);
            }}
            onKeyDown={aoTeclarInput}
            placeholder="Nome do cliente, tela ou ação…"
            className="min-h-12 w-full bg-transparent text-corpo text-tinta outline-none placeholder:text-tinta-fraca"
          />
          <button
            ref={fecharRef}
            type="button"
            onClick={aoFechar}
            onKeyDown={aoTeclarFechar}
            aria-label="Fechar"
            className="flex h-11 min-w-11 shrink-0 items-center justify-center rounded-controle border border-linha-forte px-2 font-mono text-legenda text-tinta-suave transition-colors duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)] hover:text-[color:var(--latao)]"
          >
            Esc
          </button>
        </div>

        <ul id="lista-paleta-comandos" role="listbox" aria-label="Resultados" ref={listaRef} className="max-h-[60vh] overflow-y-auto py-2">
          {grupos.map((grupo) => (
            <li key={grupo.rotulo} role="presentation">
              <p className="px-4 pb-1 pt-3 text-rotulo font-medium uppercase text-tinta-fraca">{grupo.rotulo}</p>
              <ul role="group" aria-label={grupo.rotulo}>
                {grupo.opcoes.map((opcao) => {
                  indiceGlobal += 1;
                  const i = indiceGlobal;
                  const selecionada = i === indiceAtivo;
                  return (
                    <li key={`${opcao.tipo}-${opcao.id}`}>
                      <button
                        type="button"
                        id={`opcao-${opcao.tipo}-${opcao.id}`}
                        role="option"
                        data-indice={i}
                        aria-selected={selecionada}
                        onMouseEnter={() => setIndiceAtivo(i)}
                        onClick={() => ativar(opcao)}
                        className={`flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left transition-colors duration-[var(--transicao-rapida)] ${
                          selecionada ? "bg-latao-fraco text-tinta" : "text-tinta"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${selecionada ? "bg-[color:var(--latao-cta)] text-[color:var(--latao-cta-texto)]" : "bg-papel text-tinta-suave"}`}
                        >
                          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                            {ICONE[opcao.tipo]}
                          </svg>
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="text-sm font-medium">{opcao.rotulo}</span>
                          {opcao.descricao && <span className="truncate text-legenda text-tinta-suave">{opcao.descricao}</span>}
                        </span>
                        {selecionada && (
                          <kbd aria-hidden="true" className="ml-auto rounded-md border border-linha-forte bg-papel-elevado px-1.5 py-0.5 font-mono text-legenda text-tinta-fraca">
                            Enter
                          </kbd>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}

          {buscando && (
            <li role="presentation" className="flex items-center gap-2 px-4 py-3 text-sm text-tinta-suave">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-linha-forte border-t-[color:var(--latao-cta)]" aria-hidden="true" />
              Buscando clientes…
            </li>
          )}
          {!buscando && erroBusca && (
            <li role="presentation" className="px-4 py-3 text-sm text-[color:var(--vermelho)]">
              {erroBusca}
            </li>
          )}
          {!buscando && !erroBusca && termoLongo && resultadosJornada.length === 0 && (
            <li role="presentation" className="px-4 py-3 text-sm text-tinta-suave">
              Nenhum cliente com &ldquo;{consulta.trim()}&rdquo;. Confira a grafia ou procure pelo primeiro nome.
            </li>
          )}
          {!termoLongo && consulta.trim().length === 0 && (
            <li role="presentation" className="px-4 pb-1 pt-3 text-xs text-tinta-fraca">
              Digite ao menos 2 letras para buscar um cliente.
            </li>
          )}
        </ul>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-linha bg-papel px-4 py-2.5 text-legenda text-tinta-suave">
          <span className="flex items-center gap-1">
            <kbd className="rounded-md border border-linha-forte bg-papel-elevado px-1.5 py-0.5 font-mono">↑</kbd>
            <kbd className="rounded-md border border-linha-forte bg-papel-elevado px-1.5 py-0.5 font-mono">↓</kbd>
            escolher
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded-md border border-linha-forte bg-papel-elevado px-1.5 py-0.5 font-mono">Enter</kbd>
            abrir
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded-md border border-linha-forte bg-papel-elevado px-1.5 py-0.5 font-mono">Esc</kbd>
            fechar
          </span>
        </div>
      </div>
    </div>
  );
}
