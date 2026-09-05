export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { criarClientePublico } from "@/server/publico/cliente";
import { exigirPepper, hashIp, hashToken } from "@/server/publico/pepper";
import { comCabecalhosPublicos, lerSinaisDeRequisicao } from "@/server/publico/protecao";
import { ehRespostaDeErro, statusParaErroPublico } from "@/server/publico/rpc";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { jornadaDoLinkPublico } from "@/server/publico/documento";
import { itensDeColetaDoLinkEmCache, tiposPedidosPublicos } from "@/server/publico/documentos-pedidos";
import { sanitizarPayloadMaterialPublico } from "@/server/material/publico";
import { registrarErro, respostaErro } from "@/server/erros";
import type { AberturaLinkPublico, ErroPublico } from "@/types/publico";

/**
 * GET /api/publico/[token] — resolve o link e devolve o escopo mínimo da finalidade
 * (§2.2 regra 4, §4.1). Erro único para todo caso ruim de token (regra 3): resolvido
 * inteiramente dentro de `abrir_link_publico` — esta rota só traduz `{erro}` em status.
 *
 * Depois da RPC, dois recortes que **só o servidor consegue fazer**:
 *
 *  - `documentos` — a lista de pedidos vem do RADAR (§8.3) e não dos três tipos
 *    fixos de `app.payload_link_documentos` (0028). Ver
 *    `server/publico/documentos-pedidos.ts`.
 *  - `material` — o croqui, quando existir no payload, sai recortado pelo
 *    conjunto de tabelas visíveis ao cliente e sem rastro interno de célula.
 *    Filtrar isso no navegador seria declaração, não trava: o payload já teria
 *    atravessado a rede. Ver `server/material/publico.ts`.
 *
 * Os dois recortes **nunca derrubam a rota**: falha de enriquecimento mantém o
 * payload que a RPC devolveu (o `/p/d` de hoje), com o erro registrado.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const pepper = exigirPepper();
    const { token } = await params;
    const hash = hashToken(token, pepper);
    const { ip, userAgent } = lerSinaisDeRequisicao(request);

    const supabase = criarClientePublico();
    const { data, error } = await supabase.rpc("abrir_link_publico", {
      p_hash: hash,
      p_ip_hash: ip ? hashIp(ip, pepper) : null,
      p_user_agent: userAgent,
    });

    if (error) throw error;

    if (ehRespostaDeErro(data)) {
      const corpo: ErroPublico = { erro: data.erro as ErroPublico["erro"] };
      return comCabecalhosPublicos(NextResponse.json(corpo, { status: statusParaErroPublico(data.erro) }));
    }

    const abertura = data as AberturaLinkPublico;

    if (abertura.tipo === "material") {
      abertura.payload = sanitizarPayloadMaterialPublico(abertura.payload) as AberturaLinkPublico["payload"];
    }

    if (abertura.tipo === "documentos") {
      await enriquecerPedidosComRadar(abertura, hash, pepper);
    }

    return comCabecalhosPublicos(NextResponse.json(abertura, { status: 200 }));
  } catch (erro) {
    return comCabecalhosPublicos(respostaErro("GET /api/publico/[token]", erro));
  }
}

/**
 * Troca os `tipos_pedidos` fixos da 0028 pela lista derivada do radar. Falha
 * FECHADA no sentido de "não piora": qualquer problema (sem `service_role`, sem
 * a 0065, jornada ilegível) deixa o payload da RPC como está — normalizado,
 * porque o contrato novo tem `tipo` além de `chave`.
 */
async function enriquecerPedidosComRadar(
  abertura: AberturaLinkPublico,
  tokenHash: string,
  pepper: string,
): Promise<void> {
  const payload = abertura.payload as { tipos_pedidos?: Array<Record<string, unknown>> } | null;
  if (!payload || !Array.isArray(payload.tipos_pedidos)) return;

  // Normaliza o payload antigo primeiro: `chave` era o próprio tipo, e o
  // contrato novo exige os dois campos. Sem isso, o front teria de tratar duas
  // formas — e é assim que nasce o `undefined` na tela.
  payload.tipos_pedidos = payload.tipos_pedidos.map((p) => ({ ...p, tipo: p.tipo ?? p.chave }));

  let admin: ReturnType<typeof criarClienteAdmin>;
  try {
    admin = criarClienteAdmin();
  } catch (erroServiceRole) {
    // Sem `service_role` não há como ler patrimônio/família: o radar é derivado
    // de tabelas que `anon` não enxerga. O cliente continua vendo a lista curta.
    registrarErro("GET /api/publico/[token]#radar_sem_service_role", erroServiceRole);
    return;
  }

  const jornadaId = await jornadaDoLinkPublico(admin, tokenHash, "documentos");
  if (!jornadaId) return;

  // Cache de 60 s por `token_hash` (0069): o mesmo link aberto e recarregado —
  // ou o cliente mandando cinco arquivos seguidos — deixa de custar ~5 consultas
  // `service_role` por vez. Invalidado no POST assim que um documento é gravado.
  const itens = await itensDeColetaDoLinkEmCache(admin, tokenHash, jornadaId, pepper);
  if (itens === null || itens.length === 0) return;

  payload.tipos_pedidos = tiposPedidosPublicos(itens) as unknown as Array<Record<string, unknown>>;
}
