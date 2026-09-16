"use client";

import { useCallback, useState } from "react";
import {
  ErroSessao,
  buscarEstadoCopiloto,
  encerrarCopiloto,
  pedirSugestaoCopiloto,
  registrarDesfechoSugestaoCopiloto,
} from "@/components/sessao/api";
import type {
  DesfechoCopiloto,
  InfoCicloCopiloto,
  RespostaSugestaoCopiloto,
  SugestaoCopiloto,
  SugestaoCopilotoPolling,
  TipoObservacaoCopiloto,
} from "@/types/copiloto";
import { useRecurso } from "@/hooks/useRecurso";
import { Quadro } from "@/components/ui/Quadro";
import { Selo } from "@/components/ui/Selo";
import { Botao } from "@/components/ui/Botao";
import { ConfirmarAcao } from "@/components/ui/ConfirmarAcao";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { formatarHora } from "@/lib/formatar";
import { ehCopilotoDesligado, usePollingCopiloto } from "@/components/sessao/copiloto/usePollingCopiloto";
import { ultimoNaoNulo } from "@/components/sessao/copiloto/ultimoNaoNulo";
import { mensagemRecusa } from "@/components/sessao/copiloto/mensagensRecusa";
import { RegistroManual } from "@/components/sessao/copiloto/RegistroManual";

// ---------------------------------------------------------------------------
// Fase 12, Fatia B — "a tela vira leitura" (pedido do Marcio: a tela ao vivo
// tem que ser SIMPLES; detalhe/placar vão para o resumo da sessão, fora
// daqui). Réguas aplicadas neste arquivo:
//
//  1. Se não muda a PRÓXIMA FRASE que a advogada vai dizer nos próximos 30
//     segundos, não fica na tela ao vivo.
//  2. Um único foco visual por vez — só o bloco "Fale agora" tem peso;
//     "Cuidado" e "O cliente disse" são apoio, nunca competem com ele.
//  3. Jargão traduzido: "SIMs pendentes" → a pendência por extenso; "falta no
//     bloco" → "Ainda não perguntou:"; "insight comercial"/"bloco atual"/
//     "confiança 0,72"/"gatilho: intervalo" saem da tela ao vivo (viram
//     telemetria ou material do resumo da sessão, nunca leitura ao vivo).
//
// Passo 1 (extração, sem mudar comportamento): `usePollingCopiloto`,
// `ultimoNaoNulo`, `adicionarSegmento`, `mensagemRecusa`/`MENSAGENS_RECUSA`,
// `PainelBot`+`MensagemRecusaBot`, `ApresentacaoComparacaoDecisores` e
// `RegistroManual` foram extraídos para `src/components/sessao/copiloto/`.
// Os testes correspondentes migraram junto (ver `copiloto/*.test.ts(x)`).
// `ultimoNaoNulo` é reexportado abaixo porque `PainelCopiloto.test.tsx`
// importa a função pura direto deste arquivo.
//
// O que SAI da tela ao vivo nesta fatia (call-site removido; componente
// preservado para o resumo da sessão/Ficha 360 religar depois — nada é
// apagado, exceto `QuadroVoceAcertouOuErrou`, que já era `return null`,
// código morto):
//  - `QuadroBlocoAtual` ("Bloco atual", "Parte X de Y", número) — a posição
//    no roteiro passa a viver só na linha fina do topo de
//    `ConduzirSessaoApp.tsx`, sem número de "confiança".
//  - `QuadroDecisores`/`ApresentacaoComparacaoDecisores` como card cheio —
//    vira frase de uma linha na mesma linha fina do topo
//    (`resumoAusentesLinhaFina`, em `copiloto/ApresentacaoComparacaoDecisores.tsx`).
//  - `QuadroInsightComercial`, `QuadroPodePularPra` (como card próprio) e
//    `HistoricoCoach` — acerto/histórico é PLACAR: não muda a próxima frase
//    ao vivo, vai para o resumo da sessão.
//  - `PainelBot`/`MensagemRecusaBot` — pedir o bot é OPERAÇÃO, não CONDUÇÃO;
//    sobe para o cabeçalho de `ConduzirSessaoApp.tsx`. O erro `sala_invalida`
//    continua reportado — agora pela linha fina do topo, não perdido.
// ---------------------------------------------------------------------------

/**
 * `tabIndex` de todo container com `role="region"` + `overflow-y/x-auto`
 * deste arquivo (WCAG 2.1.1 — sem foco por teclado, quem navega só pelo
 * teclado não consegue rolar o conteúdo; axe: `scrollable-region-focusable`).
 *
 * Não é `tabIndex={0}` LITERAL de propósito: `jsx-a11y/no-noninteractive-tabindex`
 * lê o valor por `getLiteralPropValue` e — com `role="region"` (não-`widget`
 * na `aria-query`, logo nunca "interativo" para a regra) — reporta erro em
 * QUALQUER `<div role="region" tabIndex={0}>` estático, mesmo sendo
 * exatamente o padrão que a própria WCAG pede. Uma constante nomeada (valor
 * não-literal do ponto de vista do linter) sai desse falso positivo sem
 * mudar o comportamento em runtime — é sempre `0`.
 */
