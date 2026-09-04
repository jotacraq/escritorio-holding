/**
 * Rótulos em português para enums do Agente do Croqui que não vêm
 * pré-traduzidos do servidor (`CRITERIOS_ARQUITETURA`,
 * `src/server/ia/schema-croqui-analise.ts`, valor puro reaproveitado — texto
 * fica só aqui, perto de quem exibe).
 */
export const ROTULO_CRITERIO_ARQUITETURA: Record<string, string> = {
  quantidade_de_nucleos_familiares: "Quantidade de núcleos familiares",
  empresa_operacional_relevante: "Empresa operacional relevante",
  imoveis_de_renda: "Imóveis de renda",
  patrimonio_pessoal_relevante: "Patrimônio pessoal relevante",
  concentracao_em_empresa: "Concentração em uma empresa",
  niveis_diferentes_de_participacao_dos_herdeiros: "Níveis diferentes de participação dos herdeiros",
  fundador_deseja_permanecer_no_controle: "Fundador deseja permanecer no controle",
  necessidade_de_separar_patrimonio_gestao_e_destino: "Necessidade de separar patrimônio, gestão e destino",
  beneficio_justifica_a_complexidade: "O benefício justifica a complexidade",
};

export function rotularCriterio(criterio: string): string {
  return ROTULO_CRITERIO_ARQUITETURA[criterio] ?? criterio;
}

const ROTULO_RECOMENDACAO_ARQUITETURA: Record<string, string> = {
  "1_celula": "1 célula",
  "2_celulas": "2 células",
  "3_celulas": "3 células",
  ponto_a_validar: "Ponto a validar",
};

export function rotularRecomendacaoArquitetura(valor: string): string {
  return ROTULO_RECOMENDACAO_ARQUITETURA[valor] ?? valor;
}

const ROTULO_ORIGEM_SLIDE: Record<string, string> = {
  metodo: "Mensagem-padrão do método",
  ia: "Proposta da IA",
  humano: "Escrito pela advogada",
};

export function rotularOrigemSlide(origem: string | undefined): string {
  if (!origem) return ROTULO_ORIGEM_SLIDE.metodo;
  return ROTULO_ORIGEM_SLIDE[origem] ?? origem;
}
