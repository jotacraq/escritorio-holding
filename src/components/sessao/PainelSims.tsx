"use client";

import { useMemo, useState } from "react";
import type { RoteiroFala, RoteiroVersao, SimIdentificador } from "@/types/roteiro";
import { ErroSessao, registrarSim, type EstadoSims } from "@/components/sessao/api";
import { Quadro } from "@/components/ui/Quadro";
import { Selo } from "@/components/ui/Selo";
import { formatarDataHora } from "@/lib/formatar";
import { NUMERO_SIM, ORDEM_SIMS, ROTULO_SIM } from "@/components/sessao/rotulos";

/**
 * `tabIndex` do `<blockquote role="region">` rolável abaixo (WCAG 2.1.1 —
 * sem foco por teclado, quem navega só pelo teclado não consegue rolar o
 * conteúdo; axe: `scrollable-region-focusable`).
 *
 * Não é `tabIndex={0}` LITERAL de propósito: `jsx-a11y/no-noninteractive-tabindex`
 * lê o valor por `getLiteralPropValue` e — com `role="region"` (não-`widget`
 * na `aria-query`, logo nunca "interativo" para a regra) — reporta erro em
 * QUALQUER `<div role="region" tabIndex={0}>` estático, mesmo sendo
 * exatamente o padrão que a própria WCAG pede. Uma constante nomeada (valor
 * não-literal do ponto de vista do linter) sai desse falso positivo sem
 * mudar o comportamento em runtime — é sempre `0`. Mesmo padrão em
 * `PainelCopiloto.tsx:104` (achado independente, mesma solução — o projeto
 * não fica com dois jeitos de resolver o mesmo problema).
 */
const TAB_INDEX_ROLAVEL = 0;

/** Acha, em qualquer bloco do roteiro, a fala marcada com este identificador de SIM. */
function acharFalaDoSim(roteiro: RoteiroVersao, sim: SimIdentificador): RoteiroFala | null {
  for (const bloco of roteiro.definicao.blocos) {
    const fala = bloco.falas.find((f) => f.sim === sim);
    if (fala) return fala;
  }
  return null;
}

/**
 * Ação por TEXTO, nunca botão redondo (pedido do Marcio, 11-14/09: "o botão
 * da ética e licitude está como um botão redondo"). Continua sendo um
 * `<button>` de verdade — alvo ≥44px, `hover`/`focus-visible` — só sem a
 * forma de pílula colorida do `Botao` primário/perigo: aqui o texto sublinhado
 * chapado é a própria affordance, como link de ação de sistema legado.
 */
function AcaoTexto({
  tom,
  carregando,
  disabled,
  onClick,
  children,
}: {
  tom: "neutro" | "vermelho";
  carregando?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={carregando || undefined}
      className={`flex min-h-11 items-center gap-1.5 rounded-controle px-2 text-sm font-medium underline decoration-1 underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
        tom === "vermelho" ? "text-[color:var(--vermelho)] hover:bg-vermelho-fraco" : "text-tinta hover:bg-papel"
      }`}
    >
      {carregando && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />}
      {children}
    </button>
  );
}

/** Número do SIM — quadrado chapado (`rounded-controle`), nunca círculo. */
function NumeroSim({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-controle border border-linha-forte bg-papel text-legenda font-bold text-tinta-suave"
    >
      {children}
    </span>
  );
}

