import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConsultaCnpj, DadosBrasilApi } from "@/types/cnpj";
import { registrarErro } from "@/server/erros";
import { consultarBrasilApi } from "./brasilapi";
import { CHAVE_VALIDADE_DIAS, lerConfiguracaoInt, VALIDADE_DIAS_PADRAO } from "./config";

/**
 * Orquestração da consulta de CNPJ: decide cache × chamada real, grava
 * sucesso/falha, e registra o evento auditável na timeline. A rota
 * (`src/app/api/cnpj/[...cnpj]/route.ts`) só traduz o resultado em HTTP —
 * toda a regra de negócio mora aqui (mesmo padrão de `src/server/agenda/**`).
 *
 * Regras que este módulo aplica, todas de docs/ARQUITETURA-FASE-3.md §4:
 *   - Frescor: só chama a BrasilAPI se não houver dado bom dentro de
 *     `configuracoes['cnpj.validade_dias']`, ou se `forcar=true`.
 *   - Falha nunca vira dado: uma tentativa que falha grava SÓ
 *     `falha_em`/`falha_motivo` — nunca sobrescreve `razao_social`/`qsa`/etc.
 *     Se nunca houve sucesso, esses campos continuam `null` (não é "empresa
 *     sem sócios", é "nunca consultamos com sucesso").
 *   - Evento na timeline em toda tentativa real contra a BrasilAPI (sucesso
 *     ou falha) — nunca numa resposta servida do cache.
 */

export type ResultadoConsulta =
  | { tipo: "cache"; consulta: ConsultaCnpj }
  | { tipo: "sucesso"; consulta: ConsultaCnpj }
  | { tipo: "falha"; statusHttp: 404 | 502 | 503; motivo: string; consultaAnterior: ConsultaCnpj | null };

const LIMITE_MOTIVO_CHARS = 500;

/** `GET /api/cnpj/[cnpj]` — leitura pura do cache, nunca chama a BrasilAPI. */
export async function buscarConsultaCache(
  supabase: SupabaseClient,
  cnpj: string,
): Promise<ConsultaCnpj | null> {
  const { data, error } = await supabase
    .from("consultas_cnpj")
    .select("*")
    .eq("cnpj", cnpj)
    .maybeSingle();

  if (error) throw error;
  return (data as ConsultaCnpj | null) ?? null;
}

function estaFresco(consulta: ConsultaCnpj | null, validadeDias: number): boolean {
  if (!consulta || !consulta.consultado_em || !consulta.razao_social) return false;
  const limiteMs = validadeDias * 24 * 60 * 60 * 1000;
  return Date.now() - new Date(consulta.consultado_em).getTime() < limiteMs;
}

/**
 * `POST /api/cnpj/[cnpj]` — o único caminho de código que chama a BrasilAPI.
 * `cnpj` já normalizado (`^[0-9]{14}$}`) pelo chamador. `jornadaId` já
 * confirmado existente pelo chamador (evita FK violation ao registrar o
 * evento de timeline).
 */
export async function consultarCnpj(params: {
  supabase: SupabaseClient;
  cnpj: string;
  jornadaId: string;
  usuarioId: string;
  forcar: boolean;
}): Promise<ResultadoConsulta> {
  const { supabase, cnpj, jornadaId, usuarioId, forcar } = params;

  const cacheAtual = await buscarConsultaCache(supabase, cnpj);
  const validadeDias = await lerConfiguracaoInt(supabase, CHAVE_VALIDADE_DIAS, VALIDADE_DIAS_PADRAO);

  if (!forcar && estaFresco(cacheAtual, validadeDias)) {
    return { tipo: "cache", consulta: cacheAtual as ConsultaCnpj };
  }

  const resultadoApi = await consultarBrasilApi(cnpj);

  if (!resultadoApi.sucesso) {
    const motivo = resultadoApi.motivo.slice(0, LIMITE_MOTIVO_CHARS);
    await gravarFalha(supabase, cnpj, motivo);
    await registrarEventoTimelineSemLancar(supabase, jornadaId, {
      titulo: `Falha ao consultar CNPJ ${formatarExibicao(cnpj)}`,
      descricao: motivo,
      dados: { cnpj, sucesso: false },
    });
    return { tipo: "falha", statusHttp: resultadoApi.statusHttp, motivo, consultaAnterior: cacheAtual };
  }

  const consulta = await gravarSucesso(supabase, cnpj, resultadoApi.dados, usuarioId);
  await registrarEventoTimelineSemLancar(supabase, jornadaId, {
    titulo: `Consulta de CNPJ: ${consulta.razao_social ?? formatarExibicao(cnpj)}`,
    descricao: null,
    dados: { cnpj, sucesso: true, razao_social: consulta.razao_social, situacao: consulta.situacao },
  });

  return { tipo: "sucesso", consulta };
}

