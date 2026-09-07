"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ConsentimentoVigente } from "@/types/publico-ui";
import { CampoPerguntaPublico, perguntaPublicaRespondida, perguntaPublicaVisivel, type PerguntaPublica } from "@/components/publico/CampoPerguntaPublico";
import { BarraProgresso } from "@/components/publico/BarraProgresso";
import { BotaoPublico, RotuloPublico } from "@/components/publico/atomos";

/**
 * O passo a passo do Formulário Estratégico — SEM rede.
 *
 * Extraído de `FormularioPublico.tsx` (Fase 7 r3, §A5.2): o Admin precisa
 * mostrar à Dra. Elaine exatamente o que o cliente vai ver antes de publicar
 * uma versão nova, e a única prévia fiel é o próprio componente. Duplicar a
 * tela criaria duas verdades que divergiriam na primeira correção; emitir um
 * link real para pré-visualizar revogaria o link que o cliente já tem na mão.
 *
 * Por isso aqui não existe `fetch`, `token`, nem rascunho: quem busca e quem
 * envia é o `FormularioPublico`; quem monta dados em memória é o
 * `FormularioPrevia` do Admin. O comportamento (foco, `aria-live`, lista do
 * que falta, travas do "Continuar") é o mesmo dos dois lados por construção.
 */

export interface BlocoDePerguntas {
  bloco: string;
  perguntas: PerguntaPublica[];
}

export function agruparPorBloco(definicao: PerguntaPublica[]): BlocoDePerguntas[] {
  const ordem: string[] = [];
  const mapa = new Map<string, PerguntaPublica[]>();
  for (const pergunta of definicao) {
    if (!mapa.has(pergunta.bloco)) {
      mapa.set(pergunta.bloco, []);
      ordem.push(pergunta.bloco);
    }
    mapa.get(pergunta.bloco)!.push(pergunta);
  }
  return ordem.map((bloco) => ({ bloco, perguntas: mapa.get(bloco)! }));
}

export interface AssistenteFormularioProps {
  primeiroNome: string;
  definicao: PerguntaPublica[];
  consentimentos: ConsentimentoVigente[];
  /** Respostas já dadas (reedição) ou rascunho local. */
  respostasIniciais?: Record<string, unknown>;
  /** Chamado a cada digitação — é onde o público salva o rascunho no aparelho. */
  aoMudarRespostas?: (respostas: Record<string, unknown>) => void;
  /**
   * Envia. Rejeitar é esperado: quem traduz a falha em texto é quem chamou
   * (o wrapper público sabe distinguir link vencido de rede caída), e o texto
   * volta por `erro`. Aqui só se desliga o "Enviando…".
   */
  aoConcluir: (respostas: Record<string, unknown>) => Promise<void>;
  /** Mensagem de falha do envio, já em português de gente. */
  erro?: string | null;
  /**
   * Pergunta que o SERVIDOR recusou (`resposta_obrigatoria`/`opcao_invalida`,
   * 0081/0082). O assistente volta ao passo dela e põe o foco no campo — sem
   * isso a pessoa lê "falta responder X" e tem de caçar X sozinha, num
   * formulário de 6 blocos e no celular.
   *
   * `sequencia` existe porque o MESMO erro pode voltar duas vezes seguidas
   * (ela reenvia sem corrigir): sem um valor que muda, o efeito não roda de
   * novo e o foco não volta.
   */
  foco?: { pergunta: string; sequencia: number } | null;
  /**
   * Pré-visualização do Admin: nada é enviado, ninguém recebe nada. Os
   * consentimentos aparecem (fazem parte do que o cliente vê) mas são inertes,
   * e o botão final fecha a prévia em vez de enviar.
   */
  modoPrevia?: boolean;
}