function LinhaSim({
  sim,
  fala,
  registrado,
  emQue,
  aoRegistrar,
}: {
  sim: SimIdentificador;
  fala: RoteiroFala | null;
  registrado: boolean | null; // null = não registrado ainda
  emQue: string | null;
  aoRegistrar: (sim: SimIdentificador, confirmado: boolean) => Promise<void>;
}) {
  const [enviando, setEnviando] = useState<"sim" | "nao" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function registrar(confirmado: boolean) {
    setErro(null);
    setEnviando(confirmado ? "sim" : "nao");
    try {
      await aoRegistrar(sim, confirmado);
    } catch (e) {
      setErro(e instanceof ErroSessao ? e.message : "Não deu para registrar. Tente de novo.");
    } finally {
      setEnviando(null);
    }
  }

  return (
    // Abaixo de `sm`: item de lista vertical, borda só embaixo (como hoje).
    // De `sm` até `2xl` (faixa em 3 colunas): cada SIM vira um cartão com
    // borda ao redor — não há "embaixo" comum quando os itens dividem uma
    // linha horizontal. Em `2xl`+: volta a ser item de lista vertical.
    // Decisão do dono (15/09, 3ª rodada): o corte que era `xl` (1280px)
    // virou `2xl` (1536px) — `xl` é INCLUSIVO, então 1280×800 e 1440×900
    // (as larguras reais medidas) caíam no modo coluna mesmo com a faixa
    // pronta. Com `2xl`, essas duas larguras usam a faixa; só monitor
    // grande (o caso de uso declarado — segundo monitor) usa a coluna.
    <li className="flex min-w-0 flex-col gap-1 border-b border-linha px-1 py-1.5 last:border-b-0 sm:rounded-controle sm:border sm:p-2 2xl:rounded-none 2xl:border-0 2xl:border-b 2xl:px-1 2xl:py-1.5 2xl:last:border-b-0">
      <div className="flex flex-col gap-1 2xl:flex-row 2xl:flex-wrap 2xl:items-center 2xl:justify-between">
        <span className="flex min-h-11 items-center gap-2 text-sm text-tinta">
          <NumeroSim>{NUMERO_SIM[sim]}</NumeroSim>
          {ROTULO_SIM[sim]}
        </span>

        {registrado === null ? (
          <div className="flex items-center gap-1">
            <AcaoTexto tom="neutro" carregando={enviando === "sim"} disabled={enviando !== null} onClick={() => registrar(true)}>
              Cliente disse sim
            </AcaoTexto>
            <AcaoTexto tom="vermelho" carregando={enviando === "nao"} disabled={enviando !== null} onClick={() => registrar(false)}>
              Não confirmou
            </AcaoTexto>
          </div>
        ) : (
          <Selo tom={registrado ? "verde" : "vermelho"}>
            {registrado ? "Registrado — SIM" : "Registrado — não confirmou"}
            {emQue && ` · ${formatarDataHora(emQue)}`}
          </Selo>
        )}
      </div>

      {erro && (
        <p role="alert" className="text-legenda text-[color:var(--vermelho)]">
          {erro}
        </p>
      )}

      {fala && (
        <details className="group">
          <summary className="min-h-6 cursor-pointer list-none text-legenda text-tinta-fraca marker:content-none [&::-webkit-details-marker]:hidden">
            Ver fala do roteiro
          </summary>
          <blockquote className="mt-1 rounded-controle border border-linha bg-papel px-3 py-2 text-sm italic leading-relaxed text-tinta-suave">
            “{fala.texto}”
          </blockquote>
        </details>
      )}
    </li>
  );
}

