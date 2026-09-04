"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface DefinicaoAba {
  id: string;
  rotulo: string;
  conteudo: ReactNode;
  /**
   * U3 — agrupa abas num segundo nível ("Preparação", "Sessão", ...).
   * Abas sem grupo caem numa lista plana, exatamente como antes — nenhum
   * consumidor existente (`agenda`, `admin`) precisa mudar.
   */
  grupo?: string;
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
 * Navegação por abas em estilo "guia de pasta" — o dossiê físico do escritório
 * virou o modelo da navegação da Ficha 360. role=tablist com setas do teclado.
 *
 * `deepLinkHash` (U3): quando ligado, a aba ativa é espelhada no hash da URL
 * (`#briefing`), lida na primeira renderização e reagindo a mudanças externas
 * de hash (ex.: um link do `ChecklistPendencias` na mesma página). Desligado
 * por padrão — não muda nada para quem já usa `Abas` sem isso.
 */
export function Abas({ abas, abaInicial, deepLinkHash = false }: { abas: DefinicaoAba[]; abaInicial?: string; deepLinkHash?: boolean }) {
  const [ativa, setAtiva] = useState(() => abaInicial ?? abas[0]?.id);
  const referencias = useRef<Record<string, HTMLButtonElement | null>>({});

  // Aplica o hash da URL só depois de montar — no servidor `window` não
  // existe, e aplicar de cara no render causaria descompasso de hidratação.
  // Leitura de um sistema externo (a URL) uma vez após montar, o mesmo caso
  // legítimo já documentado em `useTema.ts`.
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
    if (evento.key !== "ArrowRight" && evento.key !== "ArrowLeft") return;
    evento.preventDefault();
    const proximo = evento.key === "ArrowRight" ? (indice + 1) % lista.length : (indice - 1 + lista.length) % lista.length;
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
        // Nível 1 — seções do dossiê ("Preparação", "Sessão", ...). Botões
        // simples com `aria-current`, no mesmo padrão da navegação lateral
        // (`Nav.tsx`) — não é um segundo `role=tablist` aninhado, que é um
        // padrão ARIA ambíguo. O teclado funciona pela semântica nativa do
        // `<button>` (Tab, Enter, Espaço), sem roving tabindex customizado.
        <div aria-label="Seções da ficha" className="nao-imprimir flex flex-wrap gap-x-1 border-b border-linha-forte">
          {grupos.map((grupo) => {
            const selecionado = grupo.slug === grupoAtivo.slug;
            return (
              <button
                key={grupo.slug}
                type="button"
                aria-current={selecionado ? "true" : undefined}
                onClick={() => !selecionado && ativar(grupo.abas[0].id)}
                className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                  selecionado ? "border-[color:var(--latao)] text-tinta" : "border-transparent text-tinta-suave hover:border-linha-forte hover:text-tinta"
                }`}
              >
                {grupo.rotulo}
              </button>
            );
          })}
        </div>
      )}

      {/* Nível 2 (ou único nível, quando `abas` não usa `grupo`) — as folhas
          reais do dossiê, com o clip-path de guia de pasta original. */}
      <div
        role="tablist"
        aria-label={grupoAtivo ? `Seções de ${grupoAtivo.rotulo}` : "Seções da ficha"}
        className="nao-imprimir flex flex-wrap gap-0.5 border-b border-linha"
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
              style={{ clipPath: "polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%)" }}
              className={`-mb-px px-4 py-2 text-sm font-medium transition-colors ${
                selecionada ? "border border-b-0 border-linha bg-papel-elevado text-tinta" : "text-tinta-suave hover:text-tinta"
              }`}
            >
              {aba.rotulo}
            </button>
          );
        })}
      </div>

      {abas.map((aba) => (
        <div key={aba.id} role="tabpanel" id={`painel-${aba.id}`} aria-labelledby={`aba-${aba.id}`} hidden={aba.id !== abaAtual.id} className="border border-t-0 border-linha bg-papel-elevado p-4 sm:p-6">
          {aba.id === abaAtual.id ? aba.conteudo : null}
        </div>
      ))}
    </div>
  );
}
