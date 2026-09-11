"use client";

import { useCallback, useState } from "react";
import {
  ErroSessao,
  buscarEstadoCopiloto,
  listarSegmentosCopiloto,
  pedirSugestaoCopiloto,
  registrarDesfechoSugestaoCopiloto,
  registrarSegmentoManual,
} from "@/components/sessao/api";
import type { DesfechoCopiloto, RespostaSugestaoCopiloto, SegmentoCopiloto, SugestaoCopiloto, TipoObservacaoCopiloto } from "@/types/copiloto";
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
 * Copiloto ao vivo — Fatia 1 + Fatia 2 (docs/ARQUITETURA-FASE-10.md §8). A
 * Fatia 1 é o estado determinístico puro, ZERO IA: o que falta no bloco,
 * SIMs pendentes, blocos não percorridos — vem pronto de
 * `GET /api/sessoes/[id]/copiloto`, é o servidor quem deriva, não esta tela
 * (para a Fatia 3, polling automático, reusar o mesmo payload sem trocar de
 * contrato — §2.4/C9).
 *
 * A Fatia 2 acrescenta o botão **"Me ajuda agora"**: a IA só roda sob
 * demanda, nunca sozinha (B71 — "nada pisca, nada toca, nada abre
 * sozinho"). Contrato em `@/types/copiloto` (`RespostaSugestaoCopiloto`,
 * `SugestaoCopiloto`). `visivel:false` é SUCESSO com confiança insuficiente
 * — a tela mostra um aviso sóbrio, nunca a sugestão. Cada código de recusa
 * (`copiloto_ia_nao_ativada`, `teto_ia_copiloto_atingido`,
 * `timeout_copiloto`, `copiloto_ao_vivo_bloqueado`, `recusa_ia`,
 * `saida_invalida`, `conteudo_proibido`) tem mensagem própria — nunca um
 * "tente novamente" genérico. Implementado em `SugestaoIA`/
 * `ApresentacaoSugestao` mais abaixo.
 *
 * **Desfecho (§5 do plano).** "Ir para lá" grava `desfecho='aceita'`,
 * "Ignorar" grava `desfecho='ignorada'` via
 * `POST .../sugestoes/[sugestaoId]/desfecho` — é o dado que, daqui a 20
 * sessões, dirá se o copiloto acerta. A gravação é TELEMETRIA, não a ação:
 * dispara em paralelo (`registrarDesfechoSemBloquear`), nunca bloqueia a
 * navegação/dispensa, nunca mostra erro — inclusive `desfecho_ja_registrado`
 * (409, duplo clique) é silencioso por design. Ciclo automático e polling
 * continuam fora daqui — isso é Fatia 3.
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
export function PainelCopiloto({
  sessaoId,
  indiceAtual,
  blocosRoteiro,
  irPara,
}: {
  sessaoId: string;
  indiceAtual: number;
  /** `estado.roteiro.definicao.blocos` de `ConduzirSessaoApp.tsx`, na ordem —
   * é contra esta lista (não contra o payload do GET, que só traz os "não
   * percorridos") que o desvio sugerido resolve `bloco_id` em índice real
   * para navegar. Opcional: sem ela, a sugestão de desvio aparece só como
   * informação, sem o botão "Ir para lá". */
  blocosRoteiro?: { id: string }[];
  /** `ConduzirSessaoApp.tsx` — a mesma função que as setas do teclado chamam
   * (B70/§5 camada 3). Se ausente, o botão "Ir para" do desvio sugerido não
   * aparece — nunca navega sozinho e nunca falha silenciosamente. */
  irPara?: (indice: number) => void;
}) {
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

      <SugestaoIA sessaoId={sessaoId} indiceAtual={indiceAtual} blocosRoteiro={blocosRoteiro} irPara={irPara} />

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

/** Rótulo humano de cada código de recusa (§ contrato). Cada código tem causa
 * distinta — nunca um "tente novamente" genérico: `timeout_copiloto` convida
 * a tentar de novo, `teto_ia_copiloto_atingido` diz explicitamente que não
 * adianta insistir hoje, `copiloto_ia_nao_ativada` aponta para Admin. */
const MENSAGENS_RECUSA: Record<string, { titulo: string; descricao: string; podeTentarDeNovo: boolean }> = {
  copiloto_ia_nao_ativada: {
    titulo: "Copiloto de IA ainda não ativado",
    descricao: "O prompt do copiloto está desligado por configuração. A equipe técnica liga isso em Admin — a sessão segue normalmente pelo roteiro.",
    podeTentarDeNovo: false,
  },
  teto_ia_copiloto_atingido: {
    titulo: "Limite de sugestões de hoje atingido",
    descricao: "Esta sessão (ou o dia) já usou o orçamento de chamadas de IA do copiloto. Não adianta tentar de novo agora — o roteiro determinístico continua disponível.",
    podeTentarDeNovo: false,
  },
  timeout_copiloto: {
    titulo: "A sugestão não chegou a tempo",
    descricao: "A IA não respondeu em 8 segundos. Pode tentar de novo.",
    podeTentarDeNovo: true,
  },
  copiloto_ao_vivo_bloqueado: {
    titulo: "Copiloto ao vivo bloqueado",
    descricao: "Falta decisão jurídica ativa ou consentimento do titular para esta sessão. Não é algo que se resolve tentando de novo.",
    podeTentarDeNovo: false,
  },
  recusa_ia: {
    titulo: "A IA recusou responder desta vez",
    descricao: "Pode tentar de novo — às vezes é um caso isolado.",
    podeTentarDeNovo: true,
  },
  saida_invalida: {
    titulo: "A resposta da IA não pôde ser validada",
    descricao: "Pode tentar de novo.",
    podeTentarDeNovo: true,
  },
  conteudo_proibido: {
    titulo: "A sugestão foi descartada",
    descricao: "O conteúdo continha algo que o copiloto nunca deve mostrar (ex.: valor em reais). Nada foi exibido.",
    podeTentarDeNovo: false,
  },
};

function mensagemRecusa(erro: unknown): { titulo: string; descricao: string; podeTentarDeNovo: boolean } {
  if (erro instanceof ErroSessao && erro.codigo && MENSAGENS_RECUSA[erro.codigo]) {
    return MENSAGENS_RECUSA[erro.codigo];
  }
  return {
    titulo: "Não foi possível pedir a sugestão",
    descricao: erro instanceof ErroSessao ? erro.message : "Erro inesperado. Tente de novo em instantes.",
    podeTentarDeNovo: true,
  };
}

/**
 * O botão "Me ajuda agora" e a apresentação da sugestão (Fase 10, Fatia 2).
 * B71: nada pisca, nada toca, nada abre sozinho — a sugestão só existe na
 * tela depois do clique explícito da Dra. Elaine, e fica onde apareceu até
 * ela pedir outra ou trocar de bloco/sessão (não há timer nem auto-refresh).
 */
function SugestaoIA({
  sessaoId,
  indiceAtual,
  blocosRoteiro,
  irPara,
}: {
  sessaoId: string;
  indiceAtual: number;
  blocosRoteiro?: { id: string }[];
  irPara?: (indice: number) => void;
}) {
  const [pedindo, setPedindo] = useState(false);
  const [resposta, setResposta] = useState<RespostaSugestaoCopiloto | null>(null);
  const [erro, setErro] = useState<unknown>(null);

  async function pedir() {
    if (pedindo) return; // o botão não pode ser clicado duas vezes enquanto a IA responde
    setPedindo(true);
    setErro(null);
    try {
      const r = await pedirSugestaoCopiloto(sessaoId, indiceAtual);
      setResposta(r);
    } catch (e) {
      setResposta(null);
      setErro(e);
    } finally {
      setPedindo(false);
    }
  }

  return (
    <Cartao rotulo="Sugestão sob demanda" titulo="Me ajuda agora" preenchimento="compacto">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-tinta-suave">
          A IA só roda quando você pede. Ela lê o bloco atual, o briefing e o que foi dito — nunca aparece sozinha.
        </p>

        <Botao
          type="button"
          variante="primario"
          tamanho="compacto"
          carregando={pedindo}
          onClick={() => void pedir()}
          className="self-start"
          aria-describedby="copiloto-ia-nota"
        >
          Me ajuda agora
        </Botao>
        <span id="copiloto-ia-nota" className="sr-only">
          Pede à IA uma sugestão para o momento atual da sessão. Pode levar até 8 segundos.
        </span>

        {pedindo && (
          <p role="status" aria-live="polite" className="text-sm text-tinta-suave">
            Pensando… (até 8 segundos)
          </p>
        )}

        {!pedindo && erro !== null && (
          <MensagemRecusa erro={erro} aoTentarDeNovo={() => void pedir()} />
        )}

        {!pedindo && !erro && resposta && !resposta.visivel && (
          <p role="status" className="rounded-controle border border-dashed border-linha-forte px-3 py-2 text-sm text-tinta-suave">
            Sem sugestão confiável agora. A IA analisou, mas a confiança ficou abaixo do mínimo configurado — nada é
            mostrado para não guiar com um palpite fraco.
          </p>
        )}

        {!pedindo && !erro && resposta && resposta.visivel && resposta.sugestao && (
          <ApresentacaoSugestao
            sessaoId={sessaoId}
            sugestaoId={resposta.sugestao_id}
            sugestao={resposta.sugestao}
            blocosRoteiro={blocosRoteiro}
            irPara={irPara}
          />
        )}
      </div>
    </Cartao>
  );
}

function MensagemRecusa({ erro, aoTentarDeNovo }: { erro: unknown; aoTentarDeNovo: () => void }) {
  const { titulo, descricao, podeTentarDeNovo } = mensagemRecusa(erro);
  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-controle border border-[color:var(--vermelho)] bg-vermelho-fraco px-3.5 py-2.5 text-sm">
      <p className="font-bold text-[color:var(--vermelho)]">{titulo}</p>
      <p className="text-tinta">{descricao}</p>
      {podeTentarDeNovo && (
        <Botao variante="perigo" tamanho="compacto" onClick={aoTentarDeNovo}>
          Tentar de novo
        </Botao>
      )}
    </div>
  );
}

