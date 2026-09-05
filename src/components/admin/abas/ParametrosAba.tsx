"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { Botao } from "@/components/ui/Botao";
import { AreaTexto, Campo, Entrada, Opcao, Selecao } from "@/components/ui/Campo";
import { Cartao } from "@/components/ui/Cartao";
import { ConfirmarAcao } from "@/components/ui/ConfirmarAcao";
import { EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Selo, SeloStub } from "@/components/ui/Selo";
import { formatarData, formatarDataHora, formatarMoeda } from "@/lib/formatar";
import { ApiError } from "@/lib/api";
import { CHAVE_PARAMETRO, type CorpoCriarParametro, type ParametroMetodo, type UnidadeParametro } from "@/types/cenario";
import { ativarParametro, criarParametro, listarParametros } from "../adminApi";
import { mensagemDeErro } from "../http";
import { IntroAba, SeloAtivo, TRACO } from "../comum";

/** Texto exato do §4.10 — vale enquanto não houver nenhuma linha `itcmd.*`. */
const TEXTO_SEM_ITCMD = "Nenhuma alíquota de ITCMD cadastrada. O sistema não calcula imposto sem uma alíquota com base legal registrada aqui pela Dra. Elaine.";

const ROTULO_CHAVE: Record<string, string> = {
  [CHAVE_PARAMETRO.croquiPadrao]: "Honorários do Croqui — padrão",
  [CHAVE_PARAMETRO.croquiIncentivo]: "Honorários do Croqui — Incentivo do Resolvedor",
  [CHAVE_PARAMETRO.itcmdAliquota]: "ITCMD — alíquota",
  [CHAVE_PARAMETRO.itbiAliquota]: "ITBI — alíquota",
};

const CHAVES_SUGERIDAS = [CHAVE_PARAMETRO.itcmdAliquota, CHAVE_PARAMETRO.itbiAliquota, CHAVE_PARAMETRO.croquiPadrao, CHAVE_PARAMETRO.croquiIncentivo];

const UNIDADES: { valor: UnidadeParametro; rotulo: string }[] = [
  { valor: "percentual", rotulo: "Percentual (%)" },
  { valor: "brl", rotulo: "Reais (R$)" },
  { valor: "parcelas", rotulo: "Parcelas" },
  { valor: "dias", rotulo: "Dias" },
  { valor: "meses", rotulo: "Meses" },
  { valor: "quantidade", rotulo: "Quantidade" },
];

const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];

function rotuloChave(chave: string): string {
  return ROTULO_CHAVE[chave] ?? chave;
}

export function ehTributo(chave: string): boolean {
  return chave.startsWith("itcmd.") || chave.startsWith("itbi.");
}

export function formatarValor(p: Pick<ParametroMetodo, "valor" | "unidade">): string {
  const numero = Number(p.valor);
  if (Number.isNaN(numero)) return TRACO;
  switch (p.unidade) {
    case "brl":
      return formatarMoeda(numero);
    case "percentual":
      return `${numero.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`;
    case "parcelas":
      return `${numero} parcela${numero === 1 ? "" : "s"}`;
    case "dias":
      return `${numero} dia${numero === 1 ? "" : "s"}`;
    case "meses":
      return `${numero} ${numero === 1 ? "mês" : "meses"}`;
    default:
      return numero.toLocaleString("pt-BR");
  }
}

/** Jurisdição legível: "SP" / "SP · Campinas" / vazio. */
function jurisdicao(p: Pick<ParametroMetodo, "uf" | "municipio">): string {
  if (!p.uf) return "";
  return p.municipio ? `${p.uf} · ${p.municipio}` : p.uf;
}

/** Agrupa por chave + jurisdição — cada grupo é uma linha do tempo de versões. */
function agrupar(itens: ParametroMetodo[]) {
  const grupos = new Map<string, ParametroMetodo[]>();
  for (const item of itens) {
    const id = `${item.chave}|${item.uf ?? ""}|${item.municipio ?? ""}`;
    if (!grupos.has(id)) grupos.set(id, []);
    grupos.get(id)!.push(item);
  }
  return Array.from(grupos.entries()).map(([id, versoes]) => ({ id, versoes: [...versoes].sort((a, b) => b.versao - a.versao) }));
}