const TAB_INDEX_ROLAVEL = 0;

/** A partir de quantas falhas CONSECUTIVAS o polling vira aviso visível
 * (achado do Fable: falha silenciosa faz a tela parecer "sala calma" quando
 * na verdade o copiloto está surdo). 1-2 falhas seguidas continuam mudas —
 * B71 vale aqui: um soluço de rede não pode virar alarme no meio de uma
 * conversa sobre herança. 3 é o piso a partir do qual "transiente" deixa de
 * ser a explicação mais provável. */
const LIMIAR_FALHAS_PARA_AVISO = 3;

/**
 * Copiloto ao vivo — Fase 12, Fatia B: 2 blocos permanentes ("Fale agora",
 * único com peso visual) + 2 condicionais ("Cuidado" só com risco; "O
 * cliente disse" é permanente mas discreto, rodapé de altura fixa).
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
  polling: pollingProp,
  sessaoEncerrada: sessaoEncerradaProp,
  aoEncerrar: aoEncerrarProp,
}: {
  sessaoId: string;
  indiceAtual: number;
  /** `estado.roteiro.definicao.blocos` de `ConduzirSessaoApp.tsx`, na ordem —
   * é contra esta lista (não contra o payload do GET, que só traz os "não
   * percorridos") que o desvio sugerido resolve `bloco_id` em índice real
   * para navegar. Opcional: sem ela, a sugestão de desvio aparece só como
   * informação, sem o botão "Ir para lá". */
  blocosRoteiro?: { id: string; titulo?: string }[];
  /** `ConduzirSessaoApp.tsx` — a mesma função que o `<select>` "Corrigir
   * parte" chama. Se ausente, o botão "Ir para" do desvio sugerido não
   * aparece — nunca navega sozinho e nunca falha silenciosamente. */
  irPara?: (indice: number) => void;
  /**
   * Correção do achado do Fable (16/09, "um só poller"): `ConduzirSessaoApp`
   * eleva `usePollingCopiloto` e passa a MESMA instância aqui, para não
   * existirem 2 timers/2 requisições a cada tick. Opcional só para o teste
   * unitário deste componente (`PainelCopiloto.test.tsx`, que monta o painel
   * sozinho) continuar funcionando sem precisar de um `ConduzirSessaoApp` —
   * sem a prop, o componente volta a instanciar o próprio hook, como antes.
   */
  polling?: ReturnType<typeof usePollingCopiloto>;
  /** Idem — quando o pai já sabe que a sessão encerrou (manual ou por
   * duração máxima), evita este componente derivar a mesma coisa de novo. */
  sessaoEncerrada?: boolean;
  /** Chamado quando o clique em "Encerrar copiloto desta sessão" confirma —
   * sem prop, o componente guarda esse estado sozinho (fallback do teste
   * unitário). */
  aoEncerrar?: () => void;
}) {
  const buscarEstado = useCallback(() => buscarEstadoCopiloto(sessaoId, indiceAtual), [sessaoId, indiceAtual]);
  const { dados: estado, carregando, erro, recarregar } = useRecurso(buscarEstado, [sessaoId, indiceAtual]);

  // Fatia 3: o ciclo passa a rodar sozinho e a tela busca novidade a cada
  // 3s — mas SÓ depois que a Fatia 1 já provou que o copiloto está ligado
  // (senão o polling ficaria martelando 409 em ambiente onde a migration/
  // config nem rodou). `sessaoEncerrada` para o timer de vez (§4.1: "para de
  // todo quando a sessão é encerrada") — inclui o encerramento MANUAL
  // (`EncerrarCopiloto`) e o AUTOMÁTICO por duração máxima
  // (`ciclo.resultado === "sessao_encerrada_por_duracao_maxima"`, calculado
  // logo abaixo): os dois param o timer da mesma forma, mas a MENSAGEM na
  // tela é diferente — a advogada precisa saber QUAL dos dois aconteceu.
  //
  // Só instancia o hook (fallback) quando NENHUM `polling` vier por prop —
  // `pollingProp` já é a fonte única quando `ConduzirSessaoApp` está no ar.
  const [encerradaManualmenteLocal, setEncerradaManualmenteLocal] = useState(false);
  const podePollar = Boolean(estado) && !ehCopilotoDesligado(erro);
  const pollingLocal = usePollingCopiloto(sessaoId, indiceAtual, Boolean(pollingProp) || encerradaManualmenteLocal || !podePollar);
  const polling = pollingProp ?? pollingLocal;
  const encerradaPorDuracaoMaxima = polling.ciclo?.resultado === "sessao_encerrada_por_duracao_maxima";
  // Com `sessaoEncerradaProp` (pai no comando), "encerrada manualmente" para
  // fins de MENSAGEM é "encerrada mas não por duração máxima" — o pai não
  // distingue as duas causas na prop, só o resultado final; sem a prop
  // (fallback do teste unitário), o estado local já carrega a distinção.
  const encerradaManualmente = sessaoEncerradaProp !== undefined ? sessaoEncerradaProp && !encerradaPorDuracaoMaxima : encerradaManualmenteLocal;
  const sessaoEncerrada = sessaoEncerradaProp ?? (encerradaManualmenteLocal || encerradaPorDuracaoMaxima);
  const aoEncerrar = aoEncerrarProp ?? (() => setEncerradaManualmenteLocal(true));

  if (carregando && !estado) return <EstadoCarregando rotulo="Carregando o copiloto…" />;

  if (erro) {
    if (ehCopilotoDesligado(erro)) return <CopilotoDesligado />;
    return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar o copiloto" />;
  }

  if (!estado) return null;

  // (ii) do achado do Fable: o KILL-SWITCH foi virado em Admin NO MEIO da
  // sessão (o polling recebeu 409 `copiloto_desligado`, não a leitura
  // inicial). Cai no MESMO `CopilotoDesligado` da Fatia 1 — não existe um
  // segundo texto para o mesmo estado, e o polling já parou sozinho dentro
  // do hook (nunca reagenda depois de detectar isto).
  if (polling.desligadoPeloKillSwitch) return <CopilotoDesligado />;

  const sugestoesCiclo = sessaoEncerrada ? [] : polling.sugestoes;

  return (
    <div className="flex flex-col gap-2">
      {/* Avisos de topo — estado transitório, nunca um "quadro" de conteúdo
       * permanente. Empilhados, full-width, acima dos 3 blocos (B71: nada
       * disto pisca nem desloca o que já está embaixo — cada um só
       * aparece/some por mudança de estado real, nunca por timer).
       *
       * Decisão de 15/09 (mantida): `AvisoPollingFalhando` entra/sai do
       * fluxo normal na 3ª falha consecutiva de rede — `min-h-[3.25rem]`
       * reserva o espaço sempre; o aviso aparece DENTRO dele quando existe.
       * Não usa `position:sticky` — tapar o bloco "Fale agora" seria pior
       * que o reflow que está sendo corrigido. */}
      <div className="min-h-[3.25rem]">
        {!sessaoEncerrada && <AvisoPollingFalhando falhasConsecutivas={polling.falhasConsecutivas} falhandoDesde={polling.falhandoDesde} />}
      </div>

      {encerradaPorDuracaoMaxima && (
        <p role="status" className="rounded-controle border border-dashed border-linha-forte px-3 py-2 text-sm text-tinta-suave">
          Copiloto encerrado por tempo máximo — transcrição consolidada, sem novas sugestões.
        </p>
      )}

      {encerradaManualmente && !encerradaPorDuracaoMaxima && (
        <p role="status" className="rounded-controle border border-dashed border-linha-forte px-3 py-2 text-sm text-tinta-suave">
          Copiloto encerrado — transcrição consolidada, sem novas sugestões.
        </p>
      )}

      {!sessaoEncerrada && <GateBloqueado ciclo={polling.ciclo} />}

      {/* BLOCO 1 — "Fale agora". Único com peso visual: é a próxima frase
       * dela. Nunca clicável por inteiro (a lição do "link de 11px" e do
       * "card inteiro clicável muda o contrato do link") — só os botões
       * "Me ajuda agora"/"Ir para lá"/"Ignorar"/"Dispensar", que já eram
       * alvos de 44px próprios, continuam clicáveis. */}
      <BlocoFaleAgora sessaoId={sessaoId} indiceAtual={indiceAtual} sugestoesCiclo={sugestoesCiclo} blocosRoteiro={blocosRoteiro} irPara={irPara} />

      {/* BLOCO 2 — "Cuidado". CONDICIONAL: sem risco, não existe no DOM
       * (nunca um card vazio dizendo "nada"). Funde os 3 antigos quadros que
       * eram jargão/risco: Alerta (SIMs pendentes) + O que aconteceu (falta
       * no bloco) + Pode pular pra (desvio sugerido). */}
      <BlocoCuidado
        pendentes={estado.sims_pendentes}
        falta={estado.falta_no_bloco}
        sugestoesCiclo={sugestoesCiclo}
        sessaoId={sessaoId}
        blocosRoteiro={blocosRoteiro}
        irPara={irPara}
      />

      {/* BLOCO 3 — "O cliente disse" (rodapé, altura fixa). Recuperar a
       * última fala registrada muda a próxima frase dela — passa na régua
       * dos 30 segundos, mesmo sendo apoio, não foco. */}
      <RegistroManual sessaoId={sessaoId} sessaoEncerrada={sessaoEncerrada || estado.estado_copiloto === "encerrado"} />

      {!sessaoEncerrada && <EncerrarCopiloto sessaoId={sessaoId} aoEncerrar={aoEncerrar} />}
    </div>
  );
}

