"use client";

import { useState } from "react";
import { Gaveta } from "@/components/ui/Gaveta";
import { Botao } from "@/components/ui/Botao";

/**
 * Prova de conceito isolada da Gaveta (Camada 2 do padrão de navegação,
 * arquitetura de informação Fase 3) — não substitui nenhuma navegação de
 * produção. Migrar as ~10 abas candidatas (Formulário, Ligação, Links...)
 * da Ficha 360 para dentro da Gaveta é trabalho de rodada futura, fora do
 * escopo desta entrega.
 */
export default function PaginaGavetaDemo() {
  const [aberta, setAberta] = useState(false);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="font-serif text-2xl font-bold text-tinta">Demonstração — Gaveta</h1>
      <p className="text-sm text-tinta-suave">
        Painel lateral (Camada 2): abre sem tirar a tela de origem de vista, prende o foco enquanto aberta, fecha com
        Esc ou com o botão &ldquo;Fechar&rdquo;, e devolve o foco a este botão ao fechar.
      </p>
      <div>
        <Botao variante="primario" onClick={() => setAberta(true)}>
          Abrir gaveta de exemplo
        </Botao>
      </div>

      <Gaveta aberta={aberta} aoFechar={() => setAberta(false)} titulo="Exemplo — Ligação">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-tinta-suave">
            Conteúdo de exemplo simples, só para validar a Gaveta isoladamente — nenhuma aba real foi migrada para
            cá nesta rodada.
          </p>
          <label className="flex flex-col gap-1 text-sm text-tinta">
            Anotação da ligação
            <textarea
              className="rounded-sm border border-linha-forte bg-papel px-3 py-2 text-sm text-tinta outline-none focus-visible:outline-2 focus-visible:outline-[color:var(--latao)]"
              rows={4}
              placeholder="Ex.: cliente confirmou presença na sessão…"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Botao variante="fantasma" onClick={() => setAberta(false)}>
              Cancelar
            </Botao>
            <Botao variante="primario" onClick={() => setAberta(false)}>
              Salvar
            </Botao>
          </div>
        </div>
      </Gaveta>
    </div>
  );
}