export function ParametrosAba() {
  const buscar = useCallback(() => listarParametros(), []);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, []);
  const [novo, setNovo] = useState<Partial<CorpoCriarParametro> | null>(null);
  const [confirmarAtivar, setConfirmarAtivar] = useState<ParametroMetodo | null>(null);
  const [ativando, setAtivando] = useState(false);
  const { notificar } = useToast();

  const grupos = useMemo(() => agrupar(dados?.itens ?? []), [dados]);
  const temItcmd = useMemo(() => (dados?.itens ?? []).some((i) => i.chave.startsWith("itcmd.")), [dados]);

  if (erro) {
    const tabelaAusente = erro instanceof ApiError && erro.status === 500;
    return (
      <div className="flex flex-col gap-4">
        <Intro />
        {tabelaAusente ? (
          <SeloStub texto="Parâmetros do método ainda não disponíveis: a tabela parametros_metodo (migration 0056) não está neste banco." />
        ) : (
          <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar os parâmetros" />
        )}
      </div>
    );
  }
  if (carregando && !dados) return <EsqueletoLista linhas={4} rotulo="Carregando parâmetros…" />;
  if (!dados) return null;

  async function ativar() {
    if (!confirmarAtivar) return;
    setAtivando(true);
    try {
      await ativarParametro(confirmarAtivar.id);
      notificar({ tom: "sucesso", titulo: "Versão ativada", descricao: `${rotuloChave(confirmarAtivar.chave)} agora usa a v${confirmarAtivar.versao}.` });
      setConfirmarAtivar(null);
      recarregar();
    } catch (e) {
      notificar({ tom: "erro", titulo: "Não foi possível ativar", descricao: mensagemDeErro(e, "Tente de novo em instantes.") });
    } finally {
      setAtivando(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Intro />
        {!novo && (
          <Botao variante="primario" onClick={() => setNovo({ chave: CHAVE_PARAMETRO.itcmdAliquota, unidade: "percentual" })}>
            Nova versão de parâmetro
          </Botao>
        )}
      </div>

      {!temItcmd && <SeloStub texto={TEXTO_SEM_ITCMD} />}

      {novo && (
        <FormularioParametro
          inicial={novo}
          aoCancelar={() => setNovo(null)}
          aoCriar={() => {
            setNovo(null);
            recarregar();
          }}
        />
      )}

      {grupos.length === 0 && !novo && (
        <EstadoVazio
          ilustracao="lista"
          titulo="Nenhum parâmetro cadastrado"
          descricao="Honorários do croqui, alíquotas de ITCMD e ITBI vivem aqui, com versão e base legal. O sistema nunca inventa um número."
          acao={
            <Botao variante="primario" onClick={() => setNovo({ chave: CHAVE_PARAMETRO.croquiPadrao, unidade: "brl" })}>
              Cadastrar o primeiro
            </Botao>
          }
        />
      )}

      {grupos.map(({ id, versoes }) => {
        const ativa = versoes.find((v) => v.ativo);
        const cabeca = versoes[0];
        return (
          <Cartao
            key={id}
            preenchimento="sem"
            rotulo={jurisdicao(cabeca) || (ehTributo(cabeca.chave) ? "sem jurisdição" : "geral")}
            titulo={rotuloChave(cabeca.chave)}
            descricao={ativa ? `Em uso: ${formatarValor(ativa)} (v${ativa.versao}, vigente desde ${formatarData(ativa.vigente_de)})` : "Nenhuma versão ativa — o sistema não usa este parâmetro."}
            acao={
              <>
                {ativa ? <Selo tom="verde">{formatarValor(ativa)}</Selo> : <Selo tom="ambar">Sem versão ativa</Selo>}
                <Botao variante="secundario" tamanho="compacto" onClick={() => setNovo({ chave: cabeca.chave, unidade: cabeca.unidade, uf: cabeca.uf, municipio: cabeca.municipio, base_legal: cabeca.base_legal })}>
                  Nova versão
                </Botao>
              </>
            }
          >
            <ul className="divide-y divide-linha">
              {versoes.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 sm:px-6">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-tinta">
                      v{v.versao} — {formatarValor(v)}
                      <SeloAtivo ativo={v.ativo} rotuloAtivo="Em uso" rotuloInativo="Histórico" />
                    </p>
                    <p className="mt-0.5 text-xs text-tinta-suave">
                      Vigente desde {formatarData(v.vigente_de)} · criada em {formatarDataHora(v.criado_em)}
                      {v.ativado_em && ` · ativada em ${formatarDataHora(v.ativado_em)}`}
                    </p>
                    {v.base_legal && (
                      <p className="mt-1 text-sm text-tinta">
                        <span className="text-tinta-fraca">Base legal:</span> {v.base_legal}
                      </p>
                    )}
                    {v.notas && <p className="mt-1 text-sm text-tinta-suave">{v.notas}</p>}
                  </div>
                  {!v.ativo && (
                    <Botao variante="secundario" tamanho="compacto" onClick={() => setConfirmarAtivar(v)}>
                      Usar esta versão
                    </Botao>
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
        efeito={
          confirmarAtivar
            ? `${rotuloChave(confirmarAtivar.chave)} passa a valer ${formatarValor(confirmarAtivar)} (v${confirmarAtivar.versao}) a partir de agora. Cálculos já gravados guardam a versão que os gerou.`
            : ""
        }
        rotuloConfirmar="Usar esta versão"
        confirmando={ativando}
        aoConfirmar={ativar}
        aoCancelar={() => setConfirmarAtivar(null)}
      />
    </div>
  );
}

function Intro() {
  return (
    <IntroAba>
      Os números do método, com versão e base legal: honorários do croqui, alíquotas de ITCMD por UF e de ITBI por município. Uma versão nunca é
      editada — cria-se outra e ela passa a valer.
    </IntroAba>
  );
}

// ---------------------------------------------------------------------------
// Formulário de versão nova — validação no cliente espelha o 422 do servidor
// ---------------------------------------------------------------------------

interface Rascunho {
  chave: string;
  chaveOutra: boolean;
  valor: string;
  unidade: UnidadeParametro;
  uf: string;
  municipio: string;
  base_legal: string;
  vigente_de: string;
  notas: string;
  ativar: boolean;
}

type Erros = Partial<Record<keyof Rascunho, string>>;

export function validarRascunho(r: Rascunho): Erros {
  const erros: Erros = {};
  const chave = r.chave.trim();
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(chave)) erros.chave = "Chave no formato grupo.nome (ex.: itcmd.aliquota).";
  const valor = Number(r.valor.replace(",", "."));
  if (r.valor.trim() === "" || Number.isNaN(valor) || valor < 0) erros.valor = "Informe um número maior ou igual a zero.";
  const tributo = ehTributo(chave);
  if (tributo && !r.base_legal.trim()) erros.base_legal = "Alíquota de imposto exige base legal (lei, decreto ou link oficial).";
  if (tributo && !r.uf) erros.uf = "Alíquota de imposto exige a UF.";
  if (chave.startsWith("itbi.") && !r.municipio.trim()) erros.municipio = "ITBI é municipal: informe o município.";
  if (r.municipio.trim() && !r.uf) erros.uf = "Município exige UF.";
  if (tributo && r.unidade !== "percentual") erros.unidade = "Alíquota de imposto é percentual.";
  return erros;
}

function FormularioParametro({ inicial, aoCancelar, aoCriar }: { inicial: Partial<CorpoCriarParametro>; aoCancelar: () => void; aoCriar: () => void }) {
  const { notificar } = useToast();
  const [r, setR] = useState<Rascunho>({
    chave: inicial.chave ?? "",
    chaveOutra: Boolean(inicial.chave && !CHAVES_SUGERIDAS.includes(inicial.chave as (typeof CHAVES_SUGERIDAS)[number])),
    valor: "",
    unidade: inicial.unidade ?? "percentual",
    uf: inicial.uf ?? "",
    municipio: inicial.municipio ?? "",
    base_legal: inicial.base_legal ?? "",
    vigente_de: new Date().toISOString().slice(0, 10),
    notas: "",
    ativar: true,
  });
  const [erros, setErros] = useState<Erros>({});
  const [tocado, setTocado] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const tributo = ehTributo(r.chave);
  const errosVivos = tocado ? validarRascunho(r) : erros;

  function mudar<K extends keyof Rascunho>(campo: K, valor: Rascunho[K]) {
    setR((atual) => ({ ...atual, [campo]: valor }));
  }

  function validarNoBlur() {
    setErros(validarRascunho(r));
  }

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    const e = validarRascunho(r);
    setErros(e);
    setTocado(true);
    if (Object.keys(e).length > 0) {
      notificar({ tom: "erro", titulo: "Faltou preencher", descricao: Object.values(e)[0] });
      return;
    }
    setSalvando(true);
    try {
      await criarParametro({
        chave: r.chave.trim(),
        valor: Number(r.valor.replace(",", ".")),
        unidade: r.unidade,
        uf: r.uf || null,
        municipio: r.municipio.trim() || null,
        base_legal: r.base_legal.trim() || null,
        vigente_de: r.vigente_de,
        notas: r.notas.trim() || null,
        ativar: r.ativar,
      });
      notificar({ tom: "sucesso", titulo: r.ativar ? "Versão criada e em uso" : "Versão criada", descricao: `${rotuloChave(r.chave)}: ${formatarValor({ valor: Number(r.valor.replace(",", ".")), unidade: r.unidade })}.` });
      aoCriar();
    } catch (erro) {
      const detalhe = erro instanceof ApiError && erro.status === 422 ? "O servidor recusou: confira base legal, UF e município." : undefined;
      notificar({ tom: "erro", titulo: "Não foi possível criar a versão", descricao: detalhe ?? mensagemDeErro(erro, "Tente de novo em instantes.") });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Cartao como="section" rotulo="Nova versão" titulo={r.chave ? rotuloChave(r.chave) : "Parâmetro"} descricao="Não altera a versão em uso até você marcar 'usar esta versão'.">
      <form noValidate onSubmit={enviar} className="flex flex-col gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Campo rotulo="Parâmetro" erro={errosVivos.chave} obrigatorio>
            {r.chaveOutra ? (
              <Entrada value={r.chave} onChange={(e) => mudar("chave", e.target.value)} onBlur={validarNoBlur} placeholder="grupo.nome" autoComplete="off" />
            ) : (
              <Selecao
                value={r.chave}
                onChange={(e) => {
                  if (e.target.value === "__outra__") {
                    setR((a) => ({ ...a, chaveOutra: true, chave: "" }));
                    return;
                  }
                  const chave = e.target.value;
                  setR((a) => ({ ...a, chave, unidade: ehTributo(chave) ? "percentual" : chave.startsWith("honorarios.") ? "brl" : a.unidade }));
                }}
              >
                {CHAVES_SUGERIDAS.map((c) => (
                  <option key={c} value={c}>
                    {rotuloChave(c)}
                  </option>
                ))}
                <option value="__outra__">Outra chave…</option>
              </Selecao>
            )}
          </Campo>
          <Campo rotulo="Unidade" erro={errosVivos.unidade} obrigatorio>
            <Selecao value={r.unidade} onChange={(e) => mudar("unidade", e.target.value as UnidadeParametro)}>
              {UNIDADES.map((u) => (
                <option key={u.valor} value={u.valor}>
                  {u.rotulo}
                </option>
              ))}
            </Selecao>
          </Campo>
          <Campo rotulo="Valor" erro={errosVivos.valor} obrigatorio ajuda={r.unidade === "percentual" ? "Só o número: 4 significa 4%." : r.unidade === "brl" ? "Em reais, sem R$: 7200." : undefined}>
            <Entrada inputMode="decimal" value={r.valor} onChange={(e) => mudar("valor", e.target.value)} onBlur={validarNoBlur} />
          </Campo>
          <Campo rotulo="Vigente desde" obrigatorio>
            <Entrada type="date" value={r.vigente_de} onChange={(e) => mudar("vigente_de", e.target.value)} />
          </Campo>
          <Campo rotulo="UF" erro={errosVivos.uf} obrigatorio={tributo} extra={tributo ? undefined : "opcional"}>
            <Selecao value={r.uf} onChange={(e) => mudar("uf", e.target.value)} onBlur={validarNoBlur}>
              <option value="">{TRACO}</option>
              {UFS.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </Selecao>
          </Campo>
          <Campo rotulo="Município" erro={errosVivos.municipio} obrigatorio={r.chave.startsWith("itbi.")} extra={r.chave.startsWith("itbi.") ? undefined : "opcional"}>
            <Entrada value={r.municipio} onChange={(e) => mudar("municipio", e.target.value)} onBlur={validarNoBlur} autoComplete="off" />
          </Campo>
        </div>
        <Campo rotulo="Base legal" erro={errosVivos.base_legal} obrigatorio={tributo} extra={tributo ? undefined : "opcional"} ajuda="Lei, decreto ou link oficial de onde este número veio. Obrigatória para imposto.">
          <AreaTexto rows={2} value={r.base_legal} onChange={(e) => mudar("base_legal", e.target.value)} onBlur={validarNoBlur} />
        </Campo>
        <Campo rotulo="Notas" extra="opcional">
          <AreaTexto rows={2} value={r.notas} onChange={(e) => mudar("notas", e.target.value)} />
        </Campo>
        <Opcao tipo="checkbox" rotulo="Usar esta versão assim que criar" descricao="Desmarque para deixar como histórico e ativar depois." checked={r.ativar} onChange={(e) => mudar("ativar", e.target.checked)} />
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
