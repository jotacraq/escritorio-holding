import Link from "next/link";
import { Selo } from "@/components/ui/Selo";
import { SeloEstado } from "@/components/ui/SeloEstado";
import { formatarDataHora, formatarRelativo } from "@/lib/formatar";
import { rotulo, titleDe } from "@/lib/vocabulario";
import type { IntencaoAgente } from "@/types/agente";

/**
 * O vocabulário do agente de WhatsApp (Fase 9), em UM lugar.
 *
 * Três telas mostram a mesma resposta do robô — a Ficha (`RecebidasFicha`),
 * Comunicação → Recebidas e Admin → Agente de WhatsApp. Se cada uma
 * traduzisse `intencao` por conta própria, "fora_do_tema" viraria três
 * palavras diferentes na mesma casa. É o mesmo motivo pelo qual `lib/estados`
 * é o dicionário único de status.
 *
 * **Divergência declarada com o DS §12.3:** o catálogo de estados
 * (`lib/estados/catalogo.ts`) não tem domínio para "quem respondeu", e este
 * agente não pode editá-lo (fronteira da fase). Então a leitura fica dividida
 * do jeito que já é a regra da casa:
 *   - **quem respondeu** é AUTORIA, não status → `Selo` (chip que não é
 *     estado, exatamente o uso que o DS reserva para ele);
 *   - **se a frase saiu ou não** é status de mensagem → `SeloEstado
 *     dominio="mensagem"`, com as chaves reais `enviada` e `falhou`, tom e
 *     glifo do catálogo, contraste ≥ 7:1.
 * Anotado no brief da fase para virar domínio próprio (`autoria`) quando
 * `lib/estados` puder ser tocado.
 */

/* -------------------------------------------------------------------------- */
/* Intenções                                                                  */
/* -------------------------------------------------------------------------- */

/** ≤ 4 palavras, língua do escritório — nunca o valor cru do banco na tela. */
const ROTULO_INTENCAO: Record<IntencaoAgente, string> = {
  confirmar_horario: "Confirmar horário",
  enviar_documento: "Mandar documento",
  o_que_falta: "O que falta",
  duvida_uso_sistema: "Dúvida sobre o sistema",
  duvida_juridica: "Dúvida jurídica",
  preco_prazo: "Preço ou prazo",
  falar_com_humano: "Quer falar com alguém",
  fora_do_tema: "Fora do assunto",
  desconhecida: "Não entendeu",
};

/** A frase longa mora no `title` (lei de texto, DS §2.2), nunca num `<p>`. */
const EXPLIQUE_INTENCAO: Record<IntencaoAgente, string> = {
  confirmar_horario: "O cliente falou do horário da sessão. O agente manda o link de confirmação — nunca confirma sozinho.",
  enviar_documento: "O cliente quis mandar documento. O agente devolve o link de envio; anexo por WhatsApp nunca é aceito.",
  o_que_falta: "O cliente perguntou o que falta. A resposta é montada do radar de documentos e do passo do processo.",
  duvida_uso_sistema: "Dúvida sobre como usar o sistema. É a única intenção em que o texto do cliente vai para a IA.",
  duvida_juridica: "Pergunta jurídica ou tributária. O agente se esquiva e abre tarefa para a advogada — nunca orienta.",
  preco_prazo: "Pergunta de valor, honorário ou parcelamento. O agente devolve a pergunta: quem fala de oferta é a Dra. Elaine.",
  falar_com_humano: "O cliente pediu para falar com uma pessoa. O agente para e abre tarefa para a equipe.",
  fora_do_tema: "Assunto fora do fechamento da holding. Na segunda vez, o agente encaminha para a equipe.",
  desconhecida: "O agente não teve certeza do que o cliente quis dizer. Não enviou nada e abriu tarefa.",
};

export function rotuloIntencao(intencao: string | null | undefined): string {
  if (!intencao) return "Sem intenção registrada";
  return (ROTULO_INTENCAO as Record<string, string>)[intencao] ?? intencao.replace(/_/g, " ");
}

export function expliqueIntencao(intencao: string | null | undefined): string | undefined {
  if (!intencao) return undefined;
  return (EXPLIQUE_INTENCAO as Record<string, string>)[intencao];
}

/* -------------------------------------------------------------------------- */
/* Números                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * `custo_usd` é DÓLAR. `formatarMoeda()` de `lib/formatar` é BRL fixo — usá-lo
 * aqui escreveria "R$ 0,0004" para um valor cobrado em dólar, que é o tipo de
 * número plausível e errado que esta base persegue.
 */
const DOLAR = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });

export function formatarDolar(valor: number | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const numero = Number(valor);
  if (Number.isNaN(numero)) return null;
  return DOLAR.format(numero);
}

/** `confianca` chega em 0–1. Na tela é "82% de certeza" — número primeiro. */
export function formatarConfianca(valor: number | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const numero = Number(valor);
  if (Number.isNaN(numero)) return null;
  return `${Math.round(numero * 100)}% de certeza`;
}

/* -------------------------------------------------------------------------- */
/* Selos                                                                      */
/* -------------------------------------------------------------------------- */

const ICONE_AGENTE = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="7" width="12" height="9" rx="2.5" />
    <path d="M10 4.5V7M7.5 11h.01M12.5 11h.01M8 14h4" />
  </svg>
);

/**
 * "Respondido pelo agente" — AUTORIA, não status. Sempre com a palavra ao lado
 * do glifo (DS §12.1: nenhum ícone sem rótulo).
 */
