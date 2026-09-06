import type { PerguntaFormularioPublico } from "@/types/publico-ui";
import { normalizarOpcoes, perguntaVisivel } from "@/lib/formulario/definicao";

/**
 * `opcoes` chega nos DOIS formatos que `formularios.definicao` guarda: string
 * crua (versões 1..5) e `{valor, rotulo}` (0078 em diante). O tipo do contrato
 * público só descreve o legado, então aqui a lista entra como `unknown` e sai
 * normalizada por `normalizarOpcoes` — a mesma função que a Ficha e o editor do
 * Admin usam. `PerguntaFormularioPublico` continua atribuível a este tipo.
 */
export type PerguntaPublica = Omit<PerguntaFormularioPublico, "opcoes"> & { opcoes?: unknown };

/**
 * Avalia a condicional de uma pergunta (ex.: P11 só aparece se P10 incluir
 * "Imóveis"). É `perguntaVisivel` do núcleo, sem cópia: a MESMA regra que a
 * Ficha usa na tela interna e que a 0082 espelha no banco para não cobrar
 * pergunta que ninguém viu. O nome local fica porque é o vocabulário desta
 * pasta (`*Publico`); a regra, não.
 */
export const perguntaPublicaVisivel: (pergunta: PerguntaPublica, respostas: Record<string, unknown>) => boolean = perguntaVisivel;

/** Uma pergunta preenchida conta como respondida se tem valor não vazio. */
export function perguntaPublicaRespondida(pergunta: PerguntaPublica, valor: unknown): boolean {
  if (!pergunta.obrigatoria) return true;
  if (valor === undefined || valor === null) return false;
  if (typeof valor === "string") return valor.trim().length > 0;
  if (Array.isArray(valor)) return valor.length > 0;
  return true;
}

/**
 * Campo de uma pergunta, para uso público (celular, 45–75 anos). Alvo de toque generoso já vem
 * de `.area-publica` (globals.css, `min-height: 44px` em input/button/select/textarea) — aqui só
 * cuido de tipografia grande o bastante e espaçamento entre opções para não errar o toque.
 */
export function CampoPerguntaPublico({
  pergunta,
  valor,
  aoMudar,
}: {
  pergunta: PerguntaPublica;
  valor: unknown;
  aoMudar: (valor: unknown) => void;
}) {
  /*
   * `idCampo` está em TODOS os tipos, inclusive nos grupos de escolha (onde
   * fica no `<div role=radiogroup|group>`, com `tabIndex={-1}`). Dois motivos:
   * o `<label htmlFor>` do assistente deixa de apontar para o vazio, e o erro
   * que o servidor devolve por id de pergunta (`opcao_invalida`, que só
   * acontece em escolha) consegue levar o foco até o grupo culpado.
   */
  const idCampo = `pergunta-publica-${pergunta.id}`;
  const rotuloId = `${idCampo}-rotulo`;
  /*
   * Fase 7 r2 (§UX2.3): o asterisco do rótulo é `aria-hidden` — de propósito,
   * "asterisco" lido em voz alta não quer dizer nada. Só que sem `aria-required`
   * a informação sumia por completo para quem usa leitor de tela: o campo era
   * obrigatório e ninguém dizia. Aqui ele volta pela via correta.
   */
  const obrigatorio = pergunta.obrigatoria || undefined;
  const opcoes = normalizarOpcoes(pergunta.opcoes);

  switch (pergunta.tipo) {
    case "texto":
      return (
        <input
          id={idCampo}
          type="text"
          value={(valor as string) ?? ""}
          onChange={(e) => aoMudar(e.target.value)}
          aria-required={obrigatorio}
          autoComplete="off"
          className="w-full rounded-controle border border-linha-controle bg-papel-elevado px-4 py-3 text-base text-tinta"
        />
      );
    case "numero":
      return (
        <input
          id={idCampo}
          type="number"
          inputMode="numeric"
          min={0}
          value={(valor as number) ?? ""}
          onChange={(e) => aoMudar(e.target.value === "" ? null : Number(e.target.value))}
          aria-required={obrigatorio}
          className="w-32 rounded-controle border border-linha-controle bg-papel-elevado px-4 py-3 text-base text-tinta"
        />
      );
    case "texto_longo":
      return (
        <textarea
          id={idCampo}
          rows={4}
          value={(valor as string) ?? ""}
          onChange={(e) => aoMudar(e.target.value)}
          aria-required={obrigatorio}
          className="w-full rounded-controle border border-linha-controle bg-papel-elevado px-4 py-3 text-base text-tinta"
        />
      );
    case "sim_nao":
      return (
        <div id={idCampo} tabIndex={-1} role="radiogroup" aria-labelledby={rotuloId} aria-required={obrigatorio} className="flex gap-3">
          {(["sim", "nao"] as const).map((opcao) => (
            <label
              key={opcao}
              className={`flex flex-1 items-center justify-center gap-2 min-h-11 rounded-controle border-2 px-4 py-3 text-base font-medium ${
                valor === opcao ? "border-[color:var(--latao-cta)] bg-latao-fraco text-tinta" : "border-linha-forte bg-papel text-tinta"
              }`}
            >
              <input type="radio" name={idCampo} checked={valor === opcao} onChange={() => aoMudar(opcao)} className="h-5 w-5 accent-[color:var(--latao-cta)]" />
              {opcao === "sim" ? "Sim" : "Não"}
            </label>
          ))}
        </div>
      );
    case "unica":
      return (
        <div id={idCampo} tabIndex={-1} role="radiogroup" aria-labelledby={rotuloId} aria-required={obrigatorio} className="flex flex-col gap-2.5">
          {opcoes.map((opcao) => (
            <label
              key={opcao.valor}
              className={`flex items-center gap-3 min-h-11 rounded-controle border-2 px-4 py-3 text-base ${
                valor === opcao.valor ? "border-[color:var(--latao-cta)] bg-latao-fraco" : "border-linha-forte bg-papel"
              }`}
            >
              <input
                type="radio"
                name={idCampo}
                checked={valor === opcao.valor}
                onChange={() => aoMudar(opcao.valor)}
                className="h-5 w-5 shrink-0 accent-[color:var(--latao-cta)]"
              />
              <span className="text-tinta">{opcao.rotulo}</span>
            </label>
          ))}
        </div>
      );
    case "multipla": {
      const selecionadas = Array.isArray(valor) ? (valor as string[]) : [];
      return (
        // Grupo de caixas: `role="radiogroup"` seria mentira (dá para marcar várias).
        // `role="group"` + `aria-labelledby` dá ao conjunto o nome da pergunta.
        <div id={idCampo} tabIndex={-1} role="group" aria-labelledby={rotuloId} className="flex flex-col gap-2.5">
          {opcoes.map((opcao) => (
            <label
              key={opcao.valor}
              className={`flex items-center gap-3 min-h-11 rounded-controle border-2 px-4 py-3 text-base ${
                selecionadas.includes(opcao.valor) ? "border-[color:var(--latao-cta)] bg-latao-fraco" : "border-linha-forte bg-papel"
              }`}
            >
              <input
                type="checkbox"
                checked={selecionadas.includes(opcao.valor)}
                onChange={(e) => aoMudar(e.target.checked ? [...selecionadas, opcao.valor] : selecionadas.filter((o) => o !== opcao.valor))}
                className="h-5 w-5 shrink-0 rounded-controle accent-[color:var(--latao-cta)]"
              />
              <span className="text-tinta">{opcao.rotulo}</span>
            </label>
          ))}
        </div>
      );
    }
    default:
      return null;
  }
}
