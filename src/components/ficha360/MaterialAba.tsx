"use client";

import { useCallback, useState } from "react";
import { aprovarMaterial, gerarMaterial, listarMateriais, ErroFicha360Api } from "@/components/ficha360/api";
import { buscarUrlPdfMaterial, regerarPdfMaterial } from "@/components/ficha360/api-material-pdf";
import type { BlocoMaterial, CriterioEscolhaModelo, FonteDorMaterial, MaterialGeradoResumo, ResultadoPdfMaterial } from "@/types/material";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { EsqueletoFicha } from "@/components/ui/Esqueleto";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { ConfirmarAcao } from "@/components/ui/ConfirmarAcao";
import { Progresso } from "@/components/ui/Progresso";
import { Selo, SeloDemonstracao, SeloIA, SeloStub, type TomSelo } from "@/components/ui/Selo";
import { formatarDataHora } from "@/lib/formatar";

const ROTULOS_FONTE: Record<FonteDorMaterial, string> = {
  ligacao: "Registro da ligação",
  formulario: "Formulário do cliente",
  relatorio: "Relatório da Sessão de Viabilidade",
  nenhuma: "Nenhuma — material padrão",
};

const ROTULO_CRITERIO: Record<CriterioEscolhaModelo, string> = {
  dor_principal: "dor principal",
  arquetipo: "arquétipo patrimonial",
  preocupacao: "preocupação predominante",
  riscos: "riscos da análise",
};

const ROTULO_MODELO: Record<string, string> = {
  padrao: "Padrão",
  empresa: "Empresa",
  inventario: "Inventário",
  conflito_familiar: "Conflito familiar",
  itcmd: "ITCMD",
  imoveis: "Imóveis",
  protecao_patrimonial: "Proteção patrimonial",
  doacao_em_vida: "Doação em vida",
};

function rotularModelo(chave: string | null): string {
  if (!chave) return "—";
  return ROTULO_MODELO[chave] ?? chave;
}

