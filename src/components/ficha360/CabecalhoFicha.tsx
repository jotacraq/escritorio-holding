"use client";

import { useState } from "react";
import Link from "next/link";
import { useEtapasOrdem } from "@/hooks/useJornadas";
import { atualizarEtapa, ApiError, type Briefing, type DesfechoJornada, type Ficha360 } from "@/lib/api";
import { formatarCidadeUf, formatarTelefone } from "@/lib/formatar";
import { Selo, SeloDadoExemplo, SeloStub } from "@/components/ui/Selo";
import { Botao } from "@/components/ui/Botao";
import { Gaveta } from "@/components/ui/Gaveta";
import { objecaoPrincipal } from "@/components/briefing/atomos";
import { rotularDisc } from "@/components/briefing/tipos";
import { rotulo, rotuloDeEtapa, titleDe } from "@/lib/vocabulario";
import type { ChaveItemPasta } from "@/lib/pasta/catalogo";

/**
 * Como cada desfecho aparece. `Record<string, …>` e não `Record<DesfechoJornada, …>`
 * porque `anonimizada` (0079, Fase 7 r3) só existe no enum depois da migration
 * aplicada — e a tela tem de funcionar antes disso. Desfecho desconhecido cai
 * no fallback legível de `desfechoNaTela`, nunca em `undefined.rotulo`.
 */
const ROTULOS_DESFECHO: Record<string, { rotulo: string; tom: "verde" | "vermelho" | "azul" | "neutro" }> = {
  aberta: { rotulo: "Aberta", tom: "azul" },
  ganha: { rotulo: "Ganha", tom: "verde" },
  perdida: { rotulo: "Perdida", tom: "vermelho" },
  descartada: { rotulo: "Descartada", tom: "vermelho" },
  congelada: { rotulo: "Congelada", tom: "neutro" },
  // Tom NEUTRO de propósito: encerrar o tratamento a pedido do titular não é
  // derrota comercial nem vitória — é um direito exercido.
  anonimizada: { rotulo: "Anonimizada", tom: "neutro" },
};

/**
 * Os desfechos que alguém ESCOLHE na tela. `anonimizada` fica de fora: ela é
 * consequência de "Direitos do titular" no Admin, com motivo e base legal
 * registrados, e não um item de menu suspenso (o servidor também recusa).
 */
const DESFECHOS_ESCOLHIVEIS: DesfechoJornada[] = ["aberta", "ganha", "perdida", "descartada", "congelada"];

function desfechoNaTela(desfecho: string): { rotulo: string; tom: "verde" | "vermelho" | "azul" | "neutro" } {
  return ROTULOS_DESFECHO[desfecho] ?? { rotulo: desfecho.replace(/_/g, " "), tom: "neutro" };
}

// "Sessão paga" aparecia aqui E como rótulo da etapa `sessao_contratada`:
// dois selos idênticos lado a lado, dizendo coisas diferentes (um é a coluna
// da lista de clientes, o outro é até onde a pessoa pagou). Prefixo "Pago:"
// desfaz a colisão sem perder a informação.
const ROTULOS_NIVEL_PAGO = ["Nada pago", "Pago: sessão", "Pago: croqui", "Pago: holding"];

/**
 * O cabeçalho da Ficha, Fase 6.
 *
 * O João, depois de usar a Fase 5: *"eu não consigo reunir os dados e ver:
 * esse cara, a situação dele é essa"* e *"quero ver os dados do aluno: uma
 * aba/ficha só com todos os dados dele (pode ser pop-up/gaveta)"*.
 *
 * O que mudou: o cabeçalho virou **uma faixa** — nome, contato, cidade e os
 * selos de situação, tudo em uma linha de leitura. A grade de quatro campos, o
 * bloco de alterar desfecho e o stub da Pesquisa pública (que ocupava uma aba
 * inteira só para dizer que não existe) desceram para a gaveta **"Ficha
 * completa"**, a um clique. Nenhuma requisição nova: todo esse dado já vem no
 * payload da Ficha.
 */

interface ItemFaixa {
  rotulo: string;
  valor: string;
  href?: string;
  /** Detalhe/sigla do método — só no `title` (lei de texto §2.2). */
  title?: string;
  onClick?: () => void;
}

