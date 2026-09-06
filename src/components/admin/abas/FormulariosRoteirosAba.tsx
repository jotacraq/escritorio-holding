"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { Botao } from "@/components/ui/Botao";
import { AreaTexto, Campo, Entrada, Opcao, Selecao } from "@/components/ui/Campo";
import { Cartao } from "@/components/ui/Cartao";
import { ConfirmarAcao } from "@/components/ui/ConfirmarAcao";
import { EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Selo } from "@/components/ui/Selo";
import {
  ROTULO_TIPO_PERGUNTA,
  TIPOS_PERGUNTA,
  exigeOpcoes,
  motivoDePerguntaDeSistema,
  normalizarOpcoes,
  prepararParaPublicar,
  resumoDaDefinicao,
  validarDefinicaoNoCliente,
  type OpcaoPergunta,
  type PerguntaDefinicao,
  type TipoPergunta,
} from "@/lib/formulario/definicao";
import {
  ativarVersaoFormulario,
  buscarVersaoFormulario,
  listarVersoesFormulario,
  publicarVersaoFormulario,
  type FormularioVersao,
  type FormularioVersaoResumo,
} from "@/lib/api";
import { mensagemDeErro } from "../http";
import { ApiError } from "@/lib/api";
import { IntroAba, SeloAtivo, autoriaDeVersao } from "../comum";
import { SecaoRoteiros } from "./RoteirosSecao";
import { FormularioPrevia } from "../FormularioPrevia";

/**
 * Aba "Formulário e roteiros" (Fase 7 r3, §A5).
 *
 * Três rotas vivas que nunca tiveram botão viram tela: `GET/POST
 * /api/formularios` e `POST /api/roteiros/[id]/ativar` — esta última é o
 * mecanismo do BLOQUEIO B15 ("qual das 4 versões do roteiro é a oficial"),
 * que até aqui só se respondia por SQL à mão.
 *
 * O que a tela faz NÃO é "editar o formulário": é publicar a **versão N+1** da
 * definição do POP 02 e carimbar qual está valendo — mesmo padrão de
 * `prompts_versoes`, `roteiros_versoes` e `parametros_metodo`. Versão
 * publicada nunca é reescrita: as respostas antigas estão presas ao
 * `formulario_id` delas e é isso que permite reabrir uma resposta de junho e
 * saber contra qual pergunta ela foi dada.
 */

const CHAVE_PADRAO = "estrategico";

/** Rótulo da versão de formulário na lista e nos avisos. */
function rotuloVersao(versao: FormularioVersaoResumo): string {
  return versao.titulo ? `v${versao.versao} — ${versao.titulo}` : `v${versao.versao}`;
}

/**
 * A lista devolve `criado_por`/`ativado_por` como id de perfil, não nome — e id
 * na tela não diz nada a ninguém. Enquanto o servidor não juntar o nome, sai só
 * a data: vazio é vazio, não se inventa autor.
 */


// ---------------------------------------------------------------------------
// Editor de uma pergunta (coluna da direita)
// ---------------------------------------------------------------------------

