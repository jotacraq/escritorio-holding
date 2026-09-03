"use client";

import { useCallback, useState } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { ApiError } from "@/lib/api";
import { Botao } from "@/components/ui/Botao";
import { EstadoCarregando, EstadoErro } from "@/components/ui/Estado";
import { formatarData } from "@/lib/formatar";
import { atualizarEdicao, criarEdicao, listarEdicoes } from "../adminApi";
import { ConfirmarAcao } from "../ConfirmarAcao";
import { AvisoInline } from "../AvisoInline";
import type { EdicaoSeminario } from "@/types/admin";

function formularioVazio() {
  return { codigo: "", nome: "", inicio_em: "", fim_em: "" };
}

export function EdicoesAba() {
  const buscar = useCallback(() => listarEdicoes(), []);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, []);

  const [novo, setNovo] = useState<ReturnType<typeof formularioVazio> | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [edicaoId, setEdicaoId] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState({ nome: "", inicio_em: "", fim_em: "" });
  const [processando, setProcessando] = useState(false);
  const [confirmarDesativar, setConfirmarDesativar] = useState<EdicaoSeminario | null>(null);
  const [aviso, setAviso] = useState<{ tom: "sucesso" | "erro"; texto: string } | null>(null);

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar as edições" />;
  if (carregando && !dados) return <EstadoCarregando rotulo="Carregando edições…" />;
  if (!dados) return null;

  async function salvarNovo() {
    if (!novo || !novo.codigo.trim() || !novo.nome.trim() || !novo.inicio_em || !novo.fim_em) return;
    setSalvando(true);
    setAviso(null);
    try {
      await criarEdicao(novo);
      setNovo(null);
      recarregar();
    } catch (e) {
      setAviso({ tom: "erro", texto: e instanceof ApiError ? e.message : "Não foi possível criar a edição." });
    } finally {
      setSalvando(false);
    }
  }

  function abrirEdicao(edicao: EdicaoSeminario) {
    setEdicaoId(edicao.id);
    setRascunho({ nome: edicao.nome, inicio_em: edicao.inicio_em, fim_em: edicao.fim_em });
  }

  async function salvarEdicaoExistente(edicao: EdicaoSeminario) {
    setProcessando(true);
    setAviso(null);
    try {
      await atualizarEdicao(edicao.id, rascunho);
      setEdicaoId(null);
      recarregar();
    } catch (e) {
      setAviso({ tom: "erro", texto: e instanceof ApiError ? e.message : "Não foi possível salvar as alterações." });
    } finally {
      setProcessando(false);
    }
  }

  async function ativar(edicao: EdicaoSeminario) {
    setAviso(null);
    try {
      await atualizarEdicao(edicao.id, { ativa: true });
      recarregar();
    } catch (e) {
      setAviso({ tom: "erro", texto: e instanceof ApiError ? e.message : "Não foi possível reativar a edição." });
    }
  }

  async function confirmarDesativarEdicao() {
    if (!confirmarDesativar) return;
    setProcessando(true);
    setAviso(null);
    try {
      await atualizarEdicao(confirmarDesativar.id, { ativa: false });
      setConfirmarDesativar(null);
      recarregar();
    } catch (e) {
      setAviso({ tom: "erro", texto: e instanceof ApiError ? e.message : "Não foi possível desativar a edição." });
    } finally {
      setProcessando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-tinta-fraca">Cada edição do seminário é a coorte que os indicadores agrupam — nunca por janela de tempo.</p>

      {aviso && <AvisoInline tom={aviso.tom}>{aviso.texto}</AvisoInline>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-linha-forte text-left text-tinta-suave">
              <th className="py-1.5 pr-3 font-medium">Código</th>
              <th className="py-1.5 pr-3 font-medium">Nome</th>
              <th className="py-1.5 pr-3 font-medium">Início</th>
              <th className="py-1.5 pr-3 font-medium">Fim</th>
              <th className="py-1.5 pr-3 font-medium">Status</th>
              <th className="py-1.5 font-medium sr-only">Ações</th>
            </tr>
          </thead>
          <tbody>
            {dados.itens.map((edicao) =>
              edicaoId === edicao.id ? (
                <tr key={edicao.id} className="border-b border-linha bg-papel-fundo align-top">
                  <td className="py-2 pr-3 text-tinta-suave">{edicao.codigo}</td>
                  <td className="py-2 pr-3">
                    <input
                      value={rascunho.nome}
                      onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })}
                      className="w-full rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      type="date"
                      value={rascunho.inicio_em}
                      onChange={(e) => setRascunho({ ...rascunho, inicio_em: e.target.value })}
                      className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      type="date"
                      value={rascunho.fim_em}
                      onChange={(e) => setRascunho({ ...rascunho, fim_em: e.target.value })}
                      className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1"
                    />
                  </td>
                  <td className="py-2 pr-3" />
                  <td className="py-2">
                    <div className="flex justify-end gap-2">
                      <Botao variante="primario" className="text-xs" carregando={processando} onClick={() => salvarEdicaoExistente(edicao)}>
                        Salvar
                      </Botao>
                      <Botao variante="fantasma" className="text-xs" onClick={() => setEdicaoId(null)}>
                        Cancelar
                      </Botao>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={edicao.id} className="border-b border-linha">
                  <td className="py-2 pr-3 font-mono text-xs text-tinta-suave">{edicao.codigo}</td>
                  <td className="py-2 pr-3 font-medium text-tinta">{edicao.nome}</td>
                  <td className="py-2 pr-3">{formatarData(edicao.inicio_em)}</td>
                  <td className="py-2 pr-3">{formatarData(edicao.fim_em)}</td>
                  <td className="py-2 pr-3">
                    {edicao.ativa ? (
                      <span className="inline-flex items-center rounded-sm bg-verde-fraco px-1.5 py-0.5 text-[11px] font-medium text-[color:var(--verde)]">
                        Ativa
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-sm border border-linha bg-papel px-1.5 py-0.5 text-[11px] font-medium text-tinta-fraca">
                        Inativa
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    <div className="flex justify-end gap-2">
                      <Botao variante="fantasma" className="text-xs" onClick={() => abrirEdicao(edicao)}>
                        Editar
                      </Botao>
                      {edicao.ativa ? (
                        <Botao variante="perigo" className="text-xs" onClick={() => setConfirmarDesativar(edicao)}>
                          Desativar
                        </Botao>
                      ) : (
                        <Botao variante="secundario" className="text-xs" onClick={() => ativar(edicao)}>
                          Reativar
                        </Botao>
                      )}
                    </div>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      {novo ? (
        <div className="flex flex-col gap-3 rounded-sm border border-linha bg-papel-fundo p-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="flex flex-col gap-1 text-sm">
              Código
              <input
                value={novo.codigo}
                onChange={(e) => setNovo({ ...novo, codigo: e.target.value })}
                className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Nome
              <input
                value={novo.nome}
                onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
                className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Início
              <input
                type="date"
                value={novo.inicio_em}
                onChange={(e) => setNovo({ ...novo, inicio_em: e.target.value })}
                className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Fim
              <input
                type="date"
                value={novo.fim_em}
                onChange={(e) => setNovo({ ...novo, fim_em: e.target.value })}
                className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <Botao variante="primario" carregando={salvando} onClick={salvarNovo}>
              Criar edição
            </Botao>
            <Botao variante="fantasma" onClick={() => setNovo(null)}>
              Cancelar
            </Botao>
          </div>
        </div>
      ) : (
        <div>
          <Botao variante="secundario" onClick={() => setNovo(formularioVazio())}>
            + Nova edição do seminário
          </Botao>
        </div>
      )}

      <ConfirmarAcao
        aberto={confirmarDesativar !== null}
        titulo="Desativar edição"
        efeito={`Marca "${confirmarDesativar?.nome}" como inativa — ela deixa de ser sugerida como opção padrão para novos leads do seminário. Jornadas já vinculadas não mudam.`}
        rotuloConfirmar="Desativar"
        perigo
        confirmando={processando}
        aoConfirmar={confirmarDesativarEdicao}
        aoCancelar={() => setConfirmarDesativar(null)}
      />
    </div>
  );
}
