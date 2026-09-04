"use client";

import { useCallback, useState } from "react";
import { criarPatrimonio, excluirPatrimonio, atualizarPatrimonio, listarPatrimonio, ApiError, type PatrimonioItem } from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";
import { useTema } from "@/hooks/useTema";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Botao } from "@/components/ui/Botao";
import { Selo } from "@/components/ui/Selo";
import { formatarData, formatarMoeda, SEM_DADO } from "@/lib/formatar";
import { cnpjEhValido, normalizarCnpj } from "@/server/cnpj/normalizar";
import { QuadroSocietario, type SocioQuadro } from "@/components/graficos/QuadroSocietario";
import { buscarCnpjEmCache, consultarCnpjPublico, ErroCnpjApi, type RespostaCnpj } from "@/components/ficha360/api-cnpj";
import type { ConsultaCnpj } from "@/types/cnpj";

const ROTULOS_TIPO: Record<PatrimonioItem["tipo"], string> = {
  imovel: "Imóvel",
  veiculo: "Veículo",
  investimento: "Investimento",
  previdencia: "Previdência",
  empresa: "Empresa",
  outro: "Outro",
};

/**
 * `detalhes` é jsonb livre (nenhuma migration nova por isto) — o Relatório da
 * SV (template da Dra. Elaine) pede, só para empresa, objeto/composição
 * societária/capital social/nº de empregados/PL/faturamento. Convenção de
 * chaves fixada aqui; nenhum outro lugar escreve neste objeto.
 *
 * `cnpj` (docs/ARQUITETURA-FASE-3.md §4.3): 14 dígitos normalizados, nunca
 * mascarado — é a chave de `consultas_cnpj.cnpj`. Só entra aqui depois de
 * passar por `normalizarCnpj` (dígito verificador validado no cliente); se a
 * digitação não fechar o dígito verificador, a chave simplesmente não é
 * gravada (nunca um CNPJ inválido persistido, nunca um dado inventado).
 */
interface DetalhesEmpresa {
  objeto?: string;
  composicao_societaria?: string;
  capital_social?: number | null;
  numero_empregados?: number | null;
  pl?: number | null;
  faturamento?: number | null;
  cnpj?: string | null;
}

function detalhesEmpresa(item: Pick<PatrimonioItem, "detalhes">): DetalhesEmpresa {
  return (item.detalhes ?? {}) as DetalhesEmpresa;
}

function itemVazio(): Omit<PatrimonioItem, "id"> {
  return { tipo: "imovel", descricao: "", ano_aquisicao: null, valor_historico: null, valor_mercado: null, destinacao: null, valor_locacao_mensal: null, detalhes: {} };
}

/** Linha auxiliar "rótulo: valor" — só aparece quando há valor (vazio é omitido, nunca "—" poluindo a subtítulo). */
function parte(rotulo: string, valor: string | number | null | undefined, formatar?: (v: string | number) => string): string | null {
  if (valor === null || valor === undefined || valor === "") return null;
  return `${rotulo}: ${formatar ? formatar(valor) : valor}`;
}

function subtituloItem(item: PatrimonioItem): string | null {
  const partes: (string | null)[] = [parte("Aquisição", item.ano_aquisicao)];
  if (item.tipo === "imovel") {
    partes.push(parte("Destinação", item.destinacao), parte("Locação", item.valor_locacao_mensal, (v) => `${formatarMoeda(Number(v))}/mês`));
  }
  if (item.tipo === "empresa") {
    const d = detalhesEmpresa(item);
    partes.push(
      parte("Objeto", d.objeto),
      parte("Sócios", d.composicao_societaria),
      parte("Capital social", d.capital_social, (v) => formatarMoeda(Number(v))),
      parte("Funcionários", d.numero_empregados),
      parte("PL", d.pl, (v) => formatarMoeda(Number(v))),
      parte("Faturamento", d.faturamento, (v) => formatarMoeda(Number(v))),
    );
  }
  const texto = partes.filter((p): p is string => p !== null).join(" · ");
  return texto || null;
}

/**
 * Máscara progressiva de CNPJ enquanto o usuário digita — nunca valida aqui
 * (isso é `cnpjEhValido`), só formata o que já foi digitado.
 */
