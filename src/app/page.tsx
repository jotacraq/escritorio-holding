import { redirect } from "next/navigation";

/**
 * A raiz leva ao Painel do dia (Fase 2, §5, F-0). O redirecionamento é do
 * SERVIDOR (307), nunca um `router.replace` no cliente: o navegador nunca
 * recebe HTML desta rota, então não há tela em branco nem "flash" entre o
 * login e o painel. Quem não está logado nem chega aqui — o `middleware.ts`
 * manda para `/login?proximo=/` antes, e o formulário de login volta para
 * `/`, que cai neste redirect direto para o painel.
 *
 * `force-dynamic` evita que o Next tente pré-renderizar a rota como página
 * estática (um redirect não tem HTML para congelar).
 */
export const dynamic = "force-dynamic";

export default function PaginaInicial() {
  redirect("/painel");
}
