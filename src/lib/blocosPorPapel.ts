import type { PapelEquipe } from "@/types/banco";

/**
 * Matriz bloco × papel do Painel do Dia (Fase 5, §9.1).
 *
 * Mora em `src/lib/` — e não mais em `src/components/painel/` — porque a matriz
 * deixou de ser regra de render e virou regra de **autorização**: `GET /api/painel`
 * importa daqui para decidir o que sequer consulta (achado BAIXO do pentest da
 * Fase 5: a tela escondia o bloco, o JSON não). `src/components/painel/blocosPorPapel.ts`
 * continua existindo como re-export para o front não mudar import.
 *
 * `PapelEquipe` vem de `@/types/banco` (e não de `@/lib/api`) porque este módulo
 * agora é importado por route handler: nada aqui pode arrastar código de cliente.
 *
 * A regra do João: o Painel mostra **o que é ação de quem está olhando**. A
 * advogada não precisa saber que um cron não passou; quem resolve isso é o
 * admin. Bloco fora da lista do papel **não é renderizado** — some do DOM,
 * não fica escondido por CSS —, e o que ele buscaria não é buscado.
 *
 * Chaves de blocos que ainda não existem (croquis, documentos, execução,
 * parâmetros) já entram na matriz: a Onda 2 pluga o componente sem mexer
 * nesta regra. `blocoVisivel` devolve `false` para papel desconhecido — sem
 * papel carregado, o Painel não inventa permissão.
 *
 * A lista de chaves existe como VALOR (e o tipo é derivado dela) porque o
 * servidor precisa percorrê-la para validar `?blocos=` em `GET /api/painel`.
 * Uma união solta obrigaria a redigitar as dez chaves no route handler — e é
 * assim que as duas listas divergem.
 */
export const CHAVES_BLOCO_PAINEL = [
  "sessoes_hoje",
  "preparo",
  "croquis",
  "documentos",
  "execucao",
  "pagos_sem_contato",
  "travado",
  "numeros",
  "parametros_divergentes",
  "sistema",
] as const;

export type ChaveBlocoPainel = (typeof CHAVES_BLOCO_PAINEL)[number];

export function ehChaveBlocoPainel(valor: string): valor is ChaveBlocoPainel {
  return (CHAVES_BLOCO_PAINEL as readonly string[]).includes(valor);
}

/** Blocos que só falam de infraestrutura: envio automático, chave ausente, aviso de pagamento. */
export const BLOCOS_DE_SISTEMA: ReadonlySet<ChaveBlocoPainel> = new Set(["sistema", "parametros_divergentes"]);

export const BLOCOS_POR_PAPEL: Record<PapelEquipe, ChaveBlocoPainel[]> = {
  admin: [
    "sessoes_hoje",
    "preparo",
    "croquis",
    "documentos",
    "execucao",
    "pagos_sem_contato",
    "travado",
    "numeros",
    "parametros_divergentes",
    "sistema",
  ],
  advogada: ["sessoes_hoje", "preparo", "croquis", "documentos", "execucao", "numeros"],
  relacionamento: ["sessoes_hoje", "preparo", "documentos", "pagos_sem_contato", "travado"],
  assistente: ["sessoes_hoje", "preparo", "documentos", "execucao", "pagos_sem_contato"],
};

export function blocosDoPapel(papel: PapelEquipe | null | undefined): ChaveBlocoPainel[] {
  if (!papel) return [];
  return BLOCOS_POR_PAPEL[papel] ?? [];
}

export function blocoVisivel(papel: PapelEquipe | null | undefined, bloco: ChaveBlocoPainel): boolean {
  return blocosDoPapel(papel).includes(bloco);
}

// ---------------------------------------------------------------------------
// Pendências: o que é ação de gente × o que é conserto de sistema
// ---------------------------------------------------------------------------

/**
 * Tipos de `vw_pendencias_sistema` que **uma pessoa** resolve na tela dela
 * (colar o link da sala, ligar à mão, aprovar material). Todo o resto é
 * conserto de infraestrutura e só o admin vê — inclusive na Comunicação.
 *
 * Divergência registrada em relação à letra do §9.1 ("`PendenciasSistema`
 * vira só-admin"): esconder o bloco inteiro tiraria de a advogada a única
 * pista de que a sessão de amanhã está sem sala. O que a lei de texto proíbe
 * é **aviso de sistema** — então o filtro é por tipo, não pelo bloco.
 */
export const PENDENCIAS_DE_PESSOA: ReadonlySet<string> = new Set([
  "sessao_sem_sala",
  "ligacao_ia_falhou",
  "material_aguardando_aprovacao",
  "link_expirando",
]);

export function pendenciaVisivelPara(papel: PapelEquipe | null | undefined, tipo: string): boolean {
  if (papel === "admin") return true;
  return PENDENCIAS_DE_PESSOA.has(tipo);
}
