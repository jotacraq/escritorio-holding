"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { formatarDataHora } from "@/lib/formatar";
import type { BlocoDiagnostico, DiagnosticoSv as Diagnostico, RespostaDiagnosticoJornada } from "@/types/cenario";
import { Botao } from "@/components/ui/Botao";
import { Campo, AreaTexto, Entrada, Opcao } from "@/components/ui/Campo";
import { Cartao } from "@/components/ui/Cartao";
import { ConfirmarAcao } from "@/components/ui/ConfirmarAcao";
import { EsqueletoCartao } from "@/components/ui/Esqueleto";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Selo, SeloStub, type TomSelo } from "@/components/ui/Selo";
import { ErroFicha360Api } from "./api";
import { buscarDiagnostico, editarDiagnostico, montarDiagnostico, ROTULO_ERRO_DIAGNOSTICO } from "./api-diagnostico";

export const ROTULO_CATEGORIA: Record<string, { rotulo: string; tom: TomSelo }> = {
  fato_declarado: { rotulo: "Fato declarado", tom: "verde" },
  dado_documental: { rotulo: "Dado documental", tom: "azul" },
  inferencia: { rotulo: "Inferência", tom: "ambar" },
  ponto_a_validar: { rotulo: "Ponto a validar", tom: "neutro" },
};

export function rotularCategoria(categoria: string): { rotulo: string; tom: TomSelo } {
  return ROTULO_CATEGORIA[categoria] ?? { rotulo: categoria, tom: "neutro" };
}

const ICONE_APRESENTAR = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="14" height="10" rx="1.5" />
    <path d="M10 14v3M7 17h6M8.5 7.5v3.5l3-1.75-3-1.75Z" />
  </svg>
);

function mensagemErro(e: unknown, padrao: string): string {
  if (e instanceof ErroFicha360Api) return (e.codigo && ROTULO_ERRO_DIAGNOSTICO[e.codigo]) || e.message || padrao;
  return padrao;
}

/**
 * Diagnóstico da SV (Fase 4 §4.7, B31): a peça que a advogada apresenta ao
 * cliente logo depois da Sessão de Viabilidade, antes do Croqui. Montado por
 * função pura a partir do que já existe (família, patrimônio, análise,
 * cenário) — zero IA. Tudo nasce OCULTO ao cliente; a advogada liga bloco a
 * bloco. "O que falta" é sempre interno (o banco recusa torná-lo visível).
 */
