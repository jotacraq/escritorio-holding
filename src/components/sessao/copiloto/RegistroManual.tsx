"use client";

import { useCallback, useState } from "react";
import { ErroSessao, listarSegmentosCopiloto, registrarSegmentoManual } from "@/components/sessao/api";
import { useRecurso } from "@/hooks/useRecurso";
import { Quadro } from "@/components/ui/Quadro";
import { Botao } from "@/components/ui/Botao";
import { EstadoCarregando, EstadoVazio } from "@/components/ui/Estado";
import { Campo, AreaTexto } from "@/components/ui/Campo";
import { formatarDataHora } from "@/lib/formatar";
import { ehCopilotoDesligado } from "@/components/sessao/copiloto/usePollingCopiloto";
import { adicionarSegmento } from "@/components/sessao/copiloto/adicionarSegmento";

/** Mesma constante de `PainelCopiloto.tsx` (WCAG 2.1.1 — container rolável
 * exige foco por teclado). Duplicada aqui de propósito: é um valor sem
 * estado, e um import cruzado só para uma constante primitiva criaria
 * acoplamento desnecessário entre os dois arquivos extraídos. */
const TAB_INDEX_ROLAVEL = 0;

/**
 * Bloco 3 "O cliente disse" (Fase 12, Fatia B — a tela vira leitura).
 * Extraído de `PainelCopiloto.tsx` (antigo `RegistroManual`, rótulo
 * "Transcrição ao vivo"), corpo intacto: recupera o que a advogada perdeu
 * enquanto formulava a próxima pergunta — ler a última fala registrada MUDA
 * a próxima frase dela, então passa na régua dos 30 segundos e fica na tela
 * ao vivo, em rodapé de ALTURA FIXA (nunca cresce com a sessão — é o mesmo
 * `max-h-32 overflow-y-auto` de sempre).
 *
 * Continua sendo a ÚNICA entrada manual da tela — regra da casa: feature
 * sem porta de entrada é feature que não existe.
 */
export function RegistroManual({ sessaoId, sessaoEncerrada }: { sessaoId: string; sessaoEncerrada: boolean }) {
  const buscarSegmentos = useCallback(() => listarSegmentosCopiloto(sessaoId), [sessaoId]);
  const { dados: resposta, carregando, erro, recarregar, setDados: setResposta } = useRecurso(buscarSegmentos, [sessaoId]);
  const segmentos = resposta?.itens ?? null;

  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);

  async function enviar() {
    const valor = texto.trim();
    if (!valor) return;
    setEnviando(true);
    setErroEnvio(null);
    try {
      const segmento = await registrarSegmentoManual(sessaoId, valor);
      setResposta((atual) => adicionarSegmento(atual, segmento));
      setTexto("");
    } catch (e) {
      if (ehCopilotoDesligado(e)) {
        setErroEnvio("O copiloto está desligado por configuração — este trecho não foi registrado.");
      } else {
        setErroEnvio(e instanceof ErroSessao ? e.message : "Não foi possível registrar o trecho. Tente de novo.");
      }
    } finally {
      setEnviando(false);
    }
  }

  // A leitura inicial de segmentos também pode bater no 409 (mesma trava,
  // caminho de leitura) — mesmo tratamento de estado, não de erro.
  if (!carregando && ehCopilotoDesligado(erro)) {
    return (
      <Quadro rotulo="O cliente disse">
        <p className="text-sm text-tinta-suave">O copiloto está desligado por configuração — nenhum trecho pode ser registrado agora.</p>
      </Quadro>
    );
  }

  // Achado do Fable (Fatia 5): campo escondido/desabilitado quando a
  // sessao ja encerrou -- nao e sumico mudo, e ESTADO EXPLICITO (mesma
  // regra de CopilotoDesligado/GateBloqueado). Sem isto, texto
  // digitado aqui depois do encerramento nunca entra em transcricoes
  // (re-encerrar e 409 sessao_ja_encerrada, nao reconsolida) e o
  // expurgo da Fatia 5 o apaga aos 7 dias -- a advogada acharia que
  // registrou algo que evapora em silencio. Esta tela e CONVENIENCIA
  // (impede o ERRO); a trava de verdade e do backend (409 no POST,
  // backstop no DELETE por criado_em <= encerrado_em).
  if (sessaoEncerrada) {
    return (
      <Quadro rotulo="O cliente disse">
        <p role="status" className="rounded-controle border border-dashed border-linha-forte px-3 py-2 text-sm text-tinta-suave">
          Sessão encerrada — transcrição consolidada, sem novos trechos.
        </p>
      </Quadro>
    );
  }

  return (
    <Quadro rotulo="O cliente disse" como="article">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void enviar();
          }}
        >
          <Campo rotulo="Trecho da fala" ajuda="Fica registrado como transcrição desta sessão — não é o prontuário jurídico.">
            <AreaTexto
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={2}
              placeholder="Ex.: o cliente disse que o filho mais velho não pôde vir hoje…"
            />
          </Campo>
          {erroEnvio && (
            <p role="alert" className="text-legenda text-[color:var(--vermelho)]">
              {erroEnvio}
            </p>
          )}
          <Botao type="submit" variante="primario" tamanho="compacto" carregando={enviando} disabled={!texto.trim()} className="self-start">
            Registrar trecho
          </Botao>
        </form>

        <div>
          {carregando && <EstadoCarregando rotulo="Carregando transcrição…" />}
          {!carregando && Boolean(erro) && (
            <p role="alert" className="flex flex-col items-start gap-1.5 text-legenda text-[color:var(--vermelho)]">
              Não foi possível carregar os trechos já registrados.
              <Botao variante="perigo" tamanho="compacto" onClick={recarregar}>
                Tentar de novo
              </Botao>
            </p>
          )}
          {!carregando && !erro && segmentos && segmentos.length === 0 && (
            <EstadoVazio compacto titulo="Nenhum trecho registrado ainda" descricao="O que for digitado ou colado acima aparece aqui, em ordem." />
          )}
          {!carregando && !erro && segmentos && segmentos.length > 0 && (
            // "Últimos primeiro" (pedido do Marcio): é ordem de EXIBIÇÃO, não
            // muda `segmentos` nem o cursor do `useRecurso` — `.slice()` antes
            // de `.reverse()` porque `reverse()` muda o array in-place.
            // B73: teto de altura + rolagem INTERNA — a transcrição de uma
            // sessão de 40min pode ter dezenas de trechos; é o quadro que
            // rola, nunca a página (pedido do Marcio: "não quero ficar
            // escrolando pra baixo... pra entender o dinamismo da sessão").
            // `role="region"`/`tabIndex` no `<div>` WRAPPER, não na `<ul>`
            // (mesma correção dos outros containers roláveis do arquivo:
            // colocar direto na lista sobrescreve o role nativo `list` e
            // deixa os `<li>` órfãos para o axe).
            <div tabIndex={TAB_INDEX_ROLAVEL} role="region" aria-label="Trechos já registrados" className="max-h-32 overflow-y-auto pr-1">
              <ul className="flex flex-col gap-2">
                {segmentos
                  .slice()
                  .reverse()
                  .map((segmento) => (
                    <li key={segmento.id} className="rounded-controle border border-linha px-3 py-2 text-sm text-tinta">
                      <p className="mb-0.5 flex flex-wrap items-baseline gap-x-2 text-legenda text-tinta-fraca">
                        <span>{formatarDataHora(segmento.criado_em)}</span>
                        {segmento.falante && <span className="font-medium uppercase">{segmento.falante}</span>}
                      </p>
                      <p>{segmento.texto}</p>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </Quadro>
  );
}
