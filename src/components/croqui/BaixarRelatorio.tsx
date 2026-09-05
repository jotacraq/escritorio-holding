"use client";

import { useCallback, useState } from "react";
import { ApiError, chamar } from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { Botao } from "@/components/ui/Botao";

/**
 * "Baixar relatório (.docx)" — a porta do documento que o M6 gera.
 *
 * O botão só existe quando há **versão fixada do cálculo**: a rota responde
 * 409 `sem_calculo` sem ela, e um link que devolve JSON de erro na cara de
 * quem clicou é pior que link nenhum. Quem decide é `GET …/docx?info=1`, que
 * é barato de propósito (não monta o documento) e devolve também os destinos
 * disponíveis. "Enviar ao Drive" **só aparece quando o adaptador está
 * configurado** — sem `GOOGLE_SA_JSON`/`DRIVE_PASTA_RAIZ_ID` a rota falha
 * fechada com 503, e oferecer o botão seria prometer o que não existe.
 *
 * O download é um `<a href>` de verdade, não um `fetch` + `Blob`: funciona com
 * o botão direito, com "abrir em nova aba" e sem JavaScript, e o
 * `Content-Disposition: attachment` da rota mantém a página onde está.
 */

interface InfoExportacao {
  destinos: string[];
  drive_indisponivel: string | null;
  calculo: { versao: number; criado_em: string } | null;
}

interface RespostaDrive {
  destino: string;
  url: string | null;
  versao: number;
}

export function BaixarRelatorio({ croquiId, className = "" }: { croquiId: string; className?: string }) {
  const buscar = useCallback(
    () => chamar<InfoExportacao>(`/api/croquis/${croquiId}/docx?info=1`),
    [croquiId],
  );
  const { dados, carregando, erro } = useRecurso(buscar, [croquiId]);
  const { notificar } = useToast();
  const [enviando, setEnviando] = useState(false);

  async function enviarAoDrive() {
    setEnviando(true);
    try {
      const r = await chamar<RespostaDrive>(`/api/croquis/${croquiId}/docx?destino=drive`, { method: "POST" });
      notificar({
        tom: "sucesso",
        titulo: "Relatório no Drive",
        ...(r.url ? { acao: { rotulo: "Abrir", aoClicar: () => window.open(r.url as string, "_blank", "noopener") } } : {}),
      });
    } catch (e) {
      notificar({
        tom: "erro",
        titulo: "Não deu para enviar ao Drive",
        descricao: e instanceof ApiError ? e.message : "Tente de novo em instantes.",
      });
    } finally {
      setEnviando(false);
    }
  }

  // Enquanto a resposta não chega, o espaço fica reservado (sem controle
  // falso na tela e sem o pulo de layout de um botão que aparece depois).
  if (carregando) {
    return <span aria-hidden="true" className={`inline-block h-11 w-48 ${className}`} />;
  }

  // Erro na sondagem não vira alarme: o relatório é um extra da tela, e a
  // tela do croqui continua inteira sem ele.
  if (erro || !dados) return null;

  if (!dados.calculo) {
    return (
      <p className={`text-sm text-tinta-suave ${className}`} title="O relatório é gerado a partir da versão fixada do cálculo.">
        Fixe uma versão para baixar
      </p>
    );
  }

  const podeDrive = dados.destinos.includes("drive");

  return (
    <span className={`inline-flex flex-wrap items-center gap-item ${className}`}>
      <a
        href={`/api/croquis/${croquiId}/docx`}
        download
        title={`Relatório do croqui, versão ${dados.calculo.versao}`}
        className="inline-flex min-h-11 items-center justify-center rounded-controle border border-linha-forte bg-papel-elevado px-3.5 py-2 text-sm font-medium text-tinta transition-colors duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--latao-cta)]"
      >
        Baixar relatório (.docx)
      </a>
      {podeDrive && (
        <Botao variante="fantasma" carregando={enviando} onClick={enviarAoDrive}>
          Enviar ao Drive
        </Botao>
      )}
    </span>
  );
}
