import { z } from "zod";
import type { DadosBrasilApi, ResultadoConsultaBrasilApi, SocioCnpj } from "@/types/cnpj";
import { normalizarCnpj } from "./normalizar";

/**
 * Cliente da BrasilAPI — https://brasilapi.com.br/api/cnpj/v1/{cnpj}. Sem
 * chave, sem autenticação. Mesmo padrão de `src/server/ia/provedor/openrouter.ts`
 * (fetch cru, sem SDK, timeout explícito via `AbortSignal.timeout()`, sem
 * retry automático — se falhar, falhou; quem decide tentar de novo é o
 * humano clicando "atualizar", nunca o servidor sozinho).
 *
 * Verificado ao vivo em 04/09/2026 contra CNPJ real (Petrobras,
 * 33.000.167/0001-01) — ver docs/ARQUITETURA-FASE-3.md §4.2.
 *
 * ESTE É O ÚNICO ARQUIVO DO SISTEMA AUTORIZADO A FALAR COM A BRASILAPI. Não
 * generalize para "cliente de busca de dado público" — isto é especificamente
 * o dossiê de CNPJ (docs/ARQUITETURA-FASE-3.md §4, regra "único lugar
 * autorizado a falar com um terceiro por HTTP").
 */

const ENDPOINT_BASE = "https://brasilapi.com.br/api/cnpj/v1";

/** Teto de espera. Curto de propósito: a tela nunca deve travar esperando um
 * terceiro sem SLA (docs/ARQUITETURA-FASE-3.md §4.2). Sem retry. */
const TIMEOUT_MS = 10_000;

/**
 * Schema DELIBERADAMENTE frouxo: a BrasilAPI não tem contrato versionado, e
 * campos ausentes/`null` são o caso comum (nem toda empresa tem CNAE
 * secundário, nem toda situação cadastral tem `data_situacao_especial`
 * preenchida). `z.object` sem `.strict()` ignora campos desconhecidos — se a
 * BrasilAPI adicionar um campo novo amanhã, isto não quebra. O que valida de
 * verdade é o TIPO de cada campo que a gente efetivamente usa: se um campo
 * usado virar tipo diferente do esperado, cai em "resposta inesperada"
 * (502) — nunca em dado fabricado.
 */
const SocioBrasilApiSchema = z.object({
  nome_socio: z.string().trim().min(1),
  qualificacao_socio: z.string().nullish(),
  data_entrada_sociedade: z.string().nullish(),
  faixa_etaria: z.string().nullish(),
});

const RespostaBrasilApiSchema = z.object({
  cnpj: z.string(),
  razao_social: z.string().nullish(),
  nome_fantasia: z.string().nullish(),
  descricao_situacao_cadastral: z.string().nullish(),
  data_situacao_cadastral: z.string().nullish(),
  capital_social: z.number().nullish(),
  cnae_fiscal: z.union([z.string(), z.number()]).nullish(),
  cnae_fiscal_descricao: z.string().nullish(),
  data_inicio_atividade: z.string().nullish(),
  municipio: z.string().nullish(),
  uf: z.string().nullish(),
  qsa: z.array(SocioBrasilApiSchema).nullish(),
});

/**
 * Consulta um CNPJ já normalizado (14 dígitos) na BrasilAPI.
 *
 * PRÉ-CONDIÇÃO DE SEGURANÇA: `cnpjNormalizado` PRECISA ter passado por
 * `normalizarCnpj()` antes de chegar aqui. Esta função valida de novo (defesa
 * em profundidade — nunca confia que quem chamou fez o dever de casa), e
 * lança se não for exatamente 14 dígitos. Isto é o que impede SSRF: não há
 * caminho de código entre "entrada do usuário" e "URL de saída" que não
 * passe pelo `^[0-9]{14}$`.
 */
