"use client";

import { useCallback } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { Cartao } from "@/components/ui/Cartao";
import { EsqueletoCartao } from "@/components/ui/Esqueleto";
import { EstadoErro } from "@/components/ui/Estado";
import { Kpi } from "@/components/ui/Kpi";
import { Selo, SeloStub } from "@/components/ui/Selo";
import { Tabela, type ColunaTabela } from "@/components/ui/Tabela";
import { formatarDataHora, formatarMoeda } from "@/lib/formatar";
import type { CustoIaMensal, CustoIaPorJornada, CustoIaPorPrompt } from "@/types/admin";
import { buscarCustoIa } from "../adminApi";
import { IntroAba } from "../comum";

const FORMATADOR_MES = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", month: "long", year: "numeric" });

function formatarMes(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return iso;
  const texto = FORMATADOR_MES.format(data);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function SeloModo({ modo }: { modo: "real" | "demonstracao" }) {
  return modo === "real" ? <Selo tom="latao">real</Selo> : <Selo tom="neutro">demonstração</Selo>;
}


/* As três tabelas de custo passaram a usar `ui/Tabela` (Fase 8 §C3 M2): uma
   descrição de colunas, duas formas. Antes eram `<table>` com `display:block`
   no celular e o rótulo da coluna vindo de `content: attr(data-rotulo)` — o
   par cabeçalho/valor se mantinha na mão em dois lugares, e a 360 px a grade
   rolava para o lado dentro do cartão. */
const COLUNAS_MES: readonly ColunaTabela<CustoIaMensal>[] = [
  { chave: "mes", cabecalho: "Mês", celula: (l) => formatarMes(l.mes) },
  { chave: "modo", cabecalho: "Modo", celula: (l) => <SeloModo modo={l.modo} /> },
  { chave: "execucoes", cabecalho: "Execuções", numerica: true, celula: (l) => l.execucoes },
  { chave: "custo", cabecalho: "Custo", numerica: true, celula: (l) => formatarMoeda(l.custo_usd_total) },
];

const COLUNAS_PROMPT: readonly ColunaTabela<CustoIaPorPrompt>[] = [
  { chave: "prompt", cabecalho: "Prompt", celula: (l) => l.chave },
  {
    chave: "versao",
    cabecalho: "Versão",
    celula: (l) => (
      <span className="inline-flex items-center gap-2">
        v{l.versao}
        {l.versao_ativa && <Selo tom="verde">ativa</Selo>}
      </span>
    ),
  },
  { chave: "modo", cabecalho: "Modo", celula: (l) => <SeloModo modo={l.modo} /> },
  { chave: "execucoes", cabecalho: "Execuções", numerica: true, celula: (l) => l.execucoes },
  { chave: "custo", cabecalho: "Custo", numerica: true, celula: (l) => formatarMoeda(l.custo_usd_total) },
];

const COLUNAS_JORNADA: readonly ColunaTabela<CustoIaPorJornada>[] = [
  /* O processo aparece pelo LINK, não pelo nome: a view de custo não traz o
     nome da pessoa, e inventar um rótulo aqui seria dado plausível na tela. */
  { chave: "processo", cabecalho: "Processo", celula: () => "Abrir a Ficha" },
  { chave: "modo", cabecalho: "Modo", celula: (l) => <SeloModo modo={l.modo} /> },
  { chave: "execucoes", cabecalho: "Execuções", numerica: true, celula: (l) => l.execucoes },
  { chave: "custo", cabecalho: "Custo", numerica: true, celula: (l) => formatarMoeda(l.custo_usd_total) },
  { chave: "ultima", cabecalho: "Última execução", celula: (l) => formatarDataHora(l.ultima_execucao_em) },
];

/**
 * Custo é informação de gestão — mesmo recorte de quem vê patrimônio
 * (admin + advogada). Execução de demonstração nunca soma no real.
 * Ligações por IA (`vw_custo_ligacoes_ia_mensal`, 0053) ainda não têm rota
 * — bloco rotulado, não número inventado.
 */
export function CustoIaAba() {
  const buscar = useCallback(() => buscarCustoIa(), []);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, []);

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar o custo de IA" />;
  if (carregando && !dados) return <EsqueletoCartao quantidade={2} rotulo="Carregando custo de IA…" />;
  if (!dados) return null;

  const { resumo, por_mes, por_prompt, por_jornada } = dados;
  const semExecucaoReal = resumo.execucoes_reais === 0;

  return (
    <div className="flex flex-col gap-bloco">
      <IntroAba>Valores em dólar. Só execução real conta; demonstração aparece separada.</IntroAba>

      <div className="grid gap-4 sm:grid-cols-2">
        <Kpi
          rotulo="Custo real acumulado"
          valor={semExecucaoReal ? null : formatarMoeda(resumo.custo_real_total_usd)}
          unidade="USD"
          motivoVazio="nenhuma execução real de IA registrada ainda"
          acao={!semExecucaoReal ? <span className="text-tinta-suave">{resumo.execucoes_reais} execução{resumo.execucoes_reais === 1 ? "" : "ões"}</span> : undefined}
        />
        <Kpi
          rotulo="Demonstração (não soma no real)"
          valor={resumo.execucoes_demonstracao === 0 ? null : formatarMoeda(resumo.custo_demonstracao_total_usd)}
          unidade="USD"
          motivoVazio="nenhuma execução de demonstração"
          acao={resumo.execucoes_demonstracao > 0 ? <span className="text-tinta-suave">{resumo.execucoes_demonstracao} execução{resumo.execucoes_demonstracao === 1 ? "" : "ões"}</span> : undefined}
        />
      </div>

      <Cartao rotulo="Ligações por IA" titulo="Custo das ligações" descricao="Minutos de voz cobrados pelo provedor (Vapi), por mês.">
        <SeloStub texto="Ainda não disponível: a view vw_custo_ligacoes_ia_mensal (migration 0053) existe no desenho, mas não há rota de leitura nem a migration está aplicada. Quando houver, este bloco mostra custo e minutos por mês." />
      </Cartao>

      {por_mes.length > 0 && (
        <Cartao preenchimento="sem" rotulo="Por mês" titulo="Custo mensal">
          <div className="px-cartao py-item">
            <Tabela legenda="Custo de IA por mês e modo" colunas={COLUNAS_MES} linhas={por_mes} chaveDaLinha={(l) => `${l.mes}-${l.modo}`} tituloDoCartao={(l) => formatarMes(l.mes)} />
          </div>
        </Cartao>
      )}

      {por_prompt.length > 0 && (
        <Cartao preenchimento="sem" rotulo="Por versão de prompt" titulo="Onde o dinheiro vai">
          <div className="px-cartao py-item">
            <Tabela
              legenda="Custo de IA por versão de prompt"
              colunas={COLUNAS_PROMPT}
              linhas={por_prompt}
              chaveDaLinha={(l) => `${l.prompt_versao_id}-${l.modo}`}
              tituloDoCartao={(l) => `${l.chave} · v${l.versao}`}
            />
          </div>
        </Cartao>
      )}

      {por_jornada.length > 0 && (
        <Cartao preenchimento="sem" rotulo="Por cliente" titulo="Os 50 que mais custaram">
          <div className="px-cartao py-item">
            <Tabela
              legenda="Custo de IA por processo"
              colunas={COLUNAS_JORNADA}
              linhas={por_jornada}
              chaveDaLinha={(l) => `${l.jornada_id}-${l.modo}`}
              hrefDaLinha={(l) => `/jornadas/${l.jornada_id}`}
            />
          </div>
        </Cartao>
      )}
    </div>
  );
}
