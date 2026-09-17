/**
 * A barra de comando do painel: quantos, de quê, na ordem em que atrasa —
 * **sempre visível**, `sticky` no topo da tela.
 *
 * ## O que ela substitui (não é remoção — é troca)
 *
 * Até a Fase 7 esta faixa eram quatro cartões `ui/Kpi` de ~120 px de altura com
 * um número cada. A regra da casa é que **KPI é valor + comparação + auxílio
 * visual**; nenhum dos quatro tinha comparação nem visual — eram contadores
 * vestidos de KPI, e o mesmo número já aparecia na bolinha do cabeçalho do
 * bloco logo abaixo. Custo medido: um terço da dobra de 900 px para repetir
 * quatro números.
 *
 * Aqui os mesmos números viram **atalhos**: cada um leva ao bloco que resolve
 * aquilo (F-pattern — o mais urgente no canto superior esquerdo, que é onde a
 * varredura começa). Nada de informação se perdeu: contagem, motivo do vazio e
 * destino continuam todos ali. O que saiu foi o enfeite.
 *
 * Estado nunca é só cor: o item urgente tem número, rótulo, e a palavra
 * "urgente" no `title` — em escala de cinza continua legível pela posição e
 * pelo texto.
 *
 * ## T2 — vira a barra de comando (16/09/2026)
 *
 * Pedido literal do Marcio: *"nunca tenho amostra de acesso rápido [...] o
 * admin tem que ter o controle do sistema"* — e *"sempre visível"*. A fila de
 * atalhos já existia; o que faltava era ficar acessível SEM rolar.
 * `sticky top-[61px] lg:top-0`: 61px é a altura medida do header mobile do
 * `AppShell` (`h-11` = 44px + `py-2` = 16px + borda 1px) — abaixo de `lg` o
 * header do celular já ocupa o topo da viewport, e a barra cola imediatamente
 * abaixo dele, nunca por baixo (por isso o `z-10`, sempre menor que o `z-30`
 * do header).
 *
 * Uma linha só, rótulo à esquerda do número, número em `tabular-nums` — é
 * literalmente o "acesso rápido" pedido. Abaixo de `sm` a barra rola
 * **dentro de si mesma** (`overflow-x-auto`), nunca a página: o item
 * continua `min-h-11` (público 50+, alvo não encolhe).
 *
 * **Fable (achado defeito 2, 16/09/2026):** a T2 original desligava o sticky
 * a partir de `sm` (`sm:border-none sm:bg-transparent sm:px-0 sm:py-0`) sem
 * `sm:static` — a barra ficava `position: sticky` **sem** fundo/padding em
 * telas ≥ 640px: pílulas coladas na borda da viewport, conteúdo rolando por
 * baixo, faixa de `backdrop-blur` sobrando. "Sempre visível" é o pedido
 * explícito do dono do produto — a correção é manter sticky+fundo+borda+`py`
 * em TODO breakpoint, não desligar em `sm`. Só o `-mx-3`/`px-3` de sangria
 * lateral (que existe para a barra encostar na borda no mobile) deixa de
 * fazer sentido a partir de `sm`, onde a página já tem `padding` — por isso
 * `sm:mx-0` continua, e junto dele `sm:px-cartao` (em vez de zerar o
 * padding) para o conteúdo não colar na borda do cartão que envolve a barra.
 */

export interface ItemResumo {
  id: string;
  /** ≤ 3 palavras. É o mesmo nome do bloco de destino — desktop e celular idênticos. */
  rotulo: string;
  /** `null` = não carregou. Nunca zero por engano (DS §7). */
  valor: number | null;
  /** Sufixo curto ("de 3"). */
  unidade?: string;
  /** Por que está vazio, quando `valor` é `null`. */
  motivoVazio?: string;
  /** Âncora do bloco correspondente nesta mesma tela. */
  href: string;
  /** Realce vermelho: há trabalho que não pode esperar. */
  urgente?: boolean;
}

/**
 * Zero não entra na faixa.
 *
 * O bloco que está em dia já aparece, com o mesmo nome, na linha "Sem
 * pendência" logo abaixo — e uma pílula dizendo "0 Compra travada" no topo com
 * "Sem pendência: Compra travada" no rodapé é o mesmo fato duas vezes na mesma
 * dobra, que é o que esta fase veio tirar. A 360 px cada pílula custa uma
 * linha: com seis, a primeira fila de trabalho começava a 700 px de rolagem.
 *
 * `null` (não carregou) **continua aparecendo**: "não sei" não é "nada", e
 * quem opera precisa ver que aquele número faltou.
 */
function vaiParaAFaixa(item: ItemResumo): boolean {
  return item.valor === null || item.valor > 0;
}

export function ResumoDoDia({ itens }: { itens: readonly ItemResumo[] }) {
  const visiveis = itens.filter(vaiParaAFaixa);
  if (visiveis.length === 0) return null;
  return (
    <nav
      aria-label="Resumo de hoje"
      className="sticky top-[61px] z-10 -mx-3 flex flex-nowrap items-center gap-2 overflow-x-auto border-b border-linha bg-papel-fundo/95 px-3 py-2 backdrop-blur sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-cartao lg:top-0"
    >
      {visiveis.map((item) => {
        const vazio = item.valor === null;
        const realce = item.urgente && !vazio && item.valor! > 0;
        return (
          <a
            key={item.id}
            href={item.href}
            title={vazio ? item.motivoVazio : realce ? `${item.rotulo} — urgente` : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-pilula border px-3.5 text-sm transition-[border-color,box-shadow] duration-[var(--transicao-rapida)] hover:shadow-cartao ${
              realce
                ? "border-transparent bg-vermelho-fraco text-[color:var(--estado-vermelho)] hover:border-[color:var(--vermelho)]"
                : "border-linha-forte bg-papel-elevado text-tinta hover:border-[color:var(--latao)]"
            }`}
          >
            <span className={`font-bold tabular-nums ${vazio ? "text-tinta-fraca" : "text-subtitulo"}`}>
              {vazio ? "—" : item.valor}
            </span>
            <span className="font-medium">{item.rotulo}</span>
            {!vazio && item.unidade && <span className="text-legenda text-tinta-suave">{item.unidade}</span>}
          </a>
        );
      })}
    </nav>
  );
}
