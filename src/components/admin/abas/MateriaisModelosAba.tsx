"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { Botao } from "@/components/ui/Botao";
import { AreaTexto, Campo, Entrada, Opcao } from "@/components/ui/Campo";
import { Cartao } from "@/components/ui/Cartao";
import { ConfirmarAcao } from "@/components/ui/ConfirmarAcao";
import { EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Selo, SeloStub } from "@/components/ui/Selo";
import { formatarDataHora } from "@/lib/formatar";
import { ApiError } from "@/lib/api";
import type { BlocoMaterial, ConteudoMaterial, MaterialModeloAdmin } from "@/types/material";
import { criarMaterialModeloVersao, editarMaterialModelo, listarMateriaisModelos } from "../adminApi";
import { mensagemDeErro } from "../http";
import { IntroAba, SeloAtivo } from "../comum";

/**
 * Catálogo do material pós-sessão (§3.4): cada modelo casa com dores e
 * arquétipos; a escolha é função pura, zero IA. Conteúdo é versionado
 * (POST = versão nova); dores/arquétipos/prioridade são metadados (PATCH).
 * Rascunho semeado por engenharia (`origem_dado='exemplo'`) nunca ativa
 * antes de a Dra. Elaine marcar como revisado — o banco recusa (409).
 */
export function MateriaisModelosAba() {
  const buscar = useCallback(() => listarMateriaisModelos(), []);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, []);
  const [novo, setNovo] = useState<Partial<MaterialModeloAdmin> | null>(null);

  const grupos = useMemo(() => {
    const mapa = new Map<string, MaterialModeloAdmin[]>();
    for (const m of dados?.itens ?? []) {
      if (!mapa.has(m.chave)) mapa.set(m.chave, []);
      mapa.get(m.chave)!.push(m);
    }
    return Array.from(mapa.entries()).map(([chave, versoes]) => ({ chave, versoes: [...versoes].sort((a, b) => b.versao - a.versao) }));
  }, [dados]);

  if (erro) {
    const semColunas = erro instanceof ApiError && erro.status === 500;
    return (
      <div className="flex flex-col gap-4">
        <Intro />
        {semColunas ? (
          <SeloStub texto="Catálogo de modelos ainda não disponível: as colunas de dores/arquétipos (migration 0055) não estão neste banco." />
        ) : (
          <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar os modelos" />
        )}
      </div>
    );
  }
  if (carregando && !dados) return <EsqueletoLista linhas={3} rotulo="Carregando modelos…" />;
  if (!dados) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Intro />
        {!novo && (
          <Botao variante="primario" onClick={() => setNovo({})}>
            Novo modelo
          </Botao>
        )}
      </div>

      {novo && (
        <FormularioVersao
          inicial={novo}
          aoCancelar={() => setNovo(null)}
          aoCriar={() => {
            setNovo(null);
            recarregar();
          }}
        />
      )}

      {grupos.length === 0 && !novo && (
        <EstadoVazio ilustracao="pasta" titulo="Nenhum modelo cadastrado" descricao="Sem modelo ativo, o material usa o texto padrão para toda dor." acao={<Botao variante="primario" onClick={() => setNovo({})}>Criar o primeiro</Botao>} />
      )}

      {grupos.map(({ chave, versoes }) => (
        <GrupoModelo key={chave} chave={chave} versoes={versoes} aoMudar={recarregar} aoNovaVersao={(base) => setNovo(base)} />
      ))}
    </div>
  );
}

function Intro() {
  return (
    <IntroAba>
      O texto-base do material pós-sessão, um por dor. O sistema escolhe o modelo que mais casa com a dor principal, o arquétipo e as preocupações
      do cliente — sem IA nessa escolha — e a IA só personaliza por cima.
    </IntroAba>
  );
}