/**
 * O que o trilho NÃO sabe: faixa de patrimônio declarada, quantos familiares
 * mapeados, perfil de decisão e objeção provável. Todos dado do cliente, todos
 * com destino de clique. "Etapa" e "Próxima ação" não moram aqui — quem
 * responde as duas é o trilho das 3 sessões, logo abaixo.
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
    itens.push({ rotulo: "Familiares", valor: String(familiares.length), href: "#patrimonio" });
  }
  if (disc) {
    itens.push({
      // Sigla do método nunca no fluxo — "DISC" vai para o `title`.
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

  const CLASSE_VALOR =
    "-my-2 inline-flex min-h-11 items-center rounded-controle font-medium text-tinta underline decoration-tinta-fraca decoration-dotted underline-offset-2 hover:text-[color:var(--latao-forte)] hover:decoration-[color:var(--latao)]";

  return (
    <dl className="nao-imprimir flex flex-wrap items-center gap-x-cartao gap-y-0.5 text-legenda">
      {itens.map((item) => (
        <div key={item.rotulo} className="flex items-center gap-1.5">
          <dt title={item.title} className="text-tinta-fraca">
            {item.rotulo}
          </dt>
          <dd>
            {item.onClick ? (
              <button type="button" onClick={item.onClick} className={CLASSE_VALOR}>
                {item.valor}
              </button>
            ) : item.href ? (
              <a href={item.href} className={CLASSE_VALOR}>
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
  aoAbrirGaveta,
}: {
  ficha: Ficha360;
  aoAtualizar: () => void;
  /** Briefing atual, buscado UMA vez pelo pai e compartilhado. `null` mostra a
   * faixa sem DISC/objeção — nunca inventa. */
  briefing: Briefing | null;
  /** Abre a gaveta correspondente; o estado vive no pai (um único dono). */
  aoAbrirGaveta: (chave: ChaveItemPasta) => void;
}) {
  const { etapas } = useEtapasOrdem();
  const { jornada, pessoa } = ficha;
  const podeVerPatrimonio = ficha.patrimonio !== null;
  const [fichaCompleta, setFichaCompleta] = useState(false);
  const [editandoDesfecho, setEditandoDesfecho] = useState(false);
  const [novoDesfecho, setNovoDesfecho] = useState<DesfechoJornada>(jornada.desfecho);
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // "Qualificado (MQL)" vem do banco, a sigla vai para o `title`.
  const doBanco = etapas?.find((e) => e.etapa === jornada.etapa)?.rotulo ?? jornada.etapa;
  const etapaNaTela = rotuloDeEtapa(doBanco);

  async function salvarDesfecho() {
    if (novoDesfecho !== "aberta" && !motivo.trim()) {
      setErro("Escreva o motivo — ele é obrigatório para qualquer situação diferente de aberta.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await atualizarEtapa(jornada.id, { desfecho: novoDesfecho, motivo: motivo.trim() || undefined });
      setEditandoDesfecho(false);
      aoAtualizar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  const cidade = formatarCidadeUf(pessoa.cidade, pessoa.uf);

  return (
    <header className="flex flex-col gap-1 border-b border-linha-forte pb-item">
      <div className="flex flex-wrap items-center justify-between gap-x-cartao gap-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-item gap-y-0.5">
          <h1 className="text-display font-bold text-tinta">{pessoa.nome}</h1>
          {jornada.origem_dado === "exemplo" && <SeloDadoExemplo />}
          {/* Identidade em UMA linha: quem é e como falar com ele. Antes isso
              era uma grade de 4 campos abaixo do título — 3 linhas de altura
              para dado que quase nunca se lê, empurrando a ação para fora da
              dobra. O resto está na gaveta "Ficha completa". */}
          <p className="flex flex-wrap items-baseline gap-x-item text-legenda text-tinta-suave">
            {cidade && <span>{cidade}</span>}
            <a href={`tel:${pessoa.telefone}`} className="-my-2 inline-flex min-h-11 items-center font-mono text-tinta hover:text-[color:var(--latao)]">
              {formatarTelefone(pessoa.telefone)}
            </a>
            {pessoa.email && (
              <a href={`mailto:${pessoa.email}`} className="-my-2 inline-flex min-h-11 min-w-0 items-center break-all text-tinta hover:text-[color:var(--latao)]">
                {pessoa.email}
              </a>
            )}
          </p>
        </div>

        <div className="nao-imprimir flex flex-wrap items-center gap-1.5">
          <Selo tom="neutro" title={etapaNaTela.title ?? "Em que coluna da lista de clientes esta pessoa está"}>
            {etapaNaTela.rotulo}
          </Selo>
          <Selo tom={desfechoNaTela(jornada.desfecho).tom}>{desfechoNaTela(jornada.desfecho).rotulo}</Selo>
          <Selo tom="neutro">{ROTULOS_NIVEL_PAGO[jornada.nivel_pago]}</Selo>
          <Botao variante="secundario" tamanho="compacto" onClick={() => setFichaCompleta(true)}>
            Ficha completa
          </Botao>
        </div>
      </div>

      <FaixaVital ficha={ficha} briefing={briefing} podeVerPatrimonio={podeVerPatrimonio} aoAbrirGaveta={aoAbrirGaveta} />

      <Gaveta
        aberta={fichaCompleta}
        aoFechar={() => setFichaCompleta(false)}
        rotulo="Ficha completa"
        titulo={pessoa.nome}
        descricao="Todos os dados desta pessoa, num lugar só."
        largura="larga"
      >
        <div className="flex flex-col gap-bloco">
          <section aria-labelledby="ficha-contato" className="flex flex-col gap-item">
            <h3 id="ficha-contato" className="text-subtitulo font-bold text-tinta">
              Contato
            </h3>
            <dl className="grid grid-cols-1 gap-x-cartao gap-y-item text-sm sm:grid-cols-2">
              <Campo rotulo="Nome" valor={pessoa.nome} />
              <Campo rotulo="Telefone" valor={formatarTelefone(pessoa.telefone)} mono />
              <Campo rotulo="E-mail" valor={pessoa.email} quebrar />
              <Campo rotulo="Cidade" valor={cidade || null} />
              <Campo rotulo="Profissão" valor={pessoa.profissao ?? null} />
            </dl>
          </section>

          <section aria-labelledby="ficha-jornada" className="flex flex-col gap-item">
            <h3 id="ficha-jornada" className="text-subtitulo font-bold text-tinta">
              Como ele chegou
            </h3>
            <dl className="grid grid-cols-1 gap-x-cartao gap-y-item text-sm sm:grid-cols-2">
              <Campo rotulo="Origem" valor={jornada.origem} />
              <Campo rotulo="Turma do seminário" valor={jornada.edicao_id ? jornada.edicao_id.slice(0, 8) : null} mono />
              <Campo rotulo="Caminho" valor={jornada.trilha === "seminario" ? "Seminário" : "Preliminar"} />
              <Campo rotulo="Patrimônio declarado" valor={jornada.faixa_patrimonio_declarada ?? null} />
              <Campo rotulo="Situação" valor={desfechoNaTela(jornada.desfecho).rotulo} />
              <Campo rotulo="Já pagou" valor={ROTULOS_NIVEL_PAGO[jornada.nivel_pago]} />
            </dl>
            {jornada.motivo_desfecho && jornada.desfecho !== "aberta" && (
              <p className="rounded-controle bg-papel-fundo px-3 py-2 text-sm text-tinta-suave">
                <span className="font-medium text-tinta">Motivo: </span>
                {jornada.motivo_desfecho}
              </p>
            )}
          </section>

          <section aria-labelledby="ficha-situacao" className="nao-imprimir flex flex-col gap-item">
            <h3 id="ficha-situacao" className="text-subtitulo font-bold text-tinta">
              Mudar a situação
            </h3>
            {!editandoDesfecho ? (
              <div>
                <Botao variante="secundario" tamanho="compacto" onClick={() => setEditandoDesfecho(true)}>
                  Mudar a situação
                </Botao>
              </div>
            ) : (
              <div className="flex flex-col gap-item rounded-controle border border-linha bg-papel-fundo p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor="novo-desfecho" className="text-legenda font-medium text-tinta-suave">
                    Nova situação
                  </label>
                  <select
                    id="novo-desfecho"
                    value={novoDesfecho}
                    onChange={(e) => setNovoDesfecho(e.target.value as DesfechoJornada)}
                    className="min-h-11 rounded-controle border border-linha-controle bg-papel-elevado px-2 text-sm"
                  >
                    {DESFECHOS_ESCOLHIVEIS.map((valor) => (
                      <option key={valor} value={valor}>
                        {desfechoNaTela(valor).rotulo}
                      </option>
                    ))}
                  </select>
                </div>
                {novoDesfecho !== "aberta" && (
                  <textarea
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    aria-label="Motivo da mudança"
                    placeholder="Motivo (obrigatório)"
                    rows={2}
                    className="rounded-controle border border-linha-controle bg-papel-elevado px-2 py-1.5 text-sm"
                  />
                )}
                {erro && (
                  <p role="alert" className="text-legenda text-[color:var(--vermelho)]">
                    {erro}
                  </p>
                )}
                <div className="flex gap-2">
                  <Botao variante="primario" tamanho="compacto" carregando={salvando} onClick={salvarDesfecho}>
                    Salvar a situação
                  </Botao>
                  <Botao
                    variante="fantasma"
                    tamanho="compacto"
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
          </section>

          <section aria-labelledby="ficha-pesquisa" className="flex flex-col gap-item">
            <h3 id="ficha-pesquisa" className="text-subtitulo font-bold text-tinta">
              Pesquisa pública
            </h3>
            {/* Ocupava uma aba inteira da Ficha para exibir um selo. Como stub,
                o lugar dele é aqui embaixo: informação de que a funcionalidade
                não existe, não uma porta. */}
            <SeloStub texto="Busca por dados públicos da pessoa: ainda não existe." className="self-start" />
            <p className="text-legenda text-tinta-suave">
              Até existir, o que se sabe do cliente vem do formulário, do contato da equipe e do que a{" "}
              <Link href="#briefing" className="font-medium text-[color:var(--latao)] underline underline-offset-2">
                análise da IA
              </Link>{" "}
              montou.
            </p>
          </section>
        </div>
      </Gaveta>
    </header>
  );
}

/** Campo da ficha completa. Vazio é "—", nunca zero nem placeholder plausível (DS §7). */
function Campo({ rotulo: nome, valor, mono, quebrar }: { rotulo: string; valor: string | null; mono?: boolean; quebrar?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-legenda text-tinta-fraca">{nome}</dt>
      <dd className={`text-tinta ${mono ? "font-mono" : ""} ${quebrar ? "min-w-0 break-all" : ""}`}>{valor || "—"}</dd>
    </div>
  );
}
