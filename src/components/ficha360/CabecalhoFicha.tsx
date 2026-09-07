"use client";

import { useState } from "react";
import Link from "next/link";
import { useEtapasOrdem } from "@/hooks/useJornadas";
import { atualizarEtapa, ApiError, type Briefing, type DesfechoJornada, type Ficha360 } from "@/lib/api";
import { formatarCidadeUf, formatarTelefone } from "@/lib/formatar";
import { Selo, SeloDadoExemplo, SeloStub } from "@/components/ui/Selo";
import { SeloEstado } from "@/components/ui/SeloEstado";
import { estadoDe } from "@/lib/estados/catalogo";
import { Prazo } from "@/components/ui/Prazo";
import { Botao } from "@/components/ui/Botao";
import { Gaveta } from "@/components/ui/Gaveta";
import { useToast } from "@/hooks/useToast";
import { objecaoPrincipal } from "@/components/briefing/atomos";
import { rotularDisc } from "@/components/briefing/tipos";
import { rotulo, rotuloDeEtapa, titleDe } from "@/lib/vocabulario";
import type { ChaveItemPasta } from "@/lib/pasta/catalogo";
import { faseDoCroqui, sinaisDaFicha } from "@/lib/pasta/sinais";
import {
  ErroArquivamento,
  arquivarProcesso,
  desarquivarProcesso,
  resumoDoArquivamento,
  resumoDoDesarquivamento,
} from "./api-arquivar";

/**
 * Os desfechos que alguém ESCOLHE na tela. `anonimizada` fica de fora: ela é
 * consequência de "Direitos do titular" no Admin, com motivo e base legal
 * registrados, e não um item de menu suspenso (o servidor também recusa).
 */
const DESFECHOS_ESCOLHIVEIS: DesfechoJornada[] = ["aberta", "ganha", "perdida", "descartada", "congelada"];

/**
 * **Um catálogo, um rótulo** (Fase 8, D19). Até aqui este arquivo tinha um mapa
 * próprio de rótulo + tom por desfecho, paralelo ao `lib/estados/catalogo.ts`.
 * Dois dicionários para o mesmo enum é como "congelada" vira "Congelada" numa
 * tela e "Arquivado" na outra — que era exatamente o caso. O mapa local morreu;
 * quem responde é o catálogo, pelo `SeloEstado` (quando é selo) e por
 * `estadoDe` (quando é só texto). `anonimizada` (0079) entrou no catálogo na
 * trava da Fase 8 — nenhuma exceção local sobrou.
 */