const ROTULO_TIPO: Record<TipoObservacaoCopiloto, string> = {
  fato: "Fato",
  hipotese: "Hipótese",
  inferencia: "Inferência",
  recomendacao: "Recomendação",
};

const TOM_TIPO: Record<TipoObservacaoCopiloto, "verde" | "azul" | "ambar" | "latao"> = {
  fato: "verde",
  hipotese: "azul",
  inferencia: "ambar",
  recomendacao: "latao",
};

/** Confiança sempre visível junto do que ela qualifica — nunca só o texto,
 * nunca só um número solto (regra da casa: tipo + confiança, sempre). */
function SeloConfianca({ confianca }: { confianca: number }) {
  return <Selo tom="neutro">confiança {Math.round(confianca * 100)}%</Selo>;
}

/** `evidencia` é citação literal do que o cliente disse — apresentada como
 * citação, visivelmente distinta da conclusão da IA. */
function Evidencia({ texto }: { texto: string }) {
  return (
    <blockquote className="border-l-2 border-linha-forte pl-2.5 text-sm italic text-tinta-suave">
      &ldquo;{texto}&rdquo;
    </blockquote>
  );
}

/**
 * Todo campo de `SugestaoCopiloto` pode vir nulo — nulo é nulo, some, nunca
 * vira texto plausível. Cada bloco abaixo só renderiza se o dado existir.
 */