function EditorPergunta({
  pergunta,
  anteriores,
  chave,
  valoresTravados,
  aoMudar,
}: {
  pergunta: PerguntaDefinicao;
  /** Só perguntas ANTERIORES podem ser alvo de condicional (regra da 0078). */
  anteriores: PerguntaDefinicao[];
  chave: string;
  /** Valores de opção que já foram publicados: mudar um deles muda o dado gravado. */
  valoresTravados: Set<string>;
  aoMudar: (pergunta: PerguntaDefinicao) => void;
}) {
  const opcoes = normalizarOpcoes(pergunta.opcoes);
  const alvo = anteriores.find((p) => p.id === pergunta.condicional?.depende_de) ?? null;
  const opcoesDoAlvo = alvo ? normalizarOpcoes(alvo.opcoes) : [];
  const motivoSistema = motivoDePerguntaDeSistema(chave, pergunta.id);

  function trocarOpcoes(novas: OpcaoPergunta[]) {
    aoMudar({ ...pergunta, opcoes: novas });
  }

  return (
    <div className="flex flex-col gap-4">
      <Campo rotulo="Identificador" ajuda={motivoSistema ?? "Minúsculas, dígitos e _. É a chave que fica gravada em cada resposta."}>
        <Entrada
          value={pergunta.id}
          readOnly={Boolean(motivoSistema)}
          onChange={(e) => aoMudar({ ...pergunta, id: e.target.value })}
          autoComplete="off"
          className="font-mono"
        />
      </Campo>

      <Campo rotulo="Enunciado" obrigatorio ajuda="É o que o cliente lê.">
        <AreaTexto rows={2} value={pergunta.rotulo} onChange={(e) => aoMudar({ ...pergunta, rotulo: e.target.value })} />
      </Campo>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Bloco" ajuda="Vira um passo do formulário do cliente.">
          <Entrada
            list="blocos-do-formulario"
            value={pergunta.bloco}
            onChange={(e) => aoMudar({ ...pergunta, bloco: e.target.value })}
            autoComplete="off"
          />
        </Campo>
        <Campo rotulo="Tipo">
          <Selecao
            value={pergunta.tipo}
            onChange={(e) => {
              const tipo = e.target.value as TipoPergunta;
              // Trocar para um tipo sem opções não pode deixar `opcoes` para trás:
              // a RPC recusa a presença da chave, não só o conteúdo.
              aoMudar({ ...pergunta, tipo, opcoes: exigeOpcoes(tipo) ? opcoes : undefined });
            }}
          >
            {TIPOS_PERGUNTA.map((tipo) => (
              <option key={tipo} value={tipo}>
                {ROTULO_TIPO_PERGUNTA[tipo]}
              </option>
            ))}
          </Selecao>
        </Campo>
      </div>

      {/*
        "Obrigatória" numa pergunta CONDICIONAL só vale quando ela aparece — é
        assim na tela do cliente e, desde a 0082, também no banco. Sem esta
        frase, marcar as duas coisas parece dizer "todo mundo responde", e a
        Dra. Elaine só descobriria o contrário lendo o formulário de alguém que
        não disparou a condição.
      */}
      <Opcao
        tipo="checkbox"
        rotulo="Obrigatória"
        descricao={
          pergunta.condicional
            ? "Só é cobrada quando a pergunta aparece: quem não cai na condição acima envia sem ela."
            : "O cliente não passa do bloco sem responder."
        }
        checked={Boolean(pergunta.obrigatoria)}
        onChange={(e) => aoMudar({ ...pergunta, obrigatoria: e.target.checked })}
      />

      {exigeOpcoes(pergunta.tipo) && (
        <fieldset className="flex flex-col gap-2 rounded-controle border border-linha p-3">
          <legend className="px-1 text-legenda font-medium uppercase text-tinta-fraca">Opções</legend>
          <p className="text-legenda text-tinta-suave">
            O <strong>valor</strong> é o que fica gravado na resposta e nunca muda; o <strong>texto</strong> é o que o cliente lê e pode ser reescrito a
            qualquer momento.
          </p>
          <ul className="flex flex-col gap-2">
            {opcoes.map((opcao, indice) => {
              const travado = valoresTravados.has(opcao.valor);
              return (
                <li key={`${opcao.valor}-${indice}`} className="flex flex-wrap items-end gap-2">
                  <label className="flex min-w-0 flex-1 basis-32 flex-col gap-1">
                    <span className="text-legenda text-tinta-fraca">Valor</span>
                    <Entrada
                      value={opcao.valor}
                      readOnly={travado}
                      title={travado ? "Este valor já foi publicado — mudá-lo mudaria o significado das respostas já dadas." : undefined}
                      onChange={(e) => trocarOpcoes(opcoes.map((o, i) => (i === indice ? { ...o, valor: e.target.value } : o)))}
                      className="font-mono"
                    />
                  </label>
                  <label className="flex min-w-0 flex-[2] basis-40 flex-col gap-1">
                    <span className="text-legenda text-tinta-fraca">Texto para o cliente</span>
                    <Entrada value={opcao.rotulo} onChange={(e) => trocarOpcoes(opcoes.map((o, i) => (i === indice ? { ...o, rotulo: e.target.value } : o)))} />
                  </label>
                  <Botao
                    variante="fantasma"
                    tamanho="compacto"
                    aria-label={`Remover a opção ${opcao.rotulo}`}
                    onClick={() => trocarOpcoes(opcoes.filter((_, i) => i !== indice))}
                  >
                    Remover
                  </Botao>
                </li>
              );
            })}
          </ul>
          <div>
            <Botao variante="secundario" tamanho="compacto" onClick={() => trocarOpcoes([...opcoes, { valor: "", rotulo: "" }])}>
              Adicionar opção
            </Botao>
          </div>
        </fieldset>
      )}

      <fieldset className="flex flex-col gap-3 rounded-controle border border-linha p-3">
        <legend className="px-1 text-legenda font-medium uppercase text-tinta-fraca">Só aparece se…</legend>
        <Campo rotulo="Depende da pergunta">
          <Selecao
            value={pergunta.condicional?.depende_de ?? ""}
            onChange={(e) => {
              const dependeDe = e.target.value;
              aoMudar({ ...pergunta, condicional: dependeDe ? { depende_de: dependeDe } : undefined });
            }}
          >
            <option value="">Sempre aparece</option>
            {anteriores
              .filter((p) => exigeOpcoes(p.tipo) || p.tipo === "sim_nao")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id} — {p.rotulo.slice(0, 60)}
                </option>
              ))}
          </Selecao>
        </Campo>
        {alvo && (
          <Campo rotulo={alvo.tipo === "multipla" ? "…e a resposta contém" : "…e a resposta é"}>
            <Selecao
              value={pergunta.condicional?.contem ?? pergunta.condicional?.igual ?? ""}
              onChange={(e) => {
                const valor = e.target.value;
                const base = { depende_de: alvo.id };
                aoMudar({ ...pergunta, condicional: alvo.tipo === "multipla" ? { ...base, contem: valor } : { ...base, igual: valor } });
              }}
            >
              <option value="">Selecione</option>
              {alvo.tipo === "sim_nao"
                ? [
                    { valor: "sim", rotulo: "Sim" },
                    { valor: "nao", rotulo: "Não" },
                  ].map((o) => (
                    <option key={o.valor} value={o.valor}>
                      {o.rotulo}
                    </option>
                  ))
                : opcoesDoAlvo.map((o) => (
                    <option key={o.valor} value={o.valor}>
                      {o.rotulo}
                    </option>
                  ))}
            </Selecao>
          </Campo>
        )}
      </fieldset>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-seção "Formulário Estratégico"
