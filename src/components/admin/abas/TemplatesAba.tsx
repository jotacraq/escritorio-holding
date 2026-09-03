"use client";

import { useCallback, useMemo, useState } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { ApiError } from "@/lib/api";
import { Botao } from "@/components/ui/Botao";
import { EstadoCarregando, EstadoErro } from "@/components/ui/Estado";
import { formatarData } from "@/lib/formatar";
import { ativarTemplate, criarTemplateVersao, listarTemplates } from "../adminApi";
import { ConfirmarAcao } from "../ConfirmarAcao";
import { AvisoInline } from "../AvisoInline";
import type { CanalMensagemAdmin, MensagemTemplateAdmin } from "@/types/admin";

function formularioVazio(chave = "", canal: CanalMensagemAdmin = "email") {
  return { chave, canal, assunto: "", corpo: "", ativar: false };
}

/** Agrupa por (chave, canal) — cada grupo é uma "linha do tempo" de versões. */
function agrupar(itens: MensagemTemplateAdmin[]) {
  const grupos = new Map<string, MensagemTemplateAdmin[]>();
  for (const item of itens) {
    const chaveGrupo = `${item.chave}::${item.canal}`;
    if (!grupos.has(chaveGrupo)) grupos.set(chaveGrupo, []);
    grupos.get(chaveGrupo)!.push(item);
  }
  return grupos;
}

export function TemplatesAba() {
  const buscar = useCallback(() => listarTemplates(), []);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, []);

  const [novo, setNovo] = useState<ReturnType<typeof formularioVazio> | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmarAtivar, setConfirmarAtivar] = useState<MensagemTemplateAdmin | null>(null);
  const [processando, setProcessando] = useState(false);
  const [aviso, setAviso] = useState<{ tom: "sucesso" | "erro"; texto: string } | null>(null);

  const grupos = useMemo(() => (dados ? agrupar(dados.itens) : new Map<string, MensagemTemplateAdmin[]>()), [dados]);

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar os templates" />;
  if (carregando && !dados) return <EstadoCarregando rotulo="Carregando templates…" />;
  if (!dados) return null;

  async function salvarNovo() {
    if (!novo || !novo.chave.trim() || !novo.corpo.trim()) return;
    setSalvando(true);
    setAviso(null);
    try {
      await criarTemplateVersao({
        chave: novo.chave.trim(),
        canal: novo.canal,
        assunto: novo.canal === "email" ? novo.assunto.trim() || null : null,
        corpo: novo.corpo,
        ativar: novo.ativar,
      });
      setAviso({ tom: "sucesso", texto: `Versão nova criada para "${novo.chave}" (${novo.canal}).${novo.ativar ? " Já está ativa." : ""}` });
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
      await ativarTemplate(confirmarAtivar.id);
      setAviso({ tom: "sucesso", texto: `Versão ${confirmarAtivar.versao} de "${confirmarAtivar.chave}" (${confirmarAtivar.canal}) agora está ativa.` });
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
        Template é dado versionado: uma versão nova nunca substitui a anterior — ela é criada e, se marcada, promovida a
        ativa. A tela nunca edita o texto que já está em uso.
      </p>

      {aviso && <AvisoInline tom={aviso.tom}>{aviso.texto}</AvisoInline>}

      {grupos.size === 0 && <p className="text-sm text-tinta-suave">Nenhum template cadastrado ainda.</p>}

      <div className="flex flex-col gap-4">
        {Array.from(grupos.entries()).map(([chaveGrupo, versoes]) => {
          const [chave, canal] = chaveGrupo.split("::");
          const ativa = versoes.find((v) => v.ativo);
          return (
            <section key={chaveGrupo} className="rounded-sm border border-linha bg-papel-elevado">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-linha px-4 py-2.5">
                <div>
                  <h3 className="font-serif text-base font-semibold text-tinta">{chave}</h3>
                  <p className="text-xs text-tinta-suave">
                    canal: {canal === "email" ? "e-mail" : "whatsapp"}
                    {ativa ? ` · versão ativa: v${ativa.versao} (criada em ${formatarData(ativa.criado_em)})` : " · nenhuma versão ativa"}
                  </p>
                </div>
                <Botao variante="secundario" className="text-xs" onClick={() => setNovo(formularioVazio(chave, canal as CanalMensagemAdmin))}>
                  + Nova versão
                </Botao>
              </header>
              <ul className="divide-y divide-linha">
                {versoes.map((versao) => (
                  <li key={versao.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-tinta">
                        v{versao.versao}
                        {versao.ativo && (
                          <span className="ml-2 inline-flex items-center rounded-sm bg-verde-fraco px-1.5 py-0.5 text-[11px] font-medium text-[color:var(--verde)]">
                            ativa
                          </span>
                        )}
                      </p>
                      {versao.assunto && <p className="text-xs text-tinta-suave">assunto: {versao.assunto}</p>}
                      <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-tinta-fraca">{versao.corpo}</p>
                      <p className="mt-1 text-[11px] text-tinta-fraca">criada em {formatarData(versao.criado_em)}</p>
                    </div>
                    {!versao.ativo && (
                      <Botao variante="secundario" className="text-xs" onClick={() => setConfirmarAtivar(versao)}>
                        Ativar esta versão
                      </Botao>
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
              <input
                value={novo.chave}
                onChange={(e) => setNovo({ ...novo, chave: e.target.value })}
                className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Canal
              <select
                value={novo.canal}
                onChange={(e) => setNovo({ ...novo, canal: e.target.value as CanalMensagemAdmin })}
                className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5"
              >
                <option value="email">E-mail</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
            </label>
          </div>
          {novo.canal === "email" && (
            <label className="flex flex-col gap-1 text-sm">
              Assunto
              <input
                value={novo.assunto}
                onChange={(e) => setNovo({ ...novo, assunto: e.target.value })}
                className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5"
              />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm">
            Corpo
            <textarea
              value={novo.corpo}
              onChange={(e) => setNovo({ ...novo, corpo: e.target.value })}
              rows={6}
              className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5 font-mono text-xs"
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
            + Novo template (chave nova)
          </Botao>
        </div>
      )}

      <ConfirmarAcao
        aberto={confirmarAtivar !== null}
        titulo="Ativar versão de template"
        efeito={`Substitui imediatamente a versão ativa de "${confirmarAtivar?.chave}" (${confirmarAtivar?.canal}). Mensagens agendadas a partir de agora usam este texto novo.`}
        rotuloConfirmar="Ativar"
        confirmando={processando}
        aoConfirmar={confirmarAtivarVersao}
        aoCancelar={() => setConfirmarAtivar(null)}
      />
    </div>
  );
}