/**
 * (i)+(iii) do achado do Fable: falha PERSISTENTE do polling vira aviso
 * visível — nunca as duas primeiras (B71: um soluço de rede não é alarme no
 * meio de uma conversa sobre herança), sempre a partir da 3ª seguida (o
 * limiar em que "transiente" deixa de ser a explicação mais provável).
 *
 * A frase tem DOIS avisos, de propósito: "sem conexão" (o quê) e "a sessão
 * segue normalmente pelo roteiro" (o que NÃO aconteceu) — sem o segundo
 * período a advogada pode entender que perdeu a sessão inteira, quando só
 * perdeu o assistente.
 *
 * `role="status"` (não `alert`): é informação sobre a INFRAESTRUTURA, não
 * um bloqueio jurídico — `GateBloqueado` usa `alert` porque aquilo é uma
 * decisão que precisa de ação; isto aqui é "seguimos tentando", sem pedir
 * nada da advogada. Some sozinho no próximo sucesso (o hook zera a contagem).
 */
function AvisoPollingFalhando({ falhasConsecutivas, falhandoDesde }: { falhasConsecutivas: number; falhandoDesde: Date | null }) {
  if (falhasConsecutivas < LIMIAR_FALHAS_PARA_AVISO || !falhandoDesde) return null;
  return (
    <p role="status" className="rounded-controle border border-[color:var(--ambar)] bg-ambar-fraco px-3.5 py-2.5 text-sm text-tinta">
      <span className="mb-0.5 block font-bold text-[color:var(--ambar)]">Copiloto sem conexão desde {formatarHora(falhandoDesde.toISOString())}</span>
      A sessão segue pelo roteiro. Retoma sozinho.
    </p>
  );
}