function ApresentacaoSugestao({
  sessaoId,
  sugestaoId,
  sugestao,
  blocosRoteiro,
  irPara,
}: {
  sessaoId: string;
  /** `resposta.sugestao_id` — nível de `RespostaSugestaoCopiloto`, não de
   * `SugestaoCopiloto`. É o vínculo para `POST .../[sugestaoId]/desfecho`. */
  sugestaoId: string;
  sugestao: SugestaoCopiloto;
  blocosRoteiro?: { id: string }[];
  irPara?: (indice: number) => void;
}) {
  const nada =
    !sugestao.proxima_pergunta &&
    sugestao.falta_no_bloco.length === 0 &&
    !sugestao.observacao &&
    !sugestao.desvio_sugerido;

  if (nada) {
    return (
      <p className="rounded-controle border border-dashed border-linha-forte px-3 py-2 text-sm text-tinta-suave">
        A IA respondeu, mas não teve nada específico a apontar agora.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-t border-linha pt-3">
      {sugestao.proxima_pergunta && (
        <div className="flex flex-col gap-1">
          <p className="text-rotulo font-medium uppercase text-tinta-fraca">Próxima pergunta</p>
          <p className="text-sm font-medium text-tinta">{sugestao.proxima_pergunta.texto}</p>
          <p className="text-legenda text-tinta-suave">{sugestao.proxima_pergunta.motivo}</p>
          {sugestao.proxima_pergunta.evidencia && <Evidencia texto={sugestao.proxima_pergunta.evidencia} />}
        </div>
      )}

      {sugestao.falta_no_bloco.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-rotulo font-medium uppercase text-tinta-fraca">A IA notou que falta</p>
          <ul className="flex flex-col gap-1.5">
            {sugestao.falta_no_bloco.map((item, i) => (
              <li key={i} className="flex flex-col gap-0.5 text-sm text-tinta">
                <span>{item.item}</span>
                {item.evidencia && <Evidencia texto={item.evidencia} />}
              </li>
            ))}
          </ul>
        </div>
      )}

      {sugestao.observacao && (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Selo tom={TOM_TIPO[sugestao.observacao.tipo]}>{ROTULO_TIPO[sugestao.observacao.tipo]}</Selo>
            <SeloConfianca confianca={sugestao.observacao.confianca} />
          </div>
          <p className="text-sm text-tinta">{sugestao.observacao.texto}</p>
          {sugestao.observacao.evidencia && <Evidencia texto={sugestao.observacao.evidencia} />}
        </div>
      )}

      {sugestao.desvio_sugerido && (
        <DesvioSugerido
          sessaoId={sessaoId}
          sugestaoId={sugestaoId}
          desvio={sugestao.desvio_sugerido}
          blocosRoteiro={blocosRoteiro}
          irPara={irPara}
        />
      )}
    </div>
  );
}

