"use client";

import { useCallback, useState } from "react";
import {
  ErroSessao,
  buscarEstadoCopiloto,
  listarSegmentosCopiloto,
  registrarSegmentoManual,
} from "@/components/sessao/api";
import type { SegmentoCopiloto } from "@/types/copiloto";
import { useRecurso } from "@/hooks/useRecurso";
import { Cartao } from "@/components/ui/Cartao";
import { Selo } from "@/components/ui/Selo";
import { Botao } from "@/components/ui/Botao";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Campo, AreaTexto } from "@/components/ui/Campo";
import { formatarDataHora } from "@/lib/formatar";

/** `codigo` que as 3 rotas do copiloto devolvem em HTTP 409 quando
 * `copiloto_sessao.ativo=false` — fail-closed por AUSÊNCIA (chave ausente,
 * falha de leitura ou valor de outro tipo caem sempre em `false`, mesmo
 * padrão de `lerConfigAgente` da Fase 9). Por isso este estado NÃO é borda
 * rara: aparece em qualquer ambiente onde a migration 0091/config não
 * rodou — inclusive em desenvolvimento — e é tratado como estado normal da
 * tela, nunca como exceção. Testar só por `codigo`, nunca por `status`
 * sozinho (409 é usado para outras coisas na casa) nem pela string da
 * mensagem (muda). */
const CODIGO_COPILOTO_DESLIGADO = "copiloto_desligado";

function ehCopilotoDesligado(erro: unknown): erro is ErroSessao {
  return erro instanceof ErroSessao && erro.codigo === CODIGO_COPILOTO_DESLIGADO;
}

/**
 * Copiloto ao vivo — Fatia 1 (docs/ARQUITETURA-FASE-10.md §8): modo
 * determinístico puro, ZERO IA. O estado (o que falta no bloco, SIMs
 * pendentes, blocos não percorridos) vem pronto de
 * `GET /api/sessoes/[id]/copiloto` — é o servidor quem deriva, não esta
 * tela, para a Fatia 3 (polling automático) reusar o mesmo payload sem
 * trocar de contrato (§2.4/C9). Nenhuma sugestão de IA aparece aqui — isso é
 * Fatia 2, e nem o botão "Me ajuda agora" existe ainda.
 *
 * C10: este painel só existe dentro da aba "Copiloto" da coluna direita —
 * quem monta as abas é `ConduzirSessaoApp.tsx`, com Briefing como default.
 * A aba **continua montada** mesmo com o copiloto desligado (decisão do
 * veredito do Fable): esconder a aba inteira deixaria a Dra. Elaine sem
 * saber se o recurso não existe ou está desligado por configuração.
 *
 * C12: o roteiro ativo (v4) nunca foi carimbado como oficial pela Dra. Elaine
 * (B15). O aviso do cabeçalho da sessão já diz isso — aqui ele é repetido,
 * sóbrio, porque quem só abre a aba Copiloto pode não ter visto o cabeçalho.
 *
 * **Kill-switch (`copiloto_sessao.ativo=false`).** É estado, não falha: cai
 * no `EstadoVazio` explicando o desligamento, nunca no `EstadoErro` com
 * "tentar de novo" — repetir a chamada não muda nada enquanto a chave
 * continuar `false`, e convidar a advogada a insistir numa ação que nunca
 * funciona é o oposto de guiar.
 */
export function PainelCopiloto({ sessaoId, indiceAtual }: { sessaoId: string; indiceAtual: number }) {
  const buscarEstado = useCallback(() => buscarEstadoCopiloto(sessaoId, indiceAtual), [sessaoId, indiceAtual]);
  const { dados: estado, carregando, erro, recarregar } = useRecurso(buscarEstado, [sessaoId, indiceAtual]);

  if (carregando && !estado) return <EstadoCarregando rotulo="Carregando o copiloto…" />;

  if (erro) {
    if (ehCopilotoDesligado(erro)) return <CopilotoDesligado />;
    return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar o copiloto" />;
  }

  if (!estado) return null;

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-controle border border-dashed border-linha-forte px-3 py-2 text-legenda text-tinta-fraca">
        Nenhuma das 4 versões do roteiro foi carimbada como oficial pela Dra. Elaine (ver aviso no topo da sessão) — o
        copiloto aponta com base na versão ativa hoje, não numa versão definitiva.
      </p>

      {!estado.bloco_atual_id ? (
        <EstadoVazio compacto titulo="Sem roteiro ativo" descricao="Não há bloco atual para mostrar o que falta." />
      ) : (
        <FaltaNoBloco falta={estado.falta_no_bloco} />
      )}

      <SimsPendentes pendentes={estado.sims_pendentes} />
      <BlocosNaoPercorridos blocos={estado.blocos_nao_percorridos} />

      <RegistroManual sessaoId={sessaoId} />
    </div>
  );
}

