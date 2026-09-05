"use client";

import { separarLinguagemDoCliente } from "@/server/ia/linguagem-cliente";
import type { Briefing } from "@/lib/api";
import { FraseComFidelidade } from "@/components/briefing/atomos";

/**
 * "Como ele fala" — seção `linguagem_do_cliente` do Briefing v3 (Fase 4
 * §5.2): palavras que o cliente repete, frases literais dele e o registro
 * (formal/coloquial…). O schema guarda a seção como UMA string em formato
 * fixo de três linhas (teto de gramática do provedor); `separarLinguagemDoCliente`
 * (função pura, sem I/O) divide para os chips. Briefing gerado pelo prompt
 * v1/v2 não tem a seção — a tela diz isso e NÃO inventa.
 */
export function ComoEleFala({ briefing, compacto = false }: { briefing: Briefing; compacto?: boolean }) {
  const bruto = (briefing.conteudo as unknown as { linguagem_do_cliente?: string }).linguagem_do_cliente;
  const temSecao = typeof bruto === "string";
  const linguagem = separarLinguagemDoCliente(bruto);
  const vazia = linguagem.palavras.length === 0 && linguagem.expressoes.length === 0 && !linguagem.registro;

  if (!temSecao) {
    return (
      <p className={`rounded-controle border border-dashed border-linha-forte px-3.5 py-2.5 text-sm text-tinta-suave ${compacto ? "" : "max-w-prose"}`}>
        Gerado com a versão anterior do protocolo — gere de novo para ter a seção “Como ele fala”.
      </p>
    );
  }

  if (vazia) {
    return <p className="text-sm text-tinta-suave">A IA não encontrou palavras nem frases literais suficientes no material recebido — nada foi inventado.</p>;
  }

  return (
    <div className={`flex flex-col ${compacto ? "gap-2" : "gap-3"}`}>
      {linguagem.registro && (
        <p className="text-sm text-tinta">
          <span className="font-medium">Registro:</span> {linguagem.registro}
        </p>
      )}
      {linguagem.palavras.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-rotulo font-medium uppercase text-tinta-fraca">Palavras que ele usa</p>
          <ul className="flex flex-wrap gap-1.5">
            {linguagem.palavras.map((p) => (
              <li key={p} className="inline-flex min-h-8 items-center rounded-pilula border border-linha-forte bg-papel-elevado px-2.5 text-sm font-medium text-tinta">
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}
      {linguagem.expressoes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-rotulo font-medium uppercase text-tinta-fraca">Frases dele, ao pé da letra</p>
          <ul className="flex flex-col gap-1 text-sm text-tinta">
            {linguagem.expressoes.map((e) => (
              <li key={e}>
                <FraseComFidelidade frase={e} />
              </li>
            ))}
          </ul>
          {!compacto && <p className="text-xs text-tinta-suave">Fonte: formulário, ligação e transcrição usados no briefing — a IA só pode citar o que está lá.</p>}
        </div>
      )}
    </div>
  );
}
