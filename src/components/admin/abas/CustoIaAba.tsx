"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useRecurso } from "@/hooks/useRecurso";
import { Cartao } from "@/components/ui/Cartao";
import { EsqueletoCartao } from "@/components/ui/Esqueleto";
import { EstadoErro } from "@/components/ui/Estado";
import { Kpi } from "@/components/ui/Kpi";
import { Selo, SeloStub } from "@/components/ui/Selo";
import { formatarDataHora, formatarMoeda } from "@/lib/formatar";
import { buscarCustoIa } from "../adminApi";
import { IntroAba, Tabela, Tbody, Td, Th, Thead, Tr } from "../comum";

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
    <div className="flex flex-col gap-6">
      <IntroAba>Quanto a IA custou, em dólar, por mês, por versão de prompt e por cliente. Só execução real conta; demonstração aparece separada.</IntroAba>

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
          <Tabela resumo="Custo de IA por mês e modo">
            <Thead>
              <tr>
                <Th>Mês</Th>
                <Th>Modo</Th>
                <Th>Execuções</Th>
                <Th>Custo</Th>
              </tr>
            </Thead>
            <Tbody>
              {por_mes.map((linha, i) => (
                <Tr key={`${linha.mes}-${linha.modo}-${i}`}>
                  <Td rotulo="Mês" className="font-medium">
                    {formatarMes(linha.mes)}
                  </Td>
                  <Td rotulo="Modo">
                    <SeloModo modo={linha.modo} />
                  </Td>
                  <Td rotulo="Execuções" className="tabular-nums">
                    {linha.execucoes}
                  </Td>
                  <Td rotulo="Custo" className="tabular-nums">
                    {formatarMoeda(linha.custo_usd_total)}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Tabela>
        </Cartao>
      )}

      {por_prompt.length > 0 && (
        <Cartao preenchimento="sem" rotulo="Por versão de prompt" titulo="Onde o dinheiro vai">
          <Tabela resumo="Custo de IA por versão de prompt">
            <Thead>
              <tr>
                <Th>Prompt</Th>
                <Th>Versão</Th>
                <Th>Modo</Th>
                <Th>Execuções</Th>
                <Th>Custo</Th>
              </tr>
            </Thead>
            <Tbody>
              {por_prompt.map((linha, i) => (
                <Tr key={`${linha.prompt_versao_id}-${linha.modo}-${i}`}>
                  <Td rotulo="Prompt" className="font-medium">
                    {linha.chave}
                  </Td>
                  <Td rotulo="Versão">
                    v{linha.versao} {linha.versao_ativa && <Selo tom="verde">ativa</Selo>}
                  </Td>
                  <Td rotulo="Modo">
                    <SeloModo modo={linha.modo} />
                  </Td>
                  <Td rotulo="Execuções" className="tabular-nums">
                    {linha.execucoes}
                  </Td>
                  <Td rotulo="Custo" className="tabular-nums">
                    {formatarMoeda(linha.custo_usd_total)}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Tabela>
        </Cartao>
      )}

      {por_jornada.length > 0 && (
        <Cartao preenchimento="sem" rotulo="Por cliente" titulo="Os 50 que mais custaram">
          <Tabela resumo="Custo de IA por jornada">
            <Thead>
              <tr>
                <Th>Cliente</Th>
                <Th>Modo</Th>
                <Th>Execuções</Th>
                <Th>Custo</Th>
                <Th>Última execução</Th>
              </tr>
            </Thead>
            <Tbody>
              {por_jornada.map((linha, i) => (
                <Tr key={`${linha.jornada_id}-${linha.modo}-${i}`}>
                  <Td rotulo="Cliente">
                    <Link href={`/jornadas/${linha.jornada_id}`} className="inline-flex min-h-11 items-center font-medium text-[color:var(--latao)] underline-offset-2 hover:underline">
                      abrir a Ficha
                    </Link>
                  </Td>
                  <Td rotulo="Modo">
                    <SeloModo modo={linha.modo} />
                  </Td>
                  <Td rotulo="Execuções" className="tabular-nums">
                    {linha.execucoes}
                  </Td>
                  <Td rotulo="Custo" className="tabular-nums">
                    {formatarMoeda(linha.custo_usd_total)}
                  </Td>
                  <Td rotulo="Última">{formatarDataHora(linha.ultima_execucao_em)}</Td>
                </Tr>
              ))}
            </Tbody>
          </Tabela>
        </Cartao>
      )}
    </div>
  );
}