export async function consultarBrasilApi(cnpjNormalizado: string): Promise<ResultadoConsultaBrasilApi> {
  // Repete a validação mesmo com o parâmetro já normalizado pelo chamador:
  // este `throw` síncrono (fora do try/catch de rede) garante que um bug de
  // outro lugar do código nunca chega a montar a URL com algo não confiável.
  const cnpj = normalizarCnpj(cnpjNormalizado);
  const url = `${ENDPOINT_BASE}/${encodeURIComponent(cnpj)}`;

  const iniciadoEm = Date.now();
  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: "GET",
      // Verificado ao vivo em 04/09/2026: a BrasilAPI (atrás de Cloudflare)
      // devolve 403 para requisições sem `User-Agent` — o `fetch`/undici do
      // Node não manda um por padrão. Sem este header, TODA consulta desta
      // feature falharia em produção, sempre, silenciosamente rotulada como
      // "indisponível" quando na verdade é bloqueio de bot, não instabilidade
      // real da fonte.
      headers: { Accept: "application/json", "User-Agent": "sic-hf/1.0 (+consulta-cnpj-publica)" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (erroRede: unknown) {
    const nome = erroRede instanceof Error ? erroRede.name : "";
    if (nome === "TimeoutError" || nome === "AbortError") {
      return {
        sucesso: false,
        motivo: `timeout: sem resposta da BrasilAPI em ${TIMEOUT_MS / 1000}s`,
        statusHttp: 503,
      };
    }
    const decorrido = Math.round((Date.now() - iniciadoEm) / 1000);
    return {
      sucesso: false,
      motivo: `erro_rede: falha ao contatar BrasilAPI após ${decorrido}s (${nome || "desconhecido"})`,
      statusHttp: 503,
    };
  }

  if (resposta.status === 404) {
    return { sucesso: false, motivo: "cnpj_nao_encontrado: CNPJ não consta na Receita Federal", statusHttp: 404 };
  }

  if (!resposta.ok) {
    return {
      sucesso: false,
      motivo: `brasilapi_${resposta.status}: BrasilAPI respondeu com erro`,
      statusHttp: 503,
    };
  }

  const corpoBruto = await resposta.json().catch(() => null);
  if (corpoBruto === null || typeof corpoBruto !== "object") {
    return { sucesso: false, motivo: "resposta_nao_json: corpo vazio ou não-JSON", statusHttp: 502 };
  }

  const validado = RespostaBrasilApiSchema.safeParse(corpoBruto);
  if (!validado.success) {
    return {
      sucesso: false,
      motivo: `formato_inesperado: ${validado.error.issues.map((i) => i.path.join(".")).join(", ")}`,
      statusHttp: 502,
    };
  }

  const d = validado.data;
  const qsa: SocioCnpj[] = (d.qsa ?? []).map((s) => ({
    nome_socio: s.nome_socio,
    qualificacao_socio: s.qualificacao_socio ?? null,
    data_entrada_sociedade: s.data_entrada_sociedade ?? null,
    faixa_etaria: s.faixa_etaria ?? null,
  }));

  const dados: DadosBrasilApi = {
    razao_social: d.razao_social ?? null,
    nome_fantasia: d.nome_fantasia ?? null,
    situacao: d.descricao_situacao_cadastral ?? null,
    data_situacao: normalizarData(d.data_situacao_cadastral),
    capital_social: d.capital_social ?? null,
    cnae_principal: d.cnae_fiscal != null ? String(d.cnae_fiscal) : null,
    cnae_descricao: d.cnae_fiscal_descricao ?? null,
    data_abertura: normalizarData(d.data_inicio_atividade),
    municipio: d.municipio ?? null,
    uf: d.uf ?? null,
    qsa,
    bruto: corpoBruto as Record<string, unknown>,
  };

  return { sucesso: true, dados };
}

/**
 * A BrasilAPI devolve datas como `"YYYY-MM-DD"` (quando presentes). Uma
 * coluna `date` do Postgres rejeita `""`/lixo — normaliza para `null` em vez
 * de deixar o INSERT falhar com erro genérico de tipo.
 */
function normalizarData(valor: string | null | undefined): string | null {
  if (!valor) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : null;
}