export function PainelSims({
  roteiro,
  sessaoId,
  estado,
  aoAtualizar,
}: {
  roteiro: RoteiroVersao;
  sessaoId: string;
  estado: EstadoSims;
  aoAtualizar: (novoEstado: EstadoSims) => void;
}) {
  const falasPorSim = useMemo(() => {
    const mapa = new Map<SimIdentificador, RoteiroFala | null>();
    for (const sim of ORDEM_SIMS) mapa.set(sim, acharFalaDoSim(roteiro, sim));
    return mapa;
  }, [roteiro]);

  async function aoRegistrar(sim: SimIdentificador, confirmado: boolean) {
    const resposta = await registrarSim(sessaoId, sim, confirmado);
    aoAtualizar({
      roteiro_versao_id: resposta.sessao.roteiro_versao_id,
      sims: resposta.sessao.sims,
      sigilo_gravacao: sim === "sigilo_gravacao" ? resposta.sigilo_gravacao : estado.sigilo_gravacao,
    });
  }

  const totalRegistrados =
    (estado.sigilo_gravacao ? 1 : 0) + Object.values(estado.sims).filter((s) => s?.ok !== undefined).length;

  return (
    <Quadro rotulo="SIMs" acao={<Selo tom={totalRegistrados === 4 ? "verde" : "neutro"}>{totalRegistrados} de 4</Selo>}>
      {/*
       * Decisão do dono (15/09): abaixo de `2xl` os 4 SIMs viram uma FAIXA
       * horizontal (não mais empilhados) — os botões de ação paravam de
       * quebrar para linha própria e as 4 linhas dividem espaço horizontal
       * em vez de somar altura. Em `2xl`+ continuam empilhados na coluna
       * lateral de 260px, como sempre foram. O corte era `xl` (1280px) até
       * a 3ª rodada (15/09): `xl` é INCLUSIVO, então 1280×800/1440×900
       * caíam no modo coluna mesmo com a faixa pronta — movido para `2xl`
       * (1536px) para que essas duas larguras usem a faixa, deixando a
       * coluna só para monitor grande (o caso de uso real de segundo
       * monitor). `2xl` escolhido em vez de um valor customizado para não
       * criar escala de breakpoint fora do padrão do projeto.
       *
       * Um só `<ul>`, mesmo DOM em qualquer largura — só as classes mudam
       * por breakpoint (`grid` abaixo de `2xl`, `flex flex-col` em `2xl`+).
       * Isso evita renderizar a lista duas vezes e esconder uma metade por
       * CSS, o que quebraria o axe (conteúdo duplicado para leitor de
       * tela) e o teste de `offsetParent` (ver `PainelSims.test.tsx`).
       *
       * Ordem de leitura continua 1-2-3-4 em qualquer largura: nenhum item
       * usa `order` do CSS para se mover — a ordem no DOM já é a ordem
       * visual. Na faixa, o SIM 1 (Sigilo e Gravação) ocupa a linha
       * inteira, sozinho: o texto de consentimento (`<details open>`, ver
       * `LinhaSimGravacao`) não cabe numa célula estreita ao lado dos
       * outros 3. Os SIMs 2-4 dividem 3 colunas na linha de baixo — só a
       * partir de `sm` (640px); abaixo disso (faixa ainda mais estreita
       * que a própria coluna de 260px de hoje) eles caem para 1 coluna,
       * porque o alvo de 44px (Fase 8, AAA) não se comprime para caber em
       * 3 colunas de menos de ~140px.
       */}
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3 2xl:flex 2xl:flex-col 2xl:gap-0">
        {ORDEM_SIMS.map((sim) => {
          if (sim === "sigilo_gravacao") {
            const consentimento = estado.sigilo_gravacao;
            return (
              <LinhaSimGravacao
                key={sim}
                fala={falasPorSim.get(sim) ?? null}
                consentimento={consentimento}
                aoRegistrar={(confirmado) => aoRegistrar(sim, confirmado)}
              />
            );
          }
          const simEstado = estado.sims[sim];
          return (
            <LinhaSim
              key={sim}
              sim={sim}
              fala={falasPorSim.get(sim) ?? null}
              registrado={simEstado ? simEstado.ok : null}
              emQue={simEstado?.em ?? null}
              aoRegistrar={aoRegistrar}
            />
          );
        })}
      </ul>
    </Quadro>
  );
}

/**
 * O 1º SIM é registro jurídico, não checagem de condução: mostra o texto
 * CONGELADO que foi de fato apresentado (`texto_apresentado`), não o texto
 * atual do roteiro (que pode ter mudado desde então) — essa é a diferença
 * para as outras 3 linhas.
 */
