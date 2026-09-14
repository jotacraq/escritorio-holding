import type { ReactNode } from "react";

/**
 * Largura cheia SÓ NESTA ROTA (pedido do Marcio, 14/09): é um painel de
 * vigilância para monitorar em segundo monitor durante a sessão em tempo
 * real, não uma página de leitura — o `max-w-7xl` do `AppShell` desperdiçava
 * ~metade da tela em monitor largo.
 *
 * 🔑 POR QUE UMA CLASSE E NÃO UM CONTEXT: o `<main>` do `AppShell` fica ACIMA
 * de `{children}` na árvore. Um Provider montado aqui é DESCENDENTE do
 * `AppShell`, e Context só flui de cima para baixo — o shell leria o default
 * (`false`) para sempre. A primeira tentativa (14/09) fez exatamente isso e a
 * tela continuou em `max-w-7xl`, com 284px de vão branco medidos na captura.
 * CSS atravessa a árvore nos dois sentidos: esta classe marca o conteúdo e o
 * seletor em `globals.css` (`:has(> .largura-cheia)`) neutraliza o `max-w` do
 * container-pai. As ~30 outras rotas não são tocadas.
 */
export default function LayoutConduzirSessao({ children }: { children: ReactNode }) {
  return <div className="largura-cheia">{children}</div>;
}
