import { z } from "zod";

/**
 * Os 13 slides tipados do croqui (Agente do Croqui, §42 do Contexto-Mestre;
 * sic-hf-brain/02 - Metodo/Agente do Croqui.md). Isto é o desenho ATUAL — chegou
 * depois do rascunho de ARQUITETURA.md (que tinha 8 tipos genéricos) e é o que
 * vale.
 */
export const TIPOS_SLIDE_CROQUI = [
  "legado",
  "controle",
  "familia",
  "patrimonio",
  "risco",
  "alternativas",
  "celula_1",
  "celula_2",
  "celula_3",
  "controle_arquitetura",
  "economia",
  "implementacao",
  "investimento",
] as const;

export const TipoSlideCroquiSchema = z.enum(TIPOS_SLIDE_CROQUI);
export type TipoSlideCroqui = z.infer<typeof TipoSlideCroquiSchema>;

// Nomes de campo alinhados com o contrato já escrito em `src/lib/api.ts`
// (`CroquiSlide`, do FRONT-END/BACK-CORE): `pergunta_ao_cliente`, não
// `pergunta_cliente`. Lá `objetivo`/`pergunta_ao_cliente` são opcionais (o front
// pode enviar um slide editado sem repeti-los); aqui ficam opcionais no schema
// pelo mesmo motivo, mas `construirSlidesBase()` sempre os preenche na origem.
export const SlideCroquiSchema = z.object({
  id: z.string(), // slug estável = o próprio tipo, ex.: 'legado'
  ordem: z.number().int().min(1).max(13).optional(), // extra aditivo — ordenação
  tipo: TipoSlideCroquiSchema,
  titulo: z.string(),
  objetivo: z.string().optional(),
  pergunta_ao_cliente: z.string().optional(),
  conteudo: z.string(), // EDITÁVEL pela advogada, por jornada — nasce vazio
});
export type SlideCroqui = z.infer<typeof SlideCroquiSchema>;

export const CroquiConteudoSchema = z.object({
  slides: z.array(SlideCroquiSchema).length(13),
});
export type CroquiConteudo = z.infer<typeof CroquiConteudoSchema>;

interface DefinicaoSlideBase {
  tipo: TipoSlideCroqui;
  titulo: string;
  objetivo: string;
  mensagem_padrao: string;
  pergunta_ao_cliente: string;
}

