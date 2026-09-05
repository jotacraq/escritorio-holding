"use client";

import { useCallback, useState, type FormEvent } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { Botao } from "@/components/ui/Botao";
import { Campo, Entrada } from "@/components/ui/Campo";
import { Cartao } from "@/components/ui/Cartao";
import { ConfirmarAcao } from "@/components/ui/ConfirmarAcao";
import { EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { formatarData } from "@/lib/formatar";
import { atualizarEdicao, criarEdicao, listarEdicoes } from "../adminApi";
import { mensagemDeErro } from "../http";
import { IntroAba, SeloAtivo, Tabela, Tbody, Td, Th, Thead, Tr } from "../comum";
import type { EdicaoSeminario } from "@/types/admin";

interface Rascunho {
  codigo: string;
  nome: string;
  inicio_em: string;
  fim_em: string;
}

function validar(r: Rascunho, exigirCodigo: boolean): Partial<Rascunho> {
  const e: Partial<Rascunho> = {};
  if (exigirCodigo && !r.codigo.trim()) e.codigo = "Informe o código (ex.: 2026-09).";
  if (!r.nome.trim()) e.nome = "Dê um nome à edição.";
  if (!r.inicio_em) e.inicio_em = "Informe o início.";
  if (!r.fim_em) e.fim_em = "Informe o fim.";
  if (r.inicio_em && r.fim_em && r.fim_em < r.inicio_em) e.fim_em = "O fim precisa ser depois do início.";
  return e;
}

/** Cada edição do seminário é a coorte que os indicadores agrupam — nunca por janela de tempo. */
export function EdicoesAba() {
  const buscar = useCallback(() => listarEdicoes(), []);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, []);
  const { notificar } = useToast();

  const [novo, setNovo] = useState<Rascunho | null>(null);
  const [edicaoId, setEdicaoId] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho>({ codigo: "", nome: "", inicio_em: "", fim_em: "" });
  const [erros, setErros] = useState<Partial<Rascunho>>({});
  const [salvando, setSalvando] = useState(false);
  const [confirmarDesativar, setConfirmarDesativar] = useState<EdicaoSeminario | null>(null);

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar as edições" />;
  if (carregando && !dados) return <EsqueletoLista linhas={3} rotulo="Carregando edições…" />;
  if (!dados) return null;

  async function salvarNovo(evento: FormEvent) {
    evento.preventDefault();
    if (!novo) return;
    const e = validar(novo, true);
    setErros(e);
    if (Object.keys(e).length > 0) return;
    setSalvando(true);
    try {
      await criarEdicao({ codigo: novo.codigo.trim(), nome: novo.nome.trim(), inicio_em: novo.inicio_em, fim_em: novo.fim_em });
      notificar({ tom: "sucesso", titulo: "Edição criada", descricao: novo.nome.trim() });
      setNovo(null);
      recarregar();
    } catch (err) {
      notificar({ tom: "erro", titulo: "Não foi possível criar", descricao: mensagemDeErro(err, "Tente de novo em instantes.") });
    } finally {
      setSalvando(false);
    }
  }

  function abrirEdicao(edicao: EdicaoSeminario) {
    setEdicaoId(edicao.id);
    setErros({});
    setRascunho({ codigo: edicao.codigo, nome: edicao.nome, inicio_em: edicao.inicio_em, fim_em: edicao.fim_em });
  }

  async function salvarEdicao(evento: FormEvent, edicao: EdicaoSeminario) {
    evento.preventDefault();
    const e = validar(rascunho, false);
    setErros(e);
    if (Object.keys(e).length > 0) return;
    setSalvando(true);
    try {
      await atualizarEdicao(edicao.id, { nome: rascunho.nome.trim(), inicio_em: rascunho.inicio_em, fim_em: rascunho.fim_em });
      notificar({ tom: "sucesso", titulo: "Edição salva", descricao: rascunho.nome.trim() });
      setEdicaoId(null);
      recarregar();
    } catch (err) {
      notificar({ tom: "erro", titulo: "Não foi possível salvar", descricao: mensagemDeErro(err, "Tente de novo em instantes.") });
    } finally {
      setSalvando(false);
    }
  }

  async function mudarAtiva(edicao: EdicaoSeminario, ativa: boolean) {
    setSalvando(true);
    try {
      await atualizarEdicao(edicao.id, { ativa });
      notificar({ tom: "sucesso", titulo: ativa ? "Edição reativada" : "Edição desativada", descricao: edicao.nome });
      setConfirmarDesativar(null);
      recarregar();
    } catch (err) {
      notificar({ tom: "erro", titulo: ativa ? "Não foi possível reativar" : "Não foi possível desativar", descricao: mensagemDeErro(err, "Tente de novo em instantes.") });
    } finally {
      setSalvando(false);
    }
  }

  const camposForm = (r: Rascunho, setR: (r: Rascunho) => void, comCodigo: boolean) => (
    <div className={`grid gap-4 ${comCodigo ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
      {comCodigo && (
        <Campo rotulo="Código" obrigatorio erro={erros.codigo} ajuda="Curto e único (ex.: 2026-09).">
          <Entrada value={r.codigo} onChange={(e) => setR({ ...r, codigo: e.target.value })} autoComplete="off" />
        </Campo>
      )}
      <Campo rotulo="Nome" obrigatorio erro={erros.nome}>
        <Entrada value={r.nome} onChange={(e) => setR({ ...r, nome: e.target.value })} />
      </Campo>
      <Campo rotulo="Início" obrigatorio erro={erros.inicio_em}>
        <Entrada type="date" value={r.inicio_em} onChange={(e) => setR({ ...r, inicio_em: e.target.value })} />
      </Campo>
      <Campo rotulo="Fim" obrigatorio erro={erros.fim_em}>
        <Entrada type="date" value={r.fim_em} onChange={(e) => setR({ ...r, fim_em: e.target.value })} />
      </Campo>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <IntroAba>Cada edição do seminário é a coorte que os indicadores agrupam — quem entrou por ela é medido junto, do seminário à holding.</IntroAba>
        {!novo && (
          <Botao variante="primario" onClick={() => setNovo({ codigo: "", nome: "", inicio_em: "", fim_em: "" })}>
            Nova edição
          </Botao>
        )}
      </div>

      {novo && (
        <Cartao rotulo="Nova edição" titulo="Edição do seminário">
          <form noValidate onSubmit={salvarNovo} className="flex flex-col gap-5">
            {camposForm(novo, setNovo, true)}
            <div className="flex flex-wrap justify-end gap-2">
              <Botao variante="fantasma" onClick={() => setNovo(null)}>
                Cancelar
              </Botao>
              <Botao type="submit" variante="primario" carregando={salvando}>
                Criar edição
              </Botao>
            </div>
          </form>
        </Cartao>
      )}

      {dados.itens.length === 0 && !novo ? (
        <EstadoVazio ilustracao="agenda" titulo="Nenhuma edição cadastrada" descricao="Sem edição, o lead do seminário não tem origem rastreável." />
      ) : (
        <Cartao preenchimento="sem">
          <Tabela resumo="Edições do seminário">
            <Thead>
              <tr>
                <Th>Código</Th>
                <Th>Nome</Th>
                <Th>Início</Th>
                <Th>Fim</Th>
                <Th>Estado</Th>
                <Th srOnly>Ações</Th>
              </tr>
            </Thead>
            <Tbody>
              {dados.itens.map((edicao) =>
                edicaoId === edicao.id ? (
                  <Tr key={edicao.id} className="bg-papel">
                    <td colSpan={6} className="block px-0 py-2 sm:table-cell sm:px-5 sm:py-4">
                      <form noValidate onSubmit={(e) => salvarEdicao(e, edicao)} className="flex flex-col gap-4">
                        <p className="text-sm text-tinta-suave">
                          Editando <span className="font-bold text-tinta">{edicao.codigo}</span>
                        </p>
                        {camposForm(rascunho, setRascunho, false)}
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
                  <Tr key={edicao.id}>
                    <Td rotulo="Código" className="text-tinta-suave">
                      {edicao.codigo}
                    </Td>
                    <Td rotulo="Nome" className="font-medium">
                      {edicao.nome}
                    </Td>
                    <Td rotulo="Início">{formatarData(edicao.inicio_em)}</Td>
                    <Td rotulo="Fim">{formatarData(edicao.fim_em)}</Td>
                    <Td rotulo="Estado">
                      <SeloAtivo ativo={edicao.ativa} />
                    </Td>
                    <Td acoes>
                      <div className="flex flex-wrap gap-2 sm:justify-end">
                        <Botao variante="fantasma" tamanho="compacto" onClick={() => abrirEdicao(edicao)}>
                          Editar
                        </Botao>
                        {edicao.ativa ? (
                          <Botao variante="perigo" tamanho="compacto" onClick={() => setConfirmarDesativar(edicao)}>
                            Desativar
                          </Botao>
                        ) : (
                          <Botao variante="secundario" tamanho="compacto" carregando={salvando} onClick={() => mudarAtiva(edicao, true)}>
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
        titulo="Desativar edição"
        efeito={`Marca "${confirmarDesativar?.nome}" como inativa — deixa de ser sugerida para novos leads do seminário. Jornadas já vinculadas não mudam.`}
        rotuloConfirmar="Desativar"
        perigo
        confirmando={salvando}
        aoConfirmar={() => confirmarDesativar && mudarAtiva(confirmarDesativar, false)}
        aoCancelar={() => setConfirmarDesativar(null)}
      />
    </div>
  );
}