export function AssistenteFormulario({
  primeiroNome,
  definicao,
  consentimentos,
  respostasIniciais,
  aoMudarRespostas,
  aoConcluir,
  erro = null,
  foco = null,
  modoPrevia = false,
}: AssistenteFormularioProps) {
  const blocos = useMemo(() => agruparPorBloco(definicao), [definicao]);
  const [respostas, setRespostas] = useState<Record<string, unknown>>(() => respostasIniciais ?? {});
  const [aceites, setAceites] = useState<Set<string>>(new Set());
  const [passo, setPasso] = useState(0); // 0..blocos.length-1 = blocos; blocos.length = consentimentos
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    aoMudarRespostas?.(respostas);
  }, [aoMudarRespostas, respostas]);

  const totalPassos = blocos.length + 1; // + tela de consentimento

  const blocoAtual = passo < blocos.length ? blocos[passo] : null;
  const perguntasVisiveisDoBloco = blocoAtual ? blocoAtual.perguntas.filter((p) => perguntaPublicaVisivel(p, respostas)) : [];
  const blocoCompleto = perguntasVisiveisDoBloco.every((p) => perguntaPublicaRespondida(p, respostas[p.id]));

  /*
   * Fase 7 r2 (§UX2.3) — o que faltava no passo a passo:
   *
   * 1. FOCO. Trocar de passo só trocava o conteúdo do `<fieldset>`. Quem usa
   *    leitor de tela continuava com o foco no botão "Continuar" (que agora é
   *    outro botão) e nunca ouvia que mudou de bloco; quem está no celular
   *    ficava com a tela rolada no rodapé do bloco anterior. Agora o foco vai
   *    para o passo novo (`tabIndex={-1}`, sem virar parada de Tab) e a rolagem
   *    volta ao topo.
   * 2. POR QUE O BOTÃO ESTÁ DESLIGADO. "Continuar" desabilitado sem motivo é
   *    um beco sem saída para quem tem 60+ e está no celular. `faltando` diz o
   *    nome das perguntas que faltam, em `aria-live` para o leitor de tela.
   */
  const refAnuncio = useRef<HTMLParagraphElement>(null);
  const refPasso = useRef<HTMLFieldSetElement>(null);
  const passoAnterior = useRef(passo);
  useEffect(() => {
    if (passoAnterior.current === passo) return; // montagem (e o remonte do StrictMode)
    passoAnterior.current = passo;
    // O foco vai para um parágrafo `sr-only`, NÃO para o `<fieldset>`: a regra
    // global `:focus-visible` de `globals.css` pintaria um halo laranja de 2px
    // em volta do cartão inteiro. O `sr-only` recorta o halo e o leitor de tela
    // lê o passo novo — que é a única coisa que se queria aqui.
    refAnuncio.current?.focus({ preventScroll: true });
    refPasso.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [passo]);

  /*
   * O servidor apontou uma pergunta (`foco`): volta ao bloco dela e põe o foco
   * no campo. Roda DEPOIS do efeito de troca de passo acima — que manda o foco
   * para o anúncio do passo —, então é este que fica valendo.
   *
   * Duas passagens de propósito: a primeira troca o passo (o campo ainda não
   * está no DOM), a segunda encontra o campo e foca. `document.getElementById`
   * e não `ref` porque o id é o mesmo contrato que `CampoPerguntaPublico`
   * escreve (`pergunta-publica-<id>`) e que o `<label htmlFor>` já usa.
   */
  const blocoDoFoco = foco ? blocos.findIndex((b) => b.perguntas.some((p) => p.id === foco.pergunta)) : -1;
  useEffect(() => {
    if (!foco || blocoDoFoco < 0) return;
    if (passo !== blocoDoFoco) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPasso(blocoDoFoco);
      return;
    }
    const campo = document.getElementById(`pergunta-publica-${foco.pergunta}`);
    if (!(campo instanceof HTMLElement)) return;
    campo.focus({ preventScroll: true });
    campo.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [foco, blocoDoFoco, passo]);

  const faltando = perguntasVisiveisDoBloco.filter((p) => !perguntaPublicaRespondida(p, respostas[p.id])).map((p) => p.rotulo);

  const consentimentosPendentes = consentimentos.filter((c) => !aceites.has(c.chave));
  // Na prévia os checkboxes são inertes: exigir aceite ali seria pedir
  // consentimento de quem não é o titular.
  const podeEnviar = modoPrevia || consentimentosPendentes.length === 0;

  async function enviar() {
    setEnviando(true);
    try {
      await aoConcluir(respostas);
    } catch {
      // O texto do erro é responsabilidade de quem chamou e volta por `erro`.
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/*
       * `h1` de navegação por leitor de tela: a saudação abaixo já cumpre esse
       * papel visualmente, mas herdaria `font-family`/tamanho de heading do
       * `globals.css` (regra global `h1,h2,h3,h4`) e mudaria o layout se virasse
       * `<h1>` visível. Este heading fica só na árvore de acessibilidade —
       * mesmo texto, sem duplicar o que a pessoa vidente já lê no parágrafo.
       */}
      <h1 className="sr-only">Formulário Estratégico — Olá, {primeiroNome}</h1>
      <div className="flex flex-col gap-1">
        <RotuloPublico>Formulário Estratégico</RotuloPublico>
        <p className="text-tinta-suave">Olá, {primeiroNome}. Leva cerca de 3 minutos.</p>
      </div>

      <BarraProgresso atual={passo + 1} total={totalPassos} rotulo={blocoAtual ? blocoAtual.bloco : "Confirmação"} />

      {!modoPrevia && (
        /* Honeypot: invisível para pessoa, visível para bot que preenche tudo automaticamente. */
        <div aria-hidden="true" className="absolute h-0 w-0 overflow-hidden opacity-0" style={{ left: "-9999px" }}>
          <label htmlFor="site-pessoal">Deixe este campo em branco</label>
          <input id="site-pessoal" name="site-pessoal" type="text" tabIndex={-1} autoComplete="off" />
        </div>
      )}

      {blocoAtual && (
        <fieldset ref={refPasso} className="flex flex-col gap-6 rounded-cartao border border-linha bg-papel-elevado px-5 py-6 shadow-cartao sm:px-8 sm:py-8">
          <legend className="sr-only">
            {blocoAtual.bloco} — passo {passo + 1} de {totalPassos}
          </legend>
          <p ref={refAnuncio} tabIndex={-1} className="sr-only">
            Passo {passo + 1} de {totalPassos}: {blocoAtual.bloco}
          </p>
          {perguntasVisiveisDoBloco.map((pergunta) => (
            <div key={pergunta.id} className="flex flex-col gap-2">
              <label id={`pergunta-publica-${pergunta.id}-rotulo`} htmlFor={`pergunta-publica-${pergunta.id}`} className="text-base font-medium text-tinta">
                {pergunta.rotulo}
                {pergunta.obrigatoria && (
                  <>
                    {/* O asterisco é visual (`aria-hidden`); o leitor de tela ouve
                        a palavra. Sem isto, "obrigatória" só existia para quem vê. */}
                    <span aria-hidden="true" className="text-[color:var(--vermelho)]">
                      {" "}
                      *
                    </span>
                    <span className="sr-only"> (obrigatória)</span>
                  </>
                )}
              </label>
              <CampoPerguntaPublico pergunta={pergunta} valor={respostas[pergunta.id]} aoMudar={(v) => setRespostas((r) => ({ ...r, [pergunta.id]: v }))} />
            </div>
          ))}
        </fieldset>
      )}

      {!blocoAtual && (
        <fieldset ref={refPasso} className="flex flex-col gap-4 rounded-cartao border border-linha bg-papel-elevado px-5 py-6 shadow-cartao sm:px-8 sm:py-8">
          <legend className="text-subtitulo font-bold text-tinta">Antes de enviar</legend>
          <p ref={refAnuncio} tabIndex={-1} className="sr-only">
            Passo {passo + 1} de {totalPassos}: antes de enviar
          </p>
          {consentimentos.map((consentimento) => {
            const marcado = aceites.has(consentimento.chave);
            return (
              <label
                key={consentimento.chave}
                className={`flex min-h-11 items-start gap-3 rounded-controle border-2 px-4 py-3 transition-colors duration-[var(--transicao-rapida)] ${
                  modoPrevia ? "cursor-default opacity-80" : "cursor-pointer"
                } ${marcado ? "border-[color:var(--latao-cta)] bg-latao-fraco" : "border-linha-forte bg-papel"}`}
              >
                <input
                  type="checkbox"
                  checked={marcado}
                  disabled={modoPrevia}
                  onChange={(e) =>
                    setAceites((atual) => {
                      const novo = new Set(atual);
                      if (e.target.checked) novo.add(consentimento.chave);
                      else novo.delete(consentimento.chave);
                      return novo;
                    })
                  }
                  className="mt-1 h-6 w-6 shrink-0 accent-[color:var(--latao-cta)]"
                />
                <span className="text-publico leading-relaxed text-tinta">
                  <span className="block text-base font-bold">{consentimento.titulo}</span>
                  {consentimento.texto}
                </span>
              </label>
            );
          })}
          {consentimentos.length === 0 && (
            <p className="text-publico text-tinta-suave">
              {modoPrevia
                ? "Aqui o cliente marca os textos de consentimento vigentes. A pré-visualização não os carrega — eles são resolvidos na hora em que o link é aberto."
                : "Nenhum texto de consentimento vigente — não há nada para marcar."}
            </p>
          )}
        </fieldset>
      )}

      {blocoAtual && faltando.length > 0 && (
        <p aria-live="polite" className="text-publico text-tinta-suave">
          Para continuar, falta responder: <span className="font-medium text-tinta">{faltando.join(", ")}</span>.
        </p>
      )}

      {!blocoAtual && !modoPrevia && consentimentosPendentes.length > 0 && (
        <p aria-live="polite" className="text-publico text-tinta-suave">
          Para enviar, marque {consentimentosPendentes.length === 1 ? "a autorização acima" : `as ${consentimentosPendentes.length} autorizações acima`}.
        </p>
      )}

      {erro && (
        <p role="alert" className="text-publico font-medium text-[color:var(--vermelho)]">
          {erro}
        </p>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        {passo > 0 && (
          <BotaoPublico variante="secundario" onClick={() => setPasso((p) => p - 1)} disabled={enviando} className="sm:flex-1">
            Voltar
          </BotaoPublico>
        )}
        {blocoAtual ? (
          <BotaoPublico variante="primario" onClick={() => setPasso((p) => p + 1)} disabled={!blocoCompleto} className="sm:flex-[2]">
            Continuar
          </BotaoPublico>
        ) : (
          <BotaoPublico variante="primario" onClick={enviar} disabled={!podeEnviar} carregando={enviando && !modoPrevia} className="sm:flex-[2]">
            {modoPrevia ? "Fim da pré-visualização" : enviando ? "Enviando…" : "Enviar respostas"}
          </BotaoPublico>
        )}
      </div>
    </div>
  );
}
