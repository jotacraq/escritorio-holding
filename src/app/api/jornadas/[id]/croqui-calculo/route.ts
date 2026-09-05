export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirVePatrimonio } from "@/server/auth";
import { erroValidacao, respostaErro } from "@/server/erros";
import { listarCroquiCalculo, registrarCalculo } from "@/server/motor-croqui/servico";

const ParametroSchema = z.object({ id: z.string().uuid() });

/**
 * O corpo NÃO tem `resultado` de propósito. O simulador ao vivo recalcula no
 * navegador com o mesmo motor, mas a versão gravada sai SEMPRE de um cálculo
 * feito no servidor com os `parametros_metodo` vigentes. Número que o cliente
 * manda não vira croqui — é a diferença entre um simulador e uma porta aberta.
 */
const CorpoSchema = z
  .object({
    croqui_id: z.string().uuid().nullish(),
    nota: z.string().trim().max(2000).nullish(),
  })
  .strict();

// A existência da jornada NÃO é conferida com uma consulta própria: quem monta
// a ficha (`lerFichaDoCroqui`) já lê `jornadas` e levanta 404 quando não acha.
// Uma consulta a menos por request, mesmo status na resposta.

/**
 * GET /api/jornadas/[id]/croqui-calculo — o cálculo atual (se houver), o
 * histórico de versões, a entrada montada AGORA da Ficha, os parâmetros
 * vigentes e o que falta cadastrar.
 *
 * A entrada e os parâmetros vão no payload porque o simulador da Sessão de
 * Viabilidade recalcula as 19 tabelas no cliente, sem rede, enquanto a
 * advogada mexe nos números com a família na tela.
 *
 * Só `admin`/`advogada` (RLS `cc_sel`): o snapshot é o patrimônio inteiro.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id: jornadaId } = ParametroSchema.parse(await params);
    const supabase = await criarClienteServidor();
    return NextResponse.json(await listarCroquiCalculo(supabase, jornadaId));
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/croqui-calculo GET", erro);
  }
}

/**
 * POST /api/jornadas/[id]/croqui-calculo — recalcula no servidor e grava a
 * versão nova (201). Falta de parâmetro devolve 409 `parametro_ausente` com a
 * lista de chaves e a jurisdição de cada uma — a tela diz o que cadastrar e
 * onde, em vez de apresentar um croqui com buraco.
 *
 * O gate de papel desta rota virou também o AUTOR do snapshot: desde a 0069 a
 * RPC só aceita `service_role` e exige `p_criado_por` explícito, porque
 * `auth.uid()` não existe do outro lado. `usuario.id` é o `perfis_equipe.id`
 * que `exigirVePatrimonio()` acabou de validar contra a sessão — não vem do
 * corpo, não vem do navegador. Sem `SUPABASE_SERVICE_ROLE_KEY` a resposta é 503
 * rotulado (`servico_indisponivel`), nunca uma gravação pela metade.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirVePatrimonio();
    const { id: jornadaId } = ParametroSchema.parse(await params);

    const bruto = await request.text();
    const corpo = CorpoSchema.parse(
      bruto.trim() === ""
        ? {}
        : JSON.parse(bruto, (_chave, valor) => valor as unknown),
    );

    const supabase = await criarClienteServidor();
    const calculo = await registrarCalculo(supabase, jornadaId, { ...corpo, criadoPor: usuario.id });
    return NextResponse.json({ calculo }, { status: 201 });
  } catch (erro) {
    if (erro instanceof SyntaxError) {
      return respostaErro(
        "api/jornadas/[id]/croqui-calculo POST",
        erroValidacao(null, "Corpo da requisição precisa ser JSON válido."),
      );
    }
    return respostaErro("api/jornadas/[id]/croqui-calculo POST", erro);
  }
}