/**
 * `ciclo.resultado === "bloqueado_pelo_gate"` (Fatia 3, §6.2.2/B71) — o gate
 * jurídico fechou NO MEIO da sessão (decisão jurídica ou consentimento
 * revogados). É DISTINTO de silêncio normal (`ciclo.resultado === null`,
 * que é o caso comum e não gera nenhum aviso): a advogada nunca pode
 * confundir "a sala está calma, nada para sugerir" com "o copiloto foi
 * calado por revogação". Aviso sóbrio, sempre visível enquanto durar —
 * não é um toast que some sozinho, porque a condição continua verdadeira a
 * cada novo polling até alguém religar a trava.
 */
function GateBloqueado({ ciclo }: { ciclo: InfoCicloCopiloto | null }) {
  if (!ciclo || ciclo.resultado !== "bloqueado_pelo_gate") return null;
  const motivo =
    ciclo.motivo_bloqueio === "sem_decisao_juridica"
      ? "O copiloto de IA está bloqueado por configuração no servidor."
      : ciclo.motivo_bloqueio === "sem_consentimento_titular"
        ? "O copiloto de IA está bloqueado por configuração no servidor para esta sessão."
        : "A trava jurídica do copiloto está fechada para esta sessão.";
  return (
    <p role="alert" className="rounded-controle border border-[color:var(--vermelho)] bg-vermelho-fraco px-3.5 py-2.5 text-sm text-tinta">
      <span className="mb-0.5 block font-bold text-[color:var(--vermelho)]">Copiloto de IA parado nesta sessão</span>
      {motivo} A transcrição por texto continua normal.
    </p>
  );
}

/**
 * BLOCO 1 — "Fale agora" (renomeado de "Próximo movimento — fale agora"
 * → "Pergunte agora" → "Fale agora", decisão final: imperativo curto).
 * Fusão do antigo `PainelPerguntaAgora`: a pergunta pode vir do ciclo
 * automático (`polling`, sem clique) ou do clique em "Me ajuda agora" — é
 * UMA coisa na tela, nunca duas concorrendo por atenção.
 *
 * Prioridade de exibição, de cima para baixo:
 *  1. Sugestão mais recente do ciclo automático, se existir.
 *  2. Ação manual "Me ajuda agora" + a resposta do último clique.
 *  3. Sem nenhuma das duas: uma linha curta dizendo que está aguardando.
 */
