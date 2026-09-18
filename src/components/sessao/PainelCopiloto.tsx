"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ErroSessao,
  buscarEstadoCopiloto,
  encerrarCopiloto,
  pedirSugestaoCopiloto,
  registrarDesfechoSugestaoCopiloto,
} from "@/components/sessao/api";
import type {
  BlocoPendente,
  CategoriaInventarioMencionado,
  DesfechoCopiloto,
  InfoCicloCopiloto,
  InventarioParaPainel,
  ItemInventarioRecentePainel,
  RespostaSugestaoCopiloto,
  SegmentoCopiloto,
  SugestaoCopiloto,
  SugestaoCopilotoPolling,
  TipoObservacaoCopiloto,
} from "@/types/copiloto";
import type { PapelEquipe } from "@/types/banco";
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
import { PainelTranscricao } from "@/components/sessao/copiloto/PainelTranscricao";
import { Coluna } from "@/components/sessao/copiloto/Coluna";
import { useRealceUmaVez } from "@/components/sessao/copiloto/useRealceUmaVez";

// ---------------------------------------------------------------------------
// Fase 12, Fatia B/F4 — mosaico de 3 colunas, sem rolagem de página (pedido
// do Marcio, 17/09: "na mesma tela está tudo reunido [...] não consigo
// visualizar, é muito conteúdo"). Réguas aplicadas neste arquivo:
//
//  1. Se não muda a PRÓXIMA FRASE que a advogada vai dizer nos próximos 30
//     segundos, não fica na tela ao vivo.
//  2. Um único foco visual por vez — só o bloco "Fale agora" tem peso;
//     "Cuidado" e a transcrição são apoio, nunca competem com ele.
//  3. Jargão traduzido: "SIMs pendentes" → a pendência por extenso; "falta no
//     bloco" → "Ainda não perguntou:"; "insight comercial"/"bloco atual"/
//     "confiança 0,72"/"gatilho: intervalo" saem da tela ao vivo (viram
//     telemetria ou material do resumo da sessão, nunca leitura ao vivo).
//  4. Densidade sem rolagem de PÁGINA: cada coluna rola por dentro
//     (`min-h-0` + `overflow-y-auto` própria) — a página nunca rola.
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
 * na verdade o copiloto está surdo). 1-2 falhas seguidas continuam mudas: um
 * soluço de rede não pode virar alarme no meio de uma conversa sobre
 * herança. 3 é o piso a partir do qual "transiente" deixa de ser a
 * explicação mais provável — regra própria de ruído de rede, independente
 * de B71 (que tratava de sugestão/insight, não de erro de conexão). */
const LIMIAR_FALHAS_PARA_AVISO = 3;

/** Fatia 3 (17/09) — texto único para "a IA respondeu, mas abaixo do limiar
 * de confiança configurado". Estava DUPLICADO em 3 lugares (herói do ciclo
 * automático, histórico de anteriores, resposta de "Me ajuda agora") com o
 * risco já registrado nesta base (`traduzirErroBanco` casa por igualdade
 * EXATA — duas frases quase iguais para a mesma situação divergem e uma cai
 * no genérico). Constante nomeada para não nascer uma 2ª versão do texto —
 * 🔴 CORREÇÃO (Fable, 2 rodadas): o mesmo diff que criou esta constante tinha
 * criado a 2ª versão mesmo assim, no aviso do ciclo automático
 * (`EstadoDoCopiloto`, ramo `ultimaSugestaoAbaixoDoLimiar`). A 1ª tentativa
 * de unificar TROCOU a frase — e quebrou 3 testes pré-existentes que a
 * asseveravam por literal, mais 2 novos escritos em desacordo com ela. A
 * frase ORIGINAL fica (tem histórico com a advogada e era a string de 3
 * testes verdes); é reusada nos DOIS lugares e EXPORTADA para os testes
 * asseverarem a constante, nunca um literal — literal em teste é uma 3ª
 * cópia do texto, e foi exatamente isso que quebrou. */
