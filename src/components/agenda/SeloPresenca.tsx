import { Selo } from "@/components/ui/Selo";
import { formatarData } from "@/lib/formatar";
import { diasAte } from "@/lib/pasta/proximo-passo";

/**
 * Selo de presença confirmada (Fase 4 §1.2, C23): "presença confirmada" é um
 * FATO sobre o agendamento (`presenca_confirmada_em`), não o `status`
 * `confirmado` — que significa "o cliente escolheu o horário pelo link".
 *
 * Três estados quando a coluna existe:
 * - `confirmada`   → verde "Confirmou presença" (+ data)
 * - `aguardando`   → neutro "Aguardando confirmação" (sessão a ≥ 3 dias)
 * - `sem_resposta` → âmbar "Sem resposta · sessão em N dias" (faltam < 3 dias)
 * E um quarto, obrigatório enquanto o agente A não entregar a coluna:
 * - `sem_informacao` → tracejado "Confirmação: sem informação". Nunca some,
 *   nunca vira "não confirmou".
 *
 * `presencaConfirmadaEm`: `undefined` = campo ausente no payload; `null` =
 * campo presente e vazio. A distinção é a mesma de `lib/pasta/sinais.ts`.
 */
export type EstadoPresenca = "confirmada" | "aguardando" | "sem_resposta" | "sem_informacao";

export function estadoPresenca(presencaConfirmadaEm: string | null | undefined, inicioEm: string, agora: number = Date.now()): EstadoPresenca {
  if (presencaConfirmadaEm === undefined) return "sem_informacao";
  if (presencaConfirmadaEm) return "confirmada";
  const dias = diasAte(inicioEm, agora);
  if (dias !== null && dias < 3) return "sem_resposta";
  return "aguardando";
}

const ICONE_CHECK = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 10.5l3.6 3.5 7.4-8" />
  </svg>
);
const ICONE_RELOGIO = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm0-10v3.5l2.5 1.5" />
  </svg>
);
const ICONE_ALERTA = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-current">
    <path d="M10 1.5 19 17H1L10 1.5Zm0 5.4a1 1 0 0 0-1 1v3.4a1 1 0 1 0 2 0V7.9a1 1 0 0 0-1-1Zm0 7.2a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z" />
  </svg>
);

export function SeloPresenca({
  presencaConfirmadaEm,
  inicioEm,
  via,
  className = "",
}: {
  presencaConfirmadaEm: string | null | undefined;
  inicioEm: string;
  via?: string | null;
  className?: string;
}) {
  const estado = estadoPresenca(presencaConfirmadaEm, inicioEm);

  if (estado === "confirmada") {
    const porEquipe = via === "equipe";
    return (
      <Selo tom="verde" icone={ICONE_CHECK} className={className}>
        {porEquipe ? "Presença confirmada pela equipe" : "Confirmou presença"}
        {presencaConfirmadaEm && <span className="font-normal text-tinta-suave"> · {formatarData(presencaConfirmadaEm)}</span>}
      </Selo>
    );
  }

  if (estado === "sem_resposta") {
    const dias = diasAte(inicioEm) ?? 0;
    return (
      <Selo tom="ambar" icone={ICONE_ALERTA} className={className}>
        {dias <= 0 ? "Hoje" : dias === 1 ? "Amanhã" : `${dias} dias`} · sem resposta
      </Selo>
    );
  }

  if (estado === "aguardando") {
    return (
      <Selo tom="neutro" icone={ICONE_RELOGIO} className={className}>
        Aguardando confirmação
      </Selo>
    );
  }

  return (
    <Selo tom="neutro" className={`border-dashed ${className}`}>
      Confirmação: sem informação
    </Selo>
  );
}
