"use client";

import { useCallback, useMemo, useState } from "react";
import type { AberturaFormularioPublico } from "@/types/publico-ui";
import { abrirLinkFormulario, conferirTipo, ErroLinkPublico, responderFormularioPublico } from "@/components/publico/cliente";
import { useRecurso } from "@/hooks/useRecurso";
import { CarregandoPublico, ErroTemporarioPublico } from "@/components/publico/CarregandoPublico";
import { TelaLinkInvalido } from "@/components/publico/TelaLinkInvalido";
import { AssistenteFormulario, agruparPorBloco } from "@/components/publico/AssistenteFormulario";
import { lerRascunho, limparRascunho, salvarRascunho } from "@/components/publico/rascunhoLocal";
import { formatarData } from "@/lib/formatar";
import { textoDaResposta } from "@/lib/formulario/definicao";
import { CartaoPublico, IconeFeito, RotuloPublico } from "@/components/publico/atomos";

/**
 * O formulário do cliente. Esta camada só cuida da REDE (abrir o link, enviar,
 * traduzir falha em português); o passo a passo vive em `AssistenteFormulario`,
 * que o Admin monta igualzinho para pré-visualizar antes de publicar uma versão
 * (docs/ARQUITETURA-FASE-7.md §A5.2).
 */

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
          /*
           * Fase 7 r3: aqui se imprimia `String(valor)` cru — quem respondeu
           * "Casado(a)" relia "casado", porque `opcoes` guardava o slug e o
           * rótulo no mesmo campo. `textoDaResposta` devolve o rótulo da opção
           * (nos dois formatos de `definicao`) e string vazia quando não há
           * resposta — vazio é vazio, some da lista.
           */
          const visiveis = perguntas
            .map((pergunta) => ({ pergunta, texto: textoDaResposta(pergunta, respostas[pergunta.id]) }))
            .filter(({ texto }) => texto !== "");
          if (visiveis.length === 0) return null;
          return (
            <div key={bloco} className="flex flex-col gap-2.5">
              <h2 className="text-rotulo font-medium uppercase text-tinta-fraca">{bloco}</h2>
              {visiveis.map(({ pergunta, texto }) => (
                <div key={pergunta.id} className="flex flex-col gap-0.5">
                  <p className="text-sm text-tinta-suave">{pergunta.rotulo}</p>
                  <p className="text-base font-medium text-tinta">{texto}</p>
                </div>
              ))}
            </div>
          );
        })}
      </CartaoPublico>
    </div>
  );
}

/**
 * `resposta_obrigatoria` e `opcao_invalida` (0081/0082) são erros PERMANENTES:
 * o servidor conferiu o corpo contra a definição da versão ativa e ele não
 * passa. Oferecer "tente de novo em instantes" para eles é mandar a pessoa
 * repetir o que já falhou. A tela diz o RÓTULO da pergunta — o id (`p11`) não
 * quer dizer nada para quem responde — e o assistente leva o foco até lá.
 *
 * Quando o id não existe na definição que ele leu (a versão foi trocada entre
 * abrir o link e enviar — o risco residual conhecido), o texto degrada para
 * uma frase que ainda diz o que fazer, sem inventar rótulo.
 */
function textoDeErroPermanente(
  codigo: "resposta_obrigatoria" | "opcao_invalida",
  perguntaId: string | undefined,
  definicao: AberturaFormularioPublico["payload"]["definicao"],
): string {
  const rotulo = definicao.find((p) => p.id === perguntaId)?.rotulo;
  if (!rotulo) {
    return codigo === "resposta_obrigatoria"
      ? "Falta responder uma pergunta obrigatória. Revise os blocos anteriores e envie de novo."
      : "Uma das escolhas não é mais válida — as perguntas foram atualizadas. Recarregue a página e confira as opções.";
  }
  return codigo === "resposta_obrigatoria" ? `Falta responder: ${rotulo}.` : `Opção inválida em ${rotulo}. Escolha uma das opções da lista.`;
}

function Preenchimento({ token, abertura }: { token: string; abertura: AberturaFormularioPublico }) {
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [foco, setFoco] = useState<{ pergunta: string; sequencia: number } | null>(null);
  const [enviadas, setEnviadas] = useState<Record<string, unknown> | null>(null);

  // `useMemo` porque `lerRascunho` lê o `localStorage`: sem ele, toda re-render
  // desta camada (falha de envio, por exemplo) tocaria o disco de novo.
  const respostasIniciais = useMemo(() => abertura.payload.respostas ?? lerRascunho(token)?.respostas ?? {}, [abertura.payload.respostas, token]);
  const guardarRascunho = useCallback((respostas: Record<string, unknown>) => salvarRascunho(token, respostas), [token]);

  const enviar = useCallback(
    async (respostas: Record<string, unknown>) => {
      setErroEnvio(null);
      try {
        const resposta = await responderFormularioPublico(token, {
          respostas,
          consentimentos: abertura.payload.consentimentos.map((c) => ({ chave: c.chave, versao: c.versao })),
          verificacao: "",
        });
        limparRascunho(token);
        if (resposta.ok) setEnviadas(respostas);
      } catch (e) {
        if (e instanceof ErroLinkPublico && e.codigo === "link_invalido") {
          // O link venceu ou foi revogado enquanto ele preenchia — trata como qualquer link inválido, sem detalhe a mais.
          setErroEnvio("link_invalido");
        } else if (e instanceof ErroLinkPublico && e.codigo === "limite_excedido") {
          setErroEnvio("Muitas tentativas em pouco tempo. Espere um minuto e tente enviar de novo.");
        } else if (e instanceof ErroLinkPublico && (e.codigo === "resposta_obrigatoria" || e.codigo === "opcao_invalida")) {
          setErroEnvio(textoDeErroPermanente(e.codigo, e.pergunta, abertura.payload.definicao));
          // `sequencia` muda mesmo quando é a mesma pergunta de novo: é o que
          // faz o foco voltar quando ela reenvia sem ter corrigido.
          if (e.pergunta) setFoco((atual) => ({ pergunta: e.pergunta!, sequencia: (atual?.sequencia ?? 0) + 1 }));
        } else {
          setErroEnvio("Não foi possível enviar agora. Suas respostas continuam salvas neste aparelho — tente de novo em instantes.");
        }
        throw e; // o assistente só precisa saber que falhou, para desligar o "Enviando…"
      }
    },
    [abertura.payload.consentimentos, abertura.payload.definicao, token],
  );

  if (enviadas) {
    return (
      <TelaConcluida
        abertura={{ ...abertura, payload: { ...abertura.payload, respostas: enviadas, respondido_em: new Date().toISOString() } }}
      />
    );
  }

  if (erroEnvio === "link_invalido") return <TelaLinkInvalido />;

  return (
    <AssistenteFormulario
      primeiroNome={abertura.primeiro_nome}
      definicao={abertura.payload.definicao}
      consentimentos={abertura.payload.consentimentos}
      respostasIniciais={respostasIniciais}
      aoMudarRespostas={guardarRascunho}
      aoConcluir={enviar}
      erro={erroEnvio}
      foco={foco}
    />
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
  return <Preenchimento token={token} abertura={abertura} />;
}
