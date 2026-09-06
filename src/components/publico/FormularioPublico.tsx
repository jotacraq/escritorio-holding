"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AberturaFormularioPublico, PerguntaFormularioPublico } from "@/types/publico-ui";
import { abrirLinkFormulario, conferirTipo, ErroLinkPublico, responderFormularioPublico } from "@/components/publico/cliente";
import { useRecurso } from "@/hooks/useRecurso";
import { CarregandoPublico, ErroTemporarioPublico } from "@/components/publico/CarregandoPublico";
import { TelaLinkInvalido } from "@/components/publico/TelaLinkInvalido";
import { BarraProgresso } from "@/components/publico/BarraProgresso";
import { CampoPerguntaPublico, perguntaPublicaRespondida, perguntaPublicaVisivel } from "@/components/publico/CampoPerguntaPublico";
import { lerRascunho, limparRascunho, salvarRascunho } from "@/components/publico/rascunhoLocal";
import { formatarData } from "@/lib/formatar";
import { BotaoPublico, CartaoPublico, IconeFeito, RotuloPublico } from "@/components/publico/atomos";

function agruparPorBloco(definicao: PerguntaFormularioPublico[]): { bloco: string; perguntas: PerguntaFormularioPublico[] }[] {
  const ordem: string[] = [];
  const mapa = new Map<string, PerguntaFormularioPublico[]>();
  for (const pergunta of definicao) {
    if (!mapa.has(pergunta.bloco)) {
      mapa.set(pergunta.bloco, []);
      ordem.push(pergunta.bloco);
    }
    mapa.get(pergunta.bloco)!.push(pergunta);
  }
  return ordem.map((bloco) => ({ bloco, perguntas: mapa.get(bloco)! }));
}

function TelaConcluida({ abertura }: { abertura: AberturaFormularioPublico }) {
  const respostas = abertura.payload.respostas ?? {};
  const blocos = agruparPorBloco(abertura.payload.definicao);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-4 text-center" aria-live="polite">
        <IconeFeito />
        <div className="flex flex-col gap-2">
          <RotuloPublico>Formulário Estratégico</RotuloPublico>
          <h1 className="text-tinta">
            Recebemos suas respostas{abertura.payload.respondido_em ? ` em ${formatarData(abertura.payload.respondido_em)}` : ""}
          </h1>
          <p className="max-w-sm text-tinta-suave">
            {abertura.primeiro_nome}, obrigada por responder. A equipe da Dra. Elaine já está com essas informações antes da
            sua conversa.
          </p>
        </div>
      </div>

      <CartaoPublico className="flex flex-col gap-5">
        {blocos.map(({ bloco, perguntas }) => {
          const visiveis = perguntas.filter((p) => respostas[p.id] !== undefined && respostas[p.id] !== null && respostas[p.id] !== "");
          if (visiveis.length === 0) return null;
          return (
            <div key={bloco} className="flex flex-col gap-2.5">
              <h2 className="text-rotulo font-medium uppercase text-tinta-fraca">{bloco}</h2>
              {visiveis.map((pergunta) => {
                const valor = respostas[pergunta.id];
                const texto = Array.isArray(valor) ? valor.join(", ") : String(valor);
                return (
                  <div key={pergunta.id} className="flex flex-col gap-0.5">
                    <p className="text-sm text-tinta-suave">{pergunta.rotulo}</p>
                    <p className="text-base font-medium text-tinta">{texto}</p>
                  </div>
                );
              })}
            </div>
          );
        })}
      </CartaoPublico>
    </div>
  );
}