export function DiagnosticoSv({
  jornadaId,
  aoApresentar,
  hrefApresentar,
  aoMudar,
}: {
  jornadaId: string;
  /** Na página própria: abre o modo apresentação na hora. */
  aoApresentar?: (diagnostico: Diagnostico) => void;
  /** Na aba da Ficha: navega para a página com `?apresentar=1`. */
  hrefApresentar?: string;
  /** Avisa o pai (Ficha) que o diagnóstico mudou, para a Pasta refletir. */
  aoMudar?: () => void;
}) {
  const { notificar } = useToast();
  const buscar = useCallback(() => buscarDiagnostico(jornadaId), [jornadaId]);
  const { dados, carregando, erro, recarregar, setDados } = useRecurso(buscar, [jornadaId]);
  const [montando, setMontando] = useState(false);
  const [confirmandoMontar, setConfirmandoMontar] = useState(false);
  const [aprovando, setAprovando] = useState(false);
  const [confirmandoAprovar, setConfirmandoAprovar] = useState(false);
  const [alternando, setAlternando] = useState<string | null>(null);

  if (erro) {
    const indisponivel = erro instanceof ErroFicha360Api && (erro.status === 500 || erro.status === 503 || erro.status === 404);
    if (indisponivel) return <SeloStub texto="Diagnóstico da SV ainda não disponível — a tabela do diagnóstico (migração 0058) não foi aplicada neste ambiente." />;
    return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar o diagnóstico" />;
  }
  if (carregando || !dados) return <EsqueletoCartao quantidade={3} rotulo="Carregando o diagnóstico…" />;

  const atual = dados.atual;
  const visiveis = atual ? atual.blocos.filter((b) => b.visivel_ao_cliente).length : 0;

  function aplicar(diagnostico: Diagnostico) {
    setDados((antes: RespostaDiagnosticoJornada | undefined) => (antes ? { ...antes, atual: diagnostico } : { atual: diagnostico, historico: [] }));
    aoMudar?.();
  }

  async function montar() {
    setMontando(true);
    try {
      const novo = await montarDiagnostico(jornadaId);
      notificar({ tom: "sucesso", titulo: `Diagnóstico v${novo.versao} montado`, descricao: "Todos os blocos nascem ocultos ao cliente — revise e ligue o que ele pode ver." });
      setConfirmandoMontar(false);
      recarregar();
      aoMudar?.();
    } catch (e) {
      const status = e instanceof ErroFicha360Api ? e.status : 0;
      notificar({
        tom: "erro",
        titulo: status === 503 ? "Diagnóstico não disponível neste ambiente" : "Não foi possível montar o diagnóstico",
        descricao: status === 503 ? "A tabela do diagnóstico (migração 0058) ainda não existe no banco." : mensagemErro(e, "Confira a internet e tente de novo."),
      });
    } finally {
      setMontando(false);
    }
  }

  async function aprovar() {
    setAprovando(true);
    try {
      aplicar(await editarDiagnostico(jornadaId, { aprovar: true }));
      notificar({ tom: "sucesso", titulo: "Diagnóstico aprovado" });
      setConfirmandoAprovar(false);
    } catch (e) {
      notificar({ tom: "erro", titulo: "Não foi possível aprovar", descricao: mensagemErro(e, "Confira a internet e tente de novo.") });
    } finally {
      setAprovando(false);
    }
  }

  async function alternarVisibilidade(bloco: BlocoDiagnostico, visivel: boolean) {
    if (!atual) return;
    setAlternando(bloco.chave);
    // Otimista: reversível e barato — aplica na hora, desfaz se o servidor recusar.
    const antes = atual;
    aplicar({ ...atual, blocos: atual.blocos.map((b) => (b.chave === bloco.chave ? { ...b, visivel_ao_cliente: visivel } : b)) });
    try {
      aplicar(await editarDiagnostico(jornadaId, { visibilidade: { [bloco.chave]: visivel } }));
      notificar({ tom: "sucesso", titulo: visivel ? `“${bloco.titulo}” visível ao cliente` : `“${bloco.titulo}” oculto ao cliente`, duracao: 2500 });
    } catch (e) {
      aplicar(antes);
      notificar({ tom: "erro", titulo: "Não foi possível mudar a visibilidade", descricao: mensagemErro(e, "Confira a internet e tente de novo.") });
    } finally {
      setAlternando(null);
    }
  }

  const botaoApresentar =
    atual && visiveis > 0 ? (
      aoApresentar ? (
        <Botao variante="primario" icone={ICONE_APRESENTAR} onClick={() => aoApresentar(atual)}>
          Apresentar ({visiveis} {visiveis === 1 ? "bloco" : "blocos"})
        </Botao>
      ) : hrefApresentar ? (
        <Link href={hrefApresentar} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-pilula border border-transparent bg-[color:var(--latao-cta)] px-5 py-2 text-sm font-medium text-[color:var(--latao-cta-texto)] shadow-[0_3px_0_0_var(--latao-cta-forte)] hover:bg-[color:var(--latao-cta-forte)]">
          {ICONE_APRESENTAR}
          Apresentar ({visiveis} {visiveis === 1 ? "bloco" : "blocos"})
        </Link>
      ) : null
    ) : null;

  return (
    <div className="flex flex-col gap-5">
      <Cartao
        rotulo="Depois da sessão"
        titulo="Diagnóstico da SV"
        descricao="Peça apresentável ao cliente antes do Croqui, montada só com o que já está registrado — sem IA. O cliente vê apenas os blocos que você marcar."
        acao={
          <div className="nao-imprimir flex flex-wrap gap-2">
            <Botao variante={atual ? "secundario" : "primario"} tamanho="compacto" carregando={montando} onClick={() => (atual ? setConfirmandoMontar(true) : montar())}>
              {atual ? "Montar versão nova" : "Montar diagnóstico"}
            </Botao>
          </div>
        }
      >
        {!atual ? (
          <EstadoVazio
            ilustracao="lista"
            titulo="Nenhum diagnóstico montado"
            descricao="Montar reúne família, patrimônio, riscos da análise, cenário e próximos passos em 7 blocos — cada um com a categoria da afirmação (fato, dado, inferência, ponto a validar)."
            acao={
              <Botao variante="primario" carregando={montando} onClick={montar}>
                Montar diagnóstico
              </Botao>
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Selo tom="neutro">Versão {atual.versao}</Selo>
              <Selo tom={atual.aprovado_em ? "verde" : "ambar"}>{atual.aprovado_em ? `Aprovado em ${formatarDataHora(atual.aprovado_em)}` : "Não aprovado"}</Selo>
              <Selo tom={visiveis > 0 ? "latao" : "neutro"}>
                {visiveis} de {atual.blocos.length} visíveis ao cliente
              </Selo>
              {atual.analise_id ? <Selo tom="azul">com Análise da Sessão</Selo> : <Selo tom="neutro">sem Análise da Sessão</Selo>}
            </div>
            <div className="nao-imprimir flex flex-wrap items-center gap-2">
              {botaoApresentar ?? (
                <p className="text-sm text-tinta-suave">Para apresentar, marque ao menos um bloco como visível ao cliente.</p>
              )}
              {!atual.aprovado_em && (
                <Botao variante="secundario" onClick={() => setConfirmandoAprovar(true)}>
                  Aprovar
                </Botao>
              )}
            </div>
          </div>
        )}
      </Cartao>

      {atual &&
        atual.blocos.map((bloco, indice) => (
          <BlocoEditor
            key={`${atual.id}-${bloco.chave}`}
            jornadaId={jornadaId}
            bloco={bloco}
            numero={indice + 1}
            alternando={alternando === bloco.chave}
            aoAlternar={(v) => alternarVisibilidade(bloco, v)}
            aoSalvar={aplicar}
          />
        ))}

      {dados.historico.length > 1 && (
        <Cartao rotulo="Histórico" titulo="Versões" preenchimento="sem">
          <ul className="divide-y divide-linha">
            {dados.historico.map((h) => (
              <li key={h.id} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm sm:px-6">
                <span className="font-medium text-tinta">v{h.versao}</span>
                <span className="text-tinta-suave">{formatarDataHora(h.criado_em)}</span>
                <span className="text-tinta-suave">{h.aprovado_em ? `aprovado em ${formatarDataHora(h.aprovado_em)}` : "não aprovado"}</span>
                {h.atual && <Selo tom="azul">atual</Selo>}
              </li>
            ))}
          </ul>
        </Cartao>
      )}

      <ConfirmarAcao
        aberto={confirmandoMontar}
        titulo="Montar uma versão nova do diagnóstico?"
        efeito={`A versão ${atual?.versao ?? ""} vira histórico (não pode mais ser editada) e nasce a versão ${(atual?.versao ?? 0) + 1} com os dados atuais da ficha — todos os blocos OCULTOS ao cliente de novo. Edições e marcações da versão atual não são copiadas.`}
        rotuloConfirmar="Montar versão nova"
        confirmando={montando}
        aoConfirmar={montar}
        aoCancelar={() => setConfirmandoMontar(false)}
      />
      <ConfirmarAcao
        aberto={confirmandoAprovar}
        titulo="Aprovar este diagnóstico?"
        efeito={`Carimba a versão ${atual?.versao ?? ""} como aprovada em seu nome, com data e hora. Os blocos continuam editáveis e a visibilidade pode mudar; para desfazer a aprovação, monte uma versão nova.`}
        rotuloConfirmar="Aprovar"
        confirmando={aprovando}
        aoConfirmar={aprovar}
        aoCancelar={() => setConfirmandoAprovar(false)}
      />
    </div>
  );
}

function BlocoEditor({
  jornadaId,
  bloco,
  numero,
  alternando,
  aoAlternar,
  aoSalvar,
}: {
  jornadaId: string;
  bloco: BlocoDiagnostico;
  numero: number;
  alternando: boolean;
  aoAlternar: (visivel: boolean) => void;
  aoSalvar: (d: Diagnostico) => void;
}) {
  const { notificar } = useToast();
  const [editando, setEditando] = useState(false);
  const [titulo, setTitulo] = useState(bloco.titulo);
  const [conteudo, setConteudo] = useState(bloco.conteudo);
  const [pontos, setPontos] = useState<string[]>(bloco.pontos);
  const [salvando, setSalvando] = useState(false);
  const interno = bloco.chave === "o_que_falta";
  const categoria = rotularCategoria(bloco.categoria);

  function abrir() {
    setTitulo(bloco.titulo);
    setConteudo(bloco.conteudo);
    setPontos(bloco.pontos);
    setEditando(true);
  }

  async function salvar() {
    if (!titulo.trim()) {
      notificar({ tom: "erro", titulo: "O bloco precisa de título" });
      return;
    }
    setSalvando(true);
    try {
      const d = await editarDiagnostico(jornadaId, {
        blocos: [{ chave: bloco.chave, titulo: titulo.trim(), conteudo: conteudo.trim(), pontos: pontos.map((p) => p.trim()).filter(Boolean) }],
      });
      aoSalvar(d);
      notificar({ tom: "sucesso", titulo: `Bloco “${titulo.trim()}” salvo` });
      setEditando(false);
    } catch (e) {
      notificar({ tom: "erro", titulo: "Não foi possível salvar o bloco", descricao: mensagemErro(e, "Confira a internet e tente de novo.") });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Cartao
      como="article"
      rotulo={`Bloco ${String(numero).padStart(2, "0")}${interno ? " · interno" : ""}`}
      titulo={bloco.titulo}
      realce={bloco.visivel_ao_cliente ? "latao" : undefined}
      acao={
        <div className="nao-imprimir flex flex-wrap items-center gap-2">
          <Selo tom={categoria.tom}>{categoria.rotulo}</Selo>
          {!editando && (
            <Botao variante="fantasma" tamanho="compacto" onClick={abrir}>
              Editar
            </Botao>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {editando ? (
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              salvar();
            }}
          >
            <Campo rotulo="Título" obrigatorio>
              <Entrada value={titulo} maxLength={120} onChange={(e) => setTitulo(e.target.value)} />
            </Campo>
            <Campo rotulo="Conteúdo" ajuda="Frases curtas, no tom que o cliente entende. Sem parecer jurídico.">
              <AreaTexto rows={4} value={conteudo} onChange={(e) => setConteudo(e.target.value)} />
            </Campo>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-bold text-tinta">Pontos</legend>
              {pontos.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Entrada value={p} aria-label={`Ponto ${i + 1}`} onChange={(e) => setPontos(pontos.map((x, j) => (j === i ? e.target.value : x)))} />
                  <Botao variante="fantasma" tamanho="compacto" aria-label={`Remover ponto ${i + 1}`} onClick={() => setPontos(pontos.filter((_, j) => j !== i))}>
                    Remover
                  </Botao>
                </div>
              ))}
              <div>
                <Botao variante="secundario" tamanho="compacto" onClick={() => setPontos([...pontos, ""])}>
                  + Ponto
                </Botao>
              </div>
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <Botao type="submit" variante="primario" carregando={salvando}>
                Salvar bloco
              </Botao>
              <Botao variante="fantasma" onClick={() => setEditando(false)} disabled={salvando}>
                Cancelar
              </Botao>
            </div>
          </form>
        ) : (
          <>
            {bloco.conteudo ? <p className="whitespace-pre-wrap text-corpo leading-relaxed text-tinta">{bloco.conteudo}</p> : <p className="text-sm text-tinta-fraca">Sem conteúdo.</p>}
            {bloco.pontos.length > 0 && (
              <ul className="flex flex-col gap-1 pl-5 text-corpo text-tinta marker:text-[color:var(--latao)]">
                {bloco.pontos.map((p, i) => (
                  <li key={i} className="list-disc">
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {bloco.fontes.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-tinta-suave">
            <span className="font-medium text-tinta">Fontes:</span>
            {bloco.fontes.map((f, i) => (
              <span key={i} className="rounded-pilula border border-linha bg-papel px-2 py-0.5">
                {f}
              </span>
            ))}
          </div>
        )}

        <div className="nao-imprimir border-t border-linha pt-3">
          {interno ? (
            <p className="text-sm text-tinta-suave">
              <span className="font-medium text-tinta">Sempre interno.</span> Este bloco lista o que falta para fechar o diagnóstico — é para a equipe, nunca entra na apresentação ao cliente.
            </p>
          ) : (
            <Opcao
              tipo="checkbox"
              checked={bloco.visivel_ao_cliente}
              disabled={alternando}
              onChange={(e) => aoAlternar(e.target.checked)}
              rotulo="Visível ao cliente na apresentação"
              descricao={bloco.visivel_ao_cliente ? "Entra no modo apresentação." : "Oculto — só a equipe vê (padrão)."}
            />
          )}
        </div>
      </div>
    </Cartao>
  );
}
