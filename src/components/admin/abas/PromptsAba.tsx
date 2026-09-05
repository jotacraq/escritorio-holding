"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { Botao } from "@/components/ui/Botao";
import { AreaTexto, Campo, Entrada, Opcao, Selecao } from "@/components/ui/Campo";
import { Cartao } from "@/components/ui/Cartao";
import { ConfirmarAcao } from "@/components/ui/ConfirmarAcao";
import { EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Selo } from "@/components/ui/Selo";
import { formatarData } from "@/lib/formatar";
import { ativarPrompt, buscarPrompt, criarPromptVersao, listarPrompts } from "../adminApi";
import { mensagemDeErro } from "../http";
import { IntroAba, SeloAtivo } from "../comum";
import type { EffortIa, PromptVersaoAdmin, PromptVersaoResumo } from "@/types/admin";

const CHAVES_CONHECIDAS = ["prompt_mestre", "protocolo_01_briefing", "isca_pos_sessao"] as const;
const EFFORTS: EffortIa[] = ["low", "medium", "high", "xhigh", "max"];
const MODELOS = ["claude-opus-5", "claude-sonnet-5"];

const ROTULO_CHAVE: Record<string, string> = {
  prompt_mestre: "Prompt Mestre",
  protocolo_01_briefing: "Protocolo 01 — Briefing",
  isca_pos_sessao: "Material pós-sessão",
  agente_croqui_analise: "Análise do croqui",
  analise_sessao: "Análise da sessão",
};

function rotuloChave(chave: string): string {
  return ROTULO_CHAVE[chave] ?? chave.replace(/_/g, " ");
}

function formularioVazio(chave = "") {
  return {
    chave,
    chaveCustomizada: chave !== "" && !CHAVES_CONHECIDAS.includes(chave as (typeof CHAVES_CONHECIDAS)[number]),
    titulo: "",
    corpo_sistema: "",
    modelo_padrao: "claude-opus-5",
    effort: "low" as EffortIa,
    notas: "",
    ativar: false,
  };
}

function agrupar(itens: PromptVersaoResumo[]) {
  const grupos = new Map<string, PromptVersaoResumo[]>();
  for (const item of itens) {
    if (!grupos.has(item.chave)) grupos.set(item.chave, []);
    grupos.get(item.chave)!.push(item);
  }
  return grupos;
}

/**
 * O Prompt Mestre e o Protocolo 01 são sistema vivo — cada mudança nasce
 * como versão nova, nunca sobrescreve a versão em uso. Todo briefing guarda
 * a versão que o gerou. `effort` é a alavanca de custo (CONTINUAR-AQUI §0.3).
 */