const DEFINICOES_SLIDES: DefinicaoSlideBase[] = [
  {
    tipo: "legado",
    titulo: "Legado",
    objetivo: "Criar contexto emocional e estratégico.",
    mensagem_padrao: "O que esta família mais quer preservar ao longo do tempo.",
    pergunta_ao_cliente: "Quando vocês olham para tudo o que construíram, o que mais querem preservar?",
  },
  {
    tipo: "controle",
    titulo: "Controle",
    objetivo: "Mostrar quem está no comando.",
    mensagem_padrao: "A transição não pode significar perda de comando sobre o que foi construído.",
    pergunta_ao_cliente: "Quem precisa continuar tendo a palavra final durante a transição?",
  },
  {
    tipo: "familia",
    titulo: "Família",
    objetivo: "Mapear núcleos e sucessores.",
    mensagem_padrao: "Cada núcleo familiar tem um papel — a arquitetura precisa reconhecer isso.",
    pergunta_ao_cliente: "Todos os núcleos têm o mesmo papel e o mesmo interesse no patrimônio e na empresa?",
  },
  {
    tipo: "patrimonio",
    titulo: "Patrimônio",
    objetivo: "Mostrar a fotografia patrimonial.",
    mensagem_padrao: "Este é o retrato do que precisa ser organizado, protegido e transmitido.",
    pergunta_ao_cliente: "Esse retrato representa aquilo que vocês consideram o patrimônio que precisa ser organizado?",
  },
  {
    tipo: "risco",
    titulo: "Risco",
    objetivo: "Mostrar a vulnerabilidade atual.",
    mensagem_padrao: "Sem estrutura, um evento sucessório hoje geraria a maior dificuldade nestes pontos.",
    pergunta_ao_cliente:
      "Se nada fosse feito e acontecesse um evento sucessório amanhã, onde vocês acreditam que apareceria a maior dificuldade?",
  },
  {
    tipo: "alternativas",
    titulo: "Alternativas",
    objetivo: "Demonstrar que houve estudo — a holding não foi escolhida antes de comparar os caminhos.",
    mensagem_padrao: "Nós não escolhemos a holding antes de comparar os caminhos.",
    pergunta_ao_cliente: "Antes de falar de estrutura, faz sentido revisarmos juntos os caminhos que avaliamos?",
  },
  {
    tipo: "celula_1",
    titulo: "1 Célula",
    objetivo: "Explicar a arquitetura de concentração.",
    mensagem_padrao: "Uma estrutura só, concentrando patrimônio, controle e destino.",
    pergunta_ao_cliente: "Uma estrutura só resolve as funções que vocês precisam separar?",
  },
  {
    tipo: "celula_2",
    titulo: "2 Células",
    objetivo: "Explicar a separação funcional entre patrimônio e participação/controle/destino.",
    mensagem_padrao: "Duas estruturas separam o patrimônio da participação, do controle e do destino.",
    pergunta_ao_cliente: "Faz sentido para vocês separar o patrimônio da parte que decide o controle e o destino?",
  },
  {
    tipo: "celula_3",
    titulo: "3 Células",
    objetivo: "Explicar Cofre → Veículo → Destino.",
    mensagem_padrao: "Cofre (onde está o patrimônio), Veículo (quem controla e administra) e Destino (para quem e em quais condições).",
    pergunta_ao_cliente: "Essas três funções — guardar, controlar e destinar — precisam de estruturas separadas na realidade de vocês?",
  },
  {
    tipo: "controle_arquitetura",
    titulo: "Controle na Arquitetura",
    objetivo: "Demonstrar como o instituidor permanece protegido dentro da arquitetura projetada.",
    mensagem_padrao: "A arquitetura proposta mantém quem decide hoje no comando durante toda a transição.",
    pergunta_ao_cliente: "Esse desenho garante o nível de controle que vocês precisam manter?",
  },
  {
    tipo: "economia",
    titulo: "Economia",
    objetivo: "Mostrar o custo projetado — custo de agir x custo de não agir.",
    mensagem_padrao: "O custo de organizar agora é menor do que o custo de não fazer nada.",
    pergunta_ao_cliente: "Faz sentido compararmos o custo de agir agora com o custo de não agir?",
  },
  {
    tipo: "implementacao",
    titulo: "Implementação",
    objetivo: "Explicar as etapas de execução.",
    mensagem_padrao: "A implementação segue etapas claras, com prazos e responsáveis definidos.",
    pergunta_ao_cliente: "Existe alguma etapa aqui que gera dúvida sobre como vai funcionar na prática?",
  },
  {
    tipo: "investimento",
    titulo: "Investimento",
    objetivo:
      "Apresentar os honorários — somente depois da validação da solução (diagnóstico não é venda).",
    mensagem_padrao: "O investimento reflete a arquitetura que vocês acabaram de validar como a certa.",
    pergunta_ao_cliente: "Com a solução validada, faz sentido avançarmos para os próximos passos?",
  },
];

/**
 * Constrói os 13 slides-base (método) para um croqui novo. `conteudo` nasce
 * PREENCHIDO com a mensagem-padrão do método (não vazio) — é o ponto de partida
 * editável pela advogada, nunca texto solto sem curadoria.
 */
export function construirSlidesBase(): CroquiConteudo {
  return {
    slides: DEFINICOES_SLIDES.map((definicao, indice) => ({
      id: definicao.tipo,
      ordem: indice + 1,
      tipo: definicao.tipo,
      titulo: definicao.titulo,
      objetivo: definicao.objetivo,
      pergunta_ao_cliente: definicao.pergunta_ao_cliente,
      conteudo: definicao.mensagem_padrao,
    })),
  };
}
