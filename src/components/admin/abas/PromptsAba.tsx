"use client";

import { useCallback, useMemo, useState } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { ApiError } from "@/lib/api";
import { Botao } from "@/components/ui/Botao";
import { EstadoCarregando, EstadoErro } from "@/components/ui/Estado";
import { formatarData } from "@/lib/formatar";
import { ativarPrompt, buscarPrompt, criarPromptVersao, listarPrompts } from "../adminApi";
import { ConfirmarAcao } from "../ConfirmarAcao";
import { AvisoInline } from "../AvisoInline";
import type { EffortIa, PromptVersaoAdmin, PromptVersaoResumo } from "@/types/admin";

const CHAVES_CONHECIDAS = ["prompt_mestre", "protocolo_01_briefing", "isca_pos_sessao"] as const;
const EFFORTS: EffortIa[] = ["low", "medium", "high", "xhigh", "max"];
const MODELOS = ["claude-opus-5", "claude-sonnet-5"];

function formularioVazio(chave = "") {
  return {
    chave,
    chaveCustomizada: !CHAVES_CONHECIDAS.includes(chave as (typeof CHAVES_CONHECIDAS)[number]) && chave !== "",
    titulo: "",
    corpo_sistema: "",
    modelo_padrao: "claude-opus-5",
    effort: "high" as EffortIa,
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

export function PromptsAba() {
  const buscar = useCallback(() => listarPrompts(), []);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, []);

  const [novo, setNovo] = useState<ReturnType<typeof formularioVazio> | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmarAtivar, setConfirmarAtivar] = useState<PromptVersaoResumo | null>(null);
  const [processando, setProcessando] = useState(false);
  const [aviso, setAviso] = useState<{ tom: "sucesso" | "erro"; texto: string } | null>(null);
  const [expandidoId, setExpandidoId] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<Record<string, PromptVersaoAdmin>>({});
  const [carregandoDetalheId, setCarregandoDetalheId] = useState<string | null>(null);

  const grupos = useMemo(() => (dados ? agrupar(dados.itens) : new Map<string, PromptVersaoResumo[]>()), [dados]);

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar os prompts" />;
  if (carregando && !dados) return <EstadoCarregando rotulo="Carregando versões de prompt…" />;
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
      setAviso({ tom: "erro", texto: e instanceof ApiError ? e.message : "Não foi possível carregar o conteúdo desta versão." });
    } finally {
      setCarregandoDetalheId(null);
    }
  }

  async function salvarNovo() {
    if (!novo || !novo.chave.trim() || !novo.titulo.trim() || !novo.corpo_sistema.trim()) return;
    setSalvando(true);
    setAviso(null);
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
      setAviso({ tom: "sucesso", texto: `Versão nova criada para "${novo.chave}".${novo.ativar ? " Já está ativa." : ""}` });
      setNovo(null);
      recarregar();
    } catch (e) {
      setAviso({ tom: "erro", texto: e instanceof ApiError ? e.message : "Não foi possível criar a versão." });
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarAtivarVersao() {
    if (!confirmarAtivar) return;
    setProcessando(true);
    setAviso(null);
    try {
      await ativarPrompt(confirmarAtivar.id);
      setAviso({ tom: "sucesso", texto: `Versão ${confirmarAtivar.versao} de "${confirmarAtivar.chave}" agora está ativa.` });
      setConfirmarAtivar(null);
      recarregar();
    } catch (e) {
      setAviso({ tom: "erro", texto: e instanceof ApiError ? e.message : "Não foi possível ativar esta versão." });
    } finally {
      setProcessando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-tinta-fraca">
        O Prompt Mestre e o Protocolo 01 são sistema vivo — cada mudança de texto nasce como versão nova, nunca sobrescreve
        a versão em uso. Todo briefing já gerado guarda com qual versão foi produzido.
      </p>

      {aviso && <AvisoInline tom={aviso.tom}>{aviso.texto}</AvisoInline>}

      {grupos.size === 0 && <p className="text-sm text-tinta-suave">Nenhuma versão de prompt cadastrada ainda.</p>}

      <div className="flex flex-col gap-4">
        {Array.from(grupos.entries()).map(([chave, versoes]) => {
          const ativa = versoes.find((v) => v.ativo);
          return (
            <section key={chave} className="rounded-sm border border-linha bg-papel-elevado">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-linha px-4 py-2.5">
                <div>
                  <h3 className="font-serif text-base font-semibold text-tinta">{chave}</h3>
                  <p className="text-xs text-tinta-suave">
                    {ativa ? `versão ativa: v${ativa.versao} (criada em ${formatarData(ativa.criado_em)})` : "nenhuma versão ativa"}
                  </p>
                </div>
                <Botao variante="secundario" className="text-xs" onClick={() => setNovo(formularioVazio(chave))}>
                  + Nova versão
                </Botao>
              </header>
              <ul className="divide-y divide-linha">
                {versoes.map((versao) => (
                  <li key={versao.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-tinta">
                          v{versao.versao} — {versao.titulo}
                          {versao.ativo && (
                            <span className="ml-2 inline-flex items-center rounded-sm bg-verde-fraco px-1.5 py-0.5 text-[11px] font-medium text-[color:var(--verde)]">
                              ativa
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-tinta-fraca">
                          {versao.modelo_padrao} · effort {versao.effort} · criada em {formatarData(versao.criado_em)}
                        </p>
                        {versao.notas && <p className="mt-1 text-xs text-tinta-suave">{versao.notas}</p>}
                      </div>
                      <div className="flex gap-2">
                        <Botao variante="fantasma" className="text-xs" onClick={() => alternarDetalhe(versao)}>
                          {expandidoId === versao.id ? "Ocultar conteúdo" : "Ver conteúdo"}
                        </Botao>
                        {!versao.ativo && (
                          <Botao variante="secundario" className="text-xs" onClick={() => setConfirmarAtivar(versao)}>
                            Ativar esta versão
                          </Botao>
                        )}
                      </div>
                    </div>
                    {expandidoId === versao.id && (
                      <div className="mt-2 rounded-sm border border-linha bg-papel-fundo p-3">
                        {carregandoDetalheId === versao.id && <EstadoCarregando rotulo="Carregando conteúdo…" />}
                        {detalhe[versao.id] && (
                          <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs text-tinta-suave">
                            {detalhe[versao.id].corpo_sistema}
                          </pre>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {novo ? (
        <div className="flex flex-col gap-3 rounded-sm border border-linha bg-papel-fundo p-3">
          <p className="text-xs font-medium text-tinta-suave">Nova versão — não altera a versão em uso.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Chave
              {novo.chaveCustomizada ? (
                <input
                  value={novo.chave}
                  onChange={(e) => setNovo({ ...novo, chave: e.target.value })}
                  className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5"
                />
              ) : (
                <select
                  value={novo.chave}
                  onChange={(e) =>
                    e.target.value === "__outra__"
                      ? setNovo({ ...novo, chaveCustomizada: true, chave: "" })
                      : setNovo({ ...novo, chave: e.target.value })
                  }
                  className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5"
                >
                  <option value="" disabled>
                    Selecione
                  </option>
                  {CHAVES_CONHECIDAS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  <option value="__outra__">Outra chave…</option>
                </select>
              )}
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Título
              <input
                value={novo.titulo}
                onChange={(e) => setNovo({ ...novo, titulo: e.target.value })}
                className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Modelo padrão
              <select
                value={novo.modelo_padrao}
                onChange={(e) => setNovo({ ...novo, modelo_padrao: e.target.value })}
                className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5"
              >
                {MODELOS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Effort
              <select
                value={novo.effort}
                onChange={(e) => setNovo({ ...novo, effort: e.target.value as EffortIa })}
                className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5"
              >
                {EFFORTS.map((ef) => (
                  <option key={ef} value={ef}>
                    {ef}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            Corpo do prompt (system prompt)
            <textarea
              value={novo.corpo_sistema}
              onChange={(e) => setNovo({ ...novo, corpo_sistema: e.target.value })}
              rows={10}
              className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5 font-mono text-xs"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Notas (opcional)
            <textarea
              value={novo.notas}
              onChange={(e) => setNovo({ ...novo, notas: e.target.value })}
              rows={2}
              className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={novo.ativar} onChange={(e) => setNovo({ ...novo, ativar: e.target.checked })} />
            Ativar esta versão imediatamente
          </label>
          <div className="flex gap-2">
            <Botao variante="primario" carregando={salvando} onClick={salvarNovo}>
              Criar versão
            </Botao>
            <Botao variante="fantasma" onClick={() => setNovo(null)}>
              Cancelar
            </Botao>
          </div>
        </div>
      ) : (
        <div>
          <Botao variante="secundario" onClick={() => setNovo(formularioVazio())}>
            + Nova versão de prompt
          </Botao>
        </div>
      )}

      <ConfirmarAcao
        aberto={confirmarAtivar !== null}
        titulo="Ativar versão de prompt"
        efeito={`Substitui a versão ativa de "${confirmarAtivar?.chave}" imediatamente — todo briefing gerado a partir de agora usa este texto novo. Briefings já gerados mantêm a versão que os gerou.`}
        rotuloConfirmar="Ativar"
        confirmando={processando}
        aoConfirmar={confirmarAtivarVersao}
        aoCancelar={() => setConfirmarAtivar(null)}
      />
    </div>
  );
}
