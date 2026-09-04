"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { listarJornadas, ApiError, type JornadaKanban } from "@/lib/api";
import { ITENS_NAVEGACAO } from "@/components/shell/Nav";
import { formatarCidadeUf } from "@/lib/formatar";

/**
 * U7 — paleta de comandos (Ctrl+K / Cmd+K). "Buscar pessoa e pular para uma
 * tela sem navegar por menu" — é o que transforma "fácil de operar" em
 * verdade para quem usa o dia inteiro (arquitetura Fase 3, §5.3).
 *
 * Reusa `/api/jornadas` (via `listarJornadas`) — sem endpoint novo, como o
 * plano pede. Sem polling: a busca só dispara quando a pessoa digita, com
 * debounce e cancelamento da resposta anterior.
 */

type Opcao =
  | { tipo: "pagina"; id: string; rotulo: string; href: string }
  | { tipo: "jornada"; id: string; rotulo: string; descricao: string; href: string };

const MIN_CARACTERES_BUSCA_JORNADA = 2;
const ATRASO_DEBOUNCE_MS = 250;

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function paginasFiltradas(consulta: string): Opcao[] {
  const alvo = normalizar(consulta.trim());
  return ITENS_NAVEGACAO.filter((item) => !alvo || normalizar(item.rotulo).includes(alvo)).map((item) => ({
    tipo: "pagina" as const,
    id: item.href,
    rotulo: item.rotulo,
    href: item.href,
  }));
}

function jornadaParaOpcao(j: JornadaKanban): Opcao {
  const detalhe = [formatarCidadeUf(j.cidade, j.uf), j.faixa_patrimonio_declarada].filter(Boolean).join(" · ");
  return { tipo: "jornada", id: j.id, rotulo: j.nome, descricao: detalhe || j.origem, href: `/jornadas/${j.id}` };
}

export function PaletaComandos({ aberta, aoFechar }: { aberta: boolean; aoFechar: () => void }) {
  const router = useRouter();
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
    // Reseta o estado da busca sempre que a paleta abre — cada abertura é
    // uma nova sessão de busca, não uma continuação da anterior.
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
      // Consulta curta demais para buscar — limpa o resultado anterior em
      // vez de deixar uma lista de outra busca na tela.
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
          setErroBusca(e instanceof ApiError ? e.message : "Não foi possível buscar agora.");
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

  const opcoesPagina = useMemo(() => paginasFiltradas(consulta), [consulta]);
  const opcoes = useMemo(() => [...opcoesPagina, ...resultadosJornada], [opcoesPagina, resultadosJornada]);

  const ativar = useCallback(
    (opcao: Opcao) => {
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

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <div role="dialog" aria-modal="true" aria-label="Paleta de comandos" className="w-full max-w-lg overflow-hidden rounded-sm border border-linha-forte bg-papel-elevado shadow-[var(--sombra-cartao)]">
        <div className="flex items-center gap-2 border-b border-linha px-3.5 py-2.5">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 fill-current text-tinta-fraca">
            <path d="M8.5 3a5.5 5.5 0 1 0 3.42 9.83l3.63 3.62a1 1 0 0 0 1.41-1.41l-3.62-3.63A5.5 5.5 0 0 0 8.5 3Zm-3.5 5.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0Z" />
          </svg>
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls="lista-paleta-comandos"
            aria-activedescendant={idAtivo}
            aria-autocomplete="list"
            aria-label="Buscar pessoa, jornada ou tela"
            value={consulta}
            onChange={(e) => {
              setConsulta(e.target.value);
              setIndiceAtivo(0);
            }}
            onKeyDown={aoTeclarInput}
            placeholder="Buscar pessoa ou pular para uma tela…"
            className="w-full bg-transparent text-sm text-tinta outline-none placeholder:text-tinta-fraca"
          />
          <button
            ref={fecharRef}
            type="button"
            onClick={aoFechar}
            onKeyDown={aoTeclarFechar}
            aria-label="Fechar paleta de comandos"
            className="shrink-0 rounded-sm border border-linha-forte px-1.5 py-0.5 font-mono text-[11px] text-tinta-suave hover:text-tinta"
          >
            Esc
          </button>
        </div>

        <ul id="lista-paleta-comandos" role="listbox" aria-label="Resultados" ref={listaRef} className="max-h-80 overflow-y-auto py-1.5">
          {opcoesPagina.length > 0 && (
            <li role="presentation" className="px-3.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-tinta-fraca">
              Telas
            </li>
          )}
          {opcoesPagina.map((opcao, i) => (
            <li key={opcao.id}>
              <button
                type="button"
                id={`opcao-${opcao.tipo}-${opcao.id}`}
                role="option"
                data-indice={i}
                aria-selected={i === indiceAtivo}
                onMouseEnter={() => setIndiceAtivo(i)}
                onClick={() => ativar(opcao)}
                className={`flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm ${i === indiceAtivo ? "bg-[color:var(--latao-fraco)] text-tinta" : "text-tinta"}`}
              >
                {opcao.rotulo}
              </button>
            </li>
          ))}

          {(resultadosJornada.length > 0 || buscando || erroBusca || consulta.trim().length >= MIN_CARACTERES_BUSCA_JORNADA) && (
            <li role="presentation" className="px-3.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-tinta-fraca">
              Pessoas e jornadas
            </li>
          )}
          {resultadosJornada.map((opcao, i) => {
            const indiceGlobal = opcoesPagina.length + i;
            return (
              <li key={opcao.id}>
                <button
                  type="button"
                  id={`opcao-${opcao.tipo}-${opcao.id}`}
                  role="option"
                  data-indice={indiceGlobal}
                  aria-selected={indiceGlobal === indiceAtivo}
                  onMouseEnter={() => setIndiceAtivo(indiceGlobal)}
                  onClick={() => ativar(opcao)}
                  className={`flex w-full flex-col items-start gap-0.5 px-3.5 py-2 text-left text-sm ${indiceGlobal === indiceAtivo ? "bg-[color:var(--latao-fraco)] text-tinta" : "text-tinta"}`}
                >
                  <span>{opcao.rotulo}</span>
                  {opcao.tipo === "jornada" && opcao.descricao && <span className="text-xs text-tinta-fraca">{opcao.descricao}</span>}
                </button>
              </li>
            );
          })}

          {buscando && (
            <li role="presentation" className="px-3.5 py-2.5 text-sm text-tinta-fraca">
              Buscando…
            </li>
          )}
          {!buscando && erroBusca && (
            <li role="presentation" className="px-3.5 py-2.5 text-sm text-[color:var(--vermelho)]">
              {erroBusca}
            </li>
          )}
          {!buscando && !erroBusca && opcoes.length === 0 && consulta.trim().length > 0 && (
            <li role="presentation" className="px-3.5 py-2.5 text-sm text-tinta-fraca">
              Nada encontrado para &ldquo;{consulta.trim()}&rdquo;.
            </li>
          )}
        </ul>

        <div className="flex items-center gap-3 border-t border-linha px-3.5 py-2 text-[11px] text-tinta-fraca">
          <span className="flex items-center gap-1">
            <kbd className="rounded-sm border border-linha-forte bg-papel px-1.5 py-0.5 font-mono">↑</kbd>
            <kbd className="rounded-sm border border-linha-forte bg-papel px-1.5 py-0.5 font-mono">↓</kbd>
            navega
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded-sm border border-linha-forte bg-papel px-1.5 py-0.5 font-mono">Enter</kbd>
            abre
          </span>
        </div>
      </div>
    </div>
  );
}