function mascararCnpjEntrada(valor: string): string {
  const digitos = valor.replace(/\D/g, "").slice(0, 14);
  const p = [digitos.slice(0, 2), digitos.slice(2, 5), digitos.slice(5, 8), digitos.slice(8, 12), digitos.slice(12, 14)];
  let saida = p[0];
  if (p[1]) saida += `.${p[1]}`;
  if (p[2]) saida += `.${p[2]}`;
  if (p[3]) saida += `/${p[3]}`;
  if (p[4]) saida += `-${p[4]}`;
  return saida;
}

/**
 * Códigos que `src/server/cnpj/brasilapi.ts` grava em `falha_motivo`
 * (prefixo estável, ver comentário lá) traduzidos para o que a Dra. Elaine
 * lê — nunca o código cru na tela.
 */
function traduzirFalhaMotivo(motivo: string | null | undefined): string {
  if (!motivo) return "motivo não registrado";
  if (motivo.startsWith("timeout")) return "a BrasilAPI não respondeu a tempo (mais de 10s)";
  if (motivo.startsWith("erro_rede")) return "não foi possível contatar a BrasilAPI (falha de rede)";
  if (motivo.startsWith("cnpj_nao_encontrado")) return "este CNPJ não consta na Receita Federal";
  if (motivo.startsWith("brasilapi_")) return "a BrasilAPI respondeu com erro";
  if (motivo.startsWith("resposta_nao_json") || motivo.startsWith("formato_inesperado")) return "a BrasilAPI devolveu uma resposta em formato inesperado";
  return motivo;
}

function tomSituacao(situacao: string | null): "verde" | "vermelho" | "azul" | "neutro" {
  const s = (situacao ?? "").toLowerCase();
  if (s.includes("ativa")) return "verde";
  if (s.includes("baixada") || s.includes("inapta") || s.includes("nula")) return "vermelho";
  if (s.includes("suspensa")) return "azul";
  return "neutro";
}

function socioParaQuadro(consulta: ConsultaCnpj): SocioQuadro[] {
  return consulta.qsa.map((s) => ({
    nome: s.nome_socio,
    qualificacao: s.qualificacao_socio,
    // A BrasilAPI não devolve percentual de participação — `undefined` aqui
    // vira "não informado" no gráfico (QuadroSocietario), nunca 0%.
    percentual: undefined,
    dataEntrada: s.data_entrada_sociedade,
  }));
}

/**
 * Bloco "Empresas" (§4.5) — um card por item `tipo='empresa'`. Antes de ter
 * CNPJ, oferece o campo para gravá-lo (validado no cliente, nunca persiste
 * dígito verificador inválido). Depois, consulta o cache (nunca a BrasilAPI
 * sozinha) e mostra as quatro telas honestas: nunca consultado, consultando,
 * consulta indisponível (com o motivo) e dado obtido — com aviso separado
 * quando a última tentativa de ATUALIZAR falhou mas havia dado bom anterior.
 */
function BlocoEmpresa({ item, jornadaId, aoAtualizarItem }: { item: PatrimonioItem; jornadaId: string; aoAtualizarItem: () => void }) {
  const cnpjSalvo = detalhesEmpresa(item).cnpj ?? null;

  const [cnpjDigitando, setCnpjDigitando] = useState("");
  const [salvandoCnpj, setSalvandoCnpj] = useState(false);
  const [erroSalvarCnpj, setErroSalvarCnpj] = useState<string | null>(null);

  const cnpjDigitosValidos = cnpjEhValido(cnpjDigitando);
  const cnpjIncompleto = cnpjDigitando.replace(/\D/g, "").length > 0 && cnpjDigitando.replace(/\D/g, "").length < 14;

  async function salvarCnpj() {
    if (!cnpjDigitosValidos) return;
    setSalvandoCnpj(true);
    setErroSalvarCnpj(null);
    try {
      const cnpj = normalizarCnpj(cnpjDigitando);
      await atualizarPatrimonio(item.id, { detalhes: { ...item.detalhes, cnpj } });
      setCnpjDigitando("");
      aoAtualizarItem();
    } catch (e) {
      setErroSalvarCnpj(e instanceof ApiError ? e.message : "Não foi possível gravar o CNPJ.");
    } finally {
      setSalvandoCnpj(false);
    }
  }

  if (!cnpjSalvo) {
    return (
      <div className="flex flex-col gap-2 rounded-sm border border-linha bg-papel-fundo p-3">
        <p className="text-sm font-medium text-tinta">{item.descricao || "Empresa sem descrição"}</p>
        <label className="flex flex-col gap-1 text-sm" htmlFor={`cnpj-novo-${item.id}`}>
          CNPJ (para consultar dados públicos)
          <div className="flex flex-wrap items-center gap-2">
            <input
              id={`cnpj-novo-${item.id}`}
              value={cnpjDigitando}
              onChange={(e) => setCnpjDigitando(mascararCnpjEntrada(e.target.value))}
              inputMode="numeric"
              placeholder="00.000.000/0000-00"
              aria-invalid={cnpjIncompleto || (cnpjDigitando.length > 0 && !cnpjDigitosValidos && !cnpjIncompleto)}
              aria-describedby={`cnpj-novo-erro-${item.id}`}
              className="w-56 rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5 font-mono text-sm"
            />
            <Botao variante="secundario" className="text-xs" carregando={salvandoCnpj} disabled={!cnpjDigitosValidos} onClick={salvarCnpj}>
              Salvar CNPJ
            </Botao>
          </div>
        </label>
        <p id={`cnpj-novo-erro-${item.id}`} className="text-xs text-tinta-fraca" role={!cnpjDigitosValidos && !cnpjIncompleto && cnpjDigitando ? "alert" : undefined}>
          {erroSalvarCnpj
            ? <span className="text-[color:var(--vermelho)]">{erroSalvarCnpj}</span>
            : !cnpjIncompleto && cnpjDigitando && !cnpjDigitosValidos
              ? "CNPJ inválido — o dígito verificador não confere."
              : "Sem CNPJ, não é possível consultar dados públicos desta empresa."}
        </p>
      </div>
    );
  }

  return <BlocoEmpresaComCnpj item={item} cnpj={cnpjSalvo} jornadaId={jornadaId} />;
}

