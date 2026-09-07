import { telefoneDaConversa } from "@/server/chatwoot/cliente";
import { variantesTelefone } from "@/server/integracoes/telefone";

/**
 * A 15ª trava: **a conversa tem de ser de quem o payload diz que é**.
 *
 * Achado MÉDIO do pentest da Fase 9. `conversation.id` chega inteiro no corpo
 * do webhook e, até aqui, nada o amarrava ao telefone que o porteiro casou.
 * Com o `CHATWOOT_WEBHOOK_SECRET` na mão dava para forjar um `message_created`
 * com o telefone de um cliente real e o id de uma conversa qualquer: o
 * porteiro casava a pessoa certa, montava a resposta com o radar dela e
 * mandava para a conversa do atacante.
 *
 * A checagem é do lado do PROVEDOR — `GET /conversations/{id}` — porque
 * comparar payload com payload não prova nada.
 *
 * FAIL-CLOSED em três casos, e por motivos diferentes:
 *   . telefone diferente  → forjado ou conversa trocou de titular;
 *   . conversa sem contato com telefone → não dá para afirmar que é dele;
 *   . a chamada falhou    → não saber de quem é a conversa não pode virar
 *     licença para falar nela.
 *
 * Custo: UMA chamada, só no caminho que já passou pelas 14 travas. Número
 * desconhecido nunca chega aqui.
 */
export type VerificacaoConversa =
  | { ok: true }
  | { ok: false; erro: "conversa_nao_pertence_ao_telefone" | "conversa_nao_verificada"; detalhe: string };

export async function conversaPertenceAoTelefone(conversaId: string, e164: string): Promise<VerificacaoConversa> {
  const contato = await telefoneDaConversa(conversaId);

  if (!contato.ok) {
    return {
      ok: false,
      erro: "conversa_nao_verificada",
      detalhe: `Não deu para confirmar com o Chatwoot de quem é a conversa ${conversaId} (${contato.erro}). O agente não respondeu.`,
    };
  }

  if (!contato.telefone) {
    return {
      ok: false,
      erro: "conversa_nao_pertence_ao_telefone",
      detalhe: `A conversa ${conversaId} não tem telefone no contato do Chatwoot — o agente não fala numa conversa que não sabe de quem é.`,
    };
  }

  // As mesmas variantes da busca (com e sem o nono dígito, com e sem `+`): o
  // Chatwoot pode gravar o número em outra grafia que o mesmo dono.
  const aceitas = new Set(variantesTelefone(e164));
  for (const variante of variantesTelefone(contato.telefone)) {
    if (aceitas.has(variante)) return { ok: true };
  }

  // O telefone da conversa NUNCA entra na mensagem de erro: a tarefa é lida
  // pela equipe, mas o número de terceiro não precisa estar nela.
  return {
    ok: false,
    erro: "conversa_nao_pertence_ao_telefone",
    detalhe: `A conversa ${conversaId} pertence a outro contato do Chatwoot, e não ao número que assinou a mensagem. O agente não respondeu.`,
  };
}
