"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AberturaFormularioPublico, PerguntaFormularioPublico } from "@/types/publico-ui";
import { abrirLinkFormulario, conferirTipo, ErroLinkPublico, responderFormularioPublico } from "@/components/publico/cliente";
import { useRecurso } from "@/hooks/useRecurso";
import { CarregandoPublico, ErroTemporarioPublico } from "@/components/publico/CarregandoPublico";
import { TelaLinkInvalido } from "@/components/publico/TelaLinkInvalido";
import { BarraProgresso } from "@/components/publico/BarraProgresso";
import { CampoPerguntaPublico, perguntaPublicaRespondida, perguntaPublicaVisivel } from "@/components/publico/CampoPerguntaPublico";
import { lerRascunho, limparRascunho, salvarRascunho } from "@/components/publico/rascunhoLocal";
import { formatarData } from "@/lib/formatar";

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
      <div className="flex flex-col items-center gap-3 text-center">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-11 w-11 fill-none stroke-[color:var(--verde)] stroke-2">
          <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
        </svg>
        <h1 className="font-serif text-xl font-semibold text-tinta">
          Recebemos suas respostas{abertura.payload.respondido_em ? ` em ${formatarData(abertura.payload.respondido_em)}` : ""}
        </h1>
        <p className="max-w-sm text-tinta-suave">
          {abertura.primeiro_nome}, obrigada por responder. A equipe da Dra. Elaine já está com essas informações antes da
          sua conversa.
        </p>
      </div>

      <div className="flex flex-col gap-5 rounded-md border border-linha bg-papel px-5 py-5">
        {blocos.map(({ bloco, perguntas }) => {
          const visiveis = perguntas.filter((p) => respostas[p.id] !== undefined && respostas[p.id] !== null && respostas[p.id] !== "");
          if (visiveis.length === 0) return null;
          return (
            <div key={bloco} className="flex flex-col gap-2.5">
              <h2 className="font-serif text-sm font-semibold uppercase tracking-wide text-tinta-suave">{bloco}</h2>
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
      </div>
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
      <div className="flex flex-col gap-1">
        <p className="text-sm text-tinta-suave">Olá, {abertura.primeiro_nome}. Leva cerca de 3 minutos.</p>
      </div>

      <BarraProgresso atual={passo + 1} total={totalPassos} rotulo={blocoAtual ? blocoAtual.bloco : "Confirmação"} />

      {/* Honeypot: invisível para pessoa, visível para bot que preenche tudo automaticamente. */}
      <div aria-hidden="true" className="absolute h-0 w-0 overflow-hidden opacity-0" style={{ left: "-9999px" }}>
        <label htmlFor="site-pessoal">Deixe este campo em branco</label>
        <input id="site-pessoal" name="site-pessoal" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {blocoAtual && (
        <fieldset className="flex flex-col gap-6">
          <legend className="sr-only">{blocoAtual.bloco}</legend>
          {perguntasVisiveisDoBloco.map((pergunta) => (
            <div key={pergunta.id} className="flex flex-col gap-2">
              <label id={`pergunta-publica-${pergunta.id}-rotulo`} htmlFor={`pergunta-publica-${pergunta.id}`} className="text-base font-medium text-tinta">
                {pergunta.rotulo}
                {pergunta.obrigatoria && (
                  <span aria-hidden="true" className="text-[color:var(--vermelho)]">
                    {" "}
                    *
                  </span>
                )}
              </label>
              <CampoPerguntaPublico pergunta={pergunta} valor={respostas[pergunta.id]} aoMudar={(v) => setRespostas((r) => ({ ...r, [pergunta.id]: v }))} />
            </div>
          ))}
        </fieldset>
      )}

      {!blocoAtual && (
        <fieldset className="flex flex-col gap-4">
          <legend className="font-serif text-base font-semibold text-tinta">Antes de enviar</legend>
          {abertura.payload.consentimentos.map((consentimento) => (
            <label key={consentimento.chave} className="flex items-start gap-3 rounded-md border border-linha-forte bg-papel-elevado px-4 py-3">
              <input
                type="checkbox"
                checked={aceites.has(consentimento.chave)}
                onChange={(e) =>
                  setAceites((atual) => {
                    const novo = new Set(atual);
                    if (e.target.checked) novo.add(consentimento.chave);
                    else novo.delete(consentimento.chave);
                    return novo;
                  })
                }
                className="mt-0.5 h-5 w-5 shrink-0 rounded-sm accent-[color:var(--latao)]"
              />
              <span className="text-sm leading-relaxed text-tinta">
                <span className="block font-medium">{consentimento.titulo}</span>
                {consentimento.texto}
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {erroEnvio && erroEnvio !== "link_invalido" && (
        <p role="alert" className="text-sm font-medium text-[color:var(--vermelho)]">
          {erroEnvio}
        </p>
      )}

      <div className="flex gap-3">
        {passo > 0 && (
          <button
            type="button"
            onClick={() => setPasso((p) => p - 1)}
            disabled={enviando}
            className="flex-1 rounded-md border border-linha-forte bg-papel-elevado py-3 text-base font-medium text-tinta disabled:opacity-50"
          >
            Voltar
          </button>
        )}
        {blocoAtual ? (
          <button
            type="button"
            onClick={() => setPasso((p) => p + 1)}
            disabled={!blocoCompleto}
            className="flex-1 rounded-md bg-[color:var(--latao)] py-3 text-base font-semibold text-papel-elevado disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continuar
          </button>
        ) : (
          <button
            type="button"
            onClick={enviar}
            disabled={!podeEnviar || enviando}
            aria-busy={enviando}
            className="flex-1 rounded-md bg-[color:var(--latao)] py-3 text-base font-semibold text-papel-elevado disabled:cursor-not-allowed disabled:opacity-40"
          >
            {enviando ? "Enviando…" : "Enviar respostas"}
          </button>
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