/** Só o texto. Cor e ícone, quando houver, vêm do `SeloEstado`. */
function rotuloDoDesfecho(desfecho: string): string {
  return estadoDe("processo", desfecho)?.rotulo ?? desfecho.replace(/_/g, " ");
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
    "-my-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-controle font-medium text-tinta underline decoration-tinta-fraca decoration-dotted underline-offset-2 hover:text-[color:var(--latao-forte)] hover:decoration-[color:var(--latao)]";

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
  const [arquivarAberto, setArquivarAberto] = useState(false);
  const [salvandoArquivo, setSalvandoArquivo] = useState(false);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const { notificar } = useToast();

  // "Qualificado (MQL)" vem do banco, a sigla vai para o `title`.
  const doBanco = etapas?.find((e) => e.etapa === jornada.etapa)?.rotulo ?? jornada.etapa;
  const etapaNaTela = rotuloDeEtapa(doBanco);

  // A MESMA derivação da lista de Clientes e do trilho (D12) — o payload da
  // Ficha já carrega `croquiEstado` (`vw_croqui_estado`), então isto não custa
  // requisição nenhuma.
  const fase = faseDoCroqui(sinaisDaFicha(ficha));

  // O próximo prazo é a tarefa aberta que vence primeiro. `tarefasAbertas` já
  // vem ordenada por `vence_em` do servidor; tarefa sem data não é prazo.
  const proximoPrazo = (ficha.tarefasAbertas ?? []).find((t) => Boolean(t.vence_em)) ?? null;

  const arquivado = jornada.desfecho === "congelada";
  // Processo encerrado por decisão comercial (ganho/perdido/descartado) ou
  // anonimizado não é "parado": arquivar por cima apagaria o que ele afirma.
  const podeArquivar = jornada.desfecho === "aberta";

  async function arquivar(motivo: string, revogarLinks: boolean) {
    setSalvandoArquivo(true);
    setErroArquivo(null);
    try {
      const resultado = await arquivarProcesso(jornada.id, { motivo, revogarLinks });
      setArquivarAberto(false);
      aoAtualizar();
      // Reversível de verdade: o Desfazer chama a rota de desarquivar, não um
      // estado local. Nada de "Tem certeza?" antes (DS §8) — a saída fica
      // DEPOIS da ação, que é onde ela é útil.
      notificar({
        tom: "sucesso",
        titulo: "Processo arquivado",
        descricao: resumoDoArquivamento(resultado),
        duracao: 10_000,
        acao: { rotulo: "Desfazer", aoClicar: () => void reabrir() },
      });
    } catch (e) {
      setErroArquivo(e instanceof ErroArquivamento || e instanceof Error ? e.message : "Não foi possível arquivar.");
    } finally {
      setSalvandoArquivo(false);
    }
  }

  async function reabrir() {
    setSalvandoArquivo(true);
    try {
      const resultado = await desarquivarProcesso(jornada.id);
      aoAtualizar();
      notificar({ tom: "sucesso", titulo: "Processo reaberto", descricao: resumoDoDesarquivamento(resultado) });
    } catch (e) {
      // O caso frequente não é falha técnica: a pessoa ganhou OUTRO processo
      // enquanto este estava arquivado. A mensagem do servidor já diz o que
      // fazer, e o toast de erro fica na tela até ser fechado.
      notificar({
        tom: "erro",
        titulo: "Não deu para reabrir",
        descricao: e instanceof ErroArquivamento || e instanceof Error ? e.message : "Tente de novo.",
      });
    } finally {
      setSalvandoArquivo(false);
    }
  }

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

        <div className="nao-imprimir flex flex-wrap items-center gap-1.5 gap-alvo">
          <Botao variante="secundario" tamanho="compacto" onClick={() => setFichaCompleta(true)}>
            Ficha completa
          </Botao>
          {/* "Arquivar processo" é o verbo que a Dra. Elaine usa; até a Fase 8
              a ação existia só como um valor ("Congelada") dentro de um combo
              chamado "Situação", dois cliques abaixo. Processo já arquivado
              mostra o inverso — reabrir, no mesmo lugar. */}
          {arquivado ? (
            <Botao variante="secundario" tamanho="compacto" carregando={salvandoArquivo} onClick={reabrir}>
              Reabrir processo
            </Botao>
          ) : (
            podeArquivar && (
              <Botao variante="secundario" tamanho="compacto" onClick={() => setArquivarAberto(true)}>
                Arquivar processo
              </Botao>
            )
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------
          A BARRA DE STATUS (Fase 8, D21). É a primeira coisa que o advogado
          procura ao abrir um processo, e é o padrão de Astrea/Clio: fase ·
          situação · pagamento · próximo prazo, sempre no mesmo lugar, antes
          das abas.

          Todo selo vem do CATÁLOGO (`SeloEstado`) — nenhuma cor é escolhida
          aqui. O prazo tem componente próprio e tom próprio: "em dia" e "no
          prazo" são coisas diferentes, e misturar os dois foi o que fez a
          data-limite sumir no meio dos status.
          ------------------------------------------------------------------ */}
      <div className="nao-imprimir flex flex-wrap items-center gap-1.5 gap-alvo">
        <Selo tom="neutro" title={etapaNaTela.title ?? `Em que ${rotulo("fase")} da esteira este processo está`}>
          {etapaNaTela.rotulo}
        </Selo>
        <SeloEstado dominio="processo" estado={jornada.desfecho} />
        <SeloEstado dominio="croqui" estado={fase} mostrarDesconhecido={false} />
        <Selo tom="neutro" title="Até onde o cliente já pagou">
          {ROTULOS_NIVEL_PAGO[jornada.nivel_pago]}
        </Selo>
        {proximoPrazo && <Prazo vence={proximoPrazo.vence_em} rotulo={proximoPrazo.titulo} />}
      </div>

      <FaixaVital ficha={ficha} briefing={briefing} podeVerPatrimonio={podeVerPatrimonio} aoAbrirGaveta={aoAbrirGaveta} />

      <GavetaArquivar
        aberta={arquivarAberto}
        aoFechar={() => setArquivarAberto(false)}
        nome={pessoa.nome}
        salvando={salvandoArquivo}
        erro={erroArquivo}
        aoConfirmar={arquivar}
      />

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
              <Campo rotulo="Situação" valor={rotuloDoDesfecho(jornada.desfecho)} />
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
                        {rotuloDoDesfecho(valor)}
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

/**
 * A gaveta de "Arquivar processo" (Fase 8, D16).
 *
 * **Não é `ConfirmarAcao`.** O DS §8 proíbe "Tem certeza?": pergunta genérica
 * antes da ação não protege ninguém — quem lê aperta "Sim" no automático. O
 * que protege é (a) pedir o motivo, que obriga a pensar por um segundo e fica
 * registrado no processo, e (b) o **Desfazer** depois, no toast.
 *
 * A caixa de revogar links nasce DESMARCADA (B51) e diz, embaixo, que aquilo
 * não tem volta — é a única parte irreversível de uma ação que se anuncia
 * reversível, então ela precisa estar escrita, não subentendida.
 *
 * `Gaveta` e não modal: no celular ela abre em tela cheia, com "Voltar" em vez
 * de "X" (regra M6 da fase).
 */
function GavetaArquivar({
  aberta,
  aoFechar,
  nome,
  salvando,
  erro,
  aoConfirmar,
}: {
  aberta: boolean;
  aoFechar: () => void;
  nome: string;
  salvando: boolean;
  erro: string | null;
  aoConfirmar: (motivo: string, revogarLinks: boolean) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [revogarLinks, setRevogarLinks] = useState(false);
  const semMotivo = motivo.trim().length === 0;

  return (
    <Gaveta
      aberta={aberta}
      aoFechar={aoFechar}
      rotulo={rotulo("arquivado")}
      titulo="Arquivar processo"
      descricao={`${nome} sai da lista principal e a automação para. Dá para reabrir a qualquer momento.`}
      rodape={
        <>
          <Botao variante="fantasma" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" carregando={salvando} disabled={semMotivo} onClick={() => aoConfirmar(motivo.trim(), revogarLinks)}>
            Arquivar processo
          </Botao>
        </>
      }
    >
      <div className="flex flex-col gap-item">
        <div className="flex flex-col gap-1">
          <label htmlFor="motivo-arquivar" className="text-legenda font-medium text-tinta-suave">
            Por que este processo está parando?
          </label>
          <textarea
            id="motivo-arquivar"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="Ex.: cliente parou de responder desde julho."
            className="rounded-controle border border-linha-controle bg-papel-elevado px-2 py-1.5 text-sm"
          />
          <p className="text-legenda text-tinta-fraca">
            O motivo fica registrado nos {rotulo("andamentos")} e aparece na lista de arquivados.
          </p>
        </div>

        {/* O que a ação faz, em três linhas, ANTES de acontecer. Não é
            tutorial: é a consequência, que é o que a pessoa precisa saber. */}
        <ul className="flex flex-col gap-1 rounded-controle bg-papel-fundo px-3 py-2 text-sm text-tinta-suave">
          <li>As mensagens ainda não enviadas são canceladas.</li>
          <li>A ligação por IA sai da fila.</li>
          <li>O processo sai da lista principal e vai para “Arquivados”.</li>
        </ul>

        <div className="flex flex-col gap-1">
          <label htmlFor="revogar-links" className="flex min-h-11 items-center gap-2 text-sm text-tinta">
            <input
              id="revogar-links"
              type="checkbox"
              checked={revogarLinks}
              onChange={(e) => setRevogarLinks(e.target.checked)}
              className="h-5 w-5 rounded border-linha-controle"
            />
            Revogar também os links já enviados ao cliente
          </label>
          <p className="text-legenda text-tinta-fraca">
            Deixe desmarcado se o cliente ainda pode voltar a usar o link de agendamento ou de documentos.{" "}
            <strong className="font-medium text-tinta-suave">Revogar não tem volta</strong> — reabrir o processo não devolve os links.
          </p>
        </div>

        {erro && (
          <p role="alert" className="text-sm text-[color:var(--vermelho)]">
            {erro}
          </p>
        )}

        {/* As ações moram no RODAPÉ fixo da gaveta (ver `rodape` acima): a
            360 px o corpo rola e um botão no fim do conteúdo sairia da tela —
            a ação primária tem de estar visível no primeiro paint (regra M5). */}
      </div>
    </Gaveta>
  );
}