function GrupoModelo({ chave, versoes, aoMudar, aoNovaVersao }: { chave: string; versoes: MaterialModeloAdmin[]; aoMudar: () => void; aoNovaVersao: (base: MaterialModeloAdmin) => void }) {
  const ativa = versoes.find((v) => v.ativo);
  const cabeca = ativa ?? versoes[0];
  return (
    <Cartao
      preenchimento="sem"
      rotulo={chave}
      titulo={cabeca.titulo}
      descricao={ativa ? `Em uso: v${ativa.versao}` : "Nenhuma versão em uso — não entra na escolha automática."}
      acao={
        <>
          {cabeca.origem_dado === "exemplo" ? <Selo tom="ambar">Rascunho — sem parecer</Selo> : <Selo tom="verde">Revisado</Selo>}
          <Botao variante="secundario" tamanho="compacto" onClick={() => aoNovaVersao(cabeca)}>
            Nova versão do texto
          </Botao>
        </>
      }
    >
      <ul className="divide-y divide-linha">
        {versoes.map((v) => (
          <VersaoModelo key={v.id} versao={v} aoMudar={aoMudar} />
        ))}
      </ul>
    </Cartao>
  );
}

function VersaoModelo({ versao, aoMudar }: { versao: MaterialModeloAdmin; aoMudar: () => void }) {
  const { notificar } = useToast();
  const [editando, setEditando] = useState(false);
  const [dores, setDores] = useState(versao.dores.join(", "));
  const [arquetipos, setArquetipos] = useState(versao.arquetipos.join(", "));
  const [prioridade, setPrioridade] = useState(String(versao.prioridade));
  const [salvando, setSalvando] = useState(false);
  const [confirmar, setConfirmar] = useState<"ativar" | "revisado" | null>(null);
  const [verTexto, setVerTexto] = useState(false);

  function listaDe(texto: string): string[] {
    return texto.split(/[,\n;]/).map((p) => p.trim().toLowerCase()).filter(Boolean);
  }

  async function salvarMetadados() {
    setSalvando(true);
    try {
      await editarMaterialModelo(versao.id, { dores: listaDe(dores), arquetipos: listaDe(arquetipos), prioridade: Number(prioridade) || 0 });
      notificar({ tom: "sucesso", titulo: "Roteamento salvo", descricao: `${versao.titulo} v${versao.versao}: dores e arquétipos atualizados.` });
      setEditando(false);
      aoMudar();
    } catch (e) {
      notificar({ tom: "erro", titulo: "Não foi possível salvar", descricao: mensagemDeErro(e, "Tente de novo em instantes.") });
    } finally {
      setSalvando(false);
    }
  }

  async function executarConfirmacao() {
    if (!confirmar) return;
    setSalvando(true);
    try {
      if (confirmar === "revisado") {
        await editarMaterialModelo(versao.id, { origem_dado: "real" });
        notificar({ tom: "sucesso", titulo: "Marcado como revisado", descricao: "Agora pode ser ativado." });
      } else {
        await editarMaterialModelo(versao.id, { ativar: true });
        notificar({ tom: "sucesso", titulo: "Versão ativada", descricao: `${versao.titulo} v${versao.versao} entra na escolha automática.` });
      }
      setConfirmar(null);
      aoMudar();
    } catch (e) {
      const rascunho = e instanceof ApiError && e.codigo === "modelo_rascunho";
      notificar({
        tom: "erro",
        titulo: rascunho ? "Ainda é um rascunho" : "Não foi possível ativar",
        descricao: rascunho ? "Este texto foi semeado como exemplo, sem parecer. Marque como revisado (depois de ler) e aí ative." : mensagemDeErro(e, "Tente de novo em instantes."),
      });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-bold text-tinta">
          v{versao.versao} — {versao.titulo}
        </p>
        <SeloAtivo ativo={versao.ativo} rotuloAtivo="Em uso" rotuloInativo="Histórico" />
        {versao.origem_dado === "exemplo" && <Selo tom="ambar">rascunho de exemplo</Selo>}
        <span className="text-xs text-tinta-fraca">criada em {formatarDataHora(versao.criado_em)}</span>
      </div>
      {versao.descricao && <p className="text-sm text-tinta-suave">{versao.descricao}</p>}

      {editando ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo rotulo="Dores" ajuda="Separe por vírgula. Casa por 'contém' na dor principal.">
            <Entrada value={dores} onChange={(e) => setDores(e.target.value)} />
          </Campo>
          <Campo rotulo="Arquétipos" ajuda="Construtor, Patriarca, Protetor…">
            <Entrada value={arquetipos} onChange={(e) => setArquetipos(e.target.value)} />
          </Campo>
          <Campo rotulo="Prioridade" ajuda="Desempate: menor vence.">
            <Entrada inputMode="numeric" value={prioridade} onChange={(e) => setPrioridade(e.target.value)} />
          </Campo>
        </div>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-tinta-fraca">Dores</dt>
          <dd className="text-tinta">{versao.dores.length > 0 ? versao.dores.join(", ") : <span className="text-tinta-fraca">— nenhuma (só entra como padrão)</span>}</dd>
          <dt className="text-tinta-fraca">Arquétipos</dt>
          <dd className="text-tinta">{versao.arquetipos.length > 0 ? versao.arquetipos.join(", ") : <span className="text-tinta-fraca">— nenhum</span>}</dd>
          <dt className="text-tinta-fraca">Prioridade</dt>
          <dd className="text-tinta">{versao.prioridade}</dd>
        </dl>
      )}

      <div>
        <button type="button" onClick={() => setVerTexto((v) => !v)} aria-expanded={verTexto} className="min-h-11 text-sm font-medium text-[color:var(--latao)] underline-offset-2 hover:underline">
          {verTexto ? "Esconder o texto" : "Ver o texto"}
        </button>
        {verTexto && <PreviaConteudo conteudo={versao.conteudo} />}
      </div>

      <div className="flex flex-wrap gap-2">
        {editando ? (
          <>
            <Botao variante="secundario" tamanho="compacto" carregando={salvando} onClick={salvarMetadados}>
              Salvar roteamento
            </Botao>
            <Botao variante="fantasma" tamanho="compacto" onClick={() => setEditando(false)}>
              Cancelar
            </Botao>
          </>
        ) : (
          <Botao variante="fantasma" tamanho="compacto" onClick={() => setEditando(true)}>
            Editar dores e arquétipos
          </Botao>
        )}
        {versao.origem_dado === "exemplo" && (
          <Botao variante="secundario" tamanho="compacto" onClick={() => setConfirmar("revisado")}>
            Marcar como revisado
          </Botao>
        )}
        {!versao.ativo && (
          <Botao variante="secundario" tamanho="compacto" onClick={() => setConfirmar("ativar")}>
            Ativar esta versão
          </Botao>
        )}
      </div>

      <ConfirmarAcao
        aberto={confirmar !== null}
        titulo={confirmar === "revisado" ? "Marcar como revisado" : "Ativar esta versão"}
        efeito={
          confirmar === "revisado"
            ? `Declara que a Dra. Elaine leu e aprovou o texto "${versao.titulo}". Ele deixa de carregar a marca de rascunho e passa a poder ser ativado.`
            : `"${versao.titulo}" v${versao.versao} substitui a versão em uso desta chave. Todo material gerado a partir de agora para essa dor usa este texto.`
        }
        rotuloConfirmar={confirmar === "revisado" ? "Marcar como revisado" : "Ativar"}
        confirmando={salvando}
        aoConfirmar={executarConfirmacao}
        aoCancelar={() => setConfirmar(null)}
      />
    </li>
  );
}

