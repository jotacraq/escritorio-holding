"use client";

import { useState } from "react";
import Link from "next/link";
import { useEtapasOrdem } from "@/hooks/useJornadas";
import { atualizarEtapa, ApiError, type Briefing, type DesfechoJornada, type Ficha360 } from "@/lib/api";
import { formatarCidadeUf, formatarTelefone } from "@/lib/formatar";
import { Selo, SeloDadoExemplo } from "@/components/ui/Selo";
import { Botao } from "@/components/ui/Botao";
import { objecaoPrincipal } from "@/components/briefing/atomos";
import { rotularDisc } from "@/components/briefing/tipos";
import { rotulo, rotuloDeEtapa, titleDe } from "@/lib/vocabulario";
import type { ChaveItemPasta } from "@/lib/pasta/catalogo";
import { rotaCroquiApresentar, rotaCroquiVer } from "./rotas-croqui";

const ROTULOS_DESFECHO: Record<DesfechoJornada, { rotulo: string; tom: "verde" | "vermelho" | "azul" | "neutro" }> = {
  aberta: { rotulo: "Aberta", tom: "azul" },
  ganha: { rotulo: "Ganha", tom: "verde" },
  perdida: { rotulo: "Perdida", tom: "vermelho" },
  descartada: { rotulo: "Descartada", tom: "vermelho" },
  congelada: { rotulo: "Congelada", tom: "neutro" },
};

// "Sessão paga" aparecia aqui E como rótulo da etapa `sessao_contratada`:
// dois selos idênticos lado a lado, dizendo coisas diferentes (um é etapa da
// esteira, o outro é até onde a pessoa pagou). Prefixo "Pago:" desfaz a
// colisão sem perder a informação.
const ROTULOS_NIVEL_PAGO = ["Nada pago", "Pago: sessão", "Pago: croqui", "Pago: holding"];

interface ItemFaixa {
  rotulo: string;
  valor: string;
  href?: string;
  /** Detalhe/sigla do método — só no `title` (lei de texto §2.2). */
  title?: string;
  /** Fase 3 — quando o item aponta para uma das 5 chaves migradas para Gaveta
   * (Camada 2), o clique abre o painel lateral em vez de navegar por hash. */
  onClick?: () => void;
}

/**
 * A faixa vital, Fase 5: só **dado do cliente**.
 *
 * "Etapa" e "Próxima ação" saíram daqui — quem responde as duas agora é o
 * `ui/Trilho` (`TrilhoDaFicha`), que fica logo abaixo, é sticky e mostra os 9
 * passos com UMA ação. Manter as duas informações em dois lugares era a
 * terceira repetição da mesma frase na mesma dobra e brigava com a lei de
 * texto (§2: um verbo por bloco). A etapa da esteira virou selo no cabeçalho.
 *
 * O que sobra é o que o trilho não sabe: faixa de patrimônio declarada,
 * quantos familiares mapeados, perfil de decisão e objeção provável — todos
 * dado do cliente, todos com destino de clique.
 */

