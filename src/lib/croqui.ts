import type { CroquiSlide } from "./api";

/**
 * Os 13 slides tipados do Croqui Estrutural — espinha fixa do método
 * (sic-hf-brain/02 - Metodo/Agente do Croqui.md). A ORDEM e os TIPOS são
 * estrutura do método, não configuração de negócio: ficam no código, ao
 * contrário das colunas do kanban (essas sim vêm do banco).
 */
export const SLIDES_PADRAO: Omit<CroquiSlide, "id" | "conteudo">[] = [
  { tipo: "legado", titulo: "Legado", objetivo: "Contexto emocional.", pergunta_ao_cliente: "O que mais vocês querem preservar?" },
  { tipo: "controle", titulo: "Controle", objetivo: "Quem está no comando.", pergunta_ao_cliente: "Quem precisa continuar tendo a palavra final?" },
  { tipo: "familia", titulo: "Família", objetivo: "Núcleos e sucessores.", pergunta_ao_cliente: "Todos os núcleos têm o mesmo papel e interesse?" },
  { tipo: "patrimonio", titulo: "Patrimônio", objetivo: "Fotografia patrimonial.", pergunta_ao_cliente: "Esse retrato representa o que precisa ser organizado?" },
  { tipo: "risco", titulo: "Risco", objetivo: "Vulnerabilidade.", pergunta_ao_cliente: "Se acontecesse amanhã, onde apareceria a maior dificuldade?" },
  { tipo: "alternativas", titulo: "Alternativas", objetivo: "Provar que houve estudo.", pergunta_ao_cliente: "Não escolhemos a holding antes de comparar os caminhos." },
  { tipo: "celula_1", titulo: "1 célula", objetivo: "Concentração.", pergunta_ao_cliente: "Uma estrutura só cumpre todas as funções desta família?" },
  { tipo: "celula_2", titulo: "2 células", objetivo: "Separação funcional.", pergunta_ao_cliente: "Faz sentido separar patrimônio de participação e controle?" },
  { tipo: "celula_3", titulo: "3 células", objetivo: "Cofre → Veículo → Destino.", pergunta_ao_cliente: "Estas três funções precisam de estruturas distintas?" },
  { tipo: "controle_arquitetura", titulo: "Controle na arquitetura", objetivo: "Como o instituidor permanece protegido.", pergunta_ao_cliente: "Esta arquitetura preserva o comando de quem construiu?" },
  { tipo: "economia", titulo: "Economia", objetivo: "Custo de agir x custo de não agir.", pergunta_ao_cliente: "Vale comparar o custo de organizar com o custo de não organizar?" },
  { tipo: "implementacao", titulo: "Implementação", objetivo: "Etapas.", pergunta_ao_cliente: "Em que ritmo a família consegue avançar?" },
  { tipo: "investimento", titulo: "Investimento", objetivo: "Honorários — só depois da validação da solução.", pergunta_ao_cliente: "A solução faz sentido para vocês?" },
];

/** `id` = o próprio tipo (slug estável) — mesma convenção do `construirSlidesBase()` do backend. */
export function criarEsqueletoSlides(): CroquiSlide[] {
  return SLIDES_PADRAO.map((s) => ({ ...s, id: s.tipo, conteudo: "" }));
}

export const ROTULO_TIPO_SLIDE: Record<CroquiSlide["tipo"], string> = Object.fromEntries(SLIDES_PADRAO.map((s) => [s.tipo, s.titulo])) as Record<
  CroquiSlide["tipo"],
  string
>;