function PreviaConteudo({ conteudo }: { conteudo: ConteudoMaterial }) {
  return (
    <div className="mt-2 flex max-w-prose flex-col gap-2 rounded-controle bg-papel px-4 py-3 text-sm leading-relaxed text-tinta">
      <p className="font-bold">{conteudo.titulo}</p>
      {conteudo.blocos.map((b, i) => (
        <Bloco key={i} bloco={b} />
      ))}
    </div>
  );
}

function Bloco({ bloco }: { bloco: BlocoMaterial }) {
  switch (bloco.tipo) {
    case "titulo":
      return <p className="font-bold">{bloco.texto}</p>;
    case "citacao":
      return <blockquote className="border-l-4 border-[color:var(--latao-cta)] pl-3 text-tinta-suave">{bloco.texto}</blockquote>;
    case "lista":
      return (
        <ul className="list-disc pl-5">
          {bloco.itens.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    default:
      return <p>{bloco.texto}</p>;
  }
}

// ---------------------------------------------------------------------------
// Versão nova de texto (POST) — texto simples vira blocos
// ---------------------------------------------------------------------------

/** Texto livre → blocos: linha "# " = título, "- " = item de lista, "> " = citação, resto = parágrafo. */
export function textoParaBlocos(texto: string): BlocoMaterial[] {
  const blocos: BlocoMaterial[] = [];
  let lista: string[] = [];
  const fecharLista = () => {
    if (lista.length > 0) {
      blocos.push({ tipo: "lista", itens: lista });
      lista = [];
    }
  };
  for (const linhaCrua of texto.split("\n")) {
    const linha = linhaCrua.trim();
    if (!linha) {
      fecharLista();
      continue;
    }
    if (linha.startsWith("- ") || linha.startsWith("• ")) {
      lista.push(linha.slice(2).trim());
      continue;
    }
    fecharLista();
    if (linha.startsWith("# ")) blocos.push({ tipo: "titulo", texto: linha.slice(2).trim() });
    else if (linha.startsWith("> ")) blocos.push({ tipo: "citacao", texto: linha.slice(2).trim() });
    else blocos.push({ tipo: "paragrafo", texto: linha });
  }
  fecharLista();
  return blocos;
}

function blocosParaTexto(conteudo: ConteudoMaterial | undefined): string {
  if (!conteudo) return "";
  return conteudo.blocos
    .map((b) => {
      if (b.tipo === "titulo") return `# ${b.texto}`;
      if (b.tipo === "citacao") return `> ${b.texto}`;
      if (b.tipo === "lista") return b.itens.map((i) => `- ${i}`).join("\n");
      return b.texto;
    })
    .join("\n\n");
}

function FormularioVersao({ inicial, aoCancelar, aoCriar }: { inicial: Partial<MaterialModeloAdmin>; aoCancelar: () => void; aoCriar: () => void }) {
  const { notificar } = useToast();
  const [chave, setChave] = useState(inicial.chave ?? "");
  const [titulo, setTitulo] = useState(inicial.titulo ?? "");
  const [descricao, setDescricao] = useState(inicial.descricao ?? "");
  const [tituloConteudo, setTituloConteudo] = useState(inicial.conteudo?.titulo ?? "");
  const [texto, setTexto] = useState(blocosParaTexto(inicial.conteudo));
  const [dores, setDores] = useState((inicial.dores ?? []).join(", "));
  const [arquetipos, setArquetipos] = useState((inicial.arquetipos ?? []).join(", "));
  const [prioridade, setPrioridade] = useState(String(inicial.prioridade ?? 100));
  const [ativar, setAtivar] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const chaveFixa = Boolean(inicial.chave);

  function validar() {
    const e: Record<string, string> = {};
    if (!/^[a-z][a-z0-9_]{1,49}$/.test(chave.trim())) e.chave = "Minúsculas, dígitos e _ (2 a 50 caracteres). Ex.: inventario.";
    if (!titulo.trim()) e.titulo = "Dê um nome ao modelo.";
    if (!tituloConteudo.trim()) e.tituloConteudo = "O material precisa de um título.";
    if (textoParaBlocos(texto).length === 0) e.texto = "Escreva o texto-base (pelo menos um parágrafo).";
    return e;
  }

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    const e = validar();
    setErros(e);
    if (Object.keys(e).length > 0) {
      notificar({ tom: "erro", titulo: "Faltou preencher", descricao: Object.values(e)[0] });
      return;
    }
    setSalvando(true);
    try {
      const lista = (t: string) => t.split(/[,\n;]/).map((p) => p.trim().toLowerCase()).filter(Boolean);
      await criarMaterialModeloVersao({
        chave: chave.trim(),
        titulo: titulo.trim(),
        descricao: descricao.trim() || null,
        conteudo: { titulo: tituloConteudo.trim(), blocos: textoParaBlocos(texto) },
        dores: lista(dores),
        arquetipos: lista(arquetipos),
        prioridade: Number(prioridade) || 100,
        ativar,
      });
      notificar({ tom: "sucesso", titulo: ativar ? "Versão criada e ativada" : "Versão criada", descricao: `${titulo.trim()} (${chave.trim()}).` });
      aoCriar();
    } catch (erro) {
      notificar({ tom: "erro", titulo: "Não foi possível criar a versão", descricao: mensagemDeErro(erro, "Tente de novo em instantes.") });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Cartao rotulo={chaveFixa ? "Nova versão do texto" : "Novo modelo"} titulo={chaveFixa ? `${inicial.titulo ?? inicial.chave}` : "Modelo de material"} descricao="O texto escrito aqui nasce como revisado (é o escritório escrevendo, não engenharia).">
      <form noValidate onSubmit={enviar} className="flex flex-col gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Campo rotulo="Chave" erro={erros.chave} obrigatorio ajuda="Identificador fixo do modelo (não muda entre versões).">
            <Entrada value={chave} disabled={chaveFixa} onChange={(e) => setChave(e.target.value)} autoComplete="off" />
          </Campo>
          <Campo rotulo="Nome do modelo" erro={erros.titulo} obrigatorio>
            <Entrada value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </Campo>
        </div>
        <Campo rotulo="Para que serve" extra="opcional">
          <Entrada value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </Campo>
        <Campo rotulo="Título do material" erro={erros.tituloConteudo} obrigatorio ajuda="O que o cliente lê no topo do PDF.">
          <Entrada value={tituloConteudo} onChange={(e) => setTituloConteudo(e.target.value)} />
        </Campo>
        <Campo rotulo="Texto-base" erro={erros.texto} obrigatorio ajuda="Parágrafos separados por linha em branco. Comece a linha com '# ' para título, '- ' para item de lista, '> ' para citação.">
          <AreaTexto rows={12} value={texto} onChange={(e) => setTexto(e.target.value)} />
        </Campo>
        <div className="grid gap-5 sm:grid-cols-3">
          <Campo rotulo="Dores" ajuda="Separe por vírgula.">
            <Entrada value={dores} onChange={(e) => setDores(e.target.value)} />
          </Campo>
          <Campo rotulo="Arquétipos" ajuda="Separe por vírgula.">
            <Entrada value={arquetipos} onChange={(e) => setArquetipos(e.target.value)} />
          </Campo>
          <Campo rotulo="Prioridade" ajuda="Desempate: menor vence.">
            <Entrada inputMode="numeric" value={prioridade} onChange={(e) => setPrioridade(e.target.value)} />
          </Campo>
        </div>
        <Opcao tipo="checkbox" rotulo="Ativar assim que criar" descricao="Substitui a versão em uso desta chave." checked={ativar} onChange={(e) => setAtivar(e.target.checked)} />
        <div className="flex flex-wrap justify-end gap-2">
          <Botao variante="fantasma" onClick={aoCancelar}>
            Cancelar
          </Botao>
          <Botao type="submit" variante="primario" carregando={salvando}>
            Criar versão
          </Botao>
        </div>
      </form>
    </Cartao>
  );
}
