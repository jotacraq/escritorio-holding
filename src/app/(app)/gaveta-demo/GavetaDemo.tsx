"use client";

import { useState } from "react";
import { Gaveta } from "@/components/ui/Gaveta";
import { Botao } from "@/components/ui/Botao";
import { AreaTexto, Campo } from "@/components/ui/Campo";

/**
 * Prova de conceito isolada da Gaveta (Camada 2 do padrão de navegação,
 * arquitetura de informação Fase 3) — não substitui nenhuma navegação de
 * produção. Migrar as ~10 abas candidatas (Formulário, Ligação, Links...)
 * da Ficha 360 para dentro da Gaveta é trabalho de rodada futura, fora do
 * escopo desta entrega.
 */
export function GavetaDemo() {
  const [aberta, setAberta] = useState(false);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-titulo font-bold text-tinta">Demonstração — Gaveta</h1>
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
          <Campo rotulo="Anotação da ligação">
            <AreaTexto rows={4} placeholder="Ex.: cliente confirmou presença na sessão…" />
          </Campo>
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