async function gravarSucesso(
  supabase: SupabaseClient,
  cnpj: string,
  dados: DadosBrasilApi,
  usuarioId: string,
): Promise<ConsultaCnpj> {
  const { data, error } = await supabase
    .from("consultas_cnpj")
    .upsert(
      {
        cnpj,
        razao_social: dados.razao_social,
        nome_fantasia: dados.nome_fantasia,
        situacao: dados.situacao,
        data_situacao: dados.data_situacao,
        capital_social: dados.capital_social,
        cnae_principal: dados.cnae_principal,
        cnae_descricao: dados.cnae_descricao,
        data_abertura: dados.data_abertura,
        municipio: dados.municipio,
        uf: dados.uf,
        qsa: dados.qsa,
        bruto: dados.bruto,
        fonte: "brasilapi",
        consultado_em: new Date().toISOString(),
        consultado_por: usuarioId,
        falha_em: null,
        falha_motivo: null,
      },
      { onConflict: "cnpj" },
    )
    .select("*")
    .single();

  if (error) throw error;
  return data as ConsultaCnpj;
}

/**
 * Grava SÓ o carimbo de falha (`falha_em`/`falha_motivo`). Colunas de dado
 * não entram no payload de propósito: o upsert do PostgREST (merge-duplicates)
 * só toca as colunas listadas — se já existia `razao_social`/`qsa` de uma
 * consulta boa anterior, eles permanecem intactos. Se a linha ainda não
 * existia, nasce só com o carimbo de falha (defaults de banco cobrem o resto:
 * `bruto='{}'`, `qsa='[]'`) — nunca dado fabricado.
 */
async function gravarFalha(supabase: SupabaseClient, cnpj: string, motivo: string): Promise<void> {
  const { error } = await supabase
    .from("consultas_cnpj")
    .upsert({ cnpj, falha_em: new Date().toISOString(), falha_motivo: motivo }, { onConflict: "cnpj" });

  if (error) throw error;
}

/**
 * O evento de timeline é auditoria, não a operação principal: se ele falhar
 * (ex.: `jornadaId` some por corrida com um DELETE, o que este projeto não
 * pratica, mas a FK poderia recusar por outro motivo), a consulta de CNPJ
 * já aconteceu e já foi persistida — não vale a pena derrubar a resposta ao
 * usuário por causa disso. O erro é registrado, nunca engolido em silêncio
 * (`registrarErro`, mesmo padrão do resto do projeto).
 */
async function registrarEventoTimelineSemLancar(
  supabase: SupabaseClient,
  jornadaId: string,
  evento: { titulo: string; descricao: string | null; dados: Record<string, unknown> },
): Promise<void> {
  const { error } = await supabase.rpc("registrar_evento_consulta_cnpj", {
    p_jornada_id: jornadaId,
    p_titulo: evento.titulo,
    p_descricao: evento.descricao,
    p_dados: evento.dados,
  });

  if (error) {
    registrarErro("server/cnpj/consultar.registrarEventoTimelineSemLancar", error, { jornada_id: jornadaId });
  }
}

function formatarExibicao(cnpj: string): string {
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12, 14)}`;
}