/** Estado desligado por configuração — texto sóbrio, sem alarme, dizendo o
 * que é e quem liga. Mesmo padrão visual de `ConduzirSessaoApp` em
 * `sem-roteiro` (EstadoVazio com título + descrição, sem ação clicável aqui
 * porque ligar o copiloto é Admin → Parâmetros, fora do alcance desta tela). */
function CopilotoDesligado() {
  return (
    <EstadoVazio
      ilustracao="pasta"
      titulo="Copiloto desligado"
      descricao="O copiloto ao vivo está desligado por configuração (copiloto_sessao.ativo = false em Admin). A sessão segue normalmente pelo roteiro — ninguém precisa dele ligado para conduzir. Quem liga é a equipe técnica, em Admin."
    />
  );
}

function FaltaNoBloco({ falta }: { falta: { campos: { id: string; rotulo: string }[]; observar: string[] } }) {
  const semCampos = falta.campos.length === 0;
  const semObservar = falta.observar.length === 0;

  return (
    <Cartao rotulo="Neste bloco" titulo="O que falta" preenchimento="compacto">
      {semCampos && semObservar ? (
        <p className="text-sm text-tinta-suave">Este bloco não tem campo nem ponto de observação cadastrado no roteiro.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {falta.campos.length > 0 && (
            <div>
              <p className="mb-1 text-rotulo font-medium uppercase text-tinta-fraca">A preencher</p>
              <ul className="flex flex-col gap-1">
                {falta.campos.map((campo) => (
                  <li key={campo.id} className="flex items-start gap-1.5 text-sm text-tinta">
                    <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-3.5 w-3.5 shrink-0 fill-current text-[color:var(--ambar)]">
                      <circle cx="10" cy="10" r="4" />
                    </svg>
                    {campo.rotulo}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {falta.observar.length > 0 && (
            <div>
              <p className="mb-1 text-rotulo font-medium uppercase text-tinta-fraca">Observar</p>
              <ul className="flex flex-col gap-1">
                {falta.observar.map((item, i) => (
                  <li key={i} className="text-sm text-tinta-suave">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Cartao>
  );
}

function SimsPendentes({ pendentes }: { pendentes: { sim: string; rotulo: string }[] }) {
  const registrados = 4 - pendentes.length;
  return (
    <Cartao rotulo="Os 4 SIMs" titulo="SIMs pendentes" preenchimento="compacto" acao={<Selo tom={pendentes.length === 0 ? "verde" : "neutro"}>{registrados} de 4</Selo>}>
      {pendentes.length === 0 ? (
        <p className="text-sm text-tinta-suave">Os 4 SIMs já foram registrados.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {pendentes.map((p) => (
            <li key={p.sim} className="text-sm text-tinta">
              {p.rotulo}
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}

function BlocosNaoPercorridos({ blocos }: { blocos: { id: string; titulo: string }[] }) {
  return (
    <Cartao rotulo="Roteiro" titulo="Blocos ainda não percorridos" preenchimento="compacto" acao={<Selo tom="neutro">{blocos.length}</Selo>}>
      {blocos.length === 0 ? (
        <p className="text-sm text-tinta-suave">Este é o último bloco do roteiro.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {blocos.map((bloco) => (
            <li key={bloco.id} className="text-sm text-tinta-suave">
              {bloco.titulo}
            </li>
          ))}
        </ol>
      )}
    </Cartao>
  );
}

function RegistroManual({ sessaoId }: { sessaoId: string }) {
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
      <Cartao rotulo="Transcrição desta sessão" titulo="Digitar ou colar um trecho" preenchimento="compacto">
        <p className="text-sm text-tinta-suave">O copiloto está desligado por configuração — nenhum trecho pode ser registrado agora.</p>
      </Cartao>
    );
  }

  return (
    <Cartao rotulo="Transcrição desta sessão" titulo="Digitar ou colar um trecho" preenchimento="compacto">
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
            rows={3}
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

      <div className="mt-3 border-t border-linha pt-3">
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
          <ul className="flex flex-col gap-2">
            {segmentos.map((segmento) => (
              <li key={segmento.id} className="rounded-controle border border-linha bg-papel px-3 py-2 text-sm text-tinta">
                <p className="mb-0.5 text-legenda text-tinta-fraca">{formatarDataHora(segmento.criado_em)}</p>
                <p>{segmento.texto}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Cartao>
  );
}

/** Acrescenta o segmento recém-criado à resposta cacheada por `useRecurso`,
 * sem esperar a próxima leitura — mesma técnica de `setDados` usada por
 * `PainelSims`/`PainelBriefingSessao` (estado de servidor, não duplicado). */
function adicionarSegmento(
  atual: { itens: SegmentoCopiloto[]; proximo_cursor: number } | undefined,
  novo: SegmentoCopiloto,
): { itens: SegmentoCopiloto[]; proximo_cursor: number } {
  const itens = [...(atual?.itens ?? []), novo];
  return { itens, proximo_cursor: novo.ordem };
}
