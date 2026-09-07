import type { ReactNode } from "react";
import Link from "next/link";
import { EsqueletoLista } from "./Esqueleto";

/**
 * Uma tabela, duas formas (Fase 8, §C3 M2).
 *
 * Antes desta fase, "tabela responsiva" era escrever a lista DUAS vezes: um
 * `<table>` com `hidden sm:block` e uma pilha de cartões com `sm:hidden`
 * logo abaixo, as duas mantidas na mão. O custo apareceu na Fase 7: coluna
 * nova entrava numa e não na outra, e o rótulo divergia entre desktop e
 * celular — exatamente o que o João pediu para acabar ("mesma lógica, mesmos
 * nomes, mesma ordem").
 *
 * Aqui a fonte é UMA: `colunas` descreve cabeçalho + célula, e o componente
 * decide a forma. Acima do ponto de quebra, `<table>` de verdade (cabeçalho
 * com `scope="col"`, o que faz o leitor de tela anunciar "Situação: Pago" ao
 * andar pelas células). Abaixo, cada linha vira um cartão com pares
 * rótulo/valor num `<dl>` — sem rolagem horizontal a 360px, que é o piso novo.
 *
 * ```tsx
 * <Tabela
 *   legenda="Produtos do escritório"
 *   colunas={[
 *     { chave: "nome", cabecalho: "Produto", celula: (p) => p.nome },
 *     { chave: "valor", cabecalho: "Valor", numerica: true, celula: (p) => formatarMoeda(p.valor) },
 *   ]}
 *   linhas={produtos}
 *   chaveDaLinha={(p) => p.id}
 *   hrefDaLinha={(p) => `/admin/produtos/${p.id}`}
 *   vazio={<EstadoVazio titulo="Nenhum produto" … />}
 * />
 * ```
 */

export interface ColunaTabela<L> {
  /** Identificador estável da coluna (nunca o índice). */
  chave: string;
  /** Cabeçalho da coluna. É também o rótulo do par no cartão do celular. */
  cabecalho: string;
  celula: (linha: L) => ReactNode;
  /** Rótulo diferente no cartão, quando o cabeçalho só faz sentido na grade. */
  rotuloNoCartao?: string;
  /** Não repetir no cartão (ex.: a coluna que já virou o título do cartão). */
  ocultarNoCartao?: boolean;
  /** Número/valor: alinha à direita e usa `tabular-nums`. */
  numerica?: boolean;
  /** Cabeçalho só para leitor de tela (coluna de ações, de ícone). */
  cabecalhoOculto?: boolean;
  /** Classe de largura/alinhamento aplicada ao `<th>`/`<td>` no desktop. */
  classe?: string;
}

export interface TabelaProps<L> {
  /**
   * O que a tabela lista, em uma frase. Vira `<caption class="sr-only">` — é
   * como quem usa leitor de tela sabe em qual tabela entrou, e é obrigatório:
   * uma tabela sem legenda é uma grade anônima.
   */
  legenda: string;
  colunas: readonly ColunaTabela<L>[];
  linhas: readonly L[];
  /** Chave estável da linha. Índice não serve: reordenar embaralha o DOM. */
  chaveDaLinha: (linha: L) => string;
  /**
   * Título do cartão no celular. Sem isto, o cartão usa a primeira coluna —
   * que é o que quase sempre se quer (o nome da pessoa).
   */
  tituloDoCartao?: (linha: L) => ReactNode;
  /**
   * Ações da linha (botões). **Uma fonte, os dois lugares**: na grade viram a
   * última coluna, alinhada à direita; no cartão do celular vão para o rodapé.
   * Nos dois casos com `gap-alvo` entre os botões, que é o piso de folga entre
   * alvos vizinhos.
   *
   * Antes da rodada FIX a `Tabela` só sabia do cartão, e quem precisava de
   * ação na grade declarava uma coluna `cabecalhoOculto`+`ocultarNoCartao`
   * repetindo o mesmo `acoes` (era o contorno do UX2 em `TabelaClientes`) —
   * duas declarações da mesma coisa, que é exatamente o que este componente
   * existe para acabar.
   */
  acoes?: (linha: L) => ReactNode;
  /**
   * Cabeçalho da coluna de ações. Fica `sr-only`: na grade a coluna é óbvia
   * para quem vê e precisa de nome para quem ouve — `<th>` vazio faz o leitor
   * de tela anunciar "coluna em branco".
   */
  cabecalhoDasAcoes?: string;
  /** A linha inteira leva para cá. O link fica no título — um só ponto de Tab. */
  hrefDaLinha?: (linha: L) => string;
  /** Onde a grade vira cartão. Padrão `md` (a 360px nunca há tabela). */
  quebra?: "sm" | "md" | "lg";
  /** Esqueleto enquanto carrega — nunca uma tabela vazia piscando. */
  carregando?: boolean;
  /** `EstadoVazio` com a ação que preenche a lista (DS §7). */
  vazio?: ReactNode;
  className?: string;
}

