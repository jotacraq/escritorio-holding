export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { exigirVePatrimonio } from "@/server/auth";
import { ErroApi, erroConflito, erroNaoEncontrado, registrarErro, respostaErro } from "@/server/erros";
import type { CroquiCalculo } from "@/types/croqui-calculo";

const ParametroSchema = z.object({
  id: z.string().uuid(),
  calculoId: z.string().uuid(),
});

/**
 * POST /api/jornadas/[id]/croqui-calculo/[calculoId]/fixar — volta o `atual`
 * para uma versão ANTERIOR do cálculo, sem apagar nada.
 *
 * ## Por que esta rota existe
 *
 * `fixar_croqui_calculo` nasceu na 0063 e foi endurecida na 0069 (EXECUTE só
 * para `service_role`, `p_criado_por` explícito), mas nunca teve chamador — o
 * Fable listou a RPC como superfície morta na trava da Fase 5. A gaveta de
 * versões do `CroquiCalculado.tsx` mostra o histórico e não tinha como voltar
 * a uma versão: a única saída era recalcular, que grava uma versão NOVA com os
 * parâmetros de HOJE. Numa apresentação em que a família já viu a v2, isso
 * troca o número na frente dela.
 *
 * Alternativa considerada e descartada: apagar a RPC. O `atual` é escolha
 * humana ("a versão que apresentamos é a v2") e não deriva de nada — sem uma
 * porta, ou o histórico é decoração ou alguém edita a coluna à mão.
 *
 * ## Autorização, em três camadas
 *
 * 1. `exigirVePatrimonio()` — gate de papel na rota.
 * 2. A leitura de conferência usa o cliente da SESSÃO: a RLS `cc_sel` (0063,
 *    `ve_patrimonio`) decide se este usuário enxerga aquele cálculo. Um
 *    `calculoId` de outra jornada devolve 404, não 403 — não confirmamos a
 *    existência de linha que a sessão não pode ver.
 * 3. A RPC revalida `p_criado_por` contra `perfis_equipe` ativo admin/advogada
 *    (0069). `usuario.id` vem de `exigirVePatrimonio()`, nunca do corpo.
 *
 * O par jornada×cálculo é conferido AQUI, e não só na RPC: `fixar_croqui_calculo`
 * recebe o id do cálculo e resolve a jornada sozinha, então sem esta checagem
 * a rota `/api/jornadas/<A>/…/<cálculo de B>/fixar` fixaria a versão de B — um
 * IDOR de path, com 200 na resposta.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string; calculoId: string }> }) {
  try {
    const usuario = await exigirVePatrimonio();
    const { id: jornadaId, calculoId } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();
    // `select("*")`, não um recorte: a resposta desta rota é sempre um
    // `CroquiCalculo` inteiro — o mesmo que a RPC devolve no caminho de
    // escrita. Dois formatos para a mesma rota obrigariam a tela a adivinhar
    // qual chegou.
    const { data: alvo, error: erroLeitura } = await supabase
      .from("croqui_calculos")
      .select("*")
      .eq("id", calculoId)
      .eq("jornada_id", jornadaId)
      .maybeSingle<CroquiCalculo>();

    if (erroLeitura) throw erroLeitura;
    if (!alvo) throw erroNaoEncontrado("Versão do cálculo não encontrada nesta jornada.");

    if (alvo.atual) {
      // Idempotência honesta: nada a fazer, e a tela não precisa de um erro
      // para dizer "já é esta". 200 com a linha, sem escrita.
      return NextResponse.json({ calculo: alvo, ja_era_atual: true });
    }

    let admin;
    try {
      admin = criarClienteAdmin();
    } catch (erroServiceRole) {
      registrarErro("api/jornadas/[id]/croqui-calculo/[calculoId]/fixar#service_role_ausente", erroServiceRole, {
        jornada_id: jornadaId,
      });
      throw new ErroApi(
        503,
        "servico_indisponivel",
        "Fixar a versão do croqui exige SUPABASE_SERVICE_ROLE_KEY — indisponível agora.",
      );
    }

    const { data, error } = await admin.rpc("fixar_croqui_calculo", {
      p_id: calculoId,
      p_criado_por: usuario.id,
    });

    if (error) {
      registrarErro("api/jornadas/[id]/croqui-calculo/[calculoId]/fixar", error, {
        jornada_id: jornadaId,
        calculo_id: calculoId,
        perfil_id: usuario.id,
      });
      // 42501 = o perfil foi desativado ou trocou de papel entre o login e o
      // clique; 22004 = `p_criado_por` nulo (bug de chamador). Mesma resposta
      // honesta que `registrarCalculo` dá.
      if (error.code === "42501" || error.code === "22004") {
        throw erroConflito("sem_permissao", "Só admin ou advogada ativa fixa a versão do croqui.");
      }
      // Banco ainda sem a 0069: a assinatura de 2 parâmetros não existe.
      if (error.code === "PGRST202" || error.code === "42883") {
        throw new ErroApi(
          503,
          "servico_indisponivel",
          "Fixar a versão do croqui exige a migration 0069 — indisponível agora.",
        );
      }
      throw error;
    }

    return NextResponse.json({ calculo: data as CroquiCalculo, ja_era_atual: false });
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/croqui-calculo/[calculoId]/fixar POST", erro);
  }
}
