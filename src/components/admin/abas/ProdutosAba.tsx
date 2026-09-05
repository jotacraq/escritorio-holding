"use client";

import { useCallback, useState, type FormEvent } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { Botao } from "@/components/ui/Botao";
import { Campo, Entrada, Selecao } from "@/components/ui/Campo";
import { Cartao } from "@/components/ui/Cartao";
import { ConfirmarAcao } from "@/components/ui/ConfirmarAcao";
import { EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { SeloStub } from "@/components/ui/Selo";
import { atualizarProduto, criarProduto, listarProdutos } from "../adminApi";
import { mensagemDeErro } from "../http";
import { IntroAba, SeloAtivo, Tabela, Tbody, Td, Th, Thead, Tr, TRACO } from "../comum";
import type { ProdutoAdmin, ProdutoTipo } from "@/types/admin";

const ROTULO_TIPO: Record<ProdutoTipo, string> = {
  sessao_viabilidade: "Sessão de Viabilidade",
  croqui_estrutural: "Croqui Estrutural",
  holding: "Holding",
};

const TIPOS: ProdutoTipo[] = ["sessao_viabilidade", "croqui_estrutural", "holding"];

/** Texto exato de §1.9 (Admin → Produtos). */
const TEXTO_SEM_ID = "Produto sem ID da Hotmart: todo pagamento dele vai cair em 'produto não mapeado' até o ID ser preenchido.";
const TEXTO_SECRET = "Sem HOTMART_WEBHOOK_SECRET no servidor o webhook recusa tudo (503) — é o comportamento certo, não um erro.";

interface Rascunho {
  nome: string;
  hotmart_produto_id: string;
  url_checkout: string;
}

function validarUrl(url: string): string | undefined {
  const limpa = url.trim();
  if (!limpa) return undefined;
  if (!limpa.startsWith("https://")) return "O link de pagamento precisa começar com https://";
  try {
    new URL(limpa);
  } catch {
    return "Isto não parece um link válido.";
  }
  return undefined;
}

export function ProdutosAba() {
  const buscar = useCallback(() => listarProdutos(), []);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, []);
  const { notificar } = useToast();

  const [novo, setNovo] = useState<(Rascunho & { tipo: ProdutoTipo }) | null>(null);
  const [edicaoId, setEdicaoId] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho>({ nome: "", hotmart_produto_id: "", url_checkout: "" });
  const [errosForm, setErrosForm] = useState<Partial<Rascunho>>({});
  const [salvando, setSalvando] = useState(false);
  const [confirmarDesativar, setConfirmarDesativar] = useState<ProdutoAdmin | null>(null);

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar os produtos" />;
  if (carregando && !dados) return <EsqueletoLista linhas={3} rotulo="Carregando produtos…" />;
  if (!dados) return null;

  const semId = dados.itens.filter((p) => p.ativo && !p.hotmart_produto_id);

  function validar(r: Rascunho): Partial<Rascunho> {
    const e: Partial<Rascunho> = {};
    if (r.nome.trim().length < 2) e.nome = "Dê um nome com pelo menos 2 letras.";
    const erroUrl = validarUrl(r.url_checkout);
    if (erroUrl) e.url_checkout = erroUrl;
    return e;
  }

  async function salvarNovo(evento: FormEvent) {
    evento.preventDefault();
    if (!novo) return;
    const e = validar(novo);
    setErrosForm(e);
    if (Object.keys(e).length > 0) return;
    setSalvando(true);
    try {
      await criarProduto({ tipo: novo.tipo, nome: novo.nome.trim(), hotmart_produto_id: novo.hotmart_produto_id.trim() || null, url_checkout: novo.url_checkout.trim() || null });
      notificar({ tom: "sucesso", titulo: "Produto criado", descricao: `${novo.nome.trim()} (${ROTULO_TIPO[novo.tipo]}).` });
      setNovo(null);
      recarregar();
    } catch (err) {
      notificar({ tom: "erro", titulo: "Não foi possível criar", descricao: mensagemDeErro(err, "Tente de novo em instantes.") });
    } finally {
      setSalvando(false);
    }
  }

  function abrirEdicao(produto: ProdutoAdmin) {
    setEdicaoId(produto.id);
    setErrosForm({});
    setRascunho({ nome: produto.nome, hotmart_produto_id: produto.hotmart_produto_id ?? "", url_checkout: produto.url_checkout ?? "" });
  }

  async function salvarEdicao(evento: FormEvent, produto: ProdutoAdmin) {
    evento.preventDefault();
    const e = validar(rascunho);
    setErrosForm(e);
    if (Object.keys(e).length > 0) return;
    setSalvando(true);
    try {
      await atualizarProduto(produto.id, { nome: rascunho.nome.trim(), hotmart_produto_id: rascunho.hotmart_produto_id.trim() || null, url_checkout: rascunho.url_checkout.trim() || null });
      notificar({ tom: "sucesso", titulo: "Produto salvo", descricao: rascunho.nome.trim() });
      setEdicaoId(null);
      recarregar();
    } catch (err) {
      notificar({ tom: "erro", titulo: "Não foi possível salvar", descricao: mensagemDeErro(err, "Tente de novo em instantes.") });
    } finally {
      setSalvando(false);
    }
  }

  async function mudarAtivo(produto: ProdutoAdmin, ativo: boolean) {
    setSalvando(true);
    try {
      await atualizarProduto(produto.id, { ativo });
      notificar({ tom: "sucesso", titulo: ativo ? "Produto reativado" : "Produto desativado", descricao: produto.nome });
      setConfirmarDesativar(null);
      recarregar();
    } catch (err) {
      notificar({ tom: "erro", titulo: ativo ? "Não foi possível reativar" : "Não foi possível desativar", descricao: mensagemDeErro(err, "Tente de novo em instantes.") });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <IntroAba>
          Cada produto liga o ID da Hotmart ao nível pago da jornada e guarda o link de pagamento que a equipe manda ao cliente. Sem o ID, o
          pagamento chega como &quot;produto não mapeado&quot; e a jornada não avança sozinha.
        </IntroAba>
        {!novo && (
          <Botao variante="primario" onClick={() => setNovo({ tipo: "sessao_viabilidade", nome: "", hotmart_produto_id: "", url_checkout: "" })}>
            Novo produto
          </Botao>
        )}
      </div>

      {semId.length > 0 && <SeloStub texto={`${TEXTO_SEM_ID} Sem ID: ${semId.map((p) => p.nome).join(", ")}.`} />}
      <p className="text-xs text-tinta-fraca">{TEXTO_SECRET}</p>

      {novo && (
        <Cartao rotulo="Novo produto" titulo="Cadastro">
          <form noValidate onSubmit={salvarNovo} className="flex flex-col gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Campo rotulo="Tipo" obrigatorio ajuda="Decide o nível pago que o pagamento credita. Não muda depois.">
                <Selecao value={novo.tipo} onChange={(e) => setNovo({ ...novo, tipo: e.target.value as ProdutoTipo })}>
                  {TIPOS.map((t) => (
                    <option key={t} value={t}>
                      {ROTULO_TIPO[t]}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Nome" obrigatorio erro={errosForm.nome}>
                <Entrada value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
              </Campo>
              <Campo rotulo="ID do produto na Hotmart" extra="opcional" ajuda="Como aparece no painel da Hotmart.">
                <Entrada value={novo.hotmart_produto_id} onChange={(e) => setNovo({ ...novo, hotmart_produto_id: e.target.value })} autoComplete="off" />
              </Campo>
              <Campo rotulo="Link de pagamento" extra="opcional" erro={errosForm.url_checkout} ajuda="Só https. É o que vai na mensagem 'enviar link do croqui'.">
                <Entrada type="url" inputMode="url" value={novo.url_checkout} onChange={(e) => setNovo({ ...novo, url_checkout: e.target.value })} placeholder="https://pay.hotmart.com/…" />
              </Campo>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Botao variante="fantasma" onClick={() => setNovo(null)}>
                Cancelar
              </Botao>
              <Botao type="submit" variante="primario" carregando={salvando}>
                Criar produto
              </Botao>
            </div>
          </form>
        </Cartao>
      )}

      {dados.itens.length === 0 && !novo ? (
        <EstadoVazio ilustracao="lista" titulo="Nenhum produto cadastrado" descricao="Cadastre Sessão de Viabilidade, Croqui e Holding com os IDs da Hotmart." />
      ) : (
        <Cartao preenchimento="sem">
          <Tabela resumo="Produtos cadastrados, com ID da Hotmart e link de pagamento">
            <Thead>
              <tr>
                <Th>Tipo</Th>
                <Th>Nome</Th>
                <Th>ID Hotmart</Th>
                <Th>Link de pagamento</Th>
                <Th>Estado</Th>
                <Th srOnly>Ações</Th>
              </tr>
            </Thead>
            <Tbody>
              {dados.itens.map((produto) =>
                edicaoId === produto.id ? (
                  <Tr key={produto.id} className="bg-papel">
                    <td colSpan={6} className="block px-0 py-2 sm:table-cell sm:px-5 sm:py-4">
                      <form noValidate onSubmit={(e) => salvarEdicao(e, produto)} className="flex flex-col gap-4">
                        <p className="text-sm text-tinta-suave">
                          Editando <span className="font-bold text-tinta">{ROTULO_TIPO[produto.tipo]}</span>
                        </p>
                        <div className="grid gap-4 sm:grid-cols-3">
                          <Campo rotulo="Nome" obrigatorio erro={errosForm.nome}>
                            <Entrada value={rascunho.nome} onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })} />
                          </Campo>
                          <Campo rotulo="ID Hotmart" extra="opcional">
                            <Entrada value={rascunho.hotmart_produto_id} onChange={(e) => setRascunho({ ...rascunho, hotmart_produto_id: e.target.value })} autoComplete="off" />
                          </Campo>
                          <Campo rotulo="Link de pagamento" extra="opcional" erro={errosForm.url_checkout}>
                            <Entrada type="url" inputMode="url" value={rascunho.url_checkout} onChange={(e) => setRascunho({ ...rascunho, url_checkout: e.target.value })} placeholder="https://…" />
                          </Campo>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Botao variante="fantasma" tamanho="compacto" onClick={() => setEdicaoId(null)}>
                            Cancelar
                          </Botao>
                          <Botao type="submit" variante="secundario" tamanho="compacto" carregando={salvando}>
                            Salvar
                          </Botao>
                        </div>
                      </form>
                    </td>
                  </Tr>
                ) : (
                  <Tr key={produto.id}>
                    <Td rotulo="Tipo" className="text-tinta-suave">
                      {ROTULO_TIPO[produto.tipo]}
                    </Td>
                    <Td rotulo="Nome" className="font-medium">
                      {produto.nome}
                    </Td>
                    <Td rotulo="ID Hotmart">{produto.hotmart_produto_id ?? <span className="text-[color:var(--ambar)]">sem ID</span>}</Td>
                    <Td rotulo="Link">
                      {produto.url_checkout ? (
                        <a href={produto.url_checkout} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center text-[color:var(--latao)] underline-offset-2 hover:underline">
                          abrir link
                        </a>
                      ) : (
                        <span className="text-tinta-fraca">{TRACO}</span>
                      )}
                    </Td>
                    <Td rotulo="Estado">
                      <SeloAtivo ativo={produto.ativo} rotuloAtivo="Ativo" rotuloInativo="Inativo" />
                    </Td>
                    <Td acoes>
                      <div className="flex flex-wrap gap-2 sm:justify-end">
                        <Botao variante="fantasma" tamanho="compacto" onClick={() => abrirEdicao(produto)}>
                          Editar
                        </Botao>
                        {produto.ativo ? (
                          <Botao variante="perigo" tamanho="compacto" onClick={() => setConfirmarDesativar(produto)}>
                            Desativar
                          </Botao>
                        ) : (
                          <Botao variante="secundario" tamanho="compacto" carregando={salvando} onClick={() => mudarAtivo(produto, true)}>
                            Reativar
                          </Botao>
                        )}
                      </div>
                    </Td>
                  </Tr>
                ),
              )}
            </Tbody>
          </Tabela>
        </Cartao>
      )}

      <ConfirmarAcao
        aberto={confirmarDesativar !== null}
        titulo="Desativar produto"
        efeito={`Produtos inativos não mapeiam mais pagamentos da Hotmart — vendas futuras de "${confirmarDesativar?.nome}" cairão como "produto não mapeado" até reativar.`}
        rotuloConfirmar="Desativar"
        perigo
        confirmando={salvando}
        aoConfirmar={() => confirmarDesativar && mudarAtivo(confirmarDesativar, false)}
        aoCancelar={() => setConfirmarDesativar(null)}
      />
    </div>
  );
}