const QUEBRA = {
  sm: { grade: "hidden sm:block", cartoes: "sm:hidden" },
  md: { grade: "hidden md:block", cartoes: "md:hidden" },
  lg: { grade: "hidden lg:block", cartoes: "lg:hidden" },
} as const;

export function Tabela<L>({
  legenda,
  colunas,
  linhas,
  chaveDaLinha,
  tituloDoCartao,
  acoes,
  cabecalhoDasAcoes = "Ações",
  hrefDaLinha,
  quebra = "md",
  carregando = false,
  vazio,
  className = "",
}: TabelaProps<L>) {
  if (carregando) return <EsqueletoLista linhas={5} rotulo={`Carregando: ${legenda}`} />;
  if (linhas.length === 0) return <>{vazio ?? null}</>;

  const forma = QUEBRA[quebra];
  const [primeira, ...demais] = colunas;
  const tituloDe = tituloDoCartao ?? ((linha: L) => primeira?.celula(linha));
  const colunasDoCartao = tituloDoCartao ? colunas : demais;

  return (
    <div className={className}>
      {/* ---------- grade (desktop) ---------- */}
      <div className={forma.grade}>
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{legenda}</caption>
          <thead>
            <tr className="border-b border-linha">
              {colunas.map((coluna) => (
                <th
                  key={coluna.chave}
                  scope="col"
                  className={`px-3 py-2 text-rotulo font-medium uppercase text-tinta-fraca ${coluna.numerica ? "text-right" : "text-left"} ${coluna.classe ?? ""}`}
                >
                  <span className={coluna.cabecalhoOculto ? "sr-only" : undefined}>{coluna.cabecalho}</span>
                </th>
              ))}
              {acoes && (
                <th scope="col" className="w-px whitespace-nowrap px-3 py-2 text-right">
                  <span className="sr-only">{cabecalhoDasAcoes}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha) => {
              const href = hrefDaLinha?.(linha);
              return (
                <tr key={chaveDaLinha(linha)} className="border-b border-linha last:border-0 hover:bg-papel">
                  {colunas.map((coluna, indice) => {
                    const conteudo = coluna.celula(linha);
                    return (
                      <td
                        key={coluna.chave}
                        className={`px-3 py-2 align-middle ${coluna.numerica ? "text-right tabular-nums" : "text-left"} ${indice === 0 ? "font-medium text-tinta" : "text-tinta-suave"} ${coluna.classe ?? ""}`}
                      >
                        {/* O link vive na PRIMEIRA célula, não na `<tr>`: linha
                            inteira clicável exigiria `onClick` num elemento não
                            interativo — sem foco, sem Enter, sem "abrir em nova
                            aba". `min-h-11` porque o alvo é o link, não a célula. */}
                        {indice === 0 && href ? (
                          <Link href={href} className="-my-2 flex min-h-11 items-center py-2 hover:text-[color:var(--latao)]">
                            <span className="truncate">{conteudo}</span>
                          </Link>
                        ) : (
                          conteudo
                        )}
                      </td>
                    );
                  })}
                  {acoes && (
                    <td className="w-px whitespace-nowrap px-3 py-2 text-right align-middle">
                      <div className="flex justify-end gap-alvo">{acoes(linha)}</div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ---------- cartões (celular) ---------- */}
      <ul className={`flex flex-col gap-item ${forma.cartoes}`} aria-label={legenda}>
        {linhas.map((linha) => {
          const href = hrefDaLinha?.(linha);
          const titulo = tituloDe(linha);
          return (
            <li
              key={chaveDaLinha(linha)}
              className="relative flex flex-col gap-item rounded-controle border border-linha bg-papel-elevado p-3"
            >
              <p className="text-subtitulo font-bold text-tinta">
                {href ? (
                  /* `after:absolute inset-0` faz o cartão inteiro clicável com
                     UM único ponto de Tab e semântica de link de verdade. As
                     ações do rodapé sobem de camada para continuarem clicáveis. */
                  <Link href={href} className="after:absolute after:inset-0 after:rounded-controle">
                    {titulo}
                  </Link>
                ) : (
                  titulo
                )}
              </p>
              <dl className="flex flex-col gap-1">
                {colunasDoCartao
                  .filter((coluna) => !coluna.ocultarNoCartao)
                  .map((coluna) => (
                    <div key={coluna.chave} className="flex items-baseline justify-between gap-3">
                      <dt className="shrink-0 text-rotulo font-medium uppercase text-tinta-fraca">
                        {coluna.rotuloNoCartao ?? coluna.cabecalho}
                      </dt>
                      <dd className={`min-w-0 text-right text-sm text-tinta-suave ${coluna.numerica ? "tabular-nums" : ""}`}>
                        {coluna.celula(linha)}
                      </dd>
                    </div>
                  ))}
              </dl>
              {acoes && <div className="relative z-[1] flex flex-wrap gap-alvo pt-1">{acoes(linha)}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