function BlocoEmpresaComCnpj({ item, cnpj, jornadaId }: { item: PatrimonioItem; cnpj: string; jornadaId: string }) {
  const buscar = useCallback(() => buscarCnpjEmCache(cnpj), [cnpj]);
  const { dados, carregando, erro, recarregar, setDados } = useRecurso(buscar, [cnpj]);
  const [consultando, setConsultando] = useState(false);
  const [erroConsulta, setErroConsulta] = useState<string | null>(null);
  // O gráfico é um SVG próprio que nunca resolve cor por CSS (paleta.ts) —
  // precisa saber o tema ativo explicitamente, senão fica sempre claro dentro
  // de uma ficha em modo escuro.
  const { tema } = useTema();

  async function consultar(forcar: boolean) {
    setConsultando(true);
    setErroConsulta(null);
    try {
      const resultado = await consultarCnpjPublico(cnpj, jornadaId, forcar);
      setDados((anterior) => ({ ...resultado, validade_dias: resultado.validade_dias ?? anterior?.validade_dias }));
    } catch (e) {
      setErroConsulta(e instanceof ErroCnpjApi ? e.message : "Não foi possível consultar agora. Tente de novo em instantes.");
    } finally {
      setConsultando(false);
    }
  }

  const cnpjFormatado = `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12, 14)}`;

  if (erro) {
    return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo={`Não foi possível verificar o cadastro de ${cnpjFormatado}`} />;
  }
  if (carregando) {
    return <EstadoCarregando rotulo={`Verificando cadastro de ${cnpjFormatado}…`} />;
  }

  const consulta: RespostaCnpj["consulta"] | null = dados?.consulta ?? null;
  const temDadoBom = !!consulta?.razao_social;

  // Última tentativa foi de ATUALIZAR e falhou, mas já havia dado bom antes
  // (§4.4.3: falha nunca vira dado — mostra o antigo, com a data, e avisa).
  const atualizacaoFalhouAgora = dados?.atualizacao_falhou === true;
  const atualizacaoFalhouNoCache =
    temDadoBom && !!consulta?.falha_em && (!consulta?.consultado_em || new Date(consulta.falha_em) > new Date(consulta.consultado_em));

  return (
    <div className="flex flex-col gap-3 rounded-sm border border-linha bg-papel-fundo p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-tinta">{consulta?.razao_social || item.descricao || "Empresa"}</p>
          <p className="font-mono text-xs text-tinta-fraca">{cnpjFormatado}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Botao variante="secundario" className="text-xs" carregando={consultando} onClick={() => consultar(false)}>
            {temDadoBom ? "Atualizar dados" : "Consultar dados públicos"}
          </Botao>
          {temDadoBom && (
            <Botao variante="fantasma" className="text-xs" carregando={consultando} onClick={() => consultar(true)}>
              Forçar nova consulta
            </Botao>
          )}
        </div>
      </div>

      {erroConsulta && (
        <p role="alert" className="text-sm text-[color:var(--vermelho)]">
          {erroConsulta}
        </p>
      )}

      {!consulta && !erroConsulta && (
        <p className="text-sm text-tinta-suave">Nunca consultado. Clique em &quot;Consultar dados públicos&quot; para trazer razão social, situação, sócios e capital direto da Receita Federal (BrasilAPI).</p>
      )}

      {consulta && !temDadoBom && (
        <p className="text-sm text-[color:var(--vermelho)]">
          Consulta indisponível{consulta.falha_em ? ` desde ${formatarData(consulta.falha_em)}` : ""}: {traduzirFalhaMotivo(consulta.falha_motivo)}. Nada foi encontrado para este CNPJ ainda — tente de novo.
        </p>
      )}

      {(atualizacaoFalhouAgora || atualizacaoFalhouNoCache) && temDadoBom && (
        <p role="status" className="rounded-sm border border-ambar-borda bg-ambar-fraco px-2.5 py-1.5 text-xs text-[color:var(--ambar)]">
          Não foi possível atualizar agora{dados?.falha_motivo || consulta?.falha_motivo ? `: ${traduzirFalhaMotivo(dados?.falha_motivo ?? consulta?.falha_motivo)}` : ""}. Mostrando o dado consultado em {formatarData(consulta?.consultado_em)}.
        </p>
      )}

      {temDadoBom && consulta && (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-tinta-fraca">Situação</dt>
              <dd>
                <Selo tom={tomSituacao(consulta.situacao)}>{consulta.situacao || SEM_DADO}</Selo>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-tinta-fraca">Capital social</dt>
              <dd className="font-mono">{formatarMoeda(consulta.capital_social)}</dd>
            </div>
            <div>
              <dt className="text-xs text-tinta-fraca">Abertura</dt>
              <dd>{formatarData(consulta.data_abertura)}</dd>
            </div>
            <div className="col-span-2 sm:col-span-3">
              <dt className="text-xs text-tinta-fraca">CNAE principal</dt>
              <dd>{consulta.cnae_principal ? `${consulta.cnae_principal} — ${consulta.cnae_descricao || SEM_DADO}` : SEM_DADO}</dd>
            </div>
            <div className="col-span-2 sm:col-span-3">
              <dt className="text-xs text-tinta-fraca">Município</dt>
              <dd>{consulta.municipio ? `${consulta.municipio}${consulta.uf ? `/${consulta.uf}` : ""}` : SEM_DADO}</dd>
            </div>
          </dl>
          <p className="text-xs text-tinta-fraca">Consultado em {formatarData(consulta.consultado_em)} · fonte: BrasilAPI</p>

          <QuadroSocietario
            razaoSocial={consulta.razao_social}
            cnpj={consulta.cnpj}
            situacao={consulta.situacao}
            capitalSocial={consulta.capital_social}
            consultadoEm={consulta.consultado_em}
            socios={socioParaQuadro(consulta)}
            tema={tema}
          />
        </>
      )}
    </div>
  );
}