export function PromptsAba() {
  const buscar = useCallback(() => listarPrompts(), []);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, []);
  const { notificar } = useToast();

  const [novo, setNovo] = useState<ReturnType<typeof formularioVazio> | null>(null);
  const [erros, setErros] = useState<{ chave?: string; titulo?: string; corpo?: string }>({});
  const [salvando, setSalvando] = useState(false);
  const [confirmarAtivar, setConfirmarAtivar] = useState<PromptVersaoResumo | null>(null);
  const [expandidoId, setExpandidoId] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<Record<string, PromptVersaoAdmin>>({});
  const [carregandoDetalheId, setCarregandoDetalheId] = useState<string | null>(null);

  const grupos = useMemo(() => (dados ? agrupar(dados.itens) : new Map<string, PromptVersaoResumo[]>()), [dados]);

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar os prompts" />;
  if (carregando && !dados) return <EsqueletoLista linhas={4} rotulo="Carregando versões de prompt…" />;
  if (!dados) return null;

  async function alternarDetalhe(item: PromptVersaoResumo) {
    if (expandidoId === item.id) {
      setExpandidoId(null);
      return;
    }
    setExpandidoId(item.id);
    if (detalhe[item.id]) return;
    setCarregandoDetalheId(item.id);
    try {
      const { prompt } = await buscarPrompt(item.id);
      setDetalhe((atual) => ({ ...atual, [item.id]: prompt }));
    } catch (e) {
      notificar({ tom: "erro", titulo: "Não foi possível abrir o texto", descricao: mensagemDeErro(e, "Tente de novo em instantes.") });
    } finally {
      setCarregandoDetalheId(null);
    }
  }

  async function salvarNovo(evento: FormEvent) {
    evento.preventDefault();
    if (!novo) return;
    const e: typeof erros = {};
    if (!/^[a-z][a-z0-9_]{1,49}$/.test(novo.chave.trim())) e.chave = "Escolha uma chave (minúsculas, dígitos e _).";
    if (!novo.titulo.trim()) e.titulo = "Dê um título à versão.";
    if (!novo.corpo_sistema.trim()) e.corpo = "Cole o texto do prompt.";
    setErros(e);
    if (Object.keys(e).length > 0) return;
    setSalvando(true);
    try {
      await criarPromptVersao({
        chave: novo.chave.trim(),
        titulo: novo.titulo.trim(),
        corpo_sistema: novo.corpo_sistema,
        modelo_padrao: novo.modelo_padrao,
        effort: novo.effort,
        notas: novo.notas.trim() || null,
        ativar: novo.ativar,
      });
      notificar({ tom: "sucesso", titulo: novo.ativar ? "Versão criada e ativada" : "Versão criada", descricao: rotuloChave(novo.chave) });
      setNovo(null);
      recarregar();
    } catch (err) {
      notificar({ tom: "erro", titulo: "Não foi possível criar a versão", descricao: mensagemDeErro(err, "Tente de novo em instantes.") });
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarAtivarVersao() {
    if (!confirmarAtivar) return;
    setSalvando(true);
    try {
      await ativarPrompt(confirmarAtivar.id);
      notificar({ tom: "sucesso", titulo: "Versão ativada", descricao: `${rotuloChave(confirmarAtivar.chave)} v${confirmarAtivar.versao} em uso.` });
      setConfirmarAtivar(null);
      recarregar();
    } catch (err) {
      notificar({ tom: "erro", titulo: "Não foi possível ativar", descricao: mensagemDeErro(err, "Tente de novo em instantes.") });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <IntroAba>
          O texto que guia a IA em cada geração. Toda mudança nasce como versão nova — a versão em uso nunca é editada, e cada briefing guarda com
          qual foi produzido. Antes de ativar uma versão com schema maior, rode a Sonda de schema.
        </IntroAba>
        {!novo && (
          <Botao variante="primario" onClick={() => setNovo(formularioVazio())}>
            Nova versão de prompt
          </Botao>
        )}
      </div>

      {novo && (
        <Cartao rotulo="Nova versão" titulo={novo.chave ? rotuloChave(novo.chave) : "Prompt"} descricao="Não altera a versão em uso.">
          <form noValidate onSubmit={salvarNovo} className="flex flex-col gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Campo rotulo="Chave" obrigatorio erro={erros.chave}>
                {novo.chaveCustomizada ? (
                  <Entrada value={novo.chave} onChange={(e) => setNovo({ ...novo, chave: e.target.value })} autoComplete="off" />
                ) : (
                  <Selecao
                    value={novo.chave}
                    onChange={(e) => (e.target.value === "__outra__" ? setNovo({ ...novo, chaveCustomizada: true, chave: "" }) : setNovo({ ...novo, chave: e.target.value }))}
                  >
                    <option value="" disabled>
                      Selecione
                    </option>
                    {CHAVES_CONHECIDAS.map((c) => (
                      <option key={c} value={c}>
                        {rotuloChave(c)}
                      </option>
                    ))}
                    <option value="__outra__">Outra chave…</option>
                  </Selecao>
                )}
              </Campo>
              <Campo rotulo="Título da versão" obrigatorio erro={erros.titulo}>
                <Entrada value={novo.titulo} onChange={(e) => setNovo({ ...novo, titulo: e.target.value })} />
              </Campo>
              <Campo rotulo="Modelo">
                <Selecao value={novo.modelo_padrao} onChange={(e) => setNovo({ ...novo, modelo_padrao: e.target.value })}>
                  {MODELOS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Esforço (custo)" ajuda="Medido em 04/09: low US$ 0,04 · medium US$ 0,05 · high US$ 0,12 por briefing.">
                <Selecao value={novo.effort} onChange={(e) => setNovo({ ...novo, effort: e.target.value as EffortIa })}>
                  {EFFORTS.map((ef) => (
                    <option key={ef} value={ef}>
                      {ef}
                    </option>
                  ))}
                </Selecao>
              </Campo>
            </div>
            <Campo rotulo="Texto do prompt (system prompt)" obrigatorio erro={erros.corpo}>
              <AreaTexto rows={12} className="font-mono text-sm" value={novo.corpo_sistema} onChange={(e) => setNovo({ ...novo, corpo_sistema: e.target.value })} />
            </Campo>
            <Campo rotulo="Notas" extra="opcional">
              <AreaTexto rows={2} value={novo.notas} onChange={(e) => setNovo({ ...novo, notas: e.target.value })} />
            </Campo>
            <Opcao tipo="checkbox" rotulo="Ativar assim que criar" descricao="Toda geração a partir de agora usa este texto." checked={novo.ativar} onChange={(e) => setNovo({ ...novo, ativar: e.target.checked })} />
            <div className="flex flex-wrap justify-end gap-2">
              <Botao variante="fantasma" onClick={() => setNovo(null)}>
                Cancelar
              </Botao>
              <Botao type="submit" variante="primario" carregando={salvando}>
                Criar versão
              </Botao>
            </div>
          </form>
        </Cartao>
      )}

      {grupos.size === 0 && !novo && <EstadoVazio ilustracao="lista" titulo="Nenhuma versão de prompt" descricao="Sem prompt ativo, a IA não gera nada." />}

      {Array.from(grupos.entries()).map(([chave, versoes]) => {
        const ativa = versoes.find((v) => v.ativo);
        return (
          <Cartao
            key={chave}
            preenchimento="sem"
            rotulo={chave}
            titulo={rotuloChave(chave)}
            descricao={ativa ? `Em uso: v${ativa.versao} — ${ativa.titulo} (${ativa.modelo_padrao}, esforço ${ativa.effort})` : "Nenhuma versão em uso."}
            acao={
              <>
                {!ativa && <Selo tom="ambar">Sem versão ativa</Selo>}
                <Botao variante="secundario" tamanho="compacto" onClick={() => setNovo(formularioVazio(chave))}>
                  Nova versão
                </Botao>
              </>
            }
          >
            <ul className="divide-y divide-linha">
              {versoes.map((versao) => (
                <li key={versao.id} className="flex flex-col gap-2 px-5 py-4 sm:px-6">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    {/* `basis-56`: no celular o bloco de texto quebra para a linha de cima em vez de ser espremido a 47px pelo botão. */}
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-tinta">
                        v{versao.versao} — {versao.titulo}
                        <SeloAtivo ativo={versao.ativo} rotuloAtivo="Em uso" rotuloInativo="Histórico" />
                      </p>
                      <p className="text-xs text-tinta-fraca">
                        {versao.modelo_padrao} · esforço {versao.effort} · criada em {formatarData(versao.criado_em)}
                      </p>
                      {versao.notas && <p className="mt-1 break-words text-sm text-tinta-suave">{versao.notas}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => alternarDetalhe(versao)}
                      aria-expanded={expandidoId === versao.id}
                      className="min-h-11 text-sm font-medium text-[color:var(--latao)] underline-offset-2 hover:underline"
                    >
                      {expandidoId === versao.id ? "Esconder o texto" : "Ver o texto"}
                    </button>
                    {!versao.ativo && (
                      <Botao variante="secundario" tamanho="compacto" onClick={() => setConfirmarAtivar(versao)}>
                        Usar esta versão
                      </Botao>
                    )}
                  </div>
                  {expandidoId === versao.id && (
                    <div className="rounded-controle bg-papel px-4 py-3">
                      {carregandoDetalheId === versao.id && <EstadoCarregando rotulo="Abrindo o texto…" />}
                      {detalhe[versao.id] && <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-sm leading-relaxed text-tinta">{detalhe[versao.id].corpo_sistema}</pre>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Cartao>
        );
      })}

      <ConfirmarAcao
        aberto={confirmarAtivar !== null}
        titulo="Usar esta versão"
        efeito={`Substitui a versão em uso de "${confirmarAtivar ? rotuloChave(confirmarAtivar.chave) : ""}" imediatamente — toda geração a partir de agora usa este texto. O que já foi gerado mantém a versão que o gerou.`}
        rotuloConfirmar="Usar esta versão"
        confirmando={salvando}
        aoConfirmar={confirmarAtivarVersao}
        aoCancelar={() => setConfirmarAtivar(null)}
      />
    </div>
  );
}