export const MENSAGEM_CONFIANCA_ABAIXO_DO_LIMIAR = "Confiança abaixo do mínimo configurado — nada mostrado.";

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
  usuarioLogado = null,
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
  /** Fase 12, Fatia 7 — resolvido pelo SERVER COMPONENT (`page.tsx`) e
   * descido por `ConduzirSessaoApp` até aqui, e daqui até
   * `ColunaTranscricaoInventario`/`PainelTranscricao` (a única folha que usa
   * isto, para saber qual turno da transcrição é da advogada). Nunca
   * buscado de novo neste nível — só repassado. `null` default cobre o
   * teste unitário deste componente, que monta `PainelCopiloto` sozinho. */
  usuarioLogado?: { nome: string | null; papel: PapelEquipe | null } | null;
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
  // F4 — "O cliente disse" (registro manual) sai do espaço nobre e vira
  // recolhível no rodapé: estado local puro de apresentação, nunca duplica
  // servidor (o CONTEÚDO de `RegistroManual` continua vindo de
  // `listarSegmentosCopiloto`, isto só decide se a linha 3 do grid existe).
  const [registroAberto, setRegistroAberto] = useState(false);
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
  // Fatia 3 (17/09) — o fato "a última sugestão do ciclo respondeu abaixo do
  // limiar de confiança" não pode desaparecer só porque saiu do herói: vira
  // UMA LINHA FINA no rodapé (decisão do orquestrador — nunca some de vez,
  // continua avisando que o limiar está mal calibrado). Olha só a ÚLTIMA do
  // ciclo bruto: se ELA (a mais nova) é invisível, mesmo que o herói ainda
  // mostre uma anterior visível com o carimbo de hora.
  const ultimaSugestaoDoCicloAbaixoDoLimiar =
    sugestoesCiclo.length > 0 && !sugestoesCiclo[sugestoesCiclo.length - 1].visivel;

  // B73 (bloqueio de ativação da memória do copiloto, 18/09) — "bloco
  // coberto" é FATO DO SERVIDOR, nunca inferido da sugestão da IA: o campo
  // que prova isso é `estado.falta_no_bloco.campos` (o que a rota
  // determinística já sabe faltar no bloco atual), não `sugestao.
  // falta_no_bloco` (o que a IA achou faltar numa chamada específica — pode
  // vir vazio por silêncio genuíno mesmo com campo pendente real). Sem
  // campo pendente e sem observação pendente = bloco coberto.
  //
  // `proximoBloco` vem de `blocos_nao_percorridos[0]`, populado pelo SERVIDOR
  // contra o roteiro ativo — não de `indiceAtual+1` (que mentiria depois de
  // um desvio). Lista vazia = não há próximo bloco (fim do roteiro), estado
  // de primeira classe, nunca "índice fora do array" tratado como bug.
  //
  // 🔴 VAZIO POR COBERTURA ≠ VAZIO POR IGNORÂNCIA (18/09/2026, achado na
  // revisão). `estado.ts:688` monta `camposPendentes` como
  // `(blocoAtual?.campos ?? []).map(...)` — quando NÃO HÁ bloco resolvido
  // (roteiro não carregado, `blocos` vazio, bloco `indisponivel`), o servidor
  // devolve `[]` do mesmo jeito que devolveria para um bloco genuinamente
  // coberto. Sem a guarda abaixo, a tela afirmaria "bloco coberto" sem base
  // nenhuma — e o caso NÃO é hipotético: o defeito de roteiro não carregado
  // foi medido em produção hoje de manhã (a sessão inteira do Carlos Alberto
  // rodou com `bloco_indice = 0` por falta do fallback em `estado.ts`).
  //
  // A guarda é `bloco_atual_id != null`: só afirma cobertura quando o
  // servidor SABE em que bloco a conversa está (`estado.ts:706` só preenche
  // esse id a partir de um `blocoAtual` real). Sem isso, cai no texto
  // genérico de sempre — que é honesto, porque de fato não se sabe.
  const temBlocoResolvido = estado.bloco_atual_id != null;
  //
  // 🔴 `observar` FICA DE FORA DO CRITÉRIO (18/09/2026, reprovação do Fable).
  // `estado.ts:755` monta `observarPendente` como a lista INTEIRA do bloco
  // (`blocoAtual?.observar ?? []`) e NADA a subtrai — `observar` é texto livre
  // ("perceber se o cliente hesita ao falar do irmão"), que a memória não
  // categoriza e nunca vai esvaziar. Medido no roteiro v5 ativo: **13 dos 13
  // blocos têm `observar >= 1`**. Mantê-lo aqui tornava `blocoAtualCoberto`
  // FALSO EM 100% DOS BLOCOS, SEMPRE — a tela do B73 seria inalcançável em
  // produção, e a advogada leria "não teve nada específico a apontar"
  // exatamente no caso que este estado existe para eliminar.
  //
  // `observar` continua VISÍVEL como informação (não foi apagado do payload
  // nem da tela) — só deixou de ser trava de um estado que ele não sabe medir.
  const blocoAtualCoberto = temBlocoResolvido && estado.falta_no_bloco.campos.length === 0;
  const proximoBloco = estado.blocos_nao_percorridos[0] ?? null;

  return (
    // F4 — mosaico de 3 colunas, SEM rolagem de página (pedido do Marcio,
    // 17/09: hoje ~230px do topo são gastos com subtítulo/aviso/"ainda
    // identificando" antes de qualquer conteúdo útil aparecer). `grid-rows`
    // fixo (`auto 1fr auto`): a linha do meio (as 3 colunas) é a única que
    // cresce/encolhe; o rodapé de status fica sempre no mesmo lugar, nunca
    // deslocado por conteúdo novo em cima dele. `min-h-0` no wrapper e em
    // cada coluna é o que permite `overflow-y-auto` funcionar dentro de um
    // grid — sem ele, a coluna cresce com o conteúdo em vez de rolar por
    // dentro (armadilha de geometria já registrada nesta base).
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto_auto] gap-2">
      {/* LINHA 1 — as 3 colunas do mosaico. `lg:grid-cols-[40%_32%_28%]`
       * (Fale agora / Cuidado / Transcrição); abaixo de `lg` empilha em
       * ordem de prioridade (1→2→3) — o telão é o caso de uso principal,
       * mas a tela não pode quebrar em monitor estreito.
       *
       * `max-h-[calc(100vh-14.5rem)]` ancora no VIEWPORT e é o TETO de fora;
       * a CONTENÇÃO de cada célula é responsabilidade de `Coluna`
       * (`copiloto/Coluna.tsx`) — corrigido 17/09/2026 depois de a
       * transcrição vazar por cima do rodapé com 31 segmentos (COL 3 era só
       * `min-h-0`, sem `flex`: o `flex-1` do filho ficava inerte).
       *
       * 🔴 O valor da reserva foi MEDIDO no navegador (17/09, 18:48, viewport
       * 1536×826, build 8357981), não estimado: cabeçalho + linha de comando
       * = 142px acima do grid, gap 8px, rodapé de status 61px → 211px + folga
       * = 13,7rem necessários. A estimativa anterior (11rem, "por tipografia,
       * não cronometrado", como o executor avisou) deixava o rodapé 34px
       * abaixo da dobra num laptop; em 1920×1080 cabia e o defeito não
       * aparecia. 14,5rem dá ~20px de folga e escala com o ajuste "Tamanho
       * do texto" (rem acompanha o `font-size` da raiz; px não acompanharia).
       * `min-h-[22rem]` evita que o mosaico colapse para uma faixa ilegível em
       * tela baixa.
       *
       * ⚠️ DIVERGÊNCIA DO PLANO (F3, 17/09): o plano pedia RE-MEDIR este
       * valor no navegador depois do redesenho da `BarraPartes` (F1, que
       * trocou o rótulo de uma linha `text-legenda` para rótulo+trilho em
       * duas linhas dentro de `LinhaFinaRoteiro`). Este ambiente não tem
       * navegador/servidor de dev com sessão autenticada disponível para
       * medir com DevTools — não simulei o número. Estimativa por
       * aritmética, não substituto da medição: `BarraPartes` cresceu de
       * ~1 linha (rótulo `text-legenda` 11px + segmentos `h-2`=8px, quase
       * sobrepostos) para 2 linhas reais empilhadas (`text-sm`=14px/~20px de
       * `line-height` + `gap-1`=4px + trilho `h-1.5`=6px) ≈ +10px de altura
       * mínima do conteúdo da linha fina — dentro do `min-h-11` (44px) que
       * `LinhaFinaRoteiro` já reservava, então o pior caso plausível é a
       * linha fina ficar ~10px mais alta que antes SE o conteúdo já estivesse
       * perto do teto de 44px (não estava: rótulo+trilho empilhados medem
       * ~34px, ainda dentro do `min-h-11`). Mantenho 14,5rem sem alterar —
       * PROPOSTA AO ARQUITETO: confirmar em 1536×826 real antes do próximo
       * deploy; se o rodapé cair abaixo da dobra, subir para 15rem. */}
      <div className="grid min-h-[22rem] max-h-[calc(100vh-14.5rem)] grid-cols-1 gap-2 lg:grid-cols-[40%_32%_28%]">
        {/* COL 1 — "Fale agora". Único bloco com peso visual: é a próxima
         * frase dela. Nunca clicável por inteiro (a lição do "link de 11px"
         * e do "card inteiro clicável muda o contrato do link") — só os
         * botões "Me ajuda agora"/"Ir para lá"/"Ignorar"/"Dispensar", que já
         * eram alvos de 44px próprios, continuam clicáveis.
         *
         * 🔴 F3 (17/09) — achado do dono ("duplo scroll"): `BlocoFaleAgora`
         * tinha `max-h-[26rem] overflow-y-auto` PRÓPRIO, dentro desta
         * `Coluna` (que já tem `overflow-hidden`) — duas barras de rolagem
         * pelo MESMO conteúdo. `rolavel` faz esta célula ser a ÚNICA
         * superfície de rolagem da COL 1; `BlocoFaleAgora` perdeu o
         * `max-h`/`overflow` interno (ver o componente). `PlacarConducao`
         * (pedido do dono, 17/09, julga a CONDUÇÃO DA ADVOGADA — ✅ cobriu o
         * item do bloco, ❌ pulou item obrigatório) é o ÚLTIMO card do fluxo,
         * rolando junto com o resto — nunca um 2º container fixo disputando
         * altura. */}
        <Coluna className="gap-2" rolavel rotulo="Fale agora">
          <BlocoFaleAgora
            sessaoId={sessaoId}
            indiceAtual={indiceAtual}
            sugestoesCiclo={sugestoesCiclo}
            blocosRoteiro={blocosRoteiro}
            irPara={irPara}
            blocoAtualCoberto={blocoAtualCoberto}
            proximoBloco={proximoBloco}
          />
          <PlacarConducao sugestoesCiclo={sugestoesCiclo} />
        </Coluna>

        {/* COL 2 — "Cuidado". CONDICIONAL: sem risco, não existe no DOM
         * (nunca um card vazio dizendo "nada"). Funde os 3 antigos quadros
         * que eram jargão/risco: Alerta (SIMs pendentes) + O que aconteceu
         * (falta no bloco) + Pode pular pra (desvio sugerido). */}
        <Coluna>
          <BlocoCuidado
            pendentes={estado.sims_pendentes}
            falta={estado.falta_no_bloco}
            sugestoesCiclo={sugestoesCiclo}
            sessaoId={sessaoId}
            blocosRoteiro={blocosRoteiro}
            irPara={irPara}
          />
        </Coluna>

        {/* COL 3 — Transcrição | Inventário, em abas (pedido do dono, 17/09).
         * Transcrição: a mesma lista que `usePollingCopiloto` já acumula com
         * teto de 60 segmentos — nenhuma rota nova. Inventário: `polling.
         * inventario`, já no payload desde bcd3050 — mesmo poller, zero
         * query nova. */}
        <Coluna>
          <ColunaTranscricaoInventario segmentos={sessaoEncerrada ? [] : polling.segmentos} inventario={polling.inventario} usuarioLogado={usuarioLogado} />
        </Coluna>
      </div>

      {/* LINHA 2 — rodapé PERMANENTE, sempre no mesmo pixel, fora do espaço
       * nobre. `EstadoDoCopiloto` é o ÚNICO `aria-live="polite"` desta tela
       * (dois disparando no mesmo tick seria ruído) — o resto do rodapé é
       * ação, não anúncio.
       *
       * Fatia 10 (17/09) — famílias separadas: à ESQUERDA, leitura/registro
       * do que está acontecendo na sessão (`EstadoDoCopiloto` + "O cliente
       * disse", que é registro manual do mesmo tipo de fato); à DIREITA,
       * sozinho, "Encerrar copiloto desta sessão" — a única ação DESTRUTIVA
       * do rodapé, com separador vertical para nunca ser confundida com um
       * botão de leitura ao lado. `min-h-[3.25rem]` (intocado — já reserva
       * a altura certa) continua só em volta de `EstadoDoCopiloto`. */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-linha pt-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="min-h-[3.25rem] min-w-0 flex-1">
            {!sessaoEncerrada && (
              <EstadoDoCopiloto
                ciclo={polling.ciclo}
                requisicaoEmVoo={polling.requisicaoEmVoo}
                falhasConsecutivas={polling.falhasConsecutivas}
                falhandoDesde={polling.falhandoDesde}
                ultimaSugestaoAbaixoDoLimiar={ultimaSugestaoDoCicloAbaixoDoLimiar}
              />
            )}
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
          </div>

          {/* `[O cliente disse ▸]` — o registro manual é AÇÃO ocasional
           * (digitar/colar um trecho perdido), não leitura permanente: sai
           * do espaço nobre e fica recolhido aqui. `RegistroManual` é
           * exatamente o mesmo componente (campo + lista); só o CONTAINER
           * muda de lugar/estado. Estado local puro de apresentação — o
           * CONTEÚDO continua vindo do servidor via `listarSegmentosCopiloto`
           * dentro de `RegistroManual`, nunca duplicado aqui. Mesma família
           * de `EstadoDoCopiloto`: leitura/registro do que está acontecendo,
           * nunca ação destrutiva — por isso mora à esquerda, com ele. */}
          <Botao type="button" variante="fantasma" tamanho="compacto" onClick={() => setRegistroAberto((v) => !v)} aria-expanded={registroAberto} className="shrink-0">
            O cliente disse
            <span aria-hidden="true" className={`ml-1 inline-block transition-transform ${registroAberto ? "rotate-90" : ""}`}>
              ▸
            </span>
          </Botao>
        </div>

        {!sessaoEncerrada && (
          <div className="flex shrink-0 items-center gap-2 border-l border-linha pl-2">
            <EncerrarCopiloto sessaoId={sessaoId} aoEncerrar={aoEncerrar} />
          </div>
        )}
      </div>

      {/* LINHA 3 — conteúdo de "O cliente disse", fora do grid nobre e fora
       * do flex horizontal do rodapé (que espremeria "Encerrar" se o
       * registro abrisse ali dentro). Só existe no DOM quando aberto — o
       * grid externo (`grid-rows-[1fr_auto_auto]`) já reserva altura `auto`,
       * que colapsa a 0 quando esta linha está vazia. */}
      {registroAberto && (
        <div>
          <RegistroManual sessaoId={sessaoId} sessaoEncerrada={sessaoEncerrada || estado.estado_copiloto === "encerrado"} />
        </div>
      )}
    </div>
  );
}

const ROTULO_CATEGORIA_INVENTARIO: Record<CategoriaInventarioMencionado, string> = {
  imovel: "Imóveis",
  empresa: "Empresas",
  investimento: "Investimentos",
  outro: "Outros",
};

/**
 * COL 3 — Transcrição | Inventário (pedido do dono, 17/09). Duas abas
 * LOCAIS a esta coluna (não usam `ChaveTabFicha`/`tabs.ts` — aquele catálogo
 * é da Ficha 360, este componente é da tela ao vivo). Mesmo padrão de
 * `TabsFicha.tsx` (`role="tablist"`/`"tab"`/`"tabpanel"`, setas de teclado):
 * a aba inativa DESMONTA o conteúdo (`{ativa ? conteudo : null}`), nunca só
 * `hidden` — é o padrão já estabelecido nesta base para não manter pollers/
 * scroll de uma aba fora de vista consumindo ciclo à toa.
 *
 * A aba Inventário só aparece quando `inventario` não é `null` (kill-switch
 * `copiloto_sessao.inventario_mencionado` desligado, ou sessão sem item
 * ainda) — sem ela, só a Transcrição existe, sem aba nenhuma para não
 * sugerir uma escolha que não leva a lugar nenhum.
 */
