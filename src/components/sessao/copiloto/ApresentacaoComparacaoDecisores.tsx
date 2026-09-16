import type { ReactNode } from "react";
import type { ComparacaoDecisoresPresentes } from "@/types/copiloto";
import { Quadro } from "@/components/ui/Quadro";

/**
 * A CAMADA 1 do §5 — fato, SEM IA. Participantes da sala x decisores que o
 * briefing esperava (`server/copiloto/participantes.ts::compararComDecisores`).
 * Apresentado como FATO com as duas fontes visíveis (exemplo do plano):
 * "O briefing esperava 2 decisores: Terezinha e Cleison. Na sala: Terezinha."
 *
 * `ausentes` != `ambiguos` — tratamento DISTINTO e deliberado:
 *  - `ausentes`: o nome não casou com NENHUM participante — é FATO, a tela
 *    afirma.
 *  - `ambiguos`: o nome casou com MAIS DE UM participante (ou de forma
 *    incerta) — a tela diz "não consegui conferir", NUNCA "ausente".
 *    Casamento por nome normalizado erra (apelido, nome composto,
 *    "Cleison" x "Cleison Roberto") — um falso "decisor ausente" faz a
 *    advogada agir errado com a família na frente dela. `ambiguos` recebe
 *    o mesmo cuidado que uma acusação: nunca afirmado sem certeza.
 *
 * Nome de pessoa real é texto puro (`{variável}` do JSX já escapa — React
 * nunca interpreta HTML de string; nenhum `dangerouslySetInnerHTML` aqui,
 * de propósito — nome de participante vem de fora e é entrada não confiável).
 *
 * Fase 12, Fatia B (tela vira leitura): extraído para arquivo próprio —
 * deixou de aparecer como quadro permanente na tela ao vivo (a régua dos 30s
 * não passa: um card cheio para "quem está na sala" competia com a pergunta
 * única). A LINHA FINA do topo de `ConduzirSessaoApp.tsx` agora resume o
 * mesmo fato em uma frase curta ("Cleison não está na sala"), só quando há
 * divergência. Este componente continua existindo, sem chamador na tela ao
 * vivo, para o resumo da sessão (Ficha 360) reusar o mesmo fato completo,
 * com as duas fontes.
 */
export function ApresentacaoComparacaoDecisores({
  comparacao,
  numero,
  icone,
}: {
  comparacao: ComparacaoDecisoresPresentes;
  numero?: number;
  icone?: ReactNode;
}) {
  const { decisores_esperados, participantes_presentes, ausentes, ambiguos } = comparacao;
  if (decisores_esperados.length === 0) return null;

  return (
    <Quadro rotulo="Decisores esperados x presentes" numero={numero} icone={icone} como="article" className="min-h-[7rem]">
      <div className="flex flex-col gap-2 text-sm text-tinta">
        <p>
          O briefing esperava {decisores_esperados.length === 1 ? "1 decisor" : `${decisores_esperados.length} decisores`}:{" "}
          {decisores_esperados.join(", ")}. Na sala:{" "}
          {participantes_presentes.length > 0 ? participantes_presentes.join(", ") : "ninguém identificado ainda"}.
        </p>

        {ausentes.length > 0 && (
          <div className="rounded-controle border border-[color:var(--ambar)] bg-ambar-fraco px-3 py-2">
            <p className="font-bold text-[color:var(--ambar)]">{ausentes.length === 1 ? "Não entrou na sala:" : "Não entraram na sala:"}</p>
            <p className="text-tinta">{ausentes.join(", ")}</p>
          </div>
        )}

        {ambiguos.length > 0 && (
          <div className="rounded-controle border border-dashed border-linha-forte px-3 py-2">
            <p className="font-bold text-tinta-fraca">Não foi possível confirmar:</p>
            <p className="text-tinta-suave">{ambiguos.join(", ")} — o nome na sala não casou com confiança suficiente. Não trate como ausência.</p>
          </div>
        )}
      </div>
    </Quadro>
  );
}

/**
 * Resumo de UMA linha para a linha fina do topo (Fase 12, Fatia B):
 * "Cleison (decisor) não está na sala." — só os `ausentes`; `ambiguos` nunca
 * vira afirmação de ausência (mesma regra do componente cheio acima), então
 * fica de fora da linha fina — quem quer o detalhe abre o resumo da sessão.
 * `null` quando não há ninguém ausente: a linha não existe no DOM.
 */
export function resumoAusentesLinhaFina(comparacao: ComparacaoDecisoresPresentes | null): string | null {
  if (!comparacao || comparacao.ausentes.length === 0) return null;
  const nomes = comparacao.ausentes.join(", ");
  return comparacao.ausentes.length === 1 ? `${nomes} não está na sala` : `${nomes} não estão na sala`;
}
