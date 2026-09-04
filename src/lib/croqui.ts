import type { CroquiSlide } from "./api";

/**
 * Os 13 slides tipados do Croqui Estrutural — espinha fixa do método
 * (sic-hf-brain/02 - Metodo/Agente do Croqui.md). A ORDEM e os TIPOS são
 * estrutura do método, não configuração de negócio: ficam no código, ao
 * contrário das colunas do kanban (essas sim vêm do banco).
 *
 * `mensagemPadrao` espelha `DEFINICOES_SLIDES[].mensagem_padrao` de
 * `src/server/ia/schema-croqui-slides.ts` (`construirSlidesBase()`, fora
 * desta fronteira) — as DUAS listas existem porque um cliente não deve
 * importar `src/server/**`; mantidas com o mesmo texto de propósito, para
 * "Iniciar croqui" manual (aqui) e a criação automática pela Análise da
 * Sessão (lá) partirem do MESMO ponto de partida editável, nunca de uma
 * caixa vazia sem curadoria (achado corrigido nesta onda: `criarEsqueletoSlides()`
 * gravava `conteudo: ""`, divergindo do comentário de `construirSlidesBase()`
 * — "nasce PREENCHIDO... não vazio").
 */
export const SLIDES_PADRAO: (Omit<CroquiSlide, "id" | "conteudo"> & { mensagemPadrao: string })[] = [
  { tipo: "legado", titulo: "Legado", objetivo: "Contexto emocional.", pergunta_ao_cliente: "O que mais vocês querem preservar?", mensagemPadrao: "O que esta família mais quer preservar ao longo do tempo." },
  { tipo: "controle", titulo: "Controle", objetivo: "Quem está no comando.", pergunta_ao_cliente: "Quem precisa continuar tendo a palavra final?", mensagemPadrao: "A transição não pode significar perda de comando sobre o que foi construído." },
  { tipo: "familia", titulo: "Família", objetivo: "Núcleos e sucessores.", pergunta_ao_cliente: "Todos os núcleos têm o mesmo papel e interesse?", mensagemPadrao: "Cada núcleo familiar tem um papel — a arquitetura precisa reconhecer isso." },
  { tipo: "patrimonio", titulo: "Patrimônio", objetivo: "Fotografia patrimonial.", pergunta_ao_cliente: "Esse retrato representa o que precisa ser organizado?", mensagemPadrao: "Este é o retrato do que precisa ser organizado, protegido e transmitido." },
  { tipo: "risco", titulo: "Risco", objetivo: "Vulnerabilidade.", pergunta_ao_cliente: "Se acontecesse amanhã, onde apareceria a maior dificuldade?", mensagemPadrao: "Sem estrutura, um evento sucessório hoje geraria a maior dificuldade nestes pontos." },
  { tipo: "alternativas", titulo: "Alternativas", objetivo: "Provar que houve estudo.", pergunta_ao_cliente: "Não escolhemos a holding antes de comparar os caminhos.", mensagemPadrao: "Nós não escolhemos a holding antes de comparar os caminhos." },
  { tipo: "celula_1", titulo: "1 célula", objetivo: "Concentração.", pergunta_ao_cliente: "Uma estrutura só cumpre todas as funções desta família?", mensagemPadrao: "Uma estrutura só, concentrando patrimônio, controle e destino." },
  { tipo: "celula_2", titulo: "2 células", objetivo: "Separação funcional.", pergunta_ao_cliente: "Faz sentido separar patrimônio de participação e controle?", mensagemPadrao: "Duas estruturas separam o patrimônio da participação, do controle e do destino." },
  { tipo: "celula_3", titulo: "3 células", objetivo: "Cofre → Veículo → Destino.", pergunta_ao_cliente: "Estas três funções precisam de estruturas distintas?", mensagemPadrao: "Cofre (onde está o patrimônio), Veículo (quem controla e administra) e Destino (para quem e em quais condições)." },
  { tipo: "controle_arquitetura", titulo: "Controle na arquitetura", objetivo: "Como o instituidor permanece protegido.", pergunta_ao_cliente: "Esta arquitetura preserva o comando de quem construiu?", mensagemPadrao: "A arquitetura proposta mantém quem decide hoje no comando durante toda a transição." },
  { tipo: "economia", titulo: "Economia", objetivo: "Custo de agir x custo de não agir.", pergunta_ao_cliente: "Vale comparar o custo de organizar com o custo de não organizar?", mensagemPadrao: "O custo de organizar agora é menor do que o custo de não fazer nada." },
  { tipo: "implementacao", titulo: "Implementação", objetivo: "Etapas.", pergunta_ao_cliente: "Em que ritmo a família consegue avançar?", mensagemPadrao: "A implementação segue etapas claras, com prazos e responsáveis definidos." },
  { tipo: "investimento", titulo: "Investimento", objetivo: "Honorários — só depois da validação da solução.", pergunta_ao_cliente: "A solução faz sentido para vocês?", mensagemPadrao: "O investimento reflete a arquitetura que vocês acabaram de validar como a certa." },
];

/** `id` = o próprio tipo (slug estável) — mesma convenção do `construirSlidesBase()` do backend.
 * `conteudo` nasce com a mensagem-padrão do método (editável, não vazio) e
 * `origem: 'metodo'` — mesmo contrato do backend, para `EditorCroqui` mostrar
 * o carimbo certo desde o primeiro instante. */
export function criarEsqueletoSlides(): CroquiSlide[] {
  return SLIDES_PADRAO.map(({ mensagemPadrao, ...s }) => ({ ...s, id: s.tipo, conteudo: mensagemPadrao, origem: "metodo", revisado: false }));
}

export const ROTULO_TIPO_SLIDE: Record<CroquiSlide["tipo"], string> = Object.fromEntries(SLIDES_PADRAO.map((s) => [s.tipo, s.titulo])) as Record<
  CroquiSlide["tipo"],
  string
>;

/**
 * Contagem única de revisão dos slides — antes duplicada com lógica levemente
 * diferente em `EditorCroqui`, `ModoApresentacao` e `CabecalhoFicha`. A
 * revisão dos 13 slides deixou de ser trava obrigatória para virar sinal de
 * atenção (o croqui pode virar "pronto" com pendências — a assinatura é da
 * advogada, não do sistema); esta função só conta, não decide nada.
 */
export function contarRevisaoSlides(slides: CroquiSlide[]): { revisados: number; total: number; pendentes: number } {
  const total = slides.length;
  const revisados = slides.filter((s) => s.revisado).length;
  return { revisados, total, pendentes: total - revisados };
}
