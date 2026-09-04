"use client";

import { useEffect, useRef, useState } from "react";
import { Botao } from "@/components/ui/Botao";
import type { Importacao } from "@/types/importacao";

function frasePlural(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * Confirmação com o número REAL escrito por extenso em português — regra do
 * CLAUDE.md para ação de efeito amplo. Nada de "tem certeza?" genérico: a
 * frase muda com os contadores desta importação específica. Modal acessível
 * própria (não existe `Dialog` em `src/components/ui`, e não é minha
 * fronteira criar um lá): foco vai para o primeiro elemento ao abrir, Tab
 * fica preso dentro, Esc fecha, foco volta pro botão que abriu ao fechar.
 */
export function ModalConfirmarImportacao({
  importacao,
  confirmando,
  erro,
  aoConfirmar,
  aoFechar,
}: {
  importacao: Importacao;
  confirmando: boolean;
  erro: string | null;
  aoConfirmar: () => void;
  aoFechar: () => void;
}) {
  const referenciaDialogo = useRef<HTMLDivElement>(null);
  const [elementoAnterior] = useState<Element | null>(() => document.activeElement);

  useEffect(() => {
    referenciaDialogo.current?.querySelector<HTMLButtonElement>("#btn-confirmar-importacao")?.focus();
    return () => {
      if (elementoAnterior instanceof HTMLElement) elementoAnterior.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") {
        aoFechar();
        return;
      }
      if (e.key !== "Tab" || !referenciaDialogo.current) return;
      const focaveis = referenciaDialogo.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const totalGravado = importacao.pessoas_novas + importacao.jornadas_novas;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <div
        ref={referenciaDialogo}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="titulo-confirmar-importacao"
        aria-describedby="descricao-confirmar-importacao"
        className="flex w-full max-w-md flex-col gap-4 rounded-sm border border-linha-forte bg-papel-elevado p-5 shadow-lg"
      >
        <h2 id="titulo-confirmar-importacao" className="font-serif text-lg font-bold text-tinta">
          Confirmar esta importação?
        </h2>

        <div id="descricao-confirmar-importacao" className="flex flex-col gap-2 text-sm text-tinta-suave">
          <p>Ao confirmar, o sistema vai gravar de verdade:</p>
          <ul className="list-disc pl-5">
            <li>{frasePlural(importacao.pessoas_novas, "pessoa nova cadastrada", "pessoas novas cadastradas")}.</li>
            <li>{frasePlural(importacao.jornadas_novas, "jornada nova aberta para pessoa já existente", "jornadas novas abertas para pessoas já existentes")}.</li>
          </ul>
          <p>E vai deixar de fora, sem gravar nada para elas:</p>
          <ul className="list-disc pl-5">
            <li>{frasePlural(importacao.pessoas_existentes, "linha de pessoa que já participou desta edição", "linhas de pessoas que já participaram desta edição")} (não duplica).</li>
            <li>{frasePlural(importacao.ignoradas, "linha ignorada por já ter jornada aberta", "linhas ignoradas por já terem jornada aberta")}.</li>
            <li>{frasePlural(importacao.com_erro, "linha com erro", "linhas com erro")} (sem nome ou dado inválido).</li>
          </ul>
          <p className="font-medium text-tinta">
            Esta importação NÃO sobrescreve nenhuma pessoa existente e NÃO apaga nenhuma linha. A ação não pode ser desfeita
            pela tela — reverter exige pedido ao time de tecnologia.
          </p>
          {totalGravado === 0 && (
            <p className="rounded-sm border border-ambar-borda bg-ambar-fraco px-2.5 py-1.5 text-[color:var(--ambar)]">
              Nenhuma linha vai gerar pessoa ou jornada nova — confirmar só vai fechar esta importação como processada.
            </p>
          )}
        </div>

        {erro && (
          <p role="alert" className="rounded-sm border border-vermelho-fraco bg-vermelho-fraco px-2.5 py-1.5 text-sm text-[color:var(--vermelho)]">
            {erro}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Botao variante="fantasma" onClick={aoFechar} disabled={confirmando}>
            Cancelar
          </Botao>
          <Botao id="btn-confirmar-importacao" variante="primario" carregando={confirmando} onClick={aoConfirmar}>
            Confirmar importação
          </Botao>
        </div>
      </div>
    </div>
  );
}