function FaixaVital({
  ficha,
  briefing,
  podeVerPatrimonio,
  aoAbrirGaveta,
}: {
  ficha: Ficha360;
  briefing: Briefing | null;
  podeVerPatrimonio: boolean;
  /** Fase 3 — mesmo estado de Gaveta elevado a `ConteudoFicha`
   * (`jornadas/[id]/page.tsx`). Familiares continua apontando por hash: não
   * tem Gaveta própria (ver nota em `rotas.ts`). */
  aoAbrirGaveta: (chave: ChaveItemPasta) => void;
}) {
  const { jornada, familiares } = ficha;
  const objecao = objecaoPrincipal(briefing?.conteudo.objecoes_provaveis);
  const disc = briefing?.conteudo.perfil_disc;

  const itens: ItemFaixa[] = [];

  if (jornada.faixa_patrimonio_declarada) {
    itens.push({
      rotulo: "Patrimônio",
      valor: jornada.faixa_patrimonio_declarada,
      onClick: podeVerPatrimonio ? () => aoAbrirGaveta("patrimonio") : undefined,
    });
  }
  if (familiares && familiares.length > 0) {
    // "Familiares mapeados" continua por hash — não migrado (é o próprio
    // Patrimônio que lista os familiares hoje, ver nota em `rotas.ts`).
    itens.push({ rotulo: "Familiares", valor: String(familiares.length), href: "#patrimonio" });
  }
  if (disc) {
    itens.push({
      // §9.2: sigla do método nunca no fluxo — "DISC" vai para o `title`.
      rotulo: rotulo("disc"),
      valor: disc.secundario ? `${rotularDisc(disc.predominante)} / ${rotularDisc(disc.secundario)}` : rotularDisc(disc.predominante),
      href: "#briefing",
      title: titleDe("disc"),
    });
  }
  if (objecao) {
    itens.push({ rotulo: "Objeção provável", valor: objecao.objecao, href: "#briefing" });
  }

  if (itens.length === 0) return null;

  return (
    <dl className="nao-imprimir flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
      {itens.map((item) => (
        <div key={item.rotulo} className="flex items-center gap-1.5">
          <dt title={item.title} className="text-tinta-fraca">
            {item.rotulo}
          </dt>
          <dd>
            {item.onClick ? (
              <button
                type="button"
                onClick={item.onClick}
                className="-my-2 inline-flex min-h-11 items-center rounded-controle font-medium text-tinta underline decoration-tinta-fraca decoration-dotted underline-offset-2 hover:text-[color:var(--latao-forte)] hover:decoration-[color:var(--latao)]"
              >
                {item.valor}
              </button>
            ) : item.href ? (
              <a
                href={item.href}
                className="-my-2 inline-flex min-h-11 items-center rounded-controle font-medium text-tinta underline decoration-tinta-fraca decoration-dotted underline-offset-2 hover:text-[color:var(--latao-forte)] hover:decoration-[color:var(--latao)]"
              >
                {item.valor}
              </a>
            ) : (
              <span className="font-medium text-tinta">{item.valor}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function CabecalhoFicha({
  ficha,
  aoAtualizar,
  briefing,
  croquiAtalho,
  aoAbrirGaveta,
}: {
  ficha: Ficha360;
  aoAtualizar: () => void;
  /** Briefing completo atual da jornada, buscado UMA vez pelo pai
   * (`useBriefingAtual`, Tarefa 5) e compartilhado com `BriefingAba` —
   * antes, este componente buscava o mesmo dado por conta própria. Só usa
   * DISC e objeção provável; `null` mostra a faixa vital sem esses dois itens,
   * nunca inventa. */
  briefing: Briefing | null;
  /** Atalho fixo para o Modo Apresentação do Croqui, ao lado de "Conduzir
   * sessão" — mesmo estado elevado do pai (`useCroquiDaJornada`, F5), montado
   * como `null` quando não há croqui na timeline ou o papel não vê patrimônio.
   * `null` não renderiza nada (nunca aparece desabilitado). */
  croquiAtalho: { croquiId: string } | null;
  /** Fase 3 ("A Pasta do Cliente", Camada 2) — abre a Gaveta correspondente
   * quando o chip "Próxima ação"/"Patrimônio" da faixa vital aponta para um
   * dos 5 itens migrados. Estado vive no pai (`ConteudoFicha`), o mesmo que
   * a Pasta usa — um único "dono" da Gaveta na tela inteira. */
  aoAbrirGaveta: (chave: ChaveItemPasta) => void;
}) {
  const { etapas } = useEtapasOrdem();
  const { jornada, pessoa } = ficha;
  const podeVerPatrimonio = ficha.patrimonio !== null;
  const [editandoDesfecho, setEditandoDesfecho] = useState(false);
  const [novoDesfecho, setNovoDesfecho] = useState<DesfechoJornada>(jornada.desfecho);
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Mesma tradução da Esteira: "Qualificado (MQL)" vem do banco, a sigla vai
  // para o `title` (ver `rotuloDeEtapa` em `lib/vocabulario.ts`).
  const doBanco = etapas?.find((e) => e.etapa === jornada.etapa)?.rotulo ?? jornada.etapa;
  const etapaNaTela = rotuloDeEtapa(doBanco);

  async function salvarDesfecho() {
    if (novoDesfecho !== "aberta" && !motivo.trim()) {
      setErro("Motivo é obrigatório para qualquer desfecho diferente de aberta.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await atualizarEtapa(jornada.id, { desfecho: novoDesfecho, motivo: motivo.trim() || undefined });
      setEditandoDesfecho(false);
      aoAtualizar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar o desfecho.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <header className="flex flex-col gap-3 border-b border-linha-forte pb-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-tinta">{pessoa.nome}</h1>
            {jornada.origem_dado === "exemplo" && <SeloDadoExemplo />}
          </div>
          <p className="text-sm text-tinta-suave">
            {formatarCidadeUf(pessoa.cidade, pessoa.uf)}
            {pessoa.profissao && ` · ${pessoa.profissao}`}
          </p>
          <FaixaVital ficha={ficha} briefing={briefing} podeVerPatrimonio={podeVerPatrimonio} aoAbrirGaveta={aoAbrirGaveta} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* A etapa voltou para cá na Fase 5: ela saiu da faixa vital (que
              agora só carrega dado do cliente) porque quem responde "onde a
              família está" é o Trilho, logo abaixo. Aqui ela é a coluna da
              esteira — outra informação, um selo, não uma linha de texto. */}
          <Selo tom="neutro" title={etapaNaTela.title ?? titleDe("esteira")}>
            {etapaNaTela.rotulo}
          </Selo>
          <Selo tom={ROTULOS_DESFECHO[jornada.desfecho].tom}>{ROTULOS_DESFECHO[jornada.desfecho].rotulo}</Selo>
          <Selo tom="neutro">{ROTULOS_NIVEL_PAGO[jornada.nivel_pago]}</Selo>
          <Link
            href={`/sessoes/${jornada.id}/conduzir`}
            className="nao-imprimir inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-transparent bg-[color:var(--latao-cta)] px-3.5 py-2 text-sm font-medium text-[color:var(--latao-cta-texto)] shadow-[0_3px_0_0_var(--latao-cta-forte)] transition-colors hover:bg-[color:var(--latao-cta-forte)] hover:shadow-none active:translate-y-[1px] active:shadow-none"
          >
            Conduzir sessão
          </Link>
          {croquiAtalho && (
            // Dois atalhos do Croqui, agrupados lado a lado (mesmo par
            // visual, borda compartilhada no meio) em vez de um 3º botão
            // solto no cabeçalho — F4 ("A Pasta do Cliente"): "Apresentar"
            // é a tela isolada para o cliente (projetor, notas escondidas);
            // "Abrir croqui" é a tela das 19 tabelas, dentro do shell normal.
            //
            // Costura da Fase 5: o rótulo era "Ver e explicar" aqui e "Abrir
            // croqui" na aba Croqui — dois nomes para a MESMA rota. Um nome só.
            <div className="nao-imprimir inline-flex overflow-hidden rounded-controle border border-linha-forte">
              <Link
                href={rotaCroquiApresentar(croquiAtalho.croquiId)}
                className="inline-flex min-h-11 items-center justify-center gap-1.5 bg-papel-elevado px-3.5 py-2 text-sm font-medium text-tinta transition-colors hover:bg-papel-fundo"
              >
                Apresentar
              </Link>
              <Link
                href={rotaCroquiVer(croquiAtalho.croquiId)}
                className="inline-flex min-h-11 items-center justify-center gap-1.5 border-l border-linha-forte bg-papel-elevado px-3.5 py-2 text-sm font-medium text-tinta transition-colors hover:bg-papel-fundo"
              >
                Abrir croqui
              </Link>
            </div>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        {/* `min-w-0` + `break-all`: e-mail longo quebrava a grade e criava rolagem horizontal na Ficha inteira (medido a 1280px). */}
        <div>
          <dt className="text-tinta-fraca">Origem</dt>
          <dd className="text-tinta">
            {jornada.origem}
            {jornada.edicao_id && (
              <span title={jornada.edicao_id} className="ml-1 font-mono text-xs text-tinta-fraca">
                ({jornada.edicao_id.slice(0, 8)})
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-tinta-fraca">Trilha</dt>
          <dd className="text-tinta">{jornada.trilha === "seminario" ? "Seminário" : "Preliminar"}</dd>
        </div>
        <div>
          <dt className="text-tinta-fraca">Telefone</dt>
          <dd className="font-mono text-tinta">{formatarTelefone(pessoa.telefone)}</dd>
        </div>
        <div>
          <dt className="text-tinta-fraca">E-mail</dt>
          <dd className="min-w-0 break-all text-tinta">{pessoa.email ?? "—"}</dd>
        </div>
      </dl>

      {jornada.motivo_desfecho && jornada.desfecho !== "aberta" && (
        <p className="rounded-controle bg-papel-fundo px-3 py-2 text-sm text-tinta-suave">
          <span className="font-medium text-tinta">Motivo do desfecho: </span>
          {jornada.motivo_desfecho}
        </p>
      )}

      {!editandoDesfecho ? (
        <div className="nao-imprimir">
          <Botao variante="fantasma" tamanho="compacto" onClick={() => setEditandoDesfecho(true)}>
            Alterar desfecho
          </Botao>
        </div>
      ) : (
        <div className="nao-imprimir flex flex-col gap-2 rounded-controle border border-linha bg-papel-fundo p-3">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="novo-desfecho" className="text-xs font-medium text-tinta-suave">
              Novo desfecho
            </label>
            <select
              id="novo-desfecho"
              value={novoDesfecho}
              onChange={(e) => setNovoDesfecho(e.target.value as DesfechoJornada)}
              className="rounded-controle border border-linha-forte bg-papel-elevado px-2 py-1 text-sm"
            >
              {Object.entries(ROTULOS_DESFECHO).map(([valor, info]) => (
                <option key={valor} value={valor}>
                  {info.rotulo}
                </option>
              ))}
            </select>
          </div>
          {novoDesfecho !== "aberta" && (
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Motivo (obrigatório)"
              rows={2}
              className="rounded-controle border border-linha-forte bg-papel-elevado px-2 py-1.5 text-sm"
            />
          )}
          {erro && <p className="text-xs text-[color:var(--vermelho)]">{erro}</p>}
          <div className="flex gap-2">
            <Botao variante="primario" carregando={salvando} onClick={salvarDesfecho} className="text-xs">
              Salvar
            </Botao>
            <Botao
              variante="fantasma"
              className="text-xs"
              onClick={() => {
                setEditandoDesfecho(false);
                setErro(null);
              }}
            >
              Cancelar
            </Botao>
          </div>
        </div>
      )}
      </header>
    </>
  );
}