export function PatrimonioAba({ jornadaId }: { jornadaId: string }) {
  const buscar = useCallback(() => listarPatrimonio(jornadaId), [jornadaId]);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, [jornadaId]);
  const itens = dados?.itens ?? [];
  const empresas = itens.filter((i) => i.tipo === "empresa");
  const [novo, setNovo] = useState<Omit<PatrimonioItem, "id"> | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [cnpjNovoDigitado, setCnpjNovoDigitado] = useState("");
  const [avisoCnpjNovo, setAvisoCnpjNovo] = useState<string | null>(null);

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar o patrimônio" />;
  if (carregando) return <EstadoCarregando rotulo="Carregando patrimônio…" />;

  async function salvarNovo() {
    if (!novo || !novo.descricao.trim()) return;
    setSalvando(true);
    setErroSalvar(null);
    setAvisoCnpjNovo(null);
    try {
      let detalhes = novo.detalhes;
      if (novo.tipo === "empresa" && cnpjNovoDigitado) {
        if (cnpjEhValido(cnpjNovoDigitado)) {
          detalhes = { ...detalhes, cnpj: normalizarCnpj(cnpjNovoDigitado) };
        } else {
          setAvisoCnpjNovo("CNPJ inválido não foi gravado (dígito verificador não confere) — adicione depois no bloco Empresas, abaixo.");
        }
      }
      await criarPatrimonio(jornadaId, { ...novo, detalhes });
      setNovo(null);
      setCnpjNovoDigitado("");
      recarregar();
    } catch (e) {
      setErroSalvar(e instanceof ApiError ? e.message : "Não foi possível salvar o item.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(id: string) {
    try {
      await excluirPatrimonio(id);
      recarregar();
    } catch (e) {
      setErroSalvar(e instanceof ApiError ? e.message : "Não foi possível excluir o item.");
    }
  }

  function mudarDetalheEmpresa(campo: keyof DetalhesEmpresa, valor: string) {
    if (!novo) return;
    const numerico = campo === "objeto" || campo === "composicao_societaria";
    setNovo({
      ...novo,
      detalhes: { ...novo.detalhes, [campo]: numerico ? valor : valor === "" ? null : Number(valor) },
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-tinta-fraca">Composição patrimonial — valor histórico e de mercado, como no Relatório da Sessão de Viabilidade.</p>

      {itens.length === 0 && !novo && <EstadoVazio titulo="Nenhum item patrimonial registrado" descricao="Registre os bens levantados na Sessão de Viabilidade." />}

      {itens.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-linha-forte text-left text-tinta-suave">
                <th className="py-1.5 pr-3 font-medium">Tipo</th>
                <th className="py-1.5 pr-3 font-medium">Descrição</th>
                <th className="py-1.5 pr-3 font-medium">Valor histórico</th>
                <th className="py-1.5 pr-3 font-medium">Valor de mercado</th>
                <th className="py-1.5 font-medium sr-only">Ações</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((item) => {
                const subtitulo = subtituloItem(item);
                return (
                  <tr key={item.id} className="border-b border-linha align-top">
                    <td className="py-2 pr-3">{ROTULOS_TIPO[item.tipo]}</td>
                    <td className="py-2 pr-3">
                      <p>{item.descricao}</p>
                      {subtitulo && <p className="text-xs text-tinta-fraca">{subtitulo}</p>}
                    </td>
                    <td className="py-2 pr-3 font-mono">{formatarMoeda(item.valor_historico)}</td>
                    <td className="py-2 pr-3 font-mono">{formatarMoeda(item.valor_mercado)}</td>
                    <td className="py-2 text-right">
                      <button type="button" onClick={() => excluir(item.id)} className="nao-imprimir text-xs text-tinta-fraca hover:text-[color:var(--vermelho)]">
                        Excluir
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {novo ? (
        <div className="nao-imprimir flex flex-col gap-3 rounded-sm border border-linha bg-papel-fundo p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Tipo
              <select value={novo.tipo} onChange={(e) => { setNovo({ ...novo, tipo: e.target.value as PatrimonioItem["tipo"], detalhes: {} }); setCnpjNovoDigitado(""); setAvisoCnpjNovo(null); }} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5">
                {Object.entries(ROTULOS_TIPO).map(([v, r]) => (
                  <option key={v} value={v}>{r}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Descrição
              <input value={novo.descricao} onChange={(e) => setNovo({ ...novo, descricao: e.target.value })} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" placeholder={novo.tipo === "empresa" ? "Razão social" : novo.tipo === "investimento" ? "Ex.: poupança, VGBL, ações…" : undefined} />
            </label>
            {(novo.tipo === "imovel" || novo.tipo === "veiculo") && (
              <label className="flex flex-col gap-1 text-sm">
                Ano de aquisição
                <input type="number" value={novo.ano_aquisicao ?? ""} onChange={(e) => setNovo({ ...novo, ano_aquisicao: e.target.value === "" ? null : Number(e.target.value) })} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" />
              </label>
            )}
            <label className="flex flex-col gap-1 text-sm">
              Valor histórico
              <input type="number" value={novo.valor_historico ?? ""} onChange={(e) => setNovo({ ...novo, valor_historico: e.target.value === "" ? null : Number(e.target.value) })} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {novo.tipo === "investimento" || novo.tipo === "previdencia" ? "Valor atual" : "Valor de mercado"}
              <input type="number" value={novo.valor_mercado ?? ""} onChange={(e) => setNovo({ ...novo, valor_mercado: e.target.value === "" ? null : Number(e.target.value) })} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" />
            </label>
            {novo.tipo === "imovel" && (
              <>
                <label className="flex flex-col gap-1 text-sm">
                  Destinação (moradia, aluguel, vazio…)
                  <input value={novo.destinacao ?? ""} onChange={(e) => setNovo({ ...novo, destinacao: e.target.value || null })} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Valor de locação mensal
                  <input type="number" value={novo.valor_locacao_mensal ?? ""} onChange={(e) => setNovo({ ...novo, valor_locacao_mensal: e.target.value === "" ? null : Number(e.target.value) })} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" />
                </label>
              </>
            )}
          </div>

          {novo.tipo === "empresa" && (
            <fieldset className="flex flex-col gap-3 border-t border-linha pt-3">
              <legend className="text-xs font-medium uppercase tracking-wide text-tinta-fraca">Dados da empresa</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm sm:col-span-2" htmlFor="cnpj-novo-item">
                  CNPJ
                  <input
                    id="cnpj-novo-item"
                    value={cnpjNovoDigitado}
                    onChange={(e) => { setCnpjNovoDigitado(mascararCnpjEntrada(e.target.value)); setAvisoCnpjNovo(null); }}
                    inputMode="numeric"
                    placeholder="00.000.000/0000-00"
                    aria-describedby="cnpj-novo-item-ajuda"
                    className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5 font-mono"
                  />
                </label>
                <p id="cnpj-novo-item-ajuda" className="text-xs text-tinta-fraca sm:col-span-2">
                  {cnpjNovoDigitado && !cnpjEhValido(cnpjNovoDigitado) && cnpjNovoDigitado.replace(/\D/g, "").length === 14
                    ? "CNPJ inválido — o dígito verificador não confere."
                    : "Opcional. Com o CNPJ salvo, a Ficha 360 traz razão social, situação, capital e sócios direto da Receita Federal."}
                </p>
                <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                  Objeto social
                  <input value={detalhesEmpresa(novo).objeto ?? ""} onChange={(e) => mudarDetalheEmpresa("objeto", e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" />
                </label>
                <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                  Composição societária
                  <input value={detalhesEmpresa(novo).composicao_societaria ?? ""} onChange={(e) => mudarDetalheEmpresa("composicao_societaria", e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" placeholder="Ex.: 50% pai, 25% cada filho" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Capital social
                  <input type="number" value={detalhesEmpresa(novo).capital_social ?? ""} onChange={(e) => mudarDetalheEmpresa("capital_social", e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Número de empregados
                  <input type="number" value={detalhesEmpresa(novo).numero_empregados ?? ""} onChange={(e) => mudarDetalheEmpresa("numero_empregados", e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Patrimônio líquido (PL)
                  <input type="number" value={detalhesEmpresa(novo).pl ?? ""} onChange={(e) => mudarDetalheEmpresa("pl", e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Faturamento
                  <input type="number" value={detalhesEmpresa(novo).faturamento ?? ""} onChange={(e) => mudarDetalheEmpresa("faturamento", e.target.value)} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5" />
                </label>
              </div>
            </fieldset>
          )}

          {avisoCnpjNovo && <p role="alert" className="text-xs text-[color:var(--ambar)]">{avisoCnpjNovo}</p>}
          {erroSalvar && <p className="text-xs text-[color:var(--vermelho)]">{erroSalvar}</p>}
          <div className="flex gap-2">
            <Botao variante="primario" carregando={salvando} onClick={salvarNovo} className="text-xs">Adicionar</Botao>
            <Botao variante="fantasma" className="text-xs" onClick={() => setNovo(null)}>Cancelar</Botao>
          </div>
        </div>
      ) : (
        <div className="nao-imprimir">
          <Botao variante="secundario" onClick={() => setNovo(itemVazio())}>+ Adicionar item patrimonial</Botao>
        </div>
      )}

      <section className="flex flex-col gap-3 border-t border-linha pt-4" aria-labelledby="empresas-titulo">
        <div>
          <h3 id="empresas-titulo" className="text-sm font-bold text-tinta">Empresas — dados públicos (CNPJ)</h3>
          <p className="text-xs text-tinta-fraca">Objeto, composição societária, capital e situação cadastral, direto da Receita Federal (BrasilAPI) — sempre sob clique, nunca consultado sozinho.</p>
        </div>
        {empresas.length === 0 ? (
          <EstadoVazio titulo="Nenhuma empresa registrada" descricao="Adicione um item do tipo Empresa acima para consultar dados públicos por CNPJ." />
        ) : (
          <div className="flex flex-col gap-3">
            {empresas.map((item) => (
              <BlocoEmpresa key={item.id} item={item} jornadaId={jornadaId} aoAtualizarItem={recarregar} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