function LinhaSimGravacao({
  fala,
  consentimento,
  aoRegistrar,
}: {
  fala: RoteiroFala | null;
  consentimento: import("@/types/roteiro").ConsentimentoGravacao | null;
  aoRegistrar: (confirmado: boolean) => Promise<void>;
}) {
  const [enviando, setEnviando] = useState<"sim" | "nao" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function registrar(confirmado: boolean) {
    setErro(null);
    setEnviando(confirmado ? "sim" : "nao");
    try {
      await aoRegistrar(confirmado);
    } catch (e) {
      setErro(e instanceof ErroSessao ? e.message : "Não deu para registrar. Tente de novo.");
    } finally {
      setEnviando(null);
    }
  }

  const registrado = consentimento?.concedido ?? null;

  return (
    // `sm:col-span-3`/`2xl:col-span-1`: na faixa (grid de 3 colunas, `sm` até
    // antes de `2xl`) este é o ÚNICO SIM que ocupa a linha inteira, sozinho
    // — o texto de consentimento (`<details open>` abaixo) não cabe numa
    // célula de ~1/3 da largura ao lado dos outros 3. Em `2xl`+ volta a ser
    // item de lista comum (`col-span-1` é o valor default do `flex`, escrito
    // aqui só por clareza — não afeta layout `flex`).
    <li className="flex flex-col gap-1 border-b border-linha px-1 py-1.5 last:border-b-0 sm:col-span-3 sm:rounded-controle sm:border sm:p-2 2xl:col-span-1 2xl:rounded-none 2xl:border-0 2xl:border-b 2xl:px-1 2xl:py-1.5 2xl:last:border-b-0">
      <div className="flex flex-col gap-1 2xl:flex-row 2xl:flex-wrap 2xl:items-center 2xl:justify-between">
        <span className="flex min-h-11 flex-wrap items-center gap-2 text-sm text-tinta">
          <NumeroSim>1</NumeroSim>
          Sigilo e Gravação
          <span className="rounded-controle border border-linha-forte px-1.5 py-0.5 text-legenda font-medium uppercase text-tinta-fraca">registro jurídico</span>
        </span>

        {!consentimento ? (
          <div className="flex items-center gap-1">
            <AcaoTexto tom="neutro" carregando={enviando === "sim"} disabled={enviando !== null} onClick={() => registrar(true)}>
              Cliente disse sim
            </AcaoTexto>
            <AcaoTexto tom="vermelho" carregando={enviando === "nao"} disabled={enviando !== null} onClick={() => registrar(false)}>
              Não confirmou
            </AcaoTexto>
          </div>
        ) : (
          <Selo tom={registrado ? "verde" : "vermelho"}>
            {registrado ? "Consentimento concedido" : "Consentimento não concedido"} · {formatarDataHora(consentimento.concedido_em)}
          </Selo>
        )}
      </div>

      {erro && (
        <p role="alert" className="text-legenda text-[color:var(--vermelho)]">
          {erro}
        </p>
      )}

      <details className="group" open={!consentimento}>
        <summary className="min-h-6 cursor-pointer list-none text-legenda text-tinta-fraca marker:content-none [&::-webkit-details-marker]:hidden">
          Ver texto apresentado
        </summary>
        {/*
         * Decisão do dono (15/09): o `<details>` continua aberto por padrão
         * — a advogada precisa LER o texto em voz alta antes de registrar o
         * 1º SIM; é requisito de condução, não de layout. O que muda é o
         * teto: antes do registro `fala?.texto` (roteiro v4) chega a 4.274
         * caracteres — numa coluna de 260px isso é ~1.100px de altura e
         * empurra os 4 SIMs para fora da primeira dobra (medido em
         * `BlocoRoteiro.tsx:8-20`). Depois do registro vira
         * `texto_apresentado`, já curto, mas o teto protege exatamente o
         * caso em que abre sozinho. `TAB_INDEX_ROLAVEL`/`role`/`aria-label`
         * seguem o padrão de container rolável já usado em
         * `TabelaCroqui.tsx:161` (axe: `scrollable-region-focusable` exige
         * foco por teclado em região com scroll próprio; `TAB_INDEX_ROLAVEL`
         * em vez de `tabIndex={0}` literal evita falso positivo do
         * `jsx-a11y/no-noninteractive-tabindex`, ver comentário no topo do
         * arquivo).
         *
         * Decisão do dono (15/09, 2ª e 3ª rodadas): este SIM ocupa a linha
         * inteira da faixa (`sm:col-span-3`, ver o `<li>` acima) — o teto
         * de 8rem já limitava a altura, e a largura cheia da faixa só
         * melhora a leitura do texto dentro do teto, não muda o cálculo de
         * altura. O corte faixa/coluna migrou de `xl` para `2xl` na 3ª
         * rodada (ver comentário de `PainelSims` acima) — não muda nada
         * aqui, o `<details>` continua igual em qualquer corte.
         */}
        <blockquote
          tabIndex={TAB_INDEX_ROLAVEL}
          role="region"
          aria-label="Texto de consentimento apresentado ao cliente"
          className="mt-1 max-h-32 overflow-y-auto rounded-controle border border-linha bg-papel px-3 py-2 text-sm italic leading-relaxed text-tinta-suave focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--latao-cta)]"
        >
          “{consentimento?.texto_apresentado ?? fala?.texto ?? "Texto do roteiro não encontrado."}”
        </blockquote>
        {consentimento && (
          <p className="mt-1 text-legenda text-tinta-fraca">
            Texto congelado no momento do registro · versão {consentimento.versao_texto} · canal {consentimento.canal}
          </p>
        )}
      </details>
    </li>
  );
}