// ---------------------------------------------------------------------------

/**
 * Editor da versão N+1. Recebe a versão de base já carregada e nasce com ela —
 * `key={base.id}` no chamador, então trocar de base REMONTA este componente em
 * vez de sincronizar estado por efeito (o padrão de `FormularioConteudo` na
 * Ficha). Nenhum `useEffect` aqui: rascunho é estado de formulário, não espelho
 * de servidor.
 */
function EditorDeVersao({
  base,
  chave,
  proximaVersao,
  versaoAtiva,
  aoPublicar,
}: {
  base: FormularioVersao | null;
  chave: string;
  proximaVersao: number;
  versaoAtiva: number | null;
  aoPublicar: () => void;
}) {
  const { notificar } = useToast();
  const [rascunho, setRascunho] = useState<PerguntaDefinicao[]>(() => (Array.isArray(base?.definicao) ? base!.definicao : []));
  const [selecionadaId, setSelecionadaId] = useState<string | null>(null);
  const [titulo, setTitulo] = useState("");
  const [notas, setNotas] = useState("");
  const [ativarAoPublicar, setAtivarAoPublicar] = useState(false);
  const [publicando, setPublicando] = useState(false);
  const [mostrarProblemas, setMostrarProblemas] = useState(false);
  const [erroServidor, setErroServidor] = useState<string | null>(null);
  const [problemasDoServidor, setProblemasDoServidor] = useState<string[]>([]);
  const [previaAberta, setPreviaAberta] = useState(false);
  const [anuncio, setAnuncio] = useState("");

  /*
   * Clicar em "Editar" na 15ª pergunta e ter o editor lá em cima, fora da
   * tela, é o mesmo beco sem saída de um botão desabilitado sem motivo. O
   * painel é `sticky` (sempre visível ao lado da lista) e o foco vai para o
   * enunciado — quem usa teclado não precisa tabular por 40 botões para
   * chegar ao campo que pediu. Só `focus()`, nenhum `setState`: efeito não
   * é lugar de sincronizar estado.
   */
  const refEditor = useRef<HTMLDivElement>(null);
  const selecionadaAnterior = useRef<string | null>(null);
  useEffect(() => {
    // Na montagem os dois são `null` e o efeito sai antes de tocar no foco —
    // abrir a aba não pode roubar o foco de ninguém.
    if (selecionadaAnterior.current === selecionadaId) return;
    selecionadaAnterior.current = selecionadaId;
    if (!selecionadaId) return;
    refEditor.current?.querySelector<HTMLElement>("textarea")?.focus();
  }, [selecionadaId]);

  /**
   * Valores de opção que JÁ FORAM publicados. Editar um deles não muda só o
   * texto: muda a chave que as respostas antigas guardam, e a resposta de
   * junho passa a apontar para uma opção que nunca existiu. O rótulo, esse,
   * pode ser reescrito à vontade — é para isso que o formato novo separa os dois.
   */
  const valoresTravados = useMemo(
    () => new Set((Array.isArray(base?.definicao) ? base!.definicao : []).flatMap((p) => normalizarOpcoes(p.opcoes).map((o) => o.valor))),
    [base],
  );

  const problemas = useMemo(() => validarDefinicaoNoCliente(rascunho, chave), [rascunho, chave]);
  const blocos = useMemo(() => Array.from(new Set(rascunho.map((p) => p.bloco).filter(Boolean))), [rascunho]);

  const selecionadaIndice = rascunho.findIndex((p) => p.id === selecionadaId);
  const selecionada = selecionadaIndice >= 0 ? rascunho[selecionadaIndice] : null;
  const problemasPorPergunta = new Set(problemas.map((p) => p.perguntaId).filter(Boolean) as string[]);

  function mover(indice: number, direcao: -1 | 1) {
    const destino = indice + direcao;
    if (destino < 0 || destino >= rascunho.length) return;
    const copia = [...rascunho];
    [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
    setRascunho(copia);
    setAnuncio(`"${copia[destino].rotulo || copia[destino].id}" agora está na posição ${destino + 1} de ${copia.length}.`);
  }

  function remover(indice: number) {
    const removida = rascunho[indice];
    setRascunho(rascunho.filter((_, i) => i !== indice));
    if (selecionadaId === removida.id) setSelecionadaId(null);
    setAnuncio(`"${removida.rotulo || removida.id}" foi removida. Restam ${rascunho.length - 1} perguntas.`);
  }

  function adicionar() {
    // Sugere o próximo `pN` livre — a numeração do POP 02 é sequencial.
    let n = rascunho.length + 1;
    while (rascunho.some((p) => p.id === `p${n}`)) n += 1;
    const nova: PerguntaDefinicao = { id: `p${n}`, bloco: rascunho[rascunho.length - 1]?.bloco ?? "Novo bloco", tipo: "texto", rotulo: "" };
    setRascunho([...rascunho, nova]);
    setSelecionadaId(nova.id);
    setAnuncio(`Pergunta ${nova.id} acrescentada no fim, na posição ${rascunho.length + 1}.`);
  }

  async function publicar() {
    setMostrarProblemas(true);
    setErroServidor(null);
    setProblemasDoServidor([]);
    if (problemas.length > 0) {
      setAnuncio(`Não dá para publicar: ${problemas.length} ${problemas.length === 1 ? "problema" : "problemas"} na definição.`);
      return;
    }
    setPublicando(true);
    try {
      const { formulario } = await publicarVersaoFormulario({
        chave,
        titulo: titulo.trim() || null,
        notas: notas.trim() || null,
        definicao: prepararParaPublicar(rascunho),
        ativar: ativarAoPublicar,
      });
      notificar({
        tom: "sucesso",
        titulo: `Versão ${formulario.versao} publicada`,
        descricao: ativarAoPublicar ? "É esta que o cliente passa a ver ao abrir o link." : "Ela ainda não está valendo — ative quando quiser.",
      });
      aoPublicar();
    } catch (e) {
      // A rota devolve TODOS os problemas em `detalhes` (cada um nomeando a
      // pergunta culpada) e a RPC manda o texto do `raise` em `detalhe` —
      // mostrar isso é muito mais útil que "erro ao publicar".
      const detalhe = e instanceof ApiError ? e.detalhe : null;
      setProblemasDoServidor(
        Array.isArray(detalhe)
          ? detalhe.map((d) => String((d as { mensagem?: unknown }).mensagem ?? "")).filter(Boolean)
          : typeof detalhe === "string" && detalhe.trim()
            ? [detalhe]
            : [],
      );
      setErroServidor(mensagemDeErro(e, "Não foi possível publicar a versão."));
    } finally {
      setPublicando(false);
    }
  }

  return (
    <div className="flex flex-col gap-item">
      <p aria-live="polite" className="sr-only">
        {anuncio}
      </p>

      {mostrarProblemas && problemas.length > 0 && (
        <div role="alert" className="rounded-controle border border-[color:var(--vermelho)] bg-vermelho-fraco px-4 py-3">
          <p className="text-sm font-bold text-[color:var(--vermelho)]">
            {problemas.length === 1 ? "Falta corrigir 1 coisa antes de publicar:" : `Faltam corrigir ${problemas.length} coisas antes de publicar:`}
          </p>
          <ul className="mt-1 list-disc pl-5 text-sm text-tinta">
            {problemas.map((problema, i) => (
              <li key={`${problema.codigo}-${i}`}>{problema.mensagem}</li>
            ))}
          </ul>
        </div>
      )}

      {erroServidor && (
        <div role="alert" className="rounded-controle border border-[color:var(--vermelho)] bg-vermelho-fraco px-4 py-3">
          <p className="text-sm font-medium text-[color:var(--vermelho)]">{erroServidor}</p>
          {problemasDoServidor.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-sm text-tinta">
              {problemasDoServidor.map((mensagem) => (
                <li key={mensagem}>{mensagem}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <datalist id="blocos-do-formulario">
        {blocos.map((bloco) => (
          <option key={bloco} value={bloco} />
        ))}
      </datalist>

      <div className="grid gap-cartao lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-2">
          <ul className="flex flex-col divide-y divide-linha rounded-controle border border-linha">
            {rascunho.map((pergunta, indice) => {
              const motivoSistema = motivoDePerguntaDeSistema(chave, pergunta.id);
              const comProblema = mostrarProblemas && problemasPorPergunta.has(pergunta.id);
              return (
                <li
                  /*
                   * `key` é o id da pergunta, NÃO `id-índice`: com o índice na
                   * chave, mover uma pergunta desmonta e remonta a linha, e
                   * quem estava movendo pelo teclado PERDE o foco no primeiro
                   * Enter (medido em 06/09). Com a chave estável o React move
                   * o nó do DOM e o foco vai junto — dá para descer a pergunta
                   * várias posições sem tirar a mão do teclado.
                   */
                  key={pergunta.id}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2 pr-3 ${comProblema ? "bg-vermelho-fraco" : ""} ${
                    selecionadaId === pergunta.id ? "border-l-4 border-l-[color:var(--latao-cta)] pl-2" : "pl-3"
                  }`}
                >
                  {/* Setas LADO A LADO, 44x44 cada. Empilhadas ficavam 32x24 —
                      abaixo do alvo de toque do DS §6 — e empilhar dois alvos
                      de 44 px dobraria a altura de cada uma das 17 linhas. */}
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => mover(indice, -1)}
                      disabled={indice === 0}
                      aria-label={`Mover "${pergunta.rotulo || pergunta.id}" para cima`}
                      className="flex h-11 w-11 items-center justify-center rounded-controle text-tinta-suave transition-colors duration-[var(--transicao-rapida)] hover:bg-papel hover:text-[color:var(--latao)] disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      <span aria-hidden="true">↑</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => mover(indice, 1)}
                      disabled={indice === rascunho.length - 1}
                      aria-label={`Mover "${pergunta.rotulo || pergunta.id}" para baixo`}
                      className="flex h-11 w-11 items-center justify-center rounded-controle text-tinta-suave transition-colors duration-[var(--transicao-rapida)] hover:bg-papel hover:text-[color:var(--latao)] disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      <span aria-hidden="true">↓</span>
                    </button>
                  </div>
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="flex flex-wrap items-center gap-2 text-legenda text-tinta-fraca">
                      <span className="font-mono">{pergunta.id}</span>
                      <span>{pergunta.bloco}</span>
                      <span>{ROTULO_TIPO_PERGUNTA[pergunta.tipo] ?? pergunta.tipo}</span>
                      {pergunta.obrigatoria && <Selo tom="latao">obrigatória</Selo>}
                      {pergunta.condicional && <Selo tom="neutro">condicional</Selo>}
                      {motivoSistema && (
                        <Selo tom="azul" title={motivoSistema}>
                          usada pelo sistema
                        </Selo>
                      )}
                    </p>
                    <p className="break-words text-sm text-tinta">{pergunta.rotulo || <span className="text-tinta-fraca">(sem enunciado)</span>}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Botao
                      variante="fantasma"
                      tamanho="compacto"
                      onClick={() => setSelecionadaId(pergunta.id)}
                      aria-label={`Editar "${pergunta.rotulo || pergunta.id}"`}
                    >
                      Editar
                    </Botao>
                    <Botao
                      variante="fantasma"
                      tamanho="compacto"
                      disabled={Boolean(motivoSistema)}
                      title={motivoSistema ? `Não dá para remover: ${motivoSistema}` : undefined}
                      onClick={() => remover(indice)}
                      aria-label={`Remover "${pergunta.rotulo || pergunta.id}"`}
                    >
                      Remover
                    </Botao>
                  </div>
                </li>
              );
            })}
            {rascunho.length === 0 && <li className="px-3 py-4 text-sm text-tinta-suave">Nenhuma pergunta ainda. Acrescente a primeira abaixo.</li>}
          </ul>
          <div>
            <Botao variante="secundario" tamanho="compacto" onClick={adicionar}>
              Acrescentar pergunta
            </Botao>
          </div>
        </div>

        <div
          ref={refEditor}
          className="flex min-w-0 flex-col gap-3 self-start rounded-controle border border-linha bg-papel p-4 lg:sticky lg:top-3 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto"
        >
          {selecionada ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-subtitulo font-bold text-tinta">
                  Pergunta {selecionadaIndice + 1} de {rascunho.length}
                </h3>
                <Botao variante="fantasma" tamanho="compacto" onClick={() => setSelecionadaId(null)}>
                  Fechar
                </Botao>
              </div>
              <EditorPergunta
                pergunta={selecionada}
                anteriores={rascunho.slice(0, selecionadaIndice)}
                chave={chave}
                valoresTravados={valoresTravados}
                aoMudar={(nova) => {
                  setRascunho(rascunho.map((p, i) => (i === selecionadaIndice ? nova : p)));
                  if (nova.id !== selecionada.id) setSelecionadaId(nova.id);
                }}
              />
            </>
          ) : (
            <p className="text-sm text-tinta-suave">Escolha uma pergunta na lista para editar o enunciado, o tipo, as opções e a condição de aparecer.</p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-linha pt-3">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Título desta versão" extra="opcional" ajuda="Ajuda a lembrar o que mudou.">
            <Entrada value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </Campo>
          <Campo rotulo="Notas" extra="opcional">
            <Entrada value={notas} onChange={(e) => setNotas(e.target.value)} />
          </Campo>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-tinta-suave">
            {resumoDaDefinicao(rascunho)}
            {versaoAtiva ? ` · valendo hoje: v${versaoAtiva}` : " · nenhuma versão está valendo"}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Opcao tipo="checkbox" rotulo="Publicar já ativando" checked={ativarAoPublicar} onChange={(e) => setAtivarAoPublicar(e.target.checked)} />
            <Botao variante="secundario" onClick={() => setPreviaAberta(true)} disabled={rascunho.length === 0}>
              Pré-visualizar como cliente
            </Botao>
            <Botao variante="primario" carregando={publicando} onClick={publicar}>
              Publicar versão {proximaVersao}
            </Botao>
          </div>
        </div>
      </div>

      <FormularioPrevia aberta={previaAberta} aoFechar={() => setPreviaAberta(false)} definicao={rascunho} versao={proximaVersao} />
    </div>
  );
}

function SecaoFormulario() {
  const buscar = useCallback(() => listarVersoesFormulario(), []);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, []);
  const { notificar } = useToast();

  const [chave, setChave] = useState(CHAVE_PADRAO);
  const [baseEscolhidaId, setBaseEscolhidaId] = useState<string | null>(null);
  const [comecarDoZero, setComecarDoZero] = useState(false);
  const [confirmarAtivar, setConfirmarAtivar] = useState<FormularioVersaoResumo | null>(null);
  const [ativando, setAtivando] = useState(false);

  const versoes = useMemo(() => (dados?.itens ?? []).filter((v) => v.chave === chave).sort((a, b) => b.versao - a.versao), [dados, chave]);
  const chaves = useMemo(() => Array.from(new Set((dados?.itens ?? []).map((v) => v.chave))).sort(), [dados]);
  const ativa = versoes.find((v) => v.ativo) ?? null;
  const proximaVersao = (versoes[0]?.versao ?? 0) + 1;

  // Sem escolha explícita, o editor parte da versão que está valendo: é dela
  // que qualquer versão nova nasce na prática.
  const baseId = baseEscolhidaId ?? ativa?.id ?? versoes[0]?.id ?? null;
  const buscarBase = useCallback(
    () => (baseId ? buscarVersaoFormulario(baseId).then((r) => r.formulario) : Promise.resolve(null)),
    [baseId],
  );
  const { dados: base, carregando: carregandoBase, erro: erroBase, recarregar: recarregarBase } = useRecurso(buscarBase, [baseId]);

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar as versões do formulário" />;
  if (carregando && !dados) return <EsqueletoLista linhas={5} rotulo="Carregando as versões do formulário…" />;
  if (!dados) return null;

  async function confirmarAtivacao() {
    if (!confirmarAtivar) return;
    setAtivando(true);
    try {
      await ativarVersaoFormulario(confirmarAtivar.id);
      notificar({
        tom: "sucesso",
        titulo: `${rotuloVersao(confirmarAtivar)} está valendo`,
        descricao: "É o que o cliente vê ao abrir o link do formulário.",
      });
      setConfirmarAtivar(null);
      recarregar();
    } catch (e) {
      notificar({ tom: "erro", titulo: "Não foi possível ativar", descricao: mensagemDeErro(e, "Tente de novo em instantes.") });
    } finally {
      setAtivando(false);
    }
  }

  return (
    <div className="flex flex-col gap-bloco">
      <Cartao
        rotulo="POP 02"
        titulo="Formulário Estratégico"
        descricao="Publicar cria a versão N+1 a partir do que está no editor. As respostas já dadas continuam presas à versão em que foram dadas."
        acao={
          chaves.length > 1 ? (
            <label className="flex items-center gap-2 text-legenda text-tinta-suave">
              Formulário
              <Selecao
                value={chave}
                onChange={(e) => {
                  setChave(e.target.value);
                  setBaseEscolhidaId(null);
                  setComecarDoZero(false);
                }}
              >
                {chaves.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Selecao>
            </label>
          ) : undefined
        }
      >
        {erroBase ? <EstadoErro erro={erroBase} tentarNovamente={recarregarBase} titulo="Não foi possível abrir esta versão" /> : null}
        {!erroBase && carregandoBase && Boolean(baseId) && <EsqueletoLista linhas={6} rotulo="Abrindo a versão…" />}

        {!erroBase && !carregandoBase && !base && !comecarDoZero && (
          <EstadoVazio
            ilustracao="lista"
            titulo="Nenhuma versão publicada"
            descricao="O formulário público não abre enquanto não houver uma versão ativa desta chave — o cliente vê a tela sem pergunta nenhuma."
            acao={
              <Botao variante="primario" onClick={() => setComecarDoZero(true)}>
                Começar do zero
              </Botao>
            }
          />
        )}

        {!erroBase && !carregandoBase && (base || comecarDoZero) && (
          <EditorDeVersao
            key={base?.id ?? "do-zero"}
            base={base ?? null}
            chave={chave}
            proximaVersao={proximaVersao}
            versaoAtiva={ativa?.versao ?? null}
            aoPublicar={() => {
              setBaseEscolhidaId(null);
              setComecarDoZero(false);
              recarregar();
            }}
          />
        )}
      </Cartao>

      <Cartao
        preenchimento="sem"
        titulo="Versões publicadas"
        descricao="A versão que está valendo é a que o cliente vê ao abrir o link. Publicar nunca reescreve uma versão, e ativar não muda nenhuma resposta já dada."
      >
        {versoes.length === 0 ? (
          <p className="px-5 py-4 text-sm text-tinta-suave">Nenhuma versão desta chave ainda.</p>
        ) : (
          <ul className="divide-y divide-linha">
            {versoes.map((versao) => (
              <li key={versao.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 sm:px-6">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-tinta">
                    {rotuloVersao(versao)}
                    <SeloAtivo ativo={versao.ativo} rotuloAtivo="Valendo" rotuloInativo="Histórico" />
                    {versao.id === baseId && <Selo tom="neutro">no editor</Selo>}
                  </p>
                  <p className="text-legenda text-tinta-fraca">
                    {[autoriaDeVersao(versao.criado_em, "publicada"), autoriaDeVersao(versao.ativado_em, "ativada")]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {versao.notas && <p className="mt-1 break-words text-sm text-tinta-suave">{versao.notas}</p>}
                </div>
                <Botao
                  variante="fantasma"
                  tamanho="compacto"
                  onClick={() => {
                    setBaseEscolhidaId(versao.id);
                    setComecarDoZero(false);
                  }}
                >
                  Usar como base
                </Botao>
                {!versao.ativo && (
                  <Botao variante="secundario" tamanho="compacto" onClick={() => setConfirmarAtivar(versao)}>
                    Ativar esta
                  </Botao>
                )}
              </li>
            ))}
          </ul>
        )}
      </Cartao>

      <ConfirmarAcao
        aberto={confirmarAtivar !== null}
        titulo="Ativar esta versão"
        efeito={`A partir de agora todo cliente que abrir o link do formulário vê a v${confirmarAtivar?.versao ?? ""}. As respostas já dadas não mudam.`}
        rotuloConfirmar="Ativar esta"
        confirmando={ativando}
        aoConfirmar={confirmarAtivacao}
        aoCancelar={() => setConfirmarAtivar(null)}
      />
    </div>
  );
}

export function FormulariosRoteirosAba() {
  return (
    <div className="flex flex-col gap-bloco">
      {/* A `descricao` da aba (AdminApp) já diz PARA QUE a aba serve e é
          renderizada pelo `Abas`. Esta linha só acrescenta a regra que não
          está lá — repetir a frase seria eco, como já se corrigiu em
          Pendências na Fase 7. */}
      <IntroAba>Nada é editado no lugar: toda mudança nasce como versão nova, e uma delas é carimbada como a que está valendo.</IntroAba>
      <SecaoFormulario />
      <SecaoRoteiros />
    </div>
  );
}