export function SeloRespondidoPeloAgente({ className = "" }: { className?: string }) {
  return (
    <Selo tom="azul" icone={ICONE_AGENTE} title="Quem escreveu esta resposta foi o agente de WhatsApp, não uma pessoa da equipe." className={className}>
      Respondido pelo agente
    </Selo>
  );
}

/* -------------------------------------------------------------------------- */
/* Uma resposta                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A leitura de `AgenteResposta` que o contrato define e que a tela NÃO pode
 * simplificar (`types/agente.ts`):
 *
 * | `texto` | `enviada_em` | o que aconteceu                                  |
 * |---------|--------------|--------------------------------------------------|
 * | preenchido | preenchido | o cliente recebeu a frase                       |
 * | preenchido | `null`     | **montou e a central recusou** — há tarefa aberta |
 * | `null`     | —          | não havia o que dizer; `erro` diz por quê         |
 *
 * As duas últimas linhas parecem a mesma coisa numa lista mal feita ("sem
 * resposta") e são situações opostas: uma exige conserto de integração, a
 * outra é o porteiro funcionando.
 */
export type SituacaoResposta = "enviada" | "recusada" | "sem_resposta";

/**
 * O denominador comum das duas formas que o servidor entrega: `AgenteResposta`
 * (linha inteira, na Ficha e no Admin) e `AgenteNaRecebida` (o recorte que vem
 * junto de cada mensagem da fila). Os dois são estruturalmente atribuíveis a
 * isto, então a leitura das três situações é escrita **uma vez** — foi o que
 * evitou que a fila e a ficha divergissem no dia em que a central recusa.
 *
 * `criado_em` e `erro` só existem na linha inteira; `prompt_versao`, só no
 * recorte da fila. Campo ausente não vira travessão inventado: a peça
 * simplesmente não desenha aquele pedaço.
 */
export interface RespostaExibivel {
  intencao: IntencaoAgente | null;
  confianca: number | null;
  texto: string | null;
  enviada_em: string | null;
  custo_usd: number | null;
  criado_em?: string;
  erro?: string | null;
  prompt_versao?: number | null;
}

export function situacaoDaResposta(resposta: RespostaExibivel): SituacaoResposta {
  if (resposta.texto === null || resposta.texto.trim() === "") return "sem_resposta";
  return resposta.enviada_em ? "enviada" : "recusada";
}

export function RespostaDoAgente({
  resposta,
  hrefTarefa,
  className = "",
}: {
  resposta: RespostaExibivel;
  /** Para onde a tarefa aberta pela recusa leva. Ausente = já estamos nessa tela. */
  hrefTarefa?: string | null;
  className?: string;
}) {
  const situacao = situacaoDaResposta(resposta);
  const confianca = formatarConfianca(resposta.confianca);
  const custo = formatarDolar(resposta.custo_usd);

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <SeloRespondidoPeloAgente />
        {situacao === "enviada" && <SeloEstado dominio="mensagem" estado="enviada" detalhe="O cliente recebeu esta frase." />}
        {situacao === "recusada" && (
          <SeloEstado
            dominio="mensagem"
            estado="falhou"
            detalhe={`O agente montou a resposta e a ${rotulo("provedor_whatsapp")} (${titleDe("provedor_whatsapp")}) recusou o envio.${resposta.erro ? ` Motivo: ${resposta.erro}.` : ""}`}
          />
        )}
        {/* Na fila de Recebidas a resposta aparece debaixo da mensagem, que já
            traz a hora: repetir um segundo relógio a dois centímetros do
            primeiro só faz o olho conferir qual é qual. */}
        {resposta.criado_em && (
          <time dateTime={resposta.criado_em} className="text-legenda text-tinta-fraca" title={formatarDataHora(resposta.criado_em)}>
            {formatarRelativo(resposta.criado_em)}
          </time>
        )}
      </div>

      {situacao === "sem_resposta" ? (
        <p className="text-sm text-tinta-suave" title={resposta.erro ?? undefined}>
          O agente não respondeu.
        </p>
      ) : (
        // `break-words`: a frase do agente carrega o link público com o token
        // inteiro, e uma URL de 60 caracteres sem ponto de quebra estoura a
        // coluna a 360 px — `whitespace-pre-wrap` sozinho não quebra palavra.
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-tinta">{resposta.texto}</p>
      )}

      {situacao === "recusada" && (
        <p className="text-legenda text-[color:var(--estado-vermelho)]">
          <span title={`${titleDe("provedor_whatsapp")}${resposta.erro ? ` · ${resposta.erro}` : ""}`}>
            Não enviado · a {rotulo("provedor_whatsapp")} recusou.
          </span>{" "}
          {hrefTarefa ? (
            <Link href={hrefTarefa} className="font-medium underline underline-offset-2">
              Abrir a tarefa
            </Link>
          ) : (
            <span className="text-tinta-suave">A tarefa está no alto desta ficha.</span>
          )}
        </p>
      )}

      <p
        className="text-legenda text-tinta-fraca"
        title={[
          expliqueIntencao(resposta.intencao),
          custo ? `Custo desta resposta: ${custo}.` : "Resposta de texto fixo: não passou pela IA e não custou nada.",
          // A versão do prompt é auditoria, não fluxo (lei de texto §2.2). Só a
          // fila de Recebidas a recebe, e só para quem o servidor deixa ver
          // execução de IA — `null` ali é "não sei", não "texto fixo".
          typeof resposta.prompt_versao === "number" ? `Versão do prompt: v${resposta.prompt_versao}.` : null,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {[rotuloIntencao(resposta.intencao), confianca, custo ?? "sem custo de IA"].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}