function BlocoConteudo({ bloco }: { bloco: BlocoMaterial }) {
  switch (bloco.tipo) {
    case "titulo":
      return <h3 className="text-subtitulo font-bold text-tinta">{bloco.texto}</h3>;
    case "paragrafo":
      return <p className="text-corpo leading-relaxed text-tinta">{bloco.texto}</p>;
    case "lista":
      return (
        <ul className="list-disc pl-5 text-corpo text-tinta">
          {bloco.itens.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    case "citacao":
      return <blockquote className="border-l-4 border-l-[color:var(--latao-cta)] bg-papel px-4 py-2.5 text-corpo italic text-tinta-suave">“{bloco.texto}”</blockquote>;
  }
}

type EstadoPdf = "gerado" | "falhou" | "sem_arquivo" | "rascunho" | "indisponivel";

/** Estado do PDF a partir das colunas 0055 — `undefined` nas colunas = migração não aplicada. */
function estadoPdf(material: MaterialGeradoResumo): EstadoPdf {
  if (!Object.prototype.hasOwnProperty.call(material, "pdf_gerado_em")) return "indisponivel";
  if (!material.aprovado_em) return "rascunho";
  if (material.pdf_gerado_em && material.pdf_caminho) return "gerado";
  if (material.pdf_erro) return "falhou";
  return "sem_arquivo";
}

const SELO_PDF: Record<EstadoPdf, { rotulo: string; tom: TomSelo }> = {
  gerado: { rotulo: "PDF pronto", tom: "verde" },
  falhou: { rotulo: "PDF falhou", tom: "vermelho" },
  sem_arquivo: { rotulo: "PDF ainda não gerado", tom: "ambar" },
  rascunho: { rotulo: "PDF só depois de aprovar", tom: "neutro" },
  indisponivel: { rotulo: "PDF indisponível neste ambiente", tom: "neutro" },
};

const ICONE_BAIXAR = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 14.5v1A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5v-1" />
  </svg>
);

/**
 * Material pós-sessão (Fase 4 §3): texto gerado pela IA (ou padrão, sem IA),
 * aprovado por humano e — só então — convertido em PDF no servidor, anexado
 * ao e-mail `pos_sessao` e baixável em `/p/m`. Rascunho nunca vira arquivo.
 */
export function MaterialAba({ jornadaId }: { jornadaId: string }) {
  const { notificar } = useToast();
  const buscar = useCallback(() => listarMateriais(jornadaId), [jornadaId]);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, [jornadaId]);
  const [gerando, setGerando] = useState(false);
  const [aprovando, setAprovando] = useState(false);
  const [confirmandoAprovacao, setConfirmandoAprovacao] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const [regerando, setRegerando] = useState(false);
  const [ultimoPdf, setUltimoPdf] = useState<ResultadoPdfMaterial | null>(null);

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar o material" />;
  if (carregando) return <EsqueletoFicha rotulo="Carregando material…" />;

  const atual = dados?.atual ?? null;
  const itens = dados?.itens ?? [];

  function avisarPdf(pdf: ResultadoPdfMaterial) {
    setUltimoPdf(pdf);
    if (pdf.estado === "gerado") {
      notificar({
        tom: pdf.fonte === "helvetica" ? "aviso" : "sucesso",
        titulo: "PDF gerado",
        descricao: pdf.fonte === "helvetica" ? "Saiu com a fonte reserva (Helvetica) — a Neuetra não carregou no servidor. O conteúdo está íntegro." : `${Math.round(pdf.pdf_bytes / 1024)} KB, pronto para anexar ao e-mail e baixar em /p/m.`,
      });
    } else if (pdf.estado === "falhou") {
      notificar({ tom: "erro", titulo: "O PDF falhou", descricao: `${pdf.erro} — a aprovação continua válida; use “Gerar PDF de novo”.` });
    } else {
      notificar({ tom: "aviso", titulo: "PDF não gerado neste ambiente", descricao: pdf.motivo, duracao: 10000 });
    }
  }

  async function gerar(forcar: boolean) {
    setGerando(true);
    try {
      const res = await gerarMaterial(jornadaId, forcar);
      notificar({
        tom: "sucesso",
        titulo: res.execucao_id ? "Material gerado" : "Material padrão gerado (sem IA)",
        descricao: `Modelo: ${rotularModelo(res.chave_modelo)}. Revise e aprove para liberar o envio.`,
      });
      recarregar();
    } catch (e) {
      const erroApi = e instanceof ErroFicha360Api ? e : null;
      notificar({
        tom: "erro",
        titulo: erroApi?.status === 503 ? "IA não configurada neste ambiente" : "Não foi possível gerar o material",
        descricao: erroApi?.status === 503 ? "Configure o provedor de IA em Administração." : erroApi?.message ?? "Confira a internet e tente de novo.",
      });
    } finally {
      setGerando(false);
    }
  }

  async function aprovar() {
    if (!atual) return;
    setAprovando(true);
    try {
      const res = await aprovarMaterial(jornadaId, atual.id);
      notificar({ tom: "sucesso", titulo: "Material aprovado", descricao: "O e-mail pós-sessão pode sair com o link e o PDF." });
      setConfirmandoAprovacao(false);
      if (res.pdf) avisarPdf(res.pdf);
      recarregar();
    } catch (e) {
      notificar({ tom: "erro", titulo: "Não foi possível aprovar o material", descricao: e instanceof ErroFicha360Api ? e.message : "Confira a internet e tente de novo." });
    } finally {
      setAprovando(false);
    }
  }

  async function baixar() {
    if (!atual) return;
    setBaixando(true);
    try {
      const { url } = await buscarUrlPdfMaterial(jornadaId, atual.id);
      window.open(url, "_blank", "noopener");
      notificar({ tom: "info", titulo: "PDF aberto em nova aba", descricao: "O endereço vale por 5 minutos." });
    } catch (e) {
      const erroApi = e instanceof ErroFicha360Api ? e : null;
      notificar({
        tom: "erro",
        titulo: erroApi?.codigo === "pdf_indisponivel" ? "Este material ainda não tem PDF" : erroApi?.status === 503 ? "Download indisponível agora" : "Não foi possível baixar o PDF",
        descricao: erroApi?.codigo === "pdf_indisponivel" ? "Use “Gerar PDF de novo”." : erroApi?.status === 503 ? "O servidor não está pronto para gerar o arquivo." : erroApi?.message ?? "Confira a internet e tente de novo.",
      });
    } finally {
      setBaixando(false);
    }
  }

  async function regerar() {
    if (!atual) return;
    setRegerando(true);
    try {
      const res = await regerarPdfMaterial(jornadaId, atual.id);
      avisarPdf(res.pdf);
      recarregar();
    } catch (e) {
      const erroApi = e instanceof ErroFicha360Api ? e : null;
      notificar({
        tom: "erro",
        titulo: erroApi?.codigo === "material_nao_aprovado" ? "Aprove antes de gerar o PDF" : erroApi?.status === 503 ? "PDF indisponível agora" : "Não foi possível gerar o PDF",
        descricao: erroApi?.codigo === "material_nao_aprovado" ? "Rascunho nunca vira arquivo." : erroApi?.message ?? "Confira a internet e tente de novo.",
      });
    } finally {
      setRegerando(false);
    }
  }

  const conteudo = atual && (
    <div className="flex flex-col gap-3">
      {atual.conteudo.blocos.map((bloco, i) => (
        <BlocoConteudo key={i} bloco={bloco} />
      ))}
    </div>
  );

  const pdf = atual ? estadoPdf(atual) : null;
  const motivo = atual?.motivo_modelo ?? null;

  return (
    <div className="flex flex-col gap-5">
      <Cartao
        rotulo="Depois da sessão"
        titulo="Material pós-sessão"
      >
        {!gerando && (
          <div className="nao-imprimir mb-4 flex flex-wrap gap-2">
            <Botao variante={atual ? "secundario" : "primario"} carregando={gerando} onClick={() => gerar(false)}>
              {atual ? "Gerar nova versão" : "Gerar material"}
            </Botao>
            {atual && (
              <Botao variante="fantasma" carregando={gerando} onClick={() => gerar(true)}>
                Forçar regeração
              </Botao>
            )}
          </div>
        )}
        {gerando ? (
          <Progresso rotulo="Gerando o material" etapas={[{ rotulo: "Lendo ligação, formulário e relatório" }, { rotulo: "Escolhendo o modelo pela dor" }, { rotulo: "Escrevendo o texto" }]} etapaAtual={1} tempoEsperado="costuma levar até 1 minuto" cronometro />
        ) : !atual ? (
          <EstadoVazio
            ilustracao="pasta"
            titulo="Nenhum material gerado para esta jornada"
            descricao="Gerar cruza ligação, formulário e relatório para achar a dor principal do cliente — sem fonte, sai rotulado como material padrão. Use o botão acima."
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {atual.origem_dado !== "exemplo" && <SeloIA />}
              <Selo tom="neutro">Versão {atual.versao}</Selo>
              <Selo tom={atual.aprovado_em ? "verde" : "azul"}>{atual.aprovado_em ? "Aprovado" : "Pendente de aprovação"}</Selo>
              <span className="text-xs text-tinta-suave">Fonte da dor: {ROTULOS_FONTE[atual.fonte_dor]}</span>
            </div>
            {atual.dor_principal && <p className="text-sm text-tinta-suave">Dor identificada: “{atual.dor_principal}”</p>}

            <p className="text-sm text-tinta">
              <span className="font-medium">Modelo escolhido:</span> {rotularModelo(atual.chave_modelo ?? motivo?.chave ?? null)}
              {motivo && motivo.casou_em.length > 0 ? (
                <span className="text-tinta-suave"> — casou em: {motivo.casou_em.map((c) => ROTULO_CRITERIO[c]).join(", ")} ({motivo.pontos} {motivo.pontos === 1 ? "ponto" : "pontos"})</span>
              ) : motivo ? (
                <span className="text-tinta-suave"> — nenhum modelo casou com a dor; usado o padrão.</span>
              ) : null}
            </p>
            {motivo && motivo.candidatos.length > 1 && (
              <details className="text-xs text-tinta-suave">
                <summary className="min-h-11 cursor-pointer py-2 font-medium text-tinta">Outros modelos pontuados</summary>
                <ul className="flex flex-col gap-0.5 pb-2">
                  {motivo.candidatos.map((c) => (
                    <li key={c.chave}>
                      {rotularModelo(c.chave)}: {c.pontos} {c.pontos === 1 ? "ponto" : "pontos"}
                      {c.casou_em.length > 0 ? ` (${c.casou_em.map((x) => ROTULO_CRITERIO[x]).join(", ")})` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {atual.origem_dado === "exemplo" ? <SeloDemonstracao>{conteudo}</SeloDemonstracao> : <div className="rounded-controle border border-linha bg-papel-elevado p-5">{conteudo}</div>}

            <div className="nao-imprimir flex flex-wrap items-center gap-3">
              {!atual.aprovado_em ? (
                <Botao variante="primario" carregando={aprovando} onClick={() => setConfirmandoAprovacao(true)}>
                  Aprovar material
                </Botao>
              ) : (
                <p className="text-xs text-tinta-suave">Aprovado em {formatarDataHora(atual.aprovado_em)}</p>
              )}
            </div>
          </div>
        )}
      </Cartao>

      {atual && pdf && (
        <Cartao rotulo="Entrega" titulo="PDF do material" descricao="Gerado no servidor na aprovação; vai anexado ao e-mail pós-sessão e fica para baixar em /p/m.">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Selo tom={SELO_PDF[pdf].tom}>{SELO_PDF[pdf].rotulo}</Selo>
              {pdf === "gerado" && atual.pdf_gerado_em && (
                <span className="text-xs text-tinta-suave">
                  gerado em {formatarDataHora(atual.pdf_gerado_em)}
                  {atual.pdf_bytes ? ` · ${Math.round(atual.pdf_bytes / 1024)} KB` : ""}
                </span>
              )}
            </div>

            {pdf === "indisponivel" && <SeloStub texto="PDF ainda não disponível — as colunas do PDF (migração 0055) não foram aplicadas neste ambiente." />}
            {pdf === "falhou" && (
              <p role="alert" className="text-sm text-[color:var(--vermelho)]">
                Aprovado; o PDF falhou: {atual.pdf_erro}. A aprovação não foi desfeita — gere o PDF de novo.
              </p>
            )}
            {pdf === "sem_arquivo" && <p className="text-sm text-tinta-suave">Material aprovado antes do PDF existir (ou o servidor estava sem a chave de serviço). Gere agora.</p>}
            {pdf === "rascunho" && <p className="text-sm text-tinta-suave">Rascunho nunca vira arquivo — aprove o material acima e o PDF é gerado na hora.</p>}
            {ultimoPdf?.estado === "gerado" && ultimoPdf.fonte === "helvetica" && (
              <p role="status" className="rounded-controle border border-ambar-borda bg-ambar-fraco px-3.5 py-2.5 text-sm text-[color:var(--ambar)]">
                Este PDF saiu com a fonte reserva (Helvetica): a Neuetra não carregou no servidor. O texto está íntegro; o erro já foi registrado para a equipe técnica.
              </p>
            )}

            {pdf !== "indisponivel" && pdf !== "rascunho" && (
              <div className="nao-imprimir flex flex-wrap gap-2">
                {pdf === "gerado" && (
                  <Botao variante="primario" icone={ICONE_BAIXAR} carregando={baixando} onClick={baixar}>
                    Baixar PDF
                  </Botao>
                )}
                <Botao variante={pdf === "gerado" ? "secundario" : "primario"} carregando={regerando} onClick={regerar}>
                  {pdf === "gerado" ? "Gerar PDF de novo" : "Gerar PDF"}
                </Botao>
              </div>
            )}
          </div>
        </Cartao>
      )}

      {itens.length > 1 && (
        <Cartao rotulo="Histórico" titulo="Versões" preenchimento="sem">
          <ul className="divide-y divide-linha">
            {itens.map((item) => (
              <li key={item.id} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm sm:px-6">
                <span className="font-medium text-tinta">v{item.versao}</span>
                <span className="text-tinta-suave">{rotularModelo(item.chave_modelo)}</span>
                <span className="text-tinta-suave">{ROTULOS_FONTE[item.fonte_dor]}</span>
                <span className="text-tinta-suave">{item.aprovado_em ? "aprovado" : "não aprovado"}</span>
                <span className="text-tinta-suave">{formatarDataHora(item.criado_em)}</span>
                {item.atual && <Selo tom="azul">atual</Selo>}
              </li>
            ))}
          </ul>
        </Cartao>
      )}

      <ConfirmarAcao
        aberto={confirmandoAprovacao}
        titulo="Aprovar este material?"
        efeito={`A versão ${atual?.versao ?? ""} passa a ser a que o cliente recebe: o e-mail pós-sessão é liberado com o link e o PDF anexado. Para mudar o texto depois, gere uma nova versão e aprove de novo.`}
        rotuloConfirmar="Aprovar material"
        confirmando={aprovando}
        aoConfirmar={aprovar}
        aoCancelar={() => setConfirmandoAprovacao(false)}
      />
    </div>
  );
}