function ColunaTranscricaoInventario({
  segmentos,
  inventario,
  usuarioLogado,
}: {
  segmentos: SegmentoCopiloto[];
  inventario: InventarioParaPainel | null;
  /** Fase 12, Fatia 7 — só repassado a `PainelTranscricao`, nunca lido aqui. */
  usuarioLogado?: { nome: string | null; papel: PapelEquipe | null } | null;
}) {
  const [abaAtiva, setAbaAtiva] = useState<"transcricao" | "inventario">("transcricao");
  // Fatia 2 (17/09) — achado do arquiteto: `total_itens_proprios` E
  // `total_itens_incertos` JÁ vêm no payload (`ResumoInventarioAcumulado`),
  // zero backend novo. O rótulo da aba usava só o próprio ("Inventário (0)")
  // e mentia por omissão com 31 itens captados, ainda não confirmados — o
  // rótulo passa a somar os dois: responde "tem coisa aqui?", não "já bati o
  // olho nisso?" (essa segunda pergunta é a linha densa dentro do painel).
  const totalCaptado = inventario ? inventario.resumo.total_itens_proprios + inventario.resumo.total_itens_incertos : null;

  // Sem inventário, não há por que existir aba nenhuma — a Transcrição some
  // do papel de "aba" e volta a ser o conteúdo direto da coluna, como antes
  // desta entrega (geometria idêntica: mesmo `min-h-0`/`flex-1` interno de
  // `PainelTranscricao`).
  if (!inventario) return <PainelTranscricao segmentos={segmentos} usuarioLogado={usuarioLogado} />;

  const abas: { chave: "transcricao" | "inventario"; rotulo: string }[] = [
    { chave: "transcricao", rotulo: "Transcrição" },
    { chave: "inventario", rotulo: `Inventário · ${totalCaptado}` },
  ];

  function aoTeclar(evento: React.KeyboardEvent, atual: "transcricao" | "inventario") {
    const indice = abas.findIndex((a) => a.chave === atual);
    let proximo: number | null = null;
    if (evento.key === "ArrowRight") proximo = (indice + 1) % abas.length;
    else if (evento.key === "ArrowLeft") proximo = (indice - 1 + abas.length) % abas.length;
    if (proximo === null) return;
    evento.preventDefault();
    const chave = abas[proximo].chave;
    setAbaAtiva(chave);
    document.getElementById(`tab-copiloto-${chave}`)?.focus();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div role="tablist" aria-label="Transcrição e inventário" className="flex shrink-0 gap-0.5 border-b border-linha">
        {abas.map((aba) => {
          const selecionada = aba.chave === abaAtiva;
          return (
            <button
              key={aba.chave}
              type="button"
              role="tab"
              id={`tab-copiloto-${aba.chave}`}
              aria-selected={selecionada}
              aria-controls={`painel-copiloto-${aba.chave}`}
              tabIndex={selecionada ? 0 : -1}
              onClick={() => setAbaAtiva(aba.chave)}
              onKeyDown={(evento) => aoTeclar(evento, aba.chave)}
              className={`-mb-px min-h-11 border-b-2 px-2.5 text-sm transition-colors duration-[var(--transicao-rapida)] ${
                selecionada ? "border-[color:var(--acento,var(--latao))] font-bold text-tinta" : "border-transparent font-medium text-tinta-suave hover:text-tinta"
              }`}
            >
              {aba.rotulo}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id="painel-copiloto-transcricao"
        aria-labelledby="tab-copiloto-transcricao"
        hidden={abaAtiva !== "transcricao"}
        className="flex min-h-0 flex-1 flex-col"
      >
        {/* A aba inativa não monta o conteúdo — mesma regra de `TabsFicha.tsx`. */}
        {abaAtiva === "transcricao" ? <PainelTranscricao segmentos={segmentos} usuarioLogado={usuarioLogado} /> : null}
      </div>

      <div
        role="tabpanel"
        id="painel-copiloto-inventario"
        aria-labelledby="tab-copiloto-inventario"
        hidden={abaAtiva !== "inventario"}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {abaAtiva === "inventario" ? <PainelInventario inventario={inventario} /> : null}
      </div>
    </div>
  );
}

/**
 * Contagens por categoria (`IMÓVEIS · 6`) + os 5 itens mais recentes com a
 * citação literal que os prova — layout do pedido do dono, 17/09. `posse:
 * "incerta"` nunca soma no total da categoria (regra do tipo: "a confirmar",
 * nunca somado) — aparece só como contagem separada, mesmo padrão do resumo
 * que já vai para a IA (`ResumoInventarioAcumulado`). A REGRA de contagem não
 * muda na Fatia 2 — só a apresentação (linha de resumo + qual número fica em
 * negrito quando `contagem_propria` é 0).
 */
function PainelInventario({ inventario }: { inventario: InventarioParaPainel }) {
  const categorias = inventario.resumo.por_categoria.filter((c) => c.contagem_propria > 0 || c.contagem_incerta > 0);
  const { total_itens_proprios: proprios, total_itens_incertos: incertos } = inventario.resumo;

  return (
    <div className="flex flex-col gap-3 rounded-controle border border-linha bg-papel-elevado px-3 py-2">
      {/* Fatia 2 — a mentira por omissão era "Inventário (0)" com 31 itens
       * captados: o rótulo da aba já soma próprios+incertos (responde "tem
       * coisa aqui?"), e esta linha responde a segunda pergunta, densa:
       * quanto já foi captado vs. quanto ainda precisa de confirmação da
       * titularidade. Some sozinha se não há nada captado ainda (mesma regra
       * de "vazio é vazio" — nunca "0 captados · 0 confirmados"). */}
      {proprios + incertos > 0 && (
        <p className="text-sm text-tinta">
          <span className="font-bold tabular-nums">{proprios + incertos}</span> captados ·{" "}
          <span className="font-bold tabular-nums">{proprios}</span> confirmados ·{" "}
          <span className="font-bold tabular-nums">{incertos}</span> a confirmar
        </p>
      )}

      {categorias.length === 0 ? (
        <p className="text-sm text-tinta-suave">Nenhum item de patrimônio mencionado ainda nesta sessão.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {categorias.map((c) => (
            <li key={c.categoria} className="flex items-baseline justify-between text-sm text-tinta">
              <span className="font-medium uppercase tracking-wide text-tinta-fraca">{ROTULO_CATEGORIA_INVENTARIO[c.categoria]}</span>
              {/* Quando nada está confirmado ainda (`contagem_propria === 0`),
               * o destaque nunca pode ser um "0" em negrito ao lado de itens
               * reais captados — inverte a ênfase para o número que importa
               * agora: o captado, ainda a confirmar. */}
              {c.contagem_propria > 0 ? (
                <span className="font-bold tabular-nums">
                  {c.contagem_propria}
                  {c.contagem_incerta > 0 && <span className="ml-1.5 font-normal text-tinta-fraca">· {c.contagem_incerta} a confirmar</span>}
                </span>
              ) : (
                <span className="font-normal tabular-nums text-tinta-suave">
                  <span className="font-bold text-tinta">{c.contagem_incerta}</span> a confirmar
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {inventario.recentes.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-dashed border-linha pt-2.5">
          <p className="text-legenda font-medium uppercase text-tinta-fraca">Mencionados recentemente</p>
          <ul className="flex flex-col gap-2">
            {inventario.recentes.map((item, i) => (
              <ItemInventarioRecente key={i} item={item} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ItemInventarioRecente({ item }: { item: ItemInventarioRecentePainel }) {
  return (
    <li className="flex flex-col gap-0.5">
      <p className="text-sm text-tinta">
        {item.descricao}
        {item.posse === "incerta" && <span className="ml-1.5 text-legenda text-tinta-fraca">(a confirmar)</span>}
        {item.posse === "terceiro" && <span className="ml-1.5 text-legenda text-tinta-fraca">(de terceiro)</span>}
      </p>
      <p className="text-legenda italic text-tinta-fraca">&ldquo;{item.evidencia}&rdquo;</p>
    </li>
  );
}

/**
 * Fase 12, Fatia A — linha de status PERMANENTE, sempre no mesmo pixel
 * (`min-h-[3.25rem]` do container em `PainelCopiloto`). Antes desta fatia a
 * tela só distinguia "silêncio normal" de "gate bloqueado" — as outras 5
 * situações que `route.ts::paraInfoCiclo` já traduz (`timeout`,
 * `indisponivel`, `conteudo_recusado`, `orcamento_estourado`, falha de rede
 * do polling) chegavam e eram DESCARTADAS: 12 de 26 chamadas de IA medidas
 * em produção (48%) falhavam e SUMIAM da tela, sem a advogada distinguir
 * "sala calma" de "IA quebrada".
 *
 * PRIORIDADE (de cima para baixo — só uma linha aparece por vez):
 *  1. Falha de REDE do próprio polling, persistente (3+ falhas seguidas) —
 *     é a infraestrutura entre a tela e o servidor, mais grave que qualquer
 *     resultado de ciclo que o servidor tenha ou não conseguido mandar.
 *  2. `bloqueado_pelo_gate` — decisão jurídica/consentimento revogados no
 *     meio da sessão. É a ÚNICA condição que pede AÇÃO da advogada:
 *     `role="alert"`, herdado sem mudança do `GateBloqueado` anterior.
 *  3. `orcamento_estourado` — PERMANENTE para o resto da sessão (o teto não
 *     se refaz sozinho): ela precisa saber que o copiloto virou transcrição.
 *  4. `timeout`/`indisponivel`/`conteudo_recusado` — TRANSIENTE: a próxima
 *     janela tenta de novo sozinha. Nunca a palavra "erro" (pedido do dono)
 *     — para a advogada isto é "a IA não respondeu desta vez", não uma
 *     falha do sistema que ela precise reportar.
 *  5. `ultimaSugestaoAbaixoDoLimiar` (Fatia 3, 17/09) — a sugestão mais
 *     recente do ciclo respondeu, mas ficou abaixo do limiar de confiança
 *     configurado (kill-switch de qualidade, não de rede/servidor). Achado
 *     do arquiteto: antes disto o texto "Confiança abaixo do mínimo
 *     configurado — nada mostrado." ocupava o espaço nobre do herói ("Fale
 *     agora") — decisão do orquestrador foi rebaixar para linha fina aqui,
 *     nunca sumir de vez: a advogada não age sobre isto, mas alguém precisa
 *     saber que o limiar está mal calibrado.
 *  6. `requisicaoEmVoo` (Fatia B) — o GET desta janela ainda não voltou
 *     (pode levar até 20s, timeout de IA). Só aparece se nenhuma das 5
 *     situações acima já estiver ocupando a linha.
 *  7. Nada do que precede: "Ouvindo." — neutro, prova de que a linha está
 *     viva mesmo em silêncio normal (nunca um espaço em branco mudo).
 *
 * `role="status"` + `aria-live="polite"` em toda situação exceto o gate:
 * nunca `assertive` — não pode interromper o leitor de tela no meio de uma
 * frase da advogada (regra do dono, Fatia A).
 *
 * Sobre o anúncio da MUDANÇA (ex.: "Ouvindo." → "Consultando…"): quem
 * garante isso é o próprio texto mudar — o React não repinta nó de texto
 * idêntico, então o leitor de tela só re-anuncia quando o ESTADO muda, nunca
 * a cada tick de polling em silêncio. Não há (nem é preciso) `key` nos `<p>`
 * daqui: uma versão anterior deste comentário prometia uma `key` que nunca
 * existiu no JSX (achado do pentester, 17/09) — o comportamento estava certo,
 * a explicação é que mentia.
 */
function EstadoDoCopiloto({
  ciclo,
  requisicaoEmVoo,
  falhasConsecutivas,
  falhandoDesde,
  ultimaSugestaoAbaixoDoLimiar,
}: {
  ciclo: InfoCicloCopiloto | null;
  requisicaoEmVoo: boolean;
  falhasConsecutivas: number;
  falhandoDesde: Date | null;
  /** Fatia 3 (17/09) — a sugestão mais recente do ciclo respondeu, mas
   * `visivel=false` (confiança abaixo do limiar configurado). Prioridade 5:
   * depois de rede/gate/orçamento/timeout, antes de `requisicaoEmVoo`. */
  ultimaSugestaoAbaixoDoLimiar: boolean;
}) {
  if (falhasConsecutivas >= LIMIAR_FALHAS_PARA_AVISO && falhandoDesde) {
    return (
      <p role="status" aria-live="polite" className="rounded-controle border border-[color:var(--ambar)] bg-ambar-fraco px-3.5 py-2.5 text-sm text-tinta">
        <span className="mb-0.5 block font-bold text-[color:var(--ambar)]">Copiloto sem conexão desde {formatarHora(falhandoDesde.toISOString())}</span>
        A sessão segue pelo roteiro. Retoma sozinho.
      </p>
    );
  }

  if (ciclo?.resultado === "bloqueado_pelo_gate") {
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

  if (ciclo?.resultado === "orcamento_estourado") {
    return (
      <p role="status" aria-live="polite" className="rounded-controle border border-[color:var(--ambar)] bg-ambar-fraco px-3.5 py-2.5 text-sm text-tinta">
        <span className="mb-0.5 block font-bold text-[color:var(--ambar)]">Limite de consultas da sessão atingido</span>
        O copiloto virou só transcrição.
      </p>
    );
  }

  if (ciclo?.resultado === "timeout" || ciclo?.resultado === "indisponivel" || ciclo?.resultado === "conteudo_recusado") {
    return (
      <p role="status" aria-live="polite" className="rounded-controle border border-[color:var(--ambar)] bg-ambar-fraco px-3.5 py-2.5 text-sm text-tinta">
        A IA não respondeu desta vez. Continua tentando.
      </p>
    );
  }

  if (ultimaSugestaoAbaixoDoLimiar) {
    return (
      <p role="status" aria-live="polite" className="rounded-controle border border-linha px-3.5 py-2.5 text-sm text-tinta-suave">
        {MENSAGEM_CONFIANCA_ABAIXO_DO_LIMIAR}
      </p>
    );
  }

  if (requisicaoEmVoo) {
    return (
      // F7 — texto "Consultando…" INTOCADO (contrato de 6 testes
      // pré-existentes que asseveram o literal) + 3 pontos com delay
      // (`pensando-pontos`), SÓ decorativo (`aria-hidden`) — o
      // `aria-live="polite"` continua no `<p>` (única fonte de anúncio
      // desta linha).
      <p role="status" aria-live="polite" className="flex items-center gap-1 rounded-controle border border-linha px-3.5 py-2.5 text-sm text-tinta-suave">
        Consultando…
        <span aria-hidden="true" className="inline-flex gap-0.5">
          <span className="h-1 w-1 rounded-full bg-current anim-pensando-ponto-1" />
          <span className="h-1 w-1 rounded-full bg-current anim-pensando-ponto-2" />
          <span className="h-1 w-1 rounded-full bg-current anim-pensando-ponto-3" />
        </span>
      </p>
    );
  }

  return (
    <p role="status" aria-live="polite" className="flex items-center gap-1.5 rounded-controle border border-linha px-3.5 py-2.5 text-sm text-tinta-suave">
      {/* F7 — "batimento de vida": ponto que respira, SÓ no ramo "Ouvindo."
       * (silêncio normal) — prova de que a linha está viva mesmo sem
       * novidade, decorativo (`aria-hidden`). */}
      <span aria-hidden="true" className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current anim-respirar" />
      Ouvindo.
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
  blocoAtualCoberto,
  proximoBloco,
}: {
  sessaoId: string;
  indiceAtual: number;
  sugestoesCiclo: SugestaoCopilotoPolling[];
  blocosRoteiro?: { id: string; titulo?: string }[];
  irPara?: (indice: number) => void;
  /** B73 — `estado.falta_no_bloco` (campos + observar) do payload
   * determinístico: `true` quando o bloco atual não tem mais nada pendente
   * segundo o SERVIDOR. Distingue "bloco coberto" de "a IA não teve nada a
   * apontar agora" dentro de `ApresentacaoSugestao`. */
  blocoAtualCoberto: boolean;
  /** `estado.blocos_nao_percorridos[0]` — `null` quando não há próximo
   * bloco (fim do roteiro). */
  proximoBloco: BlocoPendente | null;
}) {
  const temSugestaoCiclo = sugestoesCiclo.length > 0;
  // Fase 12, Fatia C — contador de não-lido NO PRÓPRIO RÓTULO do quadro
  // ("Fale agora · 2 novas"), sem badge circular nem número flutuante
  // (pedido do dono: denso e chapado). Estado local por `sugestao_id` visto
  // — `SugestoesDoCiclo` é quem sabe quais IDs existem e quando um deixa de
  // ser "novo"; aqui só se acumula a contagem para o rótulo.
  const [naoLidas, setNaoLidas] = useState(0);
  // Iteração 3 (18/09/2026, achado do Fable) — `temSugestaoCiclo` só diz "há
  // algo na lista", não "o herói está mostrando Bloco coberto AGORA" (herói
  // pode estar dispensado, abaixo do limiar ou com conteúdo). `SugestaoIA`
  // precisa do fato específico para decidir se suprime O CARD DELA — ver
  // comentário completo em `SugestaoIA`. `SugestoesDoCiclo` só existe (é
  // montado) quando `temSugestaoCiclo`; ao desmontar (lista esvazia), o
  // último valor reportado ficaria "preso" — o reset explícito abaixo cobre
  // essa transição sem exigir cleanup no filho.
  const [heroiMostraCoberto, setHeroiMostraCoberto] = useState(false);
  if (!temSugestaoCiclo && heroiMostraCoberto) {
    // Espelha o padrão de "setState derivado durante o render" só quando o
    // valor DIVERGE do que o próximo render precisa (mesma régua seguida
    // pelo React para evitar loop: idempotente, não dispara de novo depois
    // que o estado já reflete `false`).
    setHeroiMostraCoberto(false);
  }
  // F7 — "· N nova" pulsa UMA vez a cada valor novo (chave = o próprio
  // valor): 1→2 pulsa de novo, 2→2 (mesmo render) não repete. 320ms casa com
  // `@keyframes pulsar-uma-vez` (`.anim-pulsar-uma-vez`, globals.css).
  const pulsar = useRealceUmaVez(naoLidas > 0, String(naoLidas), 320);

  return (
    <Quadro
      rotulo={
        naoLidas > 0 ? (
          <>
            Fale agora{" "}
            <span className={`font-normal text-tinta-fraca ${pulsar ? "inline-block anim-pulsar-uma-vez" : "inline-block"}`}>
              · {naoLidas} nova{naoLidas > 1 ? "s" : ""}
            </span>
          </>
        ) : (
          "Fale agora"
        )
      }
      icone={<IconeAcao />}
      como="article"
    >
      {/* 🔴 F3 (17/09) — o `max-h`/`overflow-y-auto`/`role="region"` PRÓPRIO
       * que existia aqui SAIU: era um 2º container de rolagem dentro da
       * `Coluna rolavel` (COL 1, `PainelCopiloto.tsx`), que já é a única
       * superfície de scroll desta coluna — "duplo scroll" era exatamente
       * este aninhamento (achado do dono). Geometria constante continua
       * garantida (o teto agora é o da `Coluna` ancestral, não deste bloco). */}
      <div className="flex flex-col gap-3">
        {temSugestaoCiclo && (
          <SugestoesDoCiclo
            sessaoId={sessaoId}
            sugestoes={sugestoesCiclo}
            blocosRoteiro={blocosRoteiro}
            irPara={irPara}
            aoMudarNaoLidas={setNaoLidas}
            aoMudarHeroiMostraCoberto={setHeroiMostraCoberto}
            blocoAtualCoberto={blocoAtualCoberto}
            proximoBloco={proximoBloco}
          />
        )}

        <div className={temSugestaoCiclo ? "border-t border-dashed border-linha pt-3" : undefined}>
          <SugestaoIA
            sessaoId={sessaoId}
            indiceAtual={indiceAtual}
            blocosRoteiro={blocosRoteiro}
            irPara={irPara}
            temSugestaoCiclo={temSugestaoCiclo}
            heroiMostraCoberto={heroiMostraCoberto}
            blocoAtualCoberto={blocoAtualCoberto}
            proximoBloco={proximoBloco}
          />
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

/** Card-herói (F4, 17/09) — ícone de pessoa, círculo `--acento-fraco`. */
const IconePessoa = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3 w-3">
    <circle cx="10" cy="7" r="3.2" fill="currentColor" />
    <path d="M4 16.5c0-3 2.7-5 6-5s6 2 6 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

/** Extrai o ÚLTIMO item de `cobriu_no_bloco` com evidência não nula — mesmo
 * padrão de `ultimoItemFaltaComEvidencia` (par positivo, migration 0119). Só
 * considera item com `evidencia` preenchida: sem citação literal comprovada
 * não é um acerto apresentável (regra do tipo — ver comentário de
 * `cobriu_no_bloco` em `types/copiloto.ts`, "a IA fabricando elogio sem
 * lastro é o mesmo risco que o vermelho corre ao acusar sem prova"). */
function ultimoItemAcertoComEvidencia(
  sugestoes: SugestaoCopilotoPolling[],
): { valor: { item: string; evidencia: string }; sugestaoId: string; criadoEm: string } | null {
  return ultimoNaoNulo(sugestoes, (s) => {
    const item = s.sugestao?.cobriu_no_bloco?.find((c) => c.evidencia);
    return item && item.evidencia ? { item: item.item, evidencia: item.evidencia } : null;
  });
}

const IconeAcerto = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3 w-3">
    <path d="M4.5 10.5l3.6 3.5 7.4-8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const IconeErro = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3 w-3">
    <path d="M5 5l10 10M15 5 5 15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);

/**
 * Pedido do dono (17/09, respondido agora): o verde/vermelho julga a
 * CONDUÇÃO DA ADVOGADA, não a fala do cliente — ✅ cobriu o item do bloco;
 * ❌ pulou item obrigatório.
 *
 * 🔴 CORREÇÃO (F5, 17/09) — os emojis ✅/❌ SAEM (viram ícone SVG em círculo,
 * mesmo padrão de `IconePessoa`/`IconeAcao`); os TEXTOS "ACERTO"/"ERRO"
 * FICAM (decisão do dono — cor nunca é o único sinal, o texto por extenso
 * continua carregando o significado). Cada linha vira CARD TINTADO
 * (`bg-vermelho-fraco`/`bg-verde-fraco` + borda 30% opaca) — parte do
 * "sistema vivo" pedido pelo dono (gatilho visual de acerto/erro), não mais
 * uma linha solta sobre `--papel-elevado`.
 *
 * `SugestaoCopiloto.cobriu_no_bloco` (migration 0119, backend em paralelo)
 * é `?:` — regra da casa vale ao pé da letra aqui: sem evidência conferida,
 * o item nem chega a este componente (`ultimoItemAcertoComEvidencia` já
 * filtra), e sem NENHUM item, a linha do acerto simplesmente não existe —
 * nunca um "0 acertos" nem um placeholder. Kill-switch próprio
 * (`copiloto_sessao.acerto_erro_ativo`) desligado tem o MESMO efeito: campo
 * sempre ausente/vazio, então a seção nunca aparece — a tela não distingue
 * "desligado" de "nada para mostrar ainda", pela mesma regra de honestidade
 * (vazio é vazio, nunca um motivo inventado).
 *
 * Fonte: `sugestoesCiclo` (mesma do `BlocoCuidado`/`ultimoItemFaltaComEvidencia`
 * — reuso, zero query nova). `ultimoNaoNulo` evita que os cards sumam da
 * tela só porque o ciclo seguinte não repetiu o campo, mesmo que o fato
 * continue valendo.
 *
 * Texto factual, nunca repreensivo: "Entrou em holding sem fechar os 4
 * SIMs", nunca "você errou ao...". `falta_no_bloco[].item`/
 * `cobriu_no_bloco[].item` já vêm da IA como frase de fato, não de
 * julgamento — este componente não adiciona adjetivo. Esta tela é PRIVADA
 * da Dra. Elaine, lida de relance num telão só dela — não é compartilhada
 * com o cliente; o padrão factual vale por si (clareza de leitura rápida),
 * não por causa de quem mais estaria vendo (ninguém mais está).
 *
 * F7 — "sistema vivo": cada card usa `entrar-insight` (chave = item+hora, via
 * `useRealceUmaVez`) na entrada e `decair-destaque` para o flash que decai —
 * nunca shake, nunca deslocamento de geometria (o card já nasce no tamanho
 * final). As duas animações tocam juntas via `.anim-entrar-e-decair`
 * (globals.css) — ver `CardPlacar` sobre por que não são duas classes soltas.
 */
function PlacarConducao({ sugestoesCiclo }: { sugestoesCiclo: SugestaoCopilotoPolling[] }) {
  const acerto = ultimoItemAcertoComEvidencia(sugestoesCiclo);
  const erro = ultimoItemFaltaComEvidencia(sugestoesCiclo);

  if (!acerto && !erro) return null;

  return (
    <div role="status" className="flex flex-col gap-2 border-t border-linha pt-2">
      {acerto && (
        <CardPlacar chave={`acerto-${acerto.sugestaoId}`}>
          <div className="flex flex-col gap-1 rounded-controle border border-[color:var(--verde)]/30 bg-verde-fraco p-2.5">
            <p className="flex items-center gap-1.5 text-sm text-tinta">
              <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color:var(--verde)]/15 text-[color:var(--verde)]">
                <IconeAcerto />
              </span>
              <span className="font-bold text-[color:var(--verde)]">ACERTO —</span>
              {acerto.valor.item}
            </p>
            <p className="text-legenda italic text-tinta-fraca">
              &ldquo;{acerto.valor.evidencia}&rdquo; · {formatarHora(acerto.criadoEm)}
            </p>
          </div>
        </CardPlacar>
      )}
      {erro && (
        <CardPlacar chave={`erro-${erro.sugestaoId}`}>
          <div className="flex flex-col gap-1 rounded-controle border border-[color:var(--vermelho)]/30 bg-vermelho-fraco p-2.5">
            <p className="flex items-center gap-1.5 text-sm text-tinta">
              <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color:var(--vermelho)]/15 text-[color:var(--vermelho)]">
                <IconeErro />
              </span>
              <span className="font-bold text-[color:var(--vermelho)]">ERRO —</span>
              {erro.valor.item}
            </p>
            <p className="text-legenda italic text-tinta-fraca">
              &ldquo;{erro.valor.evidencia}&rdquo; · {formatarHora(erro.criadoEm)}
            </p>
          </div>
        </CardPlacar>
      )}
    </div>
  );
}

/** F7 — wrapper do card do placar: `entrar-insight` (opacity+scale) na
 * entrada e `decair-destaque` (flash que decai, nunca shake) disparados UMA
 * vez por `chave` — mesmo contrato de `useRealceUmaVez`. Geometria constante:
 * a borda já existe desde o primeiro render (o `.decair-destaque` só troca
 * `border-color`/`background-color`, nunca largura).
 *
 * 🔴 `.anim-entrar-insight` e `.anim-decair-destaque` juntas no mesmo
 * elemento colidem (dois shorthands `animation`, o de trás vence por
 * inteiro) — `.anim-entrar-e-decair` (globals.css) as combina numa única
 * declaração. `duracaoMs=5000` casa com `@keyframes decair-destaque`. */
function CardPlacar({ chave, children }: { chave: string; children: ReactNode }) {
  const destacar = useRealceUmaVez(true, chave, 5000);
  return <div className={destacar ? "anim-entrar-e-decair" : "anim-entrar-insight"}>{children}</div>;
}

/**
 * Histórico compacto das sugestões do ciclo — a MAIS RECENTE aparece aberta,
 * por inteiro, sem clique (herda de B71: a sugestão nunca some atrás de um
 * clique extra — o card entra com `entrar-insight`/`decair-destaque`, F7,
 * mas continua sem exigir interação para ser lida). 🔴 B71 REVOGADA POR
 * INTEIRO em 17/09/2026 (decisão do dono, ver `docs/ARQUITETURA-FASE-10.md`
 * §10): a frase "nada pisca, nada toca, nada abre sozinho" deixou de ser
 * regra geral desta tela — o pedido agora é um sistema VIVO, com animação e
 * gatilho visual (F7, `globals.css`). Anteriores ficam recolhidas de
 * CONTEÚDO (nunca de existência): o `<summary>` já mostra a contagem.
 *
 * Fase 12, Fatia C — "não lido" é ESTADO local por `sugestao_id`, nunca
 * coluna nova nem rota nova. Regra: uma sugestão nasce "não lida" e só é
 * marcada como lida quando DEIXA de ser a card "recente" — enquanto ela é o
 * herói do bloco, ainda está na frente da advogada, então ainda não foi
 * "vista e superada"; no instante em que uma sugestão mais nova a empurra
 * para "anteriores", ela já cumpriu o papel de "bater o olho" e sai da
 * contagem. Isso também cobre o "some ao ver" pedido: a mudança de estado
 * que marca como lida é a MESMA que move o card, nunca um timer arbitrário.
 */
function SugestoesDoCiclo({
  sessaoId,
  sugestoes,
  blocosRoteiro,
  irPara,
  aoMudarNaoLidas,
  aoMudarHeroiMostraCoberto,
  blocoAtualCoberto,
  proximoBloco,
}: {
  sessaoId: string;
  sugestoes: SugestaoCopilotoPolling[];
  blocosRoteiro?: { id: string }[];
  irPara?: (indice: number) => void;
  aoMudarNaoLidas?: (n: number) => void;
  /** Iteração 3 (18/09/2026, achado do Fable) — reporta ao pai se o HERÓI
   * (esta função) está de fato renderizando `BlocoCoberto` agora, e não
   * apenas "existe alguma sugestão na lista" (`temSugestaoCiclo`). Os dois
   * predicados divergiam: herói dispensado, abaixo do limiar (`!visivel`,
   * filtrado em `pendentes`) ou com conteúdo (`nada` falso) faziam
   * `temSugestaoCiclo` continuar `true` mesmo sem nenhum `BlocoCoberto` na
   * tela — e `SugestaoIA` suprimia o card DELA por engano, caindo no texto
   * "não teve nada específico a apontar agora" bem depois de um clique no
   * botão "Me ajuda agora". */
  aoMudarHeroiMostraCoberto?: (mostra: boolean) => void;
  blocoAtualCoberto: boolean;
  proximoBloco: BlocoPendente | null;
}) {
  const [dispensadas, setDispensadas] = useState<Record<string, boolean>>({});
  const [vistos, setVistos] = useState<Record<string, boolean>>({});

  // Fatia 3 (17/09) — achado do arquiteto: uma sugestão `!visivel` (IA
  // respondeu abaixo do limiar de confiança) virava card no herói mesmo
  // assim, mostrando "Confiança abaixo do mínimo configurado — nada
  // mostrado." no espaço mais nobre da tela. Sugestão invisível NUNCA vira
  // card aqui — o fato "a IA respondeu abaixo do limiar" passou a viver como
  // linha fina no rodapé (`EstadoDoCopiloto`, em `PainelCopiloto`).
  const pendentes = sugestoes.filter(
    (s): s is SugestaoCopilotoPolling & { sugestao: SugestaoCopiloto } => !dispensadas[s.sugestao_id] && s.visivel && s.sugestao !== null,
  );

  const recente = pendentes[pendentes.length - 1];
  const anteriores = pendentes.slice(0, -1);

  // Marca como visto todo item que deixou de ser "recente" (agora está em
  // `anteriores`) — roda a cada render em que a lista muda, sem efeito
  // colateral de rede. `useEffect` para não disparar `setState` do pai
  // (`aoMudarNaoLidas`) durante o render deste componente.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- ver abaixo
  useEffect(() => {
    // 🔴 EXCEÇÃO DELIBERADA (18/09/2026). O lint novo do React marca
    // `setState` síncrono dentro de effect como erro — e derrubou o CI desde
    // `fb1b135` (17/09). Aqui o padrão é seguro e a exceção é consciente:
    //
    // - o `setVistos` usa updater e devolve `atual` quando nada muda
    //   (`mudou ? novo : atual`), então não há re-render em cascata;
    // - a dependência é a LISTA DE IDS serializada, não o objeto, então o
    //   effect só roda quando a lista realmente muda;
    // - o effect existe justamente para NÃO chamar `aoMudarNaoLidas`
    //   (`setState` do PAI) durante o render deste componente.
    //
    // Tentei derivar `vistos` da lista e remover o estado: passa no lint e nos
    // 105 testes deste arquivo, mas MUDA o comportamento — o contador "· N
    // novas" deixa de decrescer conforme a advogada lê, porque "visto" passa a
    // ser função só de "é a mais recente". Nenhum teste cobre esse contador,
    // então o verde não provaria equivalência. Numa tela usada ao vivo, trocar
    // comportamento sem cobertura é pior que conviver com a exceção.
    //
    // Fica como dívida NOMEADA: derivar de verdade exige primeiro um teste do
    // contador de não lidas.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVistos((atual) => {
      let mudou = false;
      const novo = { ...atual };
      for (const s of anteriores) {
        if (!novo[s.sugestao_id]) {
          novo[s.sugestao_id] = true;
          mudou = true;
        }
      }
      return mudou ? novo : atual;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    });
  }, [anteriores.map((s) => s.sugestao_id).join(",")]);

  useEffect(() => {
    const total = pendentes.filter((s) => !vistos[s.sugestao_id]).length;
    aoMudarNaoLidas?.(total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendentes.map((s) => s.sugestao_id).join(","), vistos]);

  // Iteração 3 — mesmo predicado de `ApresentacaoSugestao` (`nada` +
  // `blocoAtualCoberto`) que decide `BlocoCoberto`, calculado aqui para o
  // card do HERÓI especificamente. Sem `recente` (nenhum pendente — herói
  // dispensado ou abaixo do limiar já removidos de `pendentes`), o herói não
  // está mostrando `BlocoCoberto`: `false`. Booleano primitivo, estável
  // entre renders com o mesmo resultado — não é objeto novo a cada chamada.
  const heroiMostraCoberto = Boolean(
    recente &&
      blocoAtualCoberto &&
      !recente.sugestao.proxima_pergunta &&
      recente.sugestao.falta_no_bloco.length === 0 &&
      !recente.sugestao.observacao &&
      !recente.sugestao.desvio_sugerido,
  );

  // Reporta ao pai em effect — nunca durante o render deste componente,
  // mesma régua de `aoMudarNaoLidas` logo acima (`set-state-in-effect`
  // seria disparado do PAI se chamado direto no corpo da função).
  useEffect(() => {
    aoMudarHeroiMostraCoberto?.(heroiMostraCoberto);
  }, [heroiMostraCoberto, aoMudarHeroiMostraCoberto]);

  if (pendentes.length === 0) return null;

  const recenteNaoLida = Boolean(recente) && !vistos[recente.sugestao_id];

  return (
    <div className="flex flex-col gap-2">
      <CardRecente sugestaoId={recente.sugestao_id} naoLida={recenteNaoLida}>
        <ApresentacaoSugestao
          sessaoId={sessaoId}
          sugestaoId={recente.sugestao_id}
          sugestao={recente.sugestao}
          blocosRoteiro={blocosRoteiro}
          irPara={irPara}
          blocoAtualCoberto={blocoAtualCoberto}
          proximoBloco={proximoBloco}
        />
        {/* F4 (17/09) — rodapé do herói: hora SEMPRE (F0 — `criado_em` real,
         * nunca condicional) à esquerda, "Dispensar" à direita, mesma
         * linha. */}
        <div className="mt-2 flex items-center justify-between gap-2">
          <CarimboHora criadoEm={recente.criado_em} />
          <Botao
            variante="fantasma"
            tamanho="compacto"
            onClick={() => setDispensadas((atual) => ({ ...atual, [recente.sugestao_id]: true }))}
          >
            Dispensar
          </Botao>
        </div>
      </CardRecente>

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
              {/* `anteriores` vem de `pendentes`, que já filtrou
               * `!visivel`/`sugestao` nulo (Fatia 3) — o branch "Confiança
               * abaixo do mínimo" nunca foi alcançável aqui depois do
               * filtro; código morto removido, não só simplificado. */}
              {anteriores.map((s) => (
                <li key={s.sugestao_id} className="rounded-controle border border-linha p-2.5">
                  {/* Histórico: "bloco coberto" só se aplica ao AGORA — uma
                   * sugestão anterior mostrar de novo "vá para o próximo
                   * bloco" seria uma 2ª ação de navegação na tela, competindo
                   * com a do card recente. `blocoAtualCoberto={false}` aqui
                   * preserva o texto sóbrio de sempre para o passado. */}
                  <ApresentacaoSugestao
                    sessaoId={sessaoId}
                    sugestaoId={s.sugestao_id}
                    sugestao={s.sugestao}
                    blocosRoteiro={blocosRoteiro}
                    irPara={irPara}
                    blocoAtualCoberto={false}
                    proximoBloco={null}
                  />
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
 * Fase 12, Fatia C/F7 — wrapper do card "recente" que carrega o gatilho de
 * insight novo (`entrar-insight` + `decair-destaque`, disparado UMA vez por
 * `sugestaoId` via `useRealceUmaVez` — extraído em F7, era `useState`/
 * `useEffect` inline duplicado do mesmo hook de `PainelTranscricao.tsx`) e a
 * borda esquerda de 2px de "não lido". As duas coisas são independentes de
 * propósito: o gatilho roda UMA VEZ por `sugestaoId` (reinicia quando um
 * card novo chega, nunca se repete no mesmo card); a borda é ESTADO puro,
 * fica ligada enquanto `naoLida=true` e nunca anima (troca de cor instantânea
 * quando a advogada avança para o próximo card, sem transição nela mesma —
 * só o FUNDO/BORDA têm a régua de `decair-destaque`, por pedido explícito do
 * dono: "nada pisca, nada toca, gatilho visual só de cor/opacidade").
 *
 * Geometria constante: `border` (todos os lados) já existe desde o primeiro
 * render, nunca varia de largura — só a cor da borda esquerda e o fundo
 * mudam, então o realce nunca desloca o que está embaixo.
 *
 * 🔴 `entrar-insight`+`decair-destaque` juntas colidiam (ver `CardPlacar`) —
 * `.anim-entrar-e-decair` combina as duas; `duracaoMs=5000` casa com
 * `@keyframes decair-destaque`.
 */
function CardRecente({ sugestaoId, naoLida, children }: { sugestaoId: string; naoLida: boolean; children: ReactNode }) {
  const destacar = useRealceUmaVez(naoLida, sugestaoId, 5000);

  return (
    <div
      className={`rounded-controle border p-2.5 ${destacar ? "anim-entrar-e-decair" : "anim-entrar-insight"} ${
        naoLida ? "border-linha border-l-2 border-l-[color:var(--ambar)]" : "border-linha"
      }`}
    >
      {children}
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
    // Fatia 10 (17/09) — `border-t` interno removido: o rodapé de
    // `PainelCopiloto` já tem `border-t` (linha do topo do rodapé inteiro) e
    // agora também `border-l` (separador do bloco de ações destrutivas) —
    // manter os dois era borda dupla no mesmo canto.
    <div className="flex flex-col gap-2">
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
 * O botão "Me ajuda agora" e a apresentação da sugestão. Herda de B70/B71: a
 * sugestão só existe na tela depois do clique explícito da Dra. Elaine, e
 * fica onde apareceu até ela pedir outra ou trocar de bloco/sessão (não há
 * timer nem auto-refresh puxando conteúdo novo sozinho — isso não mudou).
 * 🔴 B71 REVOGADA POR INTEIRO em 17/09/2026 (decisão do dono): a frase "nada
 * pisca, nada toca, nada abre sozinho" deixou de valer para ANIMAÇÃO — o
 * card que a IA devolve agora pode usar `entrar-insight`/`decair-destaque`
 * (F7). O que sobrevive aqui é só "sem clique, sem sugestão" — o gatilho de
 * geração continua sendo o clique, nunca um timer.
 */
function SugestaoIA({
  sessaoId,
  indiceAtual,
  blocosRoteiro,
  irPara,
  temSugestaoCiclo,
  heroiMostraCoberto,
  blocoAtualCoberto,
  proximoBloco,
}: {
  sessaoId: string;
  indiceAtual: number;
  blocosRoteiro?: { id: string }[];
  irPara?: (indice: number) => void;
  /** `sugestoesCiclo.length > 0` — usado só para a prioridade 3 do bloco
   * ("sem nenhuma das duas, linha curta de aguardando"), NÃO para decidir se
   * este card suprime `BlocoCoberto` (ver `heroiMostraCoberto` abaixo). */
  temSugestaoCiclo: boolean;
  /** Iteração 3 (18/09/2026, achado do Fable) — `true` só quando o card do
   * HERÓI (`SugestoesDoCiclo`) está de fato renderizando `BlocoCoberto`
   * agora. Antes, `blocoAtualCobertoParaEstaSugestao` usava `temSugestaoCiclo`
   * para essa decisão e divergia do fato real em 3 casos: herói dispensado,
   * herói abaixo do limiar de confiança (`!visivel`) e herói com conteúdo
   * (`nada` falso) — nos três, `temSugestaoCiclo` continuava `true` sem
   * nenhum `BlocoCoberto` na tela, e esta função suprimia o card DELA por
   * engano. */
  heroiMostraCoberto: boolean;
  blocoAtualCoberto: boolean;
  proximoBloco: BlocoPendente | null;
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

  // 🔴 CORRIGIDO (18/09/2026, achado do Fable) — DOIS cards "Bloco coberto"
  // ao mesmo tempo, com DOIS botões "Ir para o próximo bloco" empilhados na
  // mesma coluna, quando `SugestoesDoCiclo` (herói) JÁ está oferecendo o
  // card de bloco coberto e a advogada também clica "Me ajuda agora": os
  // dois `ApresentacaoSugestao` (`SugestoesDoCiclo` e este) recebem o MESMO
  // `blocoAtualCoberto` vindo do estado do servidor — e um card `nada` (a IA
  // sob demanda também não tem pergunta nova, porque o bloco de fato já foi
  // coberto) também vira "Bloco coberto" aqui, duplicando a ação.
  //
  // Regra: só UM card oferece "Ir para o próximo bloco" — o herói
  // (`SugestoesDoCiclo`) tem precedência, por já estar na tela ANTES do
  // clique manual. Quando `heroiMostraCoberto` é `true` (o herói ESTÁ, agora,
  // de fato renderizando `BlocoCoberto` — não apenas "existe alguma sugestão
  // na lista"), a sugestão sob demanda desta função nunca afirma "Bloco
  // coberto" — cai no texto sóbrio de sempre ("a IA respondeu, mas não teve
  // nada específico a apontar agora"), que continua verdadeiro (o bloco ESTÁ
  // coberto, só que a AÇÃO de avançar já está oferecida em outro lugar da
  // mesma coluna).
  //
  // 🔴 CORRIGIDO (iteração 3, 18/09/2026) — o antigo `temSugestaoCiclo`
  // (`sugestoesCiclo.length > 0`) divergia deste fato: herói dispensado,
  // abaixo do limiar de confiança ou com conteúdo faziam `temSugestaoCiclo`
  // continuar `true` sem nenhum `BlocoCoberto` na tela, suprimindo este card
  // por engano — a advogada clicava "Me ajuda agora" num herói dispensado e
  // via "não teve nada específico a apontar agora" em vez de "Bloco coberto".
  const blocoAtualCobertoParaEstaSugestao = heroiMostraCoberto ? false : blocoAtualCoberto;

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
          {MENSAGEM_CONFIANCA_ABAIXO_DO_LIMIAR}
        </p>
      )}

      {!pedindo && !erro && resposta && resposta.visivel && resposta.sugestao && (
        <ApresentacaoSugestao
          sessaoId={sessaoId}
          sugestaoId={resposta.sugestao_id}
          sugestao={resposta.sugestao}
          blocosRoteiro={blocosRoteiro}
          irPara={irPara}
          blocoAtualCoberto={blocoAtualCobertoParaEstaSugestao}
          proximoBloco={proximoBloco}
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
 * inventado na tela"). Reusa `formatarHora` de `@/lib/formatar`.
 *
 * 🔴 CORREÇÃO (F0/F4, 17/09, pedido do dono): antes só aparecia quando o
 * valor exibido NÃO vinha da sugestão mais recente do ciclo ("Registrado às"
 * some quando o card É o mais recente) — decisão revertida: hora em TODO
 * card, sempre, é o `criado_em` REAL do dado (nunca inventado, nunca
 * condicional a "é ou não o mais recente"). `sugestaoId`/`sugestoesCiclo`
 * saíram da assinatura — eram só para a checagem que não existe mais.
 *
 * 🔴 RENOMEADO (Fable, 17/09): chamava-se `CarimboHoraSeAntigo`, nome que
 * sobrou da condição que a correção acima removeu — o componente sempre
 * renderiza, incondicionalmente, então o nome mentia. `CarimboHora` diz o
 * que ele faz hoje.
 */
function CarimboHora({ criadoEm }: { criadoEm: string }) {
  return <p className="text-legenda text-tinta-fraca">Registrado às {formatarHora(criadoEm)}</p>;
}

/** `evidencia` é citação literal do que o cliente disse — apresentada como
 * citação, visivelmente distinta da conclusão da IA.
 *
 * F4 (17/09) — o rótulo "CLIENTE DISSE" vira `<Selo>` (fundo `--acento-
 * fraco`, texto `--acento`, fallback `--latao*` fora da rota) e a borda
 * esquerda da citação acompanha `var(--acento,var(--latao))` — reforço
 * cromático de que aquele trecho é FALA REAL do cliente, não conclusão da
 * IA (que fica sem cor, `border-linha-forte`). Só quando `rotulo` existe: as
 * citações SEM rótulo (falta-no-bloco, observação da IA) continuam neutras
 * — a cor de "cliente disse" não pode vazar para citação que não é dele. */
function Evidencia({ texto, rotulo }: { texto: string; rotulo?: string }) {
  return (
    <blockquote
      className={`pl-2.5 text-sm italic text-tinta-suave ${
        rotulo ? "border-l-2 border-[color:var(--acento,var(--latao))]" : "border-l-2 border-linha-forte"
      }`}
    >
      {rotulo && (
        <div className="mb-1 not-italic">
          {/* `style` inline (não `className`) para a cor do selo: duas
           * utilities Tailwind de mesma camada (`bg-papel` do tom "neutro" ×
           * `bg-[color:...]` daqui) resolvem pela ORDEM DE GERAÇÃO do CSS,
           * não pela ordem na string — a mesma armadilha documentada em
           * `Botao.tsx`. `style` sempre vence sem depender de precedência. */}
          <Selo tom="neutro" style={{ backgroundColor: "var(--acento-fraco, var(--latao-fraco))", color: "var(--acento, var(--latao))", borderColor: "transparent" }}>
            {rotulo}
          </Selo>
        </div>
      )}
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
  blocoAtualCoberto,
  proximoBloco,
}: {
  sessaoId: string;
  /** `resposta.sugestao_id` — nível de `RespostaSugestaoCopiloto`, não de
   * `SugestaoCopiloto`. É o vínculo para `POST .../[sugestaoId]/desfecho`. */
  sugestaoId: string;
  sugestao: SugestaoCopiloto;
  blocosRoteiro?: { id: string; titulo?: string }[];
  irPara?: (indice: number) => void;
  /** B73 — `true` quando o SERVIDOR (`estado.falta_no_bloco`, não a
   * sugestão) já não tem campo/observação pendente no bloco atual. */
  blocoAtualCoberto: boolean;
  proximoBloco: BlocoPendente | null;
}) {
  const nada =
    !sugestao.proxima_pergunta &&
    sugestao.falta_no_bloco.length === 0 &&
    !sugestao.observacao &&
    !sugestao.desvio_sugerido;

  if (nada) {
    // B73 — bloqueio de ativação da memória do copiloto (Fatia A, `66dc5b3`).
    // A memória faz `proxima_pergunta: null` quando os temas do bloco já
    // foram todos perguntados — ANTES desta mudança, isso caía no MESMO
    // texto sóbrio de "silêncio genuíno" que a IA usa quando simplesmente
    // não tem nada, o que passou a ser FALSO com a memória ligada: a verdade
    // aqui é "cobriu o bloco, pode avançar". `blocoAtualCoberto` (fato do
    // ESTADO do servidor, nunca inferido da sugestão) decide qual dos dois
    // é real; sugestão vazia com campo AINDA pendente no estado continua no
    // texto antigo — silêncio genuíno, não bloco coberto.
    if (blocoAtualCoberto) {
      return <BlocoCoberto proximoBloco={proximoBloco} blocosRoteiro={blocosRoteiro} irPara={irPara} />;
    }
    return (
      <p className="rounded-controle border border-dashed border-linha-forte px-3 py-2 text-sm text-tinta-suave">
        A IA respondeu, mas não teve nada específico a apontar agora.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {sugestao.proxima_pergunta && (
        // F4 (17/09) — card-herói: ícone de pessoa 20px em círculo
        // `--acento-fraco` à esquerda (fora da rota, cai no fallback
        // `--latao-fraco` — mesmo componente, sem `if`). Grid com `shrink-0`
        // no ícone e `min-w-0` no conteúdo — a mesma armadilha de geometria
        // já registrada (nome/texto longo não pode empurrar o ícone).
        <div className="flex items-start gap-2.5 rounded-controle border border-linha px-3 py-2.5">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color:var(--acento-fraco,var(--latao-fraco))] text-[color:var(--acento,var(--latao))]"
          >
            <IconePessoa />
          </span>
          <div className="min-w-0 flex-1">
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

/**
 * B73 — estado "bloco coberto": os temas do bloco atual já foram todos
 * perguntados (fato do servidor, `estado.falta_no_bloco`), então
 * `proxima_pergunta: null` deixa de ser "silêncio" e passa a significar
 * "pode avançar". Decisão do dono (17/09, revogação do B71 para esta tela):
 * "sistema vivo" — usa o MESMO gatilho de insight novo que `CardRecente` já
 * usa (`anim-entrar-e-decair`, disparado uma vez por bloco coberto via
 * `useRealceUmaVez`), nunca uma tela morta. `prefers-reduced-motion` zera a
 * `@keyframes` inteira em `globals.css` — nada aqui duplica a media query.
 *
 * Geometria constante (mesmo padrão de `CardRecente`/`DesvioSugerido`): a
 * borda existe desde o primeiro render, só cor/fundo variam.
 *
 * Sem `proximoBloco` (fim do roteiro) o card mostra só o fato "coberto",
 * sem oferecer avanço para lugar nenhum — nunca um índice inventado.
 */
function BlocoCoberto({
  proximoBloco,
  blocosRoteiro,
  irPara,
}: {
  proximoBloco: BlocoPendente | null;
  blocosRoteiro?: { id: string; titulo?: string }[];
  irPara?: (indice: number) => void;
}) {
  // Chave estável por bloco coberto: se o próximo bloco mudar (a advogada
  // avançou e um NOVO bloco terminou de ser coberto), o gatilho visual
  // dispara de novo — é insight novo, não o mesmo re-render.
  const chave = proximoBloco?.id ?? "fim-do-roteiro";
  const destacar = useRealceUmaVez(true, chave, 5000);

  // O servidor já resolve `blocos_nao_percorridos` contra o roteiro ativo;
  // a navegação em si só existe se a tela também conseguir achar o índice
  // real na lista carregada aqui — mesma régua de `DesvioSugerido`.
  const indiceAlvo = proximoBloco ? (blocosRoteiro?.findIndex((b) => b.id === proximoBloco.id) ?? -1) : -1;
  const podeNavegar = Boolean(irPara) && indiceAlvo >= 0;
  const tituloProximo = proximoBloco?.titulo ?? blocosRoteiro?.find((b) => b.id === proximoBloco?.id)?.titulo ?? null;

  return (
    <div
      className={`flex flex-col gap-2 rounded-controle border px-3 py-2.5 ${
        destacar ? "anim-entrar-e-decair border-[color:var(--verde,var(--acento))]" : "anim-entrar-insight border-linha"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-verde-fraco text-[color:var(--verde)]"
        >
          <IconeAcerto />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-subtitulo font-bold leading-snug text-tinta">Bloco coberto</p>
          <p className="mt-1 text-sm text-tinta-suave">
            {proximoBloco ? (
              <>
                Todos os temas deste bloco já foram perguntados. Próximo:{" "}
                <span className="font-medium text-tinta">{tituloProximo ?? proximoBloco.titulo}</span>
              </>
            ) : (
              "Todos os temas deste bloco já foram perguntados — é o último do roteiro."
            )}
          </p>
        </div>
      </div>
      {podeNavegar && (
        <div className="flex justify-end">
          <Botao variante="secundario" tamanho="compacto" onClick={() => irPara!(indiceAlvo)}>
            Ir para o próximo bloco
          </Botao>
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
 * A "falha ainda não corrigida" — Fase 12, Fatia A2 (pedido do Marcio,
 * 17/09): cobertura do roteiro medida ao vivo, guiando "conforme a banda
 * toca". Critério do dono: ACERTO = cobriu o bloco (pergunta feita, mesmo
 * sem resposta); ERRO = pulou item obrigatório. `falta_no_bloco` da IA já É
 * essa falha — só nunca foi apresentada como tal (ver `schema.ts`/`validar.ts`:
 * é o item não coberto do bloco atual, com `evidencia` como citação literal
 * conferida por substring contra a transcrição real).
 *
 * Saída (a) do pedido, não (b): derivar no cliente a partir do que a IA já
 * devolve HOJE, sem esperar um campo `cobertura` novo no schema/backend (que
 * está em paralelo, fora do escopo desta tarefa). `falta_no_bloco[0].evidencia`
 * é exatamente "o item que faltou" + "a citação que prova o contexto real" —
 * o par que a régua dos 30s pede.
 *
 * DUAS DENSIDADES, um dado só (o resumo pós-sessão, Fatia 2, mostrará o
 * placar completo bloco a bloco, incluindo acertos — não é esta tarefa):
 * aqui, ao vivo, só a falha ainda aberta, a MAIS RECENTE, sem lista, sem
 * "Acertos: N/M" — porque saber que acertou não muda a próxima frase da
 * advogada, só saber que errou muda. `ultimoNaoNulo` (mesmo padrão da
 * observação crítica abaixo) evita que a falha suma da tela quando o ciclo
 * seguinte não repete o campo, mesmo que o bloco ainda esteja incompleto.
 *
 * Exige `evidencia` não nula: sem citação literal conferida não é uma falha
 * apresentável como fato (regra da casa — nada de dado inventado na tela),
 * só telemetria (`campos_evidencia_nao_conferida`).
 */
function ultimoItemFaltaComEvidencia(
  sugestoes: SugestaoCopilotoPolling[],
): { valor: { item: string; evidencia: string }; sugestaoId: string; criadoEm: string } | null {
  return ultimoNaoNulo(sugestoes, (s) => {
    const item = s.sugestao?.falta_no_bloco.find((f) => f.evidencia);
    return item && item.evidencia ? { item: item.item, evidencia: item.evidencia } : null;
  });
}

/** Fase 12, Fatia 6 — teto de itens em "Ainda não perguntou" dentro de
 * "Cuidado". O roteiro v5 (30 campos) está ativo e a lista de pendências por
 * bloco pode crescer além do que cabe numa coluna de 32% sem virar rolagem
 * disputando espaço com o resto do bloco — decisão do dono, reversível:
 * mostra os 3 primeiros + "e mais N", nunca trunca calado (o "e mais N" É a
 * contagem real do resto, nunca um "…" mudo). */
const TETO_ITENS_AINDA_NAO_PERGUNTOU = 3;

/** F7 (17/09) — item novo em "Ainda não perguntou" recebe `decair-destaque`
 * (chave `item.chave`) — gatilho visual pedido pelo dono. Componente próprio
 * porque hooks não podem rodar dentro do `.map` do pai. Bullet permanece
 * `--ambar` (decisão vinculante — verde num quadro de risco leria como
 * "resolvido"), intocado por esta mudança: o gatilho é no FUNDO/BORDA do
 * `<li>`, nunca na cor do marcador. */
function ItemAindaNaoPerguntou({ item }: { item: { chave: string; texto: string; evidencia: string | null } }) {
  const destacar = useRealceUmaVez(true, item.chave, 5000);
  return (
    <li className={`rounded-[2px] border border-transparent text-sm text-tinta ${destacar ? "anim-decair-destaque" : ""}`}>
      {item.texto}
      {item.evidencia && <span className="mt-0.5 block text-legenda italic text-tinta-fraca">&ldquo;{item.evidencia}&rdquo;</span>}
    </li>
  );
}

/**
 * BLOCO 2 — "Cuidado" (condicional). Fusão dos quadros de jargão/risco:
 *  - `QuadroAlerta` (SIMs pendentes) → "Falta pedir a autorização de
 *    gravação" e demais pendências, por extenso;
 *  - `QuadroOQueAconteceu` (falta no bloco do estado determinístico) →
 *    "Ainda não perguntou:" no bloco atual;
 *  - `QuadroPodePularPra` (desvio sugerido) → continua com "Ir para lá"/
 *    "Ignorar", agora dentro do mesmo bloco de risco;
 *  - Fase 12, Fatia A2 — a falha de cobertura da IA (`falta_no_bloco` com
 *    evidência), como LINHA, não card: "acertos e erros" do pedido do dono.
 *
 * Regra dura: **sem nenhum dos quatro, o bloco inteiro não existe no DOM** —
 * nunca um card vazio dizendo "nada". Prova por `offsetParent`, nunca por
 * `e.hidden` (filho "visível" dentro de pai `display:none` dá verde falso).
 *
 * Fase 12, Fatia 6 — hierarquia por ORDEM + degrau tipográfico, nunca por
 * rótulo de seção ("AÇÃO/ALERTA/LEITURA" seriam 3 enfeites numa coluna de
 * 32%, achado do dono). A ordem antiga (pendentes → falta → falha →
 * observação → desvio, o único item com BOTÃO por último) escondia a única
 * ação clicável no fim de uma rolagem. Nova ordem:
 *
 *  1. AÇÃO AGORA — desvio sugerido (tem botão), topo, `text-sm`.
 *  2. ALERTA — "Ainda não perguntou" (campos do bloco + falha de cobertura
 *     da IA, unificados no MESMO `<li>` — eram dois tratamentos visuais para
 *     a mesma frase, achado desta fatia) + SIMs pendentes + "Observar",
 *     meio, `text-sm`.
 *  3. LEITURA — hipótese/observação + `SeloConfianca`, base, `text-legenda
 *     text-tinta-fraca`, separada pelo `border-t dashed` que já existia.
 *
 * LIMPEZA desta fatia: o `<li>` com marcador âmbar de `falta.campos`
 * (`marker:text-[color:var(--ambar)]`) e a linha solta de
 * `achadoFalhaCobertura` (cor vermelha, sem marcador) eram dois vocabulários
 * para a mesma ideia ("isto ainda não foi perguntado") — unificados numa
 * única lista com um único tratamento de marcador.
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

  const achadoFalhaCobertura = ultimoItemFaltaComEvidencia(sugestoesCiclo);

  const temFaltaNoBloco = falta.campos.length > 0 || falta.observar.length > 0;
  const temRisco =
    pendentes.length > 0 || Boolean(observacaoCritica) || temFaltaNoBloco || Boolean(achadoDesvio) || Boolean(achadoFalhaCobertura);

  // CONDICIONAL: sem risco nenhum, o bloco não existe no DOM — nunca um
  // card vazio dizendo "nada". `offsetParent`/renderização condicional real
  // (não CSS `hidden`) é o que o teste precisa provar.
  if (!temRisco) return null;

  // ALERTA unificado — campos do bloco (determinístico) + a falha de
  // cobertura mais recente da IA, no MESMO `<li>`/mesmo marcador. A falha de
  // cobertura NUNCA duplica um campo que já está na lista de `falta.campos`
  // (mesmo texto), então só entra quando é uma frase distinta.
  const itensAindaNaoPerguntou = [
    ...falta.campos.map((campo) => ({ chave: campo.id, texto: campo.rotulo, evidencia: null as string | null })),
    ...(achadoFalhaCobertura && !falta.campos.some((c) => c.rotulo === achadoFalhaCobertura.valor.item)
      ? [{ chave: `falha-${achadoFalhaCobertura.sugestaoId}`, texto: achadoFalhaCobertura.valor.item, evidencia: achadoFalhaCobertura.valor.evidencia }]
      : []),
  ];
  const itensVisiveis = itensAindaNaoPerguntou.slice(0, TETO_ITENS_AINDA_NAO_PERGUNTOU);
  const itensOcultos = itensAindaNaoPerguntou.length - itensVisiveis.length;

  return (
    <Quadro rotulo="Cuidado" icone={<IconeAlerta />} tom="vermelho" como="article">
      <div className="flex flex-col gap-2.5">
        {/* 1. AÇÃO AGORA — desvio sugerido, único item com botão, no topo. */}
        {achadoDesvio && (
          <div className="flex flex-col gap-1">
            <DesvioSugerido sessaoId={sessaoId} sugestaoId={achadoDesvio.sugestaoId} desvio={achadoDesvio.valor} blocosRoteiro={blocosRoteiro} irPara={irPara} />
            <CarimboHora criadoEm={achadoDesvio.criadoEm} />
          </div>
        )}

        {/* 2. ALERTA — "Ainda não perguntou" (campos + falha de cobertura,
         * unificados) + SIMs pendentes + "Observar". */}
        {(itensVisiveis.length > 0 || pendentes.length > 0 || falta.observar.length > 0) && (
          <div className={`flex flex-col gap-2 ${achadoDesvio ? "border-t border-dashed border-linha pt-2.5" : ""}`}>
            {itensVisiveis.length > 0 && (
              <div>
                <p className="mb-1 text-rotulo font-medium uppercase text-tinta-fraca">Ainda não perguntou:</p>
                <ul className="ml-4 flex list-disc flex-col gap-1 marker:text-[color:var(--ambar)]">
                  {itensVisiveis.map((item) => (
                    <ItemAindaNaoPerguntou key={item.chave} item={item} />
                  ))}
                </ul>
                {itensOcultos > 0 && <p className="mt-1 text-legenda text-tinta-fraca">e mais {itensOcultos}</p>}
                {achadoFalhaCobertura && (
                  <CarimboHora criadoEm={achadoFalhaCobertura.criadoEm} />
                )}
              </div>
            )}

            {pendentes.length > 0 && (
              <ul className="flex flex-col gap-1">
                {pendentes.map((p) => (
                  <li key={p.sim} className="text-sm text-tinta">
                    {/* Tradução do jargão obrigatória: "SIMs pendentes" → a
                     * pendência por extenso. `p.rotulo` já vem da API como
                     * frase humana ("Decisores presentes", "Próximo passo")
                     * — o rótulo genérico "N de 4 SIMs" fica de fora da tela
                     * ao vivo. */}
                    Falta: {p.rotulo}
                  </li>
                ))}
              </ul>
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

        {/* 3. LEITURA — hipótese/observação, base, degrau tipográfico menor,
         * separada pelo `border-t dashed` que já existia. */}
        {observacaoCritica && achadoObservacao && (
          <div className="flex flex-col gap-1 border-t border-dashed border-linha pt-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Selo tom={TOM_TIPO[observacaoCritica.tipo]}>{ROTULO_TIPO[observacaoCritica.tipo]}</Selo>
              <SeloConfianca confianca={observacaoCritica.confianca} />
            </div>
            <p className="text-legenda text-tinta-fraca">{observacaoCritica.texto}</p>
            <CarimboHora criadoEm={achadoObservacao.criadoEm} />
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
