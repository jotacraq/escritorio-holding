export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { registrarErro, respostaErro } from "@/server/erros";
import { pendenciaVisivelPara } from "@/lib/blocosPorPapel";
import { FONTE_DO_BLOCO, blocosAConsultar, lerBlocosPedidos } from "@/server/painel/blocos";
import type {
  IndicadorEdicaoLinha,
  PagoSemContatoLinha,
  PendenciaPreparoLinha,
  PendenciaSistemaLinha,
  RespostaPainel,
  SessaoDoDiaLinha,
} from "@/types/agenda";

/**
 * Painel do dia (ARQUITETURA-FASE-2.md §4.6 / brain "Esteira do cliente"): os
 * cinco blocos que respondem "o que precisa da minha atenção agora". Sem
 * polling — a tela (`src/components/painel/usePainelDia.ts`, F-1B) busca só
 * ao montar e sob clique em "Atualizar".
 *
 * Todas as cinco fontes são views `security_invoker = true` (0034): cada
 * bloco devolve exatamente o que a RLS de quem está logado permite — "vazio"
 * aqui é sempre "nada pendente de verdade", nunca "sem permissão disfarçado
 * de zero". Uma falha em UMA consulta não derruba as outras: cada bloco é
 * buscado e tratado de forma independente, e o envelope só reporta erro geral
 * se TODAS falharem (falha parcial vira bloco ausente, que o front já trata
 * como "não conseguiu carregar aquele pedaço" — `src/types/painel-ui.ts`).
 *
 * ## Filtro por papel (0069 — achado BAIXO do pentest da Fase 5)
 *
 * Até aqui a matriz `BLOCOS_POR_PAPEL` vivia só no componente: a tela escondia
 * o bloco, o JSON entregava tudo a todo papel interno. `relacionamento` recebia
 * `cron_parado` (que cita `/api/cron/regua` e o NOME da env `CRON_SECRET`) e
 * `advogada` recebia `webhook_falho` com o texto cru de erro do provedor. RLS
 * não separava: as views são de `eh_interno`.
 *
 * Agora a MESMA matriz decide o que o servidor sequer consulta. Duas regras:
 *
 *  1. **Bloco fora do papel não é consultado.** `pagos_sem_contato` não sai
 *     para `advogada`; `indicadores_semana` não sai para `relacionamento` /
 *     `assistente`. Uma consulta a menos, e o dado não atravessa a rede.
 *  2. **`pendencias_sistema` é filtrada por TIPO, não pelo bloco.** É a
 *     divergência já registrada em `blocosPorPapel.ts`: esconder o bloco
 *     inteiro tiraria da advogada a única pista de que a sessão de amanhã está
 *     sem sala. Então todo papel interno recebe a view, e `pendenciaVisivelPara`
 *     corta tudo que não é ação de gente — `cron_parado`, `webhook_falho`,
 *     `mensagem_falhou` só chegam ao admin. O filtro roda no SERVIDOR; o
 *     componente continua chamando a mesma função e o resultado é idempotente.
 *
 * ## `?blocos=a,b,c` (corte de egress — pedido do M3)
 *
 * O recorte é a INTERSEÇÃO do pedido com o que o papel pode ver: `?blocos=` é
 * otimização, nunca elevação. A tela de Comunicação, por exemplo, só quer
 * `pendencias_sistema` e hoje baixa o painel inteiro para jogar fora quatro
 * blocos. Sem o parâmetro, o comportamento é o de sempre: tudo que o papel vê.
 * Chave desconhecida é recusada com 422 (nomeando as válidas) em vez de virar
 * um painel silenciosamente vazio.
 */

export async function GET(request: NextRequest) {
  try {
    const usuario = await exigirInterno();
    // A matriz de papel e o recorte de `?blocos=` vivem em `server/painel/blocos.ts`
    // — fora do route handler para poderem ser verificados sem subir um request.
    const aBuscar = blocosAConsultar(usuario.papel, lerBlocosPedidos(request.nextUrl.searchParams));

    const resposta: Partial<RespostaPainel> & { gerado_em: string } = {
      gerado_em: new Date().toISOString(),
    };

    if (aBuscar.length === 0) return NextResponse.json(resposta);

    const supabase = await criarClienteServidor();
    const resultados = await Promise.all(
      aBuscar.map((bloco) => supabase.from(FONTE_DO_BLOCO[bloco].view).select("*")),
    );

    aBuscar.forEach((bloco, indice) => {
      const { campo, view } = FONTE_DO_BLOCO[bloco];
      const { data, error } = resultados[indice];

      // Falha parcial vira bloco AUSENTE, nunca array vazio: "vazio" na tela
      // significa "nada pendente", e uma consulta que falhou não é isso.
      if (error) {
        registrarErro(`api/painel GET ${view}`, error, { papel: usuario.papel });
        return;
      }

      switch (campo) {
        case "sessoes_do_dia":
          resposta.sessoes_do_dia = data as SessaoDoDiaLinha[];
          break;
        case "pendencias_preparo":
          resposta.pendencias_preparo = data as PendenciaPreparoLinha[];
          break;
        case "pagos_sem_contato":
          resposta.pagos_sem_contato = data as PagoSemContatoLinha[];
          break;
        case "pendencias_sistema":
          resposta.pendencias_sistema = (data as PendenciaSistemaLinha[]).filter((linha) =>
            pendenciaVisivelPara(usuario.papel, linha.tipo),
          );
          break;
        case "indicadores_semana":
          resposta.indicadores_semana = data as IndicadorEdicaoLinha[];
          break;
      }
    });

    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro("api/painel GET", erro);
  }
}
