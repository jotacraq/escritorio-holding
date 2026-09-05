"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useRecurso } from "@/hooks/useRecurso";
import { useUsuarioAtual } from "@/hooks/useUsuarioAtual";
import { formatarData } from "@/lib/formatar";
import type { EstadoAutomacao, LinhaAutomacao } from "@/types/jornada-automacoes";
import { buscarAutomacoes } from "./api-fase5";

/**
 * "O que o sistema fez" (§1.4, §8.2) — as automações da jornada com o
 * RESULTADO, uma linha cada, dentro da Ficha. Antes disso, saber se a
 * boas-vindas saiu ou se a ligação por IA atendeu exigia abrir Comunicação e
 * cruzar com a aba Sessão.
 *
 * Lei de texto: linha = rótulo + resultado + data. Zero prosa, zero cartão
 * por automação. Estado nunca é só cor — cada um tem glifo próprio.
 *
 * `indisponivel` (a 0064 não aplicada → 503 rotulado) **não vira lista
 * vazia**: para admin, uma linha dizendo que a leitura está indisponível;
 * para quem não é admin, o bloco não existe no DOM (§9.1 — aviso de sistema
 * é assunto de admin, e "não sei" não é ação de ninguém).
 */

const ROTULO_ESTADO: Record<EstadoAutomacao, string> = {
  agendado: "Agendado",
  enviado: "Enviado",
  falhou: "Falhou",
  sem_resposta: "Sem resposta",
  concluido: "Concluído",
  aguardando: "Na fila",
};

const ESTILO_ESTADO: Record<EstadoAutomacao, string> = {
  agendado: "text-[color:var(--azul)]",
  enviado: "text-[color:var(--verde)]",
  falhou: "text-[color:var(--vermelho)]",
  sem_resposta: "text-[color:var(--ambar)]",
  concluido: "text-[color:var(--verde)]",
  aguardando: "text-tinta-fraca",
};

/* Glifos 20×20 — forma distinta por estado (daltonismo / leitor de tela). */
const GLIFO_ESTADO: Record<EstadoAutomacao, React.ReactNode> = {
  agendado: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l2.6 1.5" />
    </>
  ),
  enviado: <path d="M4.5 10.5l3.6 3.5 7.4-8" />,
  falhou: <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />,
  sem_resposta: <path d="M4.5 10h11" />,
  concluido: <path d="M4.5 10.5l3.6 3.5 7.4-8" />,
  aguardando: <circle cx="10" cy="10" r="3.2" />,
};

/** A explicação do bloco vive no `title`, nunca no fluxo (lei de texto §2.2). */
const TITULO_BLOCO = "O que o sistema fez sozinho nesta jornada";

const ROTULO_CANAL: Record<string, string> = {
  email: "e-mail",
  whatsapp: "WhatsApp",
  telefone: "telefone",
};

export function AutomacoesFicha({ jornadaId }: { jornadaId: string }) {
  const { usuario } = useUsuarioAtual();
  const buscar = useCallback(() => buscarAutomacoes(jornadaId), [jornadaId]);
  const { dados, carregando } = useRecurso(buscar, [jornadaId]);

  if (carregando || !dados) return null;

  if (dados.estado !== "ok") {
    if (usuario?.papel !== "admin") return null;
    return (
      <section aria-labelledby="automacoes-titulo" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-cartao border border-linha bg-papel-elevado px-4 py-3">
        <h2 id="automacoes-titulo" className="text-sm font-bold text-tinta" title={TITULO_BLOCO}>
          Automações
        </h2>
        <span className="text-sm text-tinta-suave" title={dados.motivo}>
          Leitura indisponível
        </span>
        <Link href="/admin" className="inline-flex min-h-11 items-center text-sm font-medium text-[color:var(--latao)] underline underline-offset-2">
          Abrir Administração
        </Link>
      </section>
    );
  }

  const itens = dados.dados.itens;

  return (
    <section aria-labelledby="automacoes-titulo" className="flex flex-col gap-item rounded-cartao border border-linha bg-papel-elevado px-4 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="automacoes-titulo" className="text-sm font-bold text-tinta" title={TITULO_BLOCO}>
          Automações
        </h2>
        {itens.length > 0 && <span className="text-xs text-tinta-fraca">{itens.length} registros</span>}
      </div>

      {itens.length === 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-sm text-tinta-suave">Nenhum envio ainda</p>
          <Link href="/comunicacao" className="inline-flex min-h-11 items-center text-sm font-medium text-[color:var(--latao)] underline underline-offset-2">
            Ver a fila
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-linha">
          {itens.map((item) => (
            <LinhaDeAutomacao key={`${item.tipo}:${item.chave}:${item.ordem}`} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

function LinhaDeAutomacao({ item }: { item: LinhaAutomacao }) {
  const canal = item.canal ? ROTULO_CANAL[item.canal] ?? item.canal : null;
  return (
    <li className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 text-sm">
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className={`h-4 w-4 shrink-0 ${ESTILO_ESTADO[item.estado]}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {GLIFO_ESTADO[item.estado]}
      </svg>
      <span className="font-medium text-tinta">{item.rotulo_fonte}</span>
      {canal && <span className="text-tinta-fraca">· {canal}</span>}
      <span className={`font-medium ${ESTILO_ESTADO[item.estado]}`}>· {item.resultado ?? ROTULO_ESTADO[item.estado]}</span>
      {item.quando && (
        <time dateTime={item.quando} className="ml-auto shrink-0 text-xs tabular-nums text-tinta-fraca">
          {formatarData(item.quando)}
        </time>
      )}
    </li>
  );
}
