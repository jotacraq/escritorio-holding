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
import { derivarPasta } from "@/lib/pasta/derivar";
import { ABA_POR_ITEM_PASTA, ACAO_POR_ITEM_PASTA, ITENS_EM_GAVETA } from "@/lib/pasta/rotas";
import type { ChaveItemPasta } from "@/lib/pasta/catalogo";

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
  /** Fase 3 — quando o item aponta para uma das 5 chaves migradas para Gaveta
   * (Camada 2), o clique abre o painel lateral em vez de navegar por hash. */
  onClick?: () => void;
}

/**
 * U2 — faixa de sinais vitais: quem é a pessoa, em que etapa está, o que já
 * pagou, o que falta — sempre visível, nunca some ao rolar (ver `sticky` no
 * `<dl>` abaixo, cujo container de posicionamento é o `<div className="flex
 * flex-col gap-6">` de `jornadas/[id]/page.tsx`, que também contém `<Abas>`
 * — por isso a faixa continua fixa durante a rolagem da ficha inteira, não
 * só deste cabeçalho).
 */

function FaixaVital({
  ficha,
  rotuloEtapa,
  briefing,
  podeVerPatrimonio,
  aoAbrirGaveta,
}: {
  ficha: Ficha360;
  rotuloEtapa: string;
  briefing: Briefing | null;
  podeVerPatrimonio: boolean;
  /** Fase 3 — mesmo estado de Gaveta elevado a `ConteudoFicha`
   * (`jornadas/[id]/page.tsx`), para o chip "Próxima ação" poder abrir a
   * Gaveta quando o item em destaque é um dos 5 migrados. Familiares
   * continua apontando por hash: não tem Gaveta própria (não é aba isolada,
   * ver `rotas.ts`) — só o cartão "Patrimônio" foi migrado. */
  aoAbrirGaveta: (chave: ChaveItemPasta) => void;
}) {
  const { jornada, familiares } = ficha;
  const objecao = objecaoPrincipal(briefing?.conteudo.objecoes_provaveis);
  const disc = briefing?.conteudo.perfil_disc;
  // Chip "Próxima ação" lê da Pasta do Cliente (14 itens, 4 estados) em vez
  // de `calcularPendencias` (5 itens fixos) — primeiro item com estado
  // `falta`. `ChecklistPendencias` (fora deste componente, em
  // `jornadas/[id]/page.tsx`) continua na fonte antiga — migração dele é
  // Fase 2 do plano ("A Pasta do Cliente").
  const pasta = derivarPasta(ficha, podeVerPatrimonio);
  const proximaAcaoPasta = pasta.find((item) => item.estado === "falta") ?? null;

  const itens: ItemFaixa[] = [{ rotulo: "Etapa", valor: rotuloEtapa }];

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
    itens.push({ rotulo: "Familiares mapeados", valor: String(familiares.length), href: "#patrimonio" });
  }
  if (disc) {
    itens.push({
      rotulo: "Perfil comportamental (DISC)",
      valor: disc.secundario ? `${rotularDisc(disc.predominante)} / ${rotularDisc(disc.secundario)}` : rotularDisc(disc.predominante),
      href: "#briefing",
    });
  }
  if (objecao) {
    itens.push({ rotulo: "Objeção provável", valor: objecao.objecao, href: "#briefing" });
  }
  itens.push({
    rotulo: "Próxima ação",
    valor: proximaAcaoPasta ? ACAO_POR_ITEM_PASTA[proximaAcaoPasta.chave] : "Nenhuma pendência",
    ...(proximaAcaoPasta && ITENS_EM_GAVETA.has(proximaAcaoPasta.chave)
      ? { onClick: () => aoAbrirGaveta(proximaAcaoPasta.chave) }
      : { href: proximaAcaoPasta ? `#${ABA_POR_ITEM_PASTA[proximaAcaoPasta.chave]}` : undefined }),
  });

  return (
    <dl className="nao-imprimir sticky top-0 z-20 flex flex-wrap items-baseline gap-x-5 gap-y-1.5 rounded-sm border border-linha-forte bg-papel-elevado px-3.5 py-2 text-xs shadow-[var(--sombra-cartao)] sm:text-[13px]">
      {itens.map((item) => (
        <div key={item.rotulo} className="flex items-baseline gap-1.5">
          <dt className="text-tinta-fraca">{item.rotulo}</dt>
          <dd>
            {item.onClick ? (
              <button
                type="button"
                onClick={item.onClick}
                className="rounded-sm font-medium text-tinta underline decoration-tinta-fraca decoration-dotted underline-offset-2 hover:text-[color:var(--latao-forte)] hover:decoration-[color:var(--latao)]"
              >
                {item.valor}
              </button>
            ) : item.href ? (
              <a
                href={item.href}
                className="rounded-sm font-medium text-tinta underline decoration-tinta-fraca decoration-dotted underline-offset-2 hover:text-[color:var(--latao-forte)] hover:decoration-[color:var(--latao)]"
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
  croquiAtalho: { croquiId: string; pendentes: number } | null;
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

  const rotuloEtapa = etapas?.find((e) => e.etapa === jornada.etapa)?.rotulo ?? jornada.etapa;

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
      <FaixaVital ficha={ficha} rotuloEtapa={rotuloEtapa} briefing={briefing} podeVerPatrimonio={podeVerPatrimonio} aoAbrirGaveta={aoAbrirGaveta} />
      <header className="flex flex-col gap-3 border-b border-linha-forte pb-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-serif text-2xl font-semibold text-tinta">{pessoa.nome}</h1>
            {jornada.origem_dado === "exemplo" && <SeloDadoExemplo />}
          </div>
          <p className="text-sm text-tinta-suave">
            {formatarCidadeUf(pessoa.cidade, pessoa.uf)}
            {pessoa.profissao && ` · ${pessoa.profissao}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* A etapa vive na faixa vital, que é sticky e acompanha a rolagem.
              Repetir aqui era a terceira vez que a mesma informação aparecia
              na mesma dobra. */}
          <Selo tom={ROTULOS_DESFECHO[jornada.desfecho].tom}>{ROTULOS_DESFECHO[jornada.desfecho].rotulo}</Selo>
          <Selo tom="neutro">{ROTULOS_NIVEL_PAGO[jornada.nivel_pago]}</Selo>
          <Link
            href={`/sessoes/${jornada.id}/conduzir`}
            className="nao-imprimir inline-flex items-center justify-center gap-1.5 rounded-sm border border-transparent bg-[color:var(--latao)] px-3.5 py-2 text-sm font-medium text-papel-elevado transition-colors hover:bg-[color:var(--latao-forte)]"
          >
            Conduzir sessão
          </Link>
          {croquiAtalho && (
            // Dois atalhos do Croqui, agrupados lado a lado (mesmo par
            // visual, borda compartilhada no meio) em vez de um 3º botão
            // solto no cabeçalho — F4 ("A Pasta do Cliente"): "Apresentar"
            // é a tela isolada para o cliente (projetor, notas escondidas);
            // "Ver e explicar" é a leitura contínua com notas visíveis,
            // dentro do shell normal, para a advogada estudar o croqui
            // sozinha ou explicar num formato de documento.
            <div className="nao-imprimir inline-flex overflow-hidden rounded-sm border border-linha-forte">
              <Link
                href={`/jornadas/${jornada.id}/croqui/${croquiAtalho.croquiId}/apresentar`}
                className="inline-flex items-center justify-center gap-1.5 bg-papel-elevado px-3.5 py-2 text-sm font-medium text-tinta transition-colors hover:bg-papel-fundo"
              >
                Apresentar
                {croquiAtalho.pendentes > 0 && (
                  <span className="text-xs text-[color:var(--ambar)]">· {croquiAtalho.pendentes} sem revisão</span>
                )}
              </Link>
              <Link
                href={`/jornadas/${jornada.id}/croqui/${croquiAtalho.croquiId}/ver`}
                className="inline-flex items-center justify-center gap-1.5 border-l border-linha-forte bg-papel-elevado px-3.5 py-2 text-sm font-medium text-tinta transition-colors hover:bg-papel-fundo"
              >
                Ver e explicar
              </Link>
            </div>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
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
          <dd className="text-tinta">{pessoa.email ?? "—"}</dd>
        </div>
      </dl>

      {jornada.motivo_desfecho && jornada.desfecho !== "aberta" && (
        <p className="rounded-sm bg-papel-fundo px-3 py-2 text-sm text-tinta-suave">
          <span className="font-medium text-tinta">Motivo do desfecho: </span>
          {jornada.motivo_desfecho}
        </p>
      )}

      {!editandoDesfecho ? (
        <div className="nao-imprimir">
          <Botao variante="fantasma" className="px-2 py-1 text-xs" onClick={() => setEditandoDesfecho(true)}>
            Alterar desfecho
          </Botao>
        </div>
      ) : (
        <div className="nao-imprimir flex flex-col gap-2 rounded-sm border border-linha bg-papel-fundo p-3">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="novo-desfecho" className="text-xs font-medium text-tinta-suave">
              Novo desfecho
            </label>
            <select
              id="novo-desfecho"
              value={novoDesfecho}
              onChange={(e) => setNovoDesfecho(e.target.value as DesfechoJornada)}
              className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1 text-sm"
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
              className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5 text-sm"
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
