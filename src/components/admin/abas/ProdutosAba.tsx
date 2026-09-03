"use client";

import { useCallback, useState } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { ApiError } from "@/lib/api";
import { Botao } from "@/components/ui/Botao";
import { EstadoCarregando, EstadoErro } from "@/components/ui/Estado";
import { atualizarProduto, criarProduto, listarProdutos } from "../adminApi";
import { ConfirmarAcao } from "../ConfirmarAcao";
import { AvisoInline } from "../AvisoInline";
import type { ProdutoAdmin, ProdutoTipo } from "@/types/admin";

const ROTULO_TIPO: Record<ProdutoTipo, string> = {
  sessao_viabilidade: "Sessão de Viabilidade",
  croqui_estrutural: "Croqui Estrutural",
  holding: "Holding",
};

const TIPOS: ProdutoTipo[] = ["sessao_viabilidade", "croqui_estrutural", "holding"];

function formularioVazio() {
  return { tipo: "sessao_viabilidade" as ProdutoTipo, nome: "", hotmart_produto_id: "" };
}

export function ProdutosAba() {
  const buscar = useCallback(() => listarProdutos(), []);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, []);

  const [novo, setNovo] = useState<ReturnType<typeof formularioVazio> | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [edicaoId, setEdicaoId] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<{ nome: string; hotmart_produto_id: string }>({ nome: "", hotmart_produto_id: "" });
  const [confirmarDesativar, setConfirmarDesativar] = useState<ProdutoAdmin | null>(null);
  const [processando, setProcessando] = useState(false);
  const [aviso, setAviso] = useState<{ tom: "sucesso" | "erro"; texto: string } | null>(null);

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar os produtos" />;
  if (carregando && !dados) return <EstadoCarregando rotulo="Carregando produtos…" />;
  if (!dados) return null;

  async function salvarNovo() {
    if (!novo || !novo.nome.trim()) return;
    setSalvando(true);
    setAviso(null);
    try {
      await criarProduto({ tipo: novo.tipo, nome: novo.nome, hotmart_produto_id: novo.hotmart_produto_id.trim() || null });
      setNovo(null);
      recarregar();
    } catch (e) {
      setAviso({ tom: "erro", texto: e instanceof ApiError ? e.message : "Não foi possível criar o produto." });
    } finally {
      setSalvando(false);
    }
  }

  function abrirEdicao(produto: ProdutoAdmin) {
    setEdicaoId(produto.id);
    setRascunho({ nome: produto.nome, hotmart_produto_id: produto.hotmart_produto_id ?? "" });
  }

  async function salvarEdicao(produto: ProdutoAdmin) {
    setProcessando(true);
    setAviso(null);
    try {
      await atualizarProduto(produto.id, { nome: rascunho.nome, hotmart_produto_id: rascunho.hotmart_produto_id.trim() || null });
      setEdicaoId(null);
      recarregar();
    } catch (e) {
      setAviso({ tom: "erro", texto: e instanceof ApiError ? e.message : "Não foi possível salvar as alterações." });
    } finally {
      setProcessando(false);
    }
  }

  async function ativar(produto: ProdutoAdmin) {
    setAviso(null);
    try {
      await atualizarProduto(produto.id, { ativo: true });
      recarregar();
    } catch (e) {
      setAviso({ tom: "erro", texto: e instanceof ApiError ? e.message : "Não foi possível reativar o produto." });
    }
  }

  async function confirmarDesativarProduto() {
    if (!confirmarDesativar) return;
    setProcessando(true);
    setAviso(null);
    try {
      await atualizarProduto(confirmarDesativar.id, { ativo: false });
      setConfirmarDesativar(null);
      recarregar();
    } catch (e) {
      setAviso({ tom: "erro", texto: e instanceof ApiError ? e.message : "Não foi possível desativar o produto." });
    } finally {
      setProcessando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-tinta-fraca">
        Mapeia o ID de produto da Hotmart ao tipo que decide o nível pago da jornada. Sem esta linha, o pagamento chega
        como &quot;produto não mapeado&quot; e fica pendente em vez de avançar a jornada sozinho.
      </p>

      {aviso && <AvisoInline tom={aviso.tom}>{aviso.texto}</AvisoInline>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-linha-forte text-left text-tinta-suave">
              <th className="py-1.5 pr-3 font-medium">Tipo</th>
              <th className="py-1.5 pr-3 font-medium">Nome</th>
              <th className="py-1.5 pr-3 font-medium">ID Hotmart</th>
              <th className="py-1.5 pr-3 font-medium">Status</th>
              <th className="py-1.5 font-medium sr-only">Ações</th>
            </tr>
          </thead>
          <tbody>
            {dados.itens.map((produto) =>
              edicaoId === produto.id ? (
                <tr key={produto.id} className="border-b border-linha bg-papel-fundo align-top">
                  <td className="py-2 pr-3 text-tinta-suave">{ROTULO_TIPO[produto.tipo]}</td>
                  <td className="py-2 pr-3">
                    <input
                      value={rascunho.nome}
                      onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })}
                      className="w-full rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      value={rascunho.hotmart_produto_id}
                      onChange={(e) => setRascunho({ ...rascunho, hotmart_produto_id: e.target.value })}
                      className="w-full rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1"
                    />
                  </td>
                  <td className="py-2 pr-3" />
                  <td className="py-2">
                    <div className="flex justify-end gap-2">
                      <Botao variante="primario" className="text-xs" carregando={processando} onClick={() => salvarEdicao(produto)}>
                        Salvar
                      </Botao>
                      <Botao variante="fantasma" className="text-xs" onClick={() => setEdicaoId(null)}>
                        Cancelar
                      </Botao>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={produto.id} className="border-b border-linha">
                  <td className="py-2 pr-3 text-tinta-suave">{ROTULO_TIPO[produto.tipo]}</td>
                  <td className="py-2 pr-3 font-medium text-tinta">{produto.nome}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-tinta-suave">{produto.hotmart_produto_id ?? "—"}</td>
                  <td className="py-2 pr-3">
                    {produto.ativo ? (
                      <span className="inline-flex items-center rounded-sm bg-verde-fraco px-1.5 py-0.5 text-[11px] font-medium text-[color:var(--verde)]">
                        Ativo
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-sm border border-linha bg-papel px-1.5 py-0.5 text-[11px] font-medium text-tinta-fraca">
                        Inativo
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    <div className="flex justify-end gap-2">
                      <Botao variante="fantasma" className="text-xs" onClick={() => abrirEdicao(produto)}>
                        Editar
                      </Botao>
                      {produto.ativo ? (
                        <Botao variante="perigo" className="text-xs" onClick={() => setConfirmarDesativar(produto)}>
                          Desativar
                        </Botao>
                      ) : (
                        <Botao variante="secundario" className="text-xs" onClick={() => ativar(produto)}>
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
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              Tipo
              <select
                value={novo.tipo}
                onChange={(e) => setNovo({ ...novo, tipo: e.target.value as ProdutoTipo })}
                className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5"
              >
                {TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {ROTULO_TIPO[t]}
                  </option>
                ))}
              </select>
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
              ID Hotmart (opcional)
              <input
                value={novo.hotmart_produto_id}
                onChange={(e) => setNovo({ ...novo, hotmart_produto_id: e.target.value })}
                className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <Botao variante="primario" carregando={salvando} onClick={salvarNovo}>
              Adicionar
            </Botao>
            <Botao variante="fantasma" onClick={() => setNovo(null)}>
              Cancelar
            </Botao>
          </div>
        </div>
      ) : (
        <div>
          <Botao variante="secundario" onClick={() => setNovo(formularioVazio())}>
            + Novo produto
          </Botao>
        </div>
      )}

      <ConfirmarAcao
        aberto={confirmarDesativar !== null}
        titulo="Desativar produto"
        efeito={`Produtos inativos não mapeiam mais pagamentos da Hotmart — vendas futuras de "${confirmarDesativar?.nome}" cairão como "produto não mapeado" até reativar.`}
        rotuloConfirmar="Desativar"
        perigo
        confirmando={processando}
        aoConfirmar={confirmarDesativarProduto}
        aoCancelar={() => setConfirmarDesativar(null)}
      />
    </div>
  );
}
