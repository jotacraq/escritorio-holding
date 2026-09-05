import type { ConteudoMaterial, CriterioEscolhaModelo, MotivoModelo, OrigemDadoMaterial } from "@/types/material";

/**
 * Escolha do modelo-base do material — FUNÇÃO PURA, zero IA (ARQUITETURA-FASE-4.md
 * §3.4). Substitui o regex hardcoded `PALAVRAS_POR_CHAVE` de `ia/material.ts`:
 * as palavras-chave agora são dado (`materiais_modelos.dores/arquetipos`,
 * 0055), editáveis em Admin → Modelos de material.
 *
 * É roteamento — "qual artigo já escrito é o mais próximo do tema" —, nunca
 * análise. O `motivo_modelo` devolvido é para a tela dizer "casou em: dor
 * principal", não para apresentar como conclusão sobre o cliente.
 *
 * Pontuação por modelo (§3.4):
 *   3 × (alguma `dores` aparece na dor principal)
 *   2 × (algum `arquetipos` bate com o arquétipo do briefing)
 *   1 × (alguma `dores` aparece na preocupação predominante OU nos riscos)
 * Empate → menor `prioridade`, depois `chave` (determinístico).
 * Nenhuma pontuação → 'padrao'.
 */

export interface SinaisEscolhaModelo {
  /** Cascata ligação → formulário p16 → relatório (C11). */
  dorPrincipal: string | null;
  /** `briefings.conteudo.arquetipo_patrimonial.escolhido` (v2) — se houver briefing atual. */
  arquetipo: string | null;
  /** `relatorios_sessao.preocupacao_predominante`. */
  preocupacaoPredominante: string | null;
  /** `croqui_analises.conteudo.riscos[].texto` da análise atual, se houver. */
  riscos: string[];
}

export interface ModeloMaterialCatalogo {
  id: string;
  chave: string;
  conteudo: ConteudoMaterial;
  dores: string[];
  arquetipos: string[];
  prioridade: number;
  origem_dado: OrigemDadoMaterial;
}

export interface EscolhaModelo {
  modelo: ModeloMaterialCatalogo;
  motivo_modelo: MotivoModelo;
}

export const CHAVE_MODELO_PADRAO = "padrao";

const PESO: Record<CriterioEscolhaModelo, number> = {
  dor_principal: 3,
  arquetipo: 2,
  preocupacao: 1,
  riscos: 1,
};

/** Minúsculas, sem acento, sem espaço duplicado — tanto no texto quanto na palavra-chave. */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function algumaPalavraCasa(palavras: string[], texto: string | null | undefined): boolean {
  if (!texto) return false;
  const alvo = normalizarTexto(texto);
  if (alvo.length === 0) return false;
  return palavras.some((palavra) => {
    const chave = normalizarTexto(palavra);
    return chave.length > 0 && alvo.includes(chave);
  });
}

function pontuar(modelo: ModeloMaterialCatalogo, sinais: SinaisEscolhaModelo) {
  const casouEm: CriterioEscolhaModelo[] = [];

  if (algumaPalavraCasa(modelo.dores, sinais.dorPrincipal)) casouEm.push("dor_principal");
  if (sinais.arquetipo && modelo.arquetipos.length > 0) {
    const arquetipo = normalizarTexto(sinais.arquetipo);
    if (modelo.arquetipos.some((a) => normalizarTexto(a) === arquetipo)) casouEm.push("arquetipo");
  }
  if (algumaPalavraCasa(modelo.dores, sinais.preocupacaoPredominante)) casouEm.push("preocupacao");
  if (sinais.riscos.some((risco) => algumaPalavraCasa(modelo.dores, risco))) casouEm.push("riscos");

  const pontos = casouEm.reduce((soma, criterio) => soma + PESO[criterio], 0);
  return { chave: modelo.chave, pontos, casou_em: casouEm };
}

export function escolherModeloMaterial(sinais: SinaisEscolhaModelo, modelos: ModeloMaterialCatalogo[]): EscolhaModelo {
  const padrao = modelos.find((m) => m.chave === CHAVE_MODELO_PADRAO);
  if (!padrao) {
    // Só acontece se o seed de 0031 tiver sido apagado — infraestrutura, não negócio.
    throw new Error("modelo_padrao_de_material_nao_encontrado: seed ausente (0031)");
  }

  const candidatos = modelos
    .filter((m) => m.chave !== CHAVE_MODELO_PADRAO)
    .map((m) => ({ modelo: m, ...pontuar(m, sinais) }))
    .sort((a, b) => b.pontos - a.pontos || a.modelo.prioridade - b.modelo.prioridade || a.chave.localeCompare(b.chave));

  const vencedor = candidatos.find((c) => c.pontos > 0);
  const listaCandidatos = candidatos.map(({ chave, pontos, casou_em }) => ({ chave, pontos, casou_em }));

  if (!vencedor) {
    return {
      modelo: padrao,
      motivo_modelo: { chave: CHAVE_MODELO_PADRAO, pontos: 0, casou_em: [], candidatos: listaCandidatos },
    };
  }

  return {
    modelo: vencedor.modelo,
    motivo_modelo: {
      chave: vencedor.chave,
      pontos: vencedor.pontos,
      casou_em: vencedor.casou_em,
      candidatos: listaCandidatos,
    },
  };
}

/*
 * Testes de mesa (rodar mentalmente; a bancada real é `scripts/gerar-pdf-exemplo.ts`):
 *
 *  modelos = [padrao, inventario{dores:[inventário,herdeiro], prio 10}, itcmd{dores:[itcmd,imposto], prio 20}]
 *
 *  1) dorPrincipal "tenho medo do inventário" → inventario (3, casou_em: [dor_principal])
 *  2) dorPrincipal null, preocupacao "imposto alto" → itcmd (1, [preocupacao])
 *  3) dorPrincipal "inventário", riscos ["imposto"] → inventario 3 vs itcmd 1 → inventario
 *  4) dorPrincipal "herdeiro e imposto" → inventario 3, itcmd 3 → empate → prioridade 10 < 20 → inventario
 *  5) nada casa → padrao (0, [])
 *  6) "INVENTÁRIO" (caixa alta, acento) → normaliza → inventario
 */
