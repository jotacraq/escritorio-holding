export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirVePatrimonio } from "@/server/auth";
import { erroNaoEncontrado, erroValidacao, respostaErro } from "@/server/erros";
import { criarLimitadorJanela } from "@/server/integracoes/rate-limit";
import { pedirDocumentos } from "@/server/radar/pedir";

/**
 * Mesmo limitador da rota de emissão de link da equipe, pelo mesmo achado do
 * pentest da Fase 6: aqui também sai um link `/p/*` (o `/p/d` do radar), a
 * emissão também REVOGA o link `documentos` ativo anterior
 * (`emitir_link_publico`, 0028:829-836) e cada chamada ainda enfileira
 * mensagem para o cliente. Chave = perfil, não IP (o escritório sai por um IP
 * só). 20 pedidos por 10 minutos.
 */
const limitarPedido = criarLimitadorJanela(20, 10 * 60_000);

const ParametroSchema = z.object({ id: z.string().uuid() });

/**
 * Só o formato da chave derivada (`{lado}:{tipo}:{item_ref|-}[:{sufixo}]`). A
 * validação que importa é a outra, no servidor: a chave tem de estar no radar
 * DESTA jornada (`pedirDocumentos`). Este regex só evita que texto arbitrário
 * chegue lá.
 */
const CorpoSchema = z.object({
  chaves: z.array(z.string().min(3).max(160).regex(/^[a-z_]+:[a-z_]+:[A-Za-z0-9_-]+(:[a-z_]+)?$/)).min(1).max(40),
});

/**
 * POST /api/jornadas/[id]/radar/pedir — grava o pedido e enfileira UMA mensagem
 * por canal com o link `/p/d` (§8.3).
 *
 * Idempotente por natureza: `unique (jornada_id, chave)` no pedido e
 * `chave_idempotencia` do dia na mensagem (0013). Duplo clique não vira duas
 * mensagens. Falha FECHADO: sem pepper ou sem `SUPABASE_SERVICE_ROLE_KEY`,
 * responde 503 rotulado e não grava nada.
 * Forma: `RespostaRadarPedir` (src/types/jornada-automacoes.ts).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirVePatrimonio();

    const limite = limitarPedido(usuario.id);
    if (limite.excedido) {
      return NextResponse.json(
        {
          erro: "limite_excedido",
          mensagem: `Muitos pedidos em sequência. Tente de novo em ${limite.tenteEmS} s.`,
          tente_em_s: limite.tenteEmS,
        },
        { status: 429, headers: { "Retry-After": String(limite.tenteEmS) } },
      );
    }

    const { id: jornadaId } = ParametroSchema.parse(await params);
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase.from("jornadas").select("id").eq("id", jornadaId).maybeSingle();
    if (error) throw error;
    if (!data) throw erroNaoEncontrado("Jornada não encontrada.");

    return NextResponse.json(await pedirDocumentos(supabase, jornadaId, corpo.chaves, usuario.id), { status: 201 });
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/radar/pedir POST", erro);
  }
}