function Assistente({ token, abertura }: { token: string; abertura: AberturaFormularioPublico }) {
  const blocos = useMemo(() => agruparPorBloco(abertura.payload.definicao), [abertura.payload.definicao]);
  const rascunho = useMemo(() => lerRascunho(token), [token]);
  const [respostas, setRespostas] = useState<Record<string, unknown>>(() => abertura.payload.respostas ?? rascunho?.respostas ?? {});
  const [aceites, setAceites] = useState<Set<string>>(new Set());
  const [passo, setPasso] = useState(0); // 0..blocos.length-1 = blocos; blocos.length = consentimentos
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [concluido, setConcluido] = useState(false);

  useEffect(() => {
    salvarRascunho(token, respostas);
  }, [token, respostas]);

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

  const faltando = perguntasVisiveisDoBloco.filter((p) => !perguntaPublicaRespondida(p, respostas[p.id])).map((p) => p.rotulo);

  const consentimentosPendentes = abertura.payload.consentimentos.filter((c) => !aceites.has(c.chave));
  const podeEnviar = consentimentosPendentes.length === 0;

  async function enviar() {
    setEnviando(true);
    setErroEnvio(null);
    try {
      const resposta = await responderFormularioPublico(token, {
        respostas,
        consentimentos: abertura.payload.consentimentos.map((c) => ({ chave: c.chave, versao: c.versao })),
        verificacao: "",
      });
      limparRascunho(token);
      setConcluido(Boolean(resposta.ok));
    } catch (e) {
      if (e instanceof ErroLinkPublico && e.codigo === "link_invalido") {
        // O link venceu ou foi revogado enquanto ele preenchia — trata como qualquer link inválido, sem detalhe a mais.
        setErroEnvio("link_invalido");
      } else if (e instanceof ErroLinkPublico && e.codigo === "limite_excedido") {
        setErroEnvio("Muitas tentativas em pouco tempo. Espere um minuto e tente enviar de novo.");
      } else {
        setErroEnvio("Não foi possível enviar agora. Suas respostas continuam salvas neste aparelho — tente de novo em instantes.");
      }
    } finally {
      setEnviando(false);
    }
  }

  if (concluido) {
    return (
      <TelaConcluida
        abertura={{
          ...abertura,
          payload: { ...abertura.payload, respostas, respondido_em: new Date().toISOString() },
        }}
      />
    );
  }

  if (erroEnvio === "link_invalido") return <TelaLinkInvalido />;

  return (
    <div className="flex flex-col gap-6">
      {/*
       * `h1` de navegação por leitor de tela: a saudação abaixo já cumpre esse
       * papel visualmente, mas herdaria `font-family`/tamanho de heading do
       * `globals.css` (regra global `h1,h2,h3,h4`) e mudaria o layout se virasse
       * `<h1>` visível. Este heading fica só na árvore de acessibilidade —
       * mesmo texto, sem duplicar o que a pessoa vidente já lê no parágrafo.
       */}
      <h1 className="sr-only">Formulário Estratégico — Olá, {abertura.primeiro_nome}</h1>
      <div className="flex flex-col gap-1">
        <RotuloPublico>Formulário Estratégico</RotuloPublico>
        <p className="text-tinta-suave">Olá, {abertura.primeiro_nome}. Leva cerca de 3 minutos.</p>
      </div>

      <BarraProgresso atual={passo + 1} total={totalPassos} rotulo={blocoAtual ? blocoAtual.bloco : "Confirmação"} />

      {/* Honeypot: invisível para pessoa, visível para bot que preenche tudo automaticamente. */}
      <div aria-hidden="true" className="absolute h-0 w-0 overflow-hidden opacity-0" style={{ left: "-9999px" }}>
        <label htmlFor="site-pessoal">Deixe este campo em branco</label>
        <input id="site-pessoal" name="site-pessoal" type="text" tabIndex={-1} autoComplete="off" />
      </div>

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
          {abertura.payload.consentimentos.map((consentimento) => {
            const marcado = aceites.has(consentimento.chave);
            return (
              <label
                key={consentimento.chave}
                className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-controle border-2 px-4 py-3 transition-colors duration-[var(--transicao-rapida)] ${
                  marcado ? "border-[color:var(--latao-cta)] bg-latao-fraco" : "border-linha-forte bg-papel"
                }`}
              >
                <input
                  type="checkbox"
                  checked={marcado}
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
                <span className="text-sm leading-relaxed text-tinta">
                  <span className="block text-base font-bold">{consentimento.titulo}</span>
                  {consentimento.texto}
                </span>
              </label>
            );
          })}
        </fieldset>
      )}

      {blocoAtual && faltando.length > 0 && (
        <p aria-live="polite" className="text-sm text-tinta-suave">
          Para continuar, falta responder: <span className="font-medium text-tinta">{faltando.join(", ")}</span>.
        </p>
      )}

      {!blocoAtual && consentimentosPendentes.length > 0 && (
        <p aria-live="polite" className="text-sm text-tinta-suave">
          Para enviar, marque {consentimentosPendentes.length === 1 ? "a autorização acima" : `as ${consentimentosPendentes.length} autorizações acima`}.
        </p>
      )}

      {erroEnvio && erroEnvio !== "link_invalido" && (
        <p role="alert" className="text-sm font-medium text-[color:var(--vermelho)]">
          {erroEnvio}
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
          <BotaoPublico variante="primario" onClick={enviar} disabled={!podeEnviar} carregando={enviando} className="sm:flex-[2]">
            {enviando ? "Enviando…" : "Enviar respostas"}
          </BotaoPublico>
        )}
      </div>
    </div>
  );
}

export function FormularioPublico({ token }: { token: string }) {
  const buscar = useCallback(() => abrirLinkFormulario(token).then((res) => conferirTipo(res, "formulario")), [token]);
  const { dados: abertura, carregando, erro, recarregar } = useRecurso(buscar, [token]);

  if (carregando) return <CarregandoPublico />;
  if (erro instanceof ErroLinkPublico && erro.codigo === "link_invalido") return <TelaLinkInvalido />;
  if (erro) return <ErroTemporarioPublico aoTentarNovamente={recarregar} />;
  if (!abertura) return null;

  if (abertura.payload.respondido_em) return <TelaConcluida abertura={abertura} />;
  return <Assistente token={token} abertura={abertura} />;
}