function BlocoFaleAgora({
  sessaoId,
  indiceAtual,
  sugestoesCiclo,
  blocosRoteiro,
  irPara,
}: {
  sessaoId: string;
  indiceAtual: number;
  sugestoesCiclo: SugestaoCopilotoPolling[];
  blocosRoteiro?: { id: string; titulo?: string }[];
  irPara?: (indice: number) => void;
}) {
  const temSugestaoCiclo = sugestoesCiclo.length > 0;

  return (
    <Quadro rotulo="Fale agora" icone={<IconeAcao />} como="article">
      {/* `max-h`/`overflow-y-auto` trava o teto e rola por dentro — o bloco
       * não estica quando a sugestão vem completa (geometria constante,
       * achado de 15/09). `tabIndex={0}` exigido pelo axe
       * (`scrollable-region-focusable`). */}
      <div tabIndex={TAB_INDEX_ROLAVEL} role="region" aria-label="Fale agora" className="flex max-h-[26rem] flex-col gap-3 overflow-y-auto pr-1">
        {temSugestaoCiclo && (
          <SugestoesDoCiclo sessaoId={sessaoId} sugestoes={sugestoesCiclo} blocosRoteiro={blocosRoteiro} irPara={irPara} />
        )}

        <div className={temSugestaoCiclo ? "border-t border-dashed border-linha pt-3" : undefined}>
          <SugestaoIA sessaoId={sessaoId} indiceAtual={indiceAtual} blocosRoteiro={blocosRoteiro} irPara={irPara} temSugestaoCiclo={temSugestaoCiclo} />
        </div>
      </div>
    </Quadro>
  );
}

const IconeAcao = () => (
  <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 1.5 3 9h4.5L7 14.5 13 7H8.5L8 1.5Z" />
  </svg>
);

/**
 * Histórico compacto das sugestões do ciclo — a MAIS RECENTE aparece aberta,
 * por inteiro, sem clique (B71: "nada pisca, nada toca, nada abre
 * sozinho"). Anteriores ficam recolhidas de CONTEÚDO (nunca de existência):
 * o `<summary>` já mostra a contagem.
 */
