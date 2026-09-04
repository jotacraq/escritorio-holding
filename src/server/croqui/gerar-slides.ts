import { construirSlidesBase, type CroquiConteudo, type SlideCroqui } from "@/server/ia/schema-croqui-slides";
import { CroquiAnaliseV2Schema, type CroquiAnaliseV2 } from "./schema-analise-v2";

/**
 * A ponte análise → 13 slides (ARQUITETURA-FASE-3.md §3.3). Função PURA —
 * ZERO chamada de IA, zero I/O. O custo é O(13) em memória. É a maior
 * economia estrutural do plano: transforma a Análise da Sessão em dado
 * pronto para o croqui SEM uma segunda chamada de modelo.
 *
 * `schemaVersao` vem de `croqui_analises.schema_versao` (0043 — default `1`
 * para toda análise gravada até hoje, porque `agente_croqui_analise` ainda
 * produz o formato v1: `croqui: string[]` solto, sem tipo de slide, sem
 * categoria — ver `src/server/ia/schema-croqui-analise.ts`). §3.1 já provou
 * que um array de frases soltas NÃO tem como ser mapeado deterministicamente
 * para os 13 slides tipados — por isso, para `schemaVersao < 2`, esta função
 * devolve a base do método intocada. Nunca adivinha correspondência entre
 * uma string solta e um slide: isso seria fabricar dado, proibido em todo o
 * projeto ("nada de dado inventado na tela").
 *
 * A v2 tipada (`./schema-analise-v2.ts`) já está pronta para ser consumida
 * aqui. O que falta para ela circular de ponta a ponta é o prompt v2 do
 * `agente_croqui_analise` (0042, dono: agente A/backend-ia) publicar esse
 * formato — ver o relatório desta onda para o pedido explícito.
 */
export function gerarSlidesDaAnalise(
  conteudoAnalise: unknown,
  schemaVersao: number,
  base: CroquiConteudo = construirSlidesBase(),
): CroquiConteudo {
  if (schemaVersao < 2) {
    return base;
  }

  const analise: CroquiAnaliseV2 = CroquiAnaliseV2Schema.parse(conteudoAnalise);
  const porTipo = new Map(analise.croqui.map((slide) => [slide.tipo, slide] as const));

  const slides: SlideCroqui[] = base.slides.map((slideBase) => {
    const daAnalise = porTipo.get(slideBase.tipo);

    if (!daAnalise) {
      // A análise não cobriu este slide — mantém a mensagem-padrão do
      // método, carimbada como tal. Nunca deixa o slide vazio, nunca
      // inventa conteúdo para preencher um buraco.
      return { ...slideBase, origem: "metodo", revisado: false };
    }

    return {
      ...slideBase,
      conteudo: daAnalise.conteudo,
      pontos: daAnalise.pontos,
      como_apresentar: daAnalise.como_apresentar,
      categoria: daAnalise.categoria,
      fontes: daAnalise.fontes,
      origem: "ia",
      // C19 (ARQUITETURA-FASE-3.md §3.6): todo slide de origem `ia` nasce por
      // revisar. `croquis.status` só pode virar `pronto`/`apresentado` com os
      // 13 `revisado: true` — garantido pelo trigger de banco (0043), não por
      // esta função. Aqui a invariante é honesta: acabou de sair da IA,
      // ninguém validou ainda.
      revisado: false,
    };
  });

  return { slides };
}