/** Dispara o registro do desfecho como telemetria pura: nunca bloqueia a UI,
 * nunca mostra erro. `desfecho_ja_registrado` (409) é caso normal (duplo
 * clique) e cai no mesmo `catch` silencioso — a advogada não pode ser punida
 * por uma métrica que não gravou, ela está em reunião com um cliente. */
function registrarDesfechoSemBloquear(sessaoId: string, sugestaoId: string, desfecho: DesfechoCopiloto) {
  void registrarDesfechoSugestaoCopiloto(sessaoId, sugestaoId, desfecho).catch(() => {
    /* telemetria — falha aqui nunca aparece na tela nem impede a ação já tomada */
  });
}

/**
 * `desvio_sugerido` é sugestão com botão, nunca ação executada (B70/B71). Se
 * a advogada clicar, quem navega é `irPara()` — a mesma função das setas do
 * teclado em `ConduzirSessaoApp.tsx`. "Ignorar" sempre ao lado. Cada clique
 * também grava o desfecho (§5 do plano) — telemetria disparada em paralelo,
 * nunca atrasando nem condicionando a navegação/dispensa.
 */
function DesvioSugerido({
  sessaoId,
  sugestaoId,
  desvio,
  blocosRoteiro,
  irPara,
}: {
  sessaoId: string;
  sugestaoId: string;
  desvio: NonNullable<SugestaoCopiloto["desvio_sugerido"]>;
  blocosRoteiro?: { id: string }[];
  irPara?: (indice: number) => void;
}) {
  const [ignorado, setIgnorado] = useState(false);
  if (ignorado) return null;

  // O servidor já confere `bloco_id` contra o roteiro ativo antes de devolver
  // a sugestão — mas a navegação em si só acontece se a tela também conseguir
  // resolver o índice, contra a lista real do roteiro carregado aqui. Sem
  // isso, o botão "Ir para lá" nunca aparece — a sugestão continua visível
  // como informação, nunca navega com um índice inventado.
  const indiceAlvo = blocosRoteiro?.findIndex((b) => b.id === desvio.bloco_id) ?? -1;
  const podeNavegar = irPara && indiceAlvo >= 0;

  return (
    <div className="flex flex-col gap-1.5 rounded-controle border border-linha bg-papel px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Selo tom="latao">Sugestão de desvio</Selo>
        <SeloConfianca confianca={desvio.confianca} />
      </div>
      <p className="text-sm text-tinta">{desvio.motivo}</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {podeNavegar && (
          <Botao
            variante="secundario"
            tamanho="compacto"
            onClick={() => {
              irPara(indiceAlvo);
              setIgnorado(true);
              registrarDesfechoSemBloquear(sessaoId, sugestaoId, "aceita");
            }}
          >
            Ir para lá
          </Botao>
        )}
        <Botao
          variante="fantasma"
          tamanho="compacto"
          onClick={() => {
            setIgnorado(true);
            registrarDesfechoSemBloquear(sessaoId, sugestaoId, "ignorada");
          }}
        >
          Ignorar
        </Botao>
      </div>
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
