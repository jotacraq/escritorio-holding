"use client";

import { useCallback } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { formatarDataHora, formatarRelativo } from "@/lib/formatar";
import { EsqueletoLinha } from "@/components/ui/Esqueleto";
import { Selo } from "@/components/ui/Selo";
import { rotulo, titleDe } from "@/lib/vocabulario";
import { buscarProvaDeVida } from "./api-regua";
import { LinkBotao } from "./LinkBotao";

const ICONE_CHECK = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 10.5l3.6 3.5 7.4-8" />
  </svg>
);

/**
 * Estado das mensagens automáticas — **só admin**, e em UMA linha.
 *
 * Fase 4 entregava aqui um cartão com duas colunas, três parágrafos e a URL
 * do cron: dívida técnica na primeira tela de quem só queria saber com quem
 * falar hoje (Fase 5 §9.1). Agora quem não é admin não renderiza este
 * componente — e, com ele, some também o `GET /api/mensagens` que ele fazia.
 * Para o admin sobra o que a lei permite: estado + número + um link.
 *
 * Sem polling: um fetch ao montar e um a cada "Atualizar".
 */
export function ProvaDeVida({ versao }: { versao: number }) {
  const buscar = useCallback(() => buscarProvaDeVida(), []);
  const { dados, carregando, erro } = useRecurso(buscar, [versao]);

  if (carregando && !dados) {
    return (
      <div role="status" aria-live="polite" className="px-1">
        <span className="sr-only">Carregando o estado das mensagens automáticas…</span>
        <EsqueletoLinha largura="w-2/3" altura="h-5" />
      </div>
    );
  }

  // Sem dado não se afirma nada: a linha inteira some (vazio é vazio).
  if (erro || !dados) return null;

  const regua = dados.regua;
  const naFila = dados.pendentes.length;
  const estado: { tom: "verde" | "ambar"; texto: string; quando: string | null } = !regua
    ? { tom: "ambar", texto: "Não configurado", quando: null }
    : regua.ultimo_cron_em === null
      ? { tom: "ambar", texto: "Nunca rodou", quando: null }
      : regua.cron_atrasado
        ? { tom: "ambar", texto: "Atrasado", quando: regua.ultimo_cron_em }
        : { tom: "verde", texto: "Rodando", quando: regua.ultimo_cron_em };

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-cartao border border-linha bg-papel px-5 py-3 text-sm text-tinta-suave"
      role="status"
    >
      <span className="font-bold text-tinta" title={titleDe("envio_automatico")}>
        {rotulo("envio_automatico")}
      </span>
      <Selo tom={estado.tom} icone={estado.tom === "verde" ? ICONE_CHECK : undefined}>
        {estado.texto}
      </Selo>
      {estado.quando && (
        <time dateTime={estado.quando} title={formatarDataHora(estado.quando)}>
          {formatarRelativo(estado.quando)}
        </time>
      )}
      <span className="tabular-nums">
        <span className="font-bold text-tinta">{naFila}</span> na fila
      </span>
      <LinkBotao href="/comunicacao" variante="fantasma" className="sm:ml-auto">
        Ver mensagens
      </LinkBotao>
    </div>
  );
}
