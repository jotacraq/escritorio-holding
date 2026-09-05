import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_URL } from "@/lib/config-publica";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { ErroApi, erroValidacao, registrarErro } from "@/server/erros";
import { exigirPepper, gerarToken, hashToken } from "@/server/publico/pepper";
import type { ItemRadar, RespostaRadarPedir } from "@/types/jornada-automacoes";
import { montarRadar } from "./index";

/** Teto por clique: pedir 40 documentos de uma vez já é a família inteira. */
const TETO_CHAVES = 40;

/**
 * "Pedir agora" (§8.3): grava o ato humano em `documentos_pedidos` e enfileira
 * UMA mensagem por canal com o link `/p/d`.
 *
 * Travas, na ordem em que acontecem:
 *  1. **Só chave derivada.** O corpo pode mandar qualquer string; só entra o
 *     que o radar do servidor calculou para ESTA jornada. Sem isso, o endpoint
 *     viraria um gravador de texto livre em tabela com RLS de patrimônio.
 *  2. **Só o lado da coleta.** Documento de entrega é produzido pelo
 *     escritório; não se pede à família.
 *  3. **Fail-closed antes de escrever.** Sem `SUPABASE_SERVICE_ROLE_KEY` e sem
 *     pepper não há como enfileirar mensagem nenhuma — e a gente descobre isso
 *     ANTES de gravar pedido, para não deixar "pedido" sem pedido nenhum.
 *  4. **Idempotência em dois níveis.** `unique (jornada_id, chave)` no pedido e
 *     `chave_idempotencia` por dia na mensagem (0013): duplo clique não vira
 *     duas mensagens.
 */
export async function pedirDocumentos(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente vem sem generic Database
  supabase: SupabaseClient<any, any, any>,
  jornadaId: string,
  chavesPedidas: string[],
): Promise<RespostaRadarPedir> {
  const unicas = [...new Set(chavesPedidas.map((c) => c.trim()).filter((c) => c.length > 0))];
  if (unicas.length === 0) throw erroValidacao(null, "Informe ao menos um documento para pedir.");
  if (unicas.length > TETO_CHAVES) throw erroValidacao({ teto: TETO_CHAVES }, `No máximo ${TETO_CHAVES} documentos por vez.`);

  const radar = await montarRadar(supabase, jornadaId);
  if (!radar.pedidos_disponiveis) {
    throw new ErroApi(503, "servico_indisponivel", "Pedido de documentos indisponível: a migration 0065 ainda não foi aplicada.");
  }

  const porChave = new Map<string, ItemRadar>(radar.itens.map((item) => [item.chave, item]));
  const desconhecidas = unicas.filter((c) => !porChave.has(c));
  if (desconhecidas.length > 0) {
    throw erroValidacao({ chaves: desconhecidas }, "Documento não faz parte do radar desta jornada.");
  }
  const daEntrega = unicas.filter((c) => porChave.get(c)?.lado === "entrega");
  if (daEntrega.length > 0) {
    throw erroValidacao({ chaves: daEntrega }, "Documento de entrega é produzido pelo escritório — não se pede ao cliente.");
  }

  // Fail-closed ANTES de escrever qualquer coisa.
  const pepper = exigirPepper();
  let admin;
  try {
    admin = criarClienteAdmin();
  } catch (erroServiceRole) {
    registrarErro("server/radar.pedirDocumentos#service_role_ausente", erroServiceRole, { jornada_id: jornadaId });
    throw new ErroApi(503, "servico_indisponivel", "Pedido de documentos exige SUPABASE_SERVICE_ROLE_KEY para enfileirar a mensagem — indisponível agora.");
  }

  // 1) O ato humano. `ignoreDuplicates` = ON CONFLICT DO NOTHING: repetir o
  // pedido não reescreve quem pediu nem quando (o trigger também barraria).
  const linhas = unicas.map((chave) => {
    const item = porChave.get(chave);
    return { jornada_id: jornadaId, chave, tipo: item?.tipo ?? "outro", item_ref: item?.item_ref ?? null };
  });
  const { data: gravados, error: erroPedido } = await supabase
    .from("documentos_pedidos")
    .upsert(linhas, { onConflict: "jornada_id,chave", ignoreDuplicates: true })
    .select("chave")
    .returns<Array<{ chave: string }>>();
  if (erroPedido) {
    registrarErro("server/radar.pedirDocumentos#gravar", erroPedido, { jornada_id: jornadaId });
    throw erroPedido;
  }
  const pedidos = gravados?.length ?? 0;

  // 2) O link público `/p/d`. `emitir_link_publico` revoga o link ativo
  // anterior do MESMO tipo, na mesma transação — é o comportamento já usado em
  // `POST /api/jornadas/[id]/links`, e o motivo de o token só existir aqui.
  const token = gerarToken();
  const { data: link, error: erroLink } = await supabase
    .rpc("emitir_link_publico", {
      p_jornada_id: jornadaId,
      p_tipo: "documentos",
      p_token_hash: hashToken(token, pepper),
      p_token_prefixo: token.slice(0, 6),
    })
    .single<{ id: string }>();
  if (erroLink || !link) {
    registrarErro("server/radar.pedirDocumentos#link", erroLink, { jornada_id: jornadaId });
    return { pedidos, enfileiradas: 0, motivo: "Documentos marcados como pedidos, mas o link seguro não pôde ser emitido." };
  }

  // 3) A mensagem. RPC `security definer` (0065): `mensagens_agendadas` não
  // aceita INSERT de `authenticated`, e a rota nunca escreve a fila direto.
  const url = `${APP_URL}/p/d/${token}`;
  const { data: enfileiradas, error: erroFila } = await admin.rpc("enfileirar_pedido_documentos", {
    p_jornada_id: jornadaId,
    p_url: url,
  });
  if (erroFila) {
    registrarErro("server/radar.pedirDocumentos#fila", erroFila, { jornada_id: jornadaId });
    return { pedidos, enfileiradas: 0, motivo: "Documentos marcados como pedidos, mas a mensagem não entrou na fila." };
  }

  const total = typeof enfileiradas === "number" ? enfileiradas : 0;
  if (total > 0) await vincularMensagem(admin, jornadaId, unicas);

  return {
    pedidos,
    enfileiradas: total,
    motivo: total > 0 ? null : "Mensagem não enfileirada: já pedida hoje, ou o cliente não tem e-mail nem telefone.",
  };
}

/**
 * Amarra o pedido à mensagem que levou o link — é o que permite responder
 * "quando pedimos e por onde". `mensagem_id` não tem grant para
 * `authenticated` (0065), então esta escrita é de `service_role`.
 */
async function vincularMensagem(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  jornadaId: string,
  chaves: string[],
): Promise<void> {
  try {
    const dia = new Date().toISOString().slice(0, 10); // UTC, igual à chave da RPC
    const { data: mensagem } = await admin
      .from("mensagens_agendadas")
      .select("id")
      .eq("jornada_id", jornadaId)
      .like("chave_idempotencia", `${jornadaId}:documentos_pedido:${dia}:%`)
      .order("criado_em", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (!mensagem) return;
    await admin
      .from("documentos_pedidos")
      .update({ mensagem_id: mensagem.id })
      .eq("jornada_id", jornadaId)
      .in("chave", chaves)
      .is("mensagem_id", null);
  } catch (erro) {
    // Rastreabilidade é bônus: o pedido e a mensagem já existem.
    registrarErro("server/radar.vincularMensagem", erro, { jornada_id: jornadaId });
  }
}
