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
 *
 * Fatia 9 (17/09) — `.foco-sessao`, classe IRMÃ de `.largura-cheia` no MESMO
 * `<div>`, mesmo mecanismo de `:has()`: enquanto a rota `/conduzir` está
 * montada, `globals.css` recolhe a `.nav-lateral` para a largura só-ícone
 * (o MESMO `4.5rem` que `NavRecolher.tsx`/`data-nav-recolhida="1"` já usa —
 * reuso do valor, não um segundo padrão de largura). Diferente de
 * `.modo-tela-cheia-sessao` (que faz `display:none` na lateral inteira e
 * deixa o foco do teclado alcançando links ocultos, documentado ali): aqui a
 * lateral não some, só encolhe — o mesmo efeito visual de `NavRecolher`, só
 * que automático nesta rota e SEM tocar `localStorage`/`CHAVE_NAV_RECOLHIDA`
 * (chave global aos 7 sistemas — persistir o recolhimento automático faria a
 * advogada achar o menu sumido em outra tela do sistema depois; isso seria
 * bug, não modo foco). Zero estado: o efeito nasce e morre com a montagem
 * deste layout.
 *
 * 🔴 CORREÇÃO (Fable, achado F9 — 17/09/2026): o botão `NavRecolher` (que
 * grava `data-nav-recolhida` direto no `<html>`) PRECISA de uma regra CSS
 * própria e mais específica para valer por cima do foco — a regra de foco
 * sozinha (`body:has(.foco-sessao) .nav-lateral`) não tinha nenhuma
 * condição sobre o atributo, então o clique alternava ícone/rótulo/
 * `aria-pressed` sem NENHUM efeito na largura real dentro desta rota.
 * `globals.css` agora tem `html[data-nav-recolhida="0"]
 * body:has(.foco-sessao) .nav-lateral` para o caso "expandir manualmente
 * mesmo em foco" — só esse valor explícito (`"0"`) vence; o foco continua
 * sendo o padrão.
 */
export default function LayoutConduzirSessao({ children }: { children: ReactNode }) {
  return <div className="largura-cheia foco-sessao">{children}</div>;
}
