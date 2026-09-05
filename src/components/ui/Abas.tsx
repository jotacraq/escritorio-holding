"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface DefinicaoAba {
  id: string;
  rotulo: string;
  conteudo: ReactNode;
  /**
   * U3 — agrupa abas num segundo nível ("Preparação", "Sessão", ...).
   * Abas sem grupo caem numa lista plana, exatamente como antes.
   */
  grupo?: string;
  /** Contador ou selo curto à direita do rótulo (ex.: pendências). */
  extra?: ReactNode;
}

interface Grupo {
  rotulo: string;
  slug: string;
  abas: DefinicaoAba[];
}

function slugificar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function agrupar(abas: DefinicaoAba[]): Grupo[] {
  const ordem: string[] = [];
  const mapa = new Map<string, DefinicaoAba[]>();
  for (const aba of abas) {
    const chave = aba.grupo ?? "";
    if (!mapa.has(chave)) {
      ordem.push(chave);
      mapa.set(chave, []);
    }
    mapa.get(chave)!.push(aba);
  }
  return ordem.map((chave) => ({ rotulo: chave, slug: slugificar(chave) || "geral", abas: mapa.get(chave)! }));
}

/**
 * Navegação por abas. `role=tablist` com setas do teclado; alvo de clique
 * ≥ 44px em cada aba; aba ativa marcada por sublinhado laranja de 3px +
 * peso — nunca só cor.
 *
 * `deepLinkHash` (U3): quando ligado, a aba ativa é espelhada no hash da URL
 * (`#briefing`), lida na primeira renderização e reagindo a mudanças
 * externas de hash. Desligado por padrão.
 *
 * `semMoldura`: renderiza o painel sem o cartão branco em volta (para quando
 * o conteúdo já é feito de cartões).
 */
export function Abas({
  abas,
  abaInicial,
  deepLinkHash = false,
  semMoldura = false,
}: {
  abas: DefinicaoAba[];
  abaInicial?: string;
  deepLinkHash?: boolean;
  semMoldura?: boolean;
}) {
  const [ativa, setAtiva] = useState(() => abaInicial ?? abas[0]?.id);
  const referencias = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (!deepLinkHash || typeof window === "undefined") return;
    const doHash = window.location.hash.slice(1);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (doHash && abas.some((a) => a.id === doHash)) setAtiva(doHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkHash]);

  useEffect(() => {
    if (!deepLinkHash) return;
    function aoMudarHash() {
      const doHash = window.location.hash.slice(1);
      if (doHash && abas.some((a) => a.id === doHash)) setAtiva(doHash);
    }
    window.addEventListener("hashchange", aoMudarHash);
    return () => window.removeEventListener("hashchange", aoMudarHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkHash]);

  function ativar(id: string) {
    setAtiva(id);
    if (deepLinkHash && typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${id}`);
    }
  }

  function aoTeclar(evento: KeyboardEvent, lista: DefinicaoAba[], indice: number) {
    let proximo: number | null = null;
    if (evento.key === "ArrowRight") proximo = (indice + 1) % lista.length;
    else if (evento.key === "ArrowLeft") proximo = (indice - 1 + lista.length) % lista.length;
    else if (evento.key === "Home") proximo = 0;
    else if (evento.key === "End") proximo = lista.length - 1;
    if (proximo === null) return;
    evento.preventDefault();
    const id = lista[proximo].id;
    ativar(id);
    referencias.current[id]?.focus();
  }

  const temGrupos = abas.some((a) => a.grupo);
  const abaAtual = abas.find((a) => a.id === ativa) ?? abas[0];

  const grupos = temGrupos ? agrupar(abas) : null;
  const grupoAtivo = grupos ? grupos.find((g) => g.abas.some((a) => a.id === abaAtual.id)) ?? grupos[0] : null;
  const abasVisiveis = grupoAtivo ? grupoAtivo.abas : abas;

  return (
    <div>
      {grupos && grupoAtivo && (
        // Nível 1 — seções do dossiê. Botões simples com `aria-current`, no
        // mesmo padrão da navegação lateral — não é um segundo `tablist`.
        <div aria-label="Seções da ficha" className="nao-imprimir mb-1 flex flex-wrap gap-1">
          {grupos.map((grupo) => {
            const selecionado = grupo.slug === grupoAtivo.slug;
            return (
              <button
                key={grupo.slug}
                type="button"
                aria-current={selecionado ? "true" : undefined}
                onClick={() => !selecionado && ativar(grupo.abas[0].id)}
                className={`min-h-11 rounded-full px-4 text-rotulo font-bold uppercase transition-colors duration-[var(--transicao-rapida)] ${
                  selecionado
                    ? "bg-[color:var(--tinta)] text-[color:var(--papel-elevado)]"
                    : "text-tinta-suave hover:bg-papel-elevado hover:text-tinta"
                }`}
              >
                {grupo.rotulo}
              </button>
            );
          })}
        </div>
      )}

      <div
        role="tablist"
        aria-label={grupoAtivo ? `Seções de ${grupoAtivo.rotulo}` : "Seções da ficha"}
        className="nao-imprimir -mb-px flex flex-wrap gap-1 border-b border-linha-forte"
      >
        {abasVisiveis.map((aba) => {
          const selecionada = aba.id === abaAtual.id;
          const indice = abasVisiveis.indexOf(aba);
          return (
            <button
              key={aba.id}
              ref={(el) => {
                referencias.current[aba.id] = el;
              }}
              role="tab"
              id={`aba-${aba.id}`}
              aria-selected={selecionada}
              aria-controls={`painel-${aba.id}`}
              tabIndex={selecionada ? 0 : -1}
              onKeyDown={(e) => aoTeclar(e, abasVisiveis, indice)}
              onClick={() => ativar(aba.id)}
              className={`-mb-px inline-flex min-h-11 items-center gap-2 rounded-t-controle border-b-[3px] px-4 text-sm transition-colors duration-[var(--transicao-rapida)] ${
                selecionada
                  ? "border-[color:var(--latao)] font-bold text-tinta"
                  : "border-transparent font-medium text-tinta-suave hover:bg-papel-elevado hover:text-tinta"
              }`}
            >
              {aba.rotulo}
              {aba.extra}
            </button>
          );
        })}
      </div>

      {abas.map((aba) => (
        <div
          key={aba.id}
          role="tabpanel"
          id={`painel-${aba.id}`}
          aria-labelledby={`aba-${aba.id}`}
          hidden={aba.id !== abaAtual.id}
          tabIndex={0}
          className={
            semMoldura
              ? "pt-5"
              : "rounded-b-cartao rounded-tr-cartao border border-t-0 border-linha bg-papel-elevado p-4 shadow-cartao sm:p-6"
          }
        >
          {aba.id === abaAtual.id ? aba.conteudo : null}
        </div>
      ))}
    </div>
  );
}