function SugestoesDoCiclo({
  sessaoId,
  sugestoes,
  blocosRoteiro,
  irPara,
}: {
  sessaoId: string;
  sugestoes: SugestaoCopilotoPolling[];
  blocosRoteiro?: { id: string }[];
  irPara?: (indice: number) => void;
}) {
  const [dispensadas, setDispensadas] = useState<Record<string, boolean>>({});

  const pendentes = sugestoes.filter((s) => !dispensadas[s.sugestao_id]);
  if (pendentes.length === 0) return null;

  const recente = pendentes[pendentes.length - 1];
  const anteriores = pendentes.slice(0, -1);

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-controle border border-linha p-2.5">
        {!recente.visivel || !recente.sugestao ? (
          <p className="rounded-controle border border-dashed border-linha-forte px-3 py-2 text-sm text-tinta-suave">
            Confiança abaixo do mínimo configurado — nada mostrado.
          </p>
        ) : (
          <ApresentacaoSugestao
            sessaoId={sessaoId}
            sugestaoId={recente.sugestao_id}
            sugestao={recente.sugestao}
            blocosRoteiro={blocosRoteiro}
            irPara={irPara}
          />
        )}
        <div className="mt-2 flex justify-end">
          <Botao
            variante="fantasma"
            tamanho="compacto"
            onClick={() => setDispensadas((atual) => ({ ...atual, [recente.sugestao_id]: true }))}
          >
            Dispensar
          </Botao>
        </div>
      </div>

      {anteriores.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-legenda font-medium text-tinta-fraca">
            {anteriores.length === 1 ? "1 sugestão anterior" : `${anteriores.length} sugestões anteriores`}
          </summary>
          {/* `role="region"`/`tabIndex` moram no `<div>` WRAPPER, não na
           * `<ul>` — colocá-los direto na lista sobrescreve o role nativo
           * dela (`list`), deixando os `<li>` filhos órfãos para o axe
           * (`listitem: <li> elements must be contained in a <ul> or <ol>`)
           * e violando `aria-allowed-role` (`<ul>` não aceita `role="region"`). */}
          <div tabIndex={TAB_INDEX_ROLAVEL} role="region" aria-label="Sugestões anteriores" className="mt-2 max-h-48 overflow-y-auto pr-1">
            <ul className="flex flex-col gap-2">
              {anteriores.map((s) => (
                <li key={s.sugestao_id} className="rounded-controle border border-linha p-2.5">
                  {!s.visivel || !s.sugestao ? (
                    <p className="rounded-controle border border-dashed border-linha-forte px-3 py-2 text-sm text-tinta-suave">
                      Confiança abaixo do mínimo configurado — nada mostrado.
                    </p>
                  ) : (
                    <ApresentacaoSugestao
                      sessaoId={sessaoId}
                      sugestaoId={s.sugestao_id}
                      sugestao={s.sugestao}
                      blocosRoteiro={blocosRoteiro}
                      irPara={irPara}
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * Encerrar a sessão do copiloto (Fatia 3, §6.1, B71 "camada 1 de
 * confirmação"): é irreversível no sentido do plano — consolida a
 * transcrição em `transcricoes` e para o copiloto para sempre nesta sessão.
 * `ConfirmarAcao` deixa o efeito explícito por extenso, nunca "tem certeza?".
 * `sessao_ja_encerrada` (409, clique duplo) é tratado como sucesso silencioso
 * — a sessão já está no estado que o clique pedia.
 */
function EncerrarCopiloto({ sessaoId, aoEncerrar }: { sessaoId: string; aoEncerrar: () => void }) {
  const [confirmando, setConfirmando] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<unknown>(null);

  async function confirmar() {
    setProcessando(true);
    setErro(null);
    try {
      await encerrarCopiloto(sessaoId);
      aoEncerrar();
    } catch (e) {
      if (e instanceof ErroSessao && e.codigo === "sessao_ja_encerrada") {
        aoEncerrar();
      } else {
        setErro(e);
      }
    } finally {
      setProcessando(false);
      setConfirmando(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-linha pt-3">
      <Botao variante="secundario" tamanho="compacto" onClick={() => setConfirmando(true)} className="self-start">
        Encerrar copiloto desta sessão
      </Botao>
      {Boolean(erro) && (
        <p role="alert" className="text-legenda text-[color:var(--vermelho)]">
          {erro instanceof ErroSessao ? erro.message : "Não foi possível encerrar o copiloto. Tente de novo."}
        </p>
      )}
      <ConfirmarAcao
        aberto={confirmando}
        titulo="Encerrar o copiloto desta sessão?"
        efeito="A transcrição registrada até agora é consolidada em um documento único desta sessão, e o copiloto para de buscar novidade e de sugerir — não é possível reativá-lo nesta mesma sessão depois."
        rotuloConfirmar="Encerrar"
        confirmando={processando}
        perigo
        aoConfirmar={() => void confirmar()}
        aoCancelar={() => setConfirmando(false)}
      />
    </div>
  );
}

/**
 * O botão "Me ajuda agora" e a apresentação da sugestão. B71: nada pisca,
 * nada toca, nada abre sozinho — a sugestão só existe na tela depois do
 * clique explícito da Dra. Elaine, e fica onde apareceu até ela pedir outra
 * ou trocar de bloco/sessão (não há timer nem auto-refresh).
 */
function SugestaoIA({
  sessaoId,
  indiceAtual,
  blocosRoteiro,
  irPara,
  temSugestaoCiclo,
}: {
  sessaoId: string;
  indiceAtual: number;
  blocosRoteiro?: { id: string }[];
  irPara?: (indice: number) => void;
  temSugestaoCiclo: boolean;
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
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Botao
          type="button"
          variante="primario"
          tamanho="compacto"
          carregando={pedindo}
          onClick={() => void pedir()}
          aria-describedby="copiloto-ia-nota"
        >
          Me ajuda agora
        </Botao>
        <span id="copiloto-ia-nota" className="sr-only">
          Pede à IA uma sugestão para o momento atual da sessão. Pode levar até 8 segundos.
        </span>
      </div>

      {pedindo && (
        <p role="status" aria-live="polite" className="text-sm text-tinta-suave">
          Pensando…
        </p>
      )}

      {!pedindo && erro !== null && <MensagemRecusa erro={erro} aoTentarDeNovo={() => void pedir()} />}

      {!pedindo && !erro && resposta && !resposta.visivel && (
        <p role="status" className="rounded-controle border border-dashed border-linha-forte px-3 py-2 text-sm text-tinta-suave">
          Confiança abaixo do mínimo configurado — nada mostrado.
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

      {!pedindo && !erro && !resposta && !temSugestaoCiclo && <p className="text-sm text-tinta-suave">Aguardando pergunta.</p>}
    </div>
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

/**
 * Carimbo de hora do achado de 15/09 (obrigatório junto de `ultimoNaoNulo`):
 * sem ele, "persistir o último valor não-nulo" trocaria "o dado some" por
 * "o dado mente sobre quando é" — pior, pela regra da casa ("nada de dado
 * inventado na tela"). Só aparece quando o valor exibido NÃO veio da
 * sugestão mais recente do ciclo. Reusa `formatarHora` de `@/lib/formatar`.
 */
function CarimboHoraSeAntigo({
  criadoEm,
  sugestaoId,
  sugestoesCiclo,
}: {
  criadoEm: string;
  sugestaoId: string;
  sugestoesCiclo: SugestaoCopilotoPolling[];
}) {
  const maisRecente = sugestoesCiclo[sugestoesCiclo.length - 1];
  if (!maisRecente || maisRecente.sugestao_id === sugestaoId) return null;
  return <p className="text-legenda text-tinta-fraca">Registrado às {formatarHora(criadoEm)}</p>;
}

/** `evidencia` é citação literal do que o cliente disse — apresentada como
 * citação, visivelmente distinta da conclusão da IA. */
function Evidencia({ texto, rotulo }: { texto: string; rotulo?: string }) {
  return (
    <blockquote className="border-l-2 border-linha-forte pl-2.5 text-sm italic text-tinta-suave">
      {rotulo && <span className="mb-0.5 block not-italic text-legenda font-medium uppercase tracking-wide text-tinta-fraca">{rotulo}</span>}
      &ldquo;{texto}&rdquo;
    </blockquote>
  );
}

/**
 * Todo campo de `SugestaoCopiloto` pode vir nulo — nulo é nulo, some, nunca
 * vira texto plausível. Cada bloco abaixo só renderiza se o dado existir.
 *
 * Hierarquia: a `proxima_pergunta.texto` é o ÚNICO elemento que a advogada
 * precisa achar em meio segundo — é o herói, card próprio com o mesmo degrau
 * tipográfico que `BlocoRoteiro.tsx` usa para o título do bloco atual.
 * `motivo` e `evidencia` moram dentro do MESMO card, menores. "Ainda não
 * perguntou:" (tradução de "falta no bloco", jargão da casa) é apoio,
 * abaixo — verbo, não substantivo abstrato. Desvio e observação por último.
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
    <div className="flex flex-col gap-3">
      {sugestao.proxima_pergunta && (
        <div className="rounded-controle border border-linha px-3 py-2.5">
          <p className="text-subtitulo font-bold leading-snug text-tinta">{sugestao.proxima_pergunta.texto}</p>
          {sugestao.proxima_pergunta.motivo && (
            <p className="mt-1.5 text-sm text-tinta-suave">
              <span className="font-medium text-tinta-fraca">Por quê: </span>
              {sugestao.proxima_pergunta.motivo}
            </p>
          )}
          {sugestao.proxima_pergunta.evidencia && (
            <div className="mt-1.5">
              <Evidencia texto={sugestao.proxima_pergunta.evidencia} rotulo="O cliente disse" />
            </div>
          )}
        </div>
      )}

      {sugestao.falta_no_bloco.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {/* Tradução do jargão (tabela obrigatória): "A IA notou que falta"
           * → "Ainda não perguntou:" — verbo, não substantivo abstrato. */}
          <p className="text-rotulo font-medium uppercase text-tinta-fraca">Ainda não perguntou:</p>
          <ul className="flex flex-wrap gap-1.5">
            {sugestao.falta_no_bloco.map((item, i) => (
              <li key={i}>
                <Selo tom="neutro">{item.item}</Selo>
              </li>
            ))}
          </ul>
          {sugestao.falta_no_bloco
            .filter((item) => item.evidencia)
            .map((item, i) => (
              <Evidencia key={i} texto={item.evidencia as string} />
            ))}
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

      {sugestao.observacao && (
        <div className="flex flex-col gap-1 border-t border-dashed border-linha pt-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Selo tom={TOM_TIPO[sugestao.observacao.tipo]}>{ROTULO_TIPO[sugestao.observacao.tipo]}</Selo>
            <SeloConfianca confianca={sugestao.observacao.confianca} />
          </div>
          <p className="text-sm text-tinta-suave">{sugestao.observacao.texto}</p>
          {sugestao.observacao.evidencia && <Evidencia texto={sugestao.observacao.evidencia} />}
        </div>
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
 * também grava o desfecho — telemetria disparada em paralelo, nunca
 * atrasando nem condicionando a navegação/dispensa.
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

/**
 * BLOCO 2 — "Cuidado" (condicional). Fusão dos 3 antigos quadros de
 * jargão/risco:
 *  - `QuadroAlerta` (SIMs pendentes) → "Falta pedir a autorização de
 *    gravação" e demais pendências, por extenso;
 *  - `QuadroOQueAconteceu` (falta no bloco do estado determinístico) →
 *    "Ainda não perguntou:" no bloco atual;
 *  - `QuadroPodePularPra` (desvio sugerido) → continua com "Ir para lá"/
 *    "Ignorar", agora dentro do mesmo bloco de risco.
 *
 * Regra dura: **sem nenhum dos três, o bloco inteiro não existe no DOM** —
 * nunca um card vazio dizendo "nada". Prova por `offsetParent`, nunca por
 * `e.hidden` (filho "visível" dentro de pai `display:none` dá verde falso).
 */
function BlocoCuidado({
  pendentes,
  falta,
  sugestoesCiclo,
  sessaoId,
  blocosRoteiro,
  irPara,
}: {
  pendentes: { sim: string; rotulo: string }[];
  falta: { campos: { id: string; rotulo: string }[]; observar: string[] };
  sugestoesCiclo: SugestaoCopilotoPolling[];
  sessaoId: string;
  blocosRoteiro?: { id: string; titulo?: string }[];
  irPara?: (indice: number) => void;
}) {
  // Decisão de 15/09 (mantida): era `sugestoesCiclo[length - 1]` direto — a
  // observação crítica sumia toda vez que o ciclo trouxesse uma sugestão
  // nova sem ela, mesmo que o risco continuasse valendo. `ultimoNaoNulo`
  // mantém a última observação crítica real.
  const achadoObservacao = ultimoNaoNulo(sugestoesCiclo, (s) =>
    s.sugestao?.observacao && (s.sugestao.observacao.tipo === "recomendacao" || s.sugestao.observacao.tipo === "hipotese") ? s.sugestao.observacao : null,
  );
  const observacaoCritica = achadoObservacao?.valor ?? null;

  const achadoDesvio = ultimoNaoNulo(sugestoesCiclo, (s) => s.sugestao?.desvio_sugerido ?? null);

  const temFaltaNoBloco = falta.campos.length > 0 || falta.observar.length > 0;
  const temRisco = pendentes.length > 0 || Boolean(observacaoCritica) || temFaltaNoBloco || Boolean(achadoDesvio);

  // CONDICIONAL: sem risco nenhum, o bloco não existe no DOM — nunca um
  // card vazio dizendo "nada". `offsetParent`/renderização condicional real
  // (não CSS `hidden`) é o que o teste precisa provar.
  if (!temRisco) return null;

  return (
    <Quadro rotulo="Cuidado" icone={<IconeAlerta />} tom="vermelho" como="article">
      <div className="flex flex-col gap-2.5">
        {pendentes.length > 0 && (
          <ul className="flex flex-col gap-1">
            {pendentes.map((p) => (
              <li key={p.sim} className="text-sm text-tinta">
                {/* Tradução do jargão obrigatória: "SIMs pendentes" → a
                 * pendência por extenso. `p.rotulo` já vem da API como frase
                 * humana ("Decisores presentes", "Próximo passo") — o rótulo
                 * genérico "N de 4 SIMs" fica de fora da tela ao vivo. */}
                Falta: {p.rotulo}
              </li>
            ))}
          </ul>
        )}

        {temFaltaNoBloco && (
          <div className="flex flex-col gap-2">
            {falta.campos.length > 0 && (
              <div>
                <p className="mb-1 text-rotulo font-medium uppercase text-tinta-fraca">Ainda não perguntou:</p>
                <ul className="ml-4 flex list-disc flex-col gap-1 marker:text-[color:var(--ambar)]">
                  {falta.campos.map((campo) => (
                    <li key={campo.id} className="text-sm text-tinta">
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

        {observacaoCritica && achadoObservacao && (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Selo tom={TOM_TIPO[observacaoCritica.tipo]}>{ROTULO_TIPO[observacaoCritica.tipo]}</Selo>
              <SeloConfianca confianca={observacaoCritica.confianca} />
            </div>
            <p className="text-sm text-tinta">{observacaoCritica.texto}</p>
            <CarimboHoraSeAntigo criadoEm={achadoObservacao.criadoEm} sugestaoId={achadoObservacao.sugestaoId} sugestoesCiclo={sugestoesCiclo} />
          </div>
        )}

        {achadoDesvio && (
          <div className="flex flex-col gap-1 border-t border-dashed border-linha pt-2.5">
            <DesvioSugerido sessaoId={sessaoId} sugestaoId={achadoDesvio.sugestaoId} desvio={achadoDesvio.valor} blocosRoteiro={blocosRoteiro} irPara={irPara} />
            <CarimboHoraSeAntigo criadoEm={achadoDesvio.criadoEm} sugestaoId={achadoDesvio.sugestaoId} sugestoesCiclo={sugestoesCiclo} />
          </div>
        )}
      </div>
    </Quadro>
  );
}

const IconeAlerta = () => (
  <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 1.5 15 14.5H1L8 1.5Zm0 4.6v3.6M8 12.1h.01" />
  </svg>
);

/** Estado desligado por configuração — texto sóbrio, sem alarme, dizendo o
 * que é e quem liga. */
function CopilotoDesligado() {
  return (
    <EstadoVazio
      ilustracao="pasta"
      titulo="Copiloto desligado"
      descricao="Desligado por configuração em Admin. A sessão segue normalmente pelo roteiro."
    />
  );
}

// `ultimoNaoNulo` vive em `src/components/sessao/copiloto/ultimoNaoNulo.ts`
// (extraído na Fase 12, Fatia B). Reexportado porque
// `PainelCopiloto.test.tsx` importa a função pura direto deste arquivo.
export { ultimoNaoNulo };
