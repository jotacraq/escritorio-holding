/**
 * O rótulo do caso é o slug do arquivo de origem (`maria-aparecida-penna`) —
 * escolhido de propósito no banco porque duas pessoas diferentes podem ter o
 * mesmo nome, e o slug é único. Alguns rótulos de transcrição já vêm com
 * espaços ("Familia cardoso de barros lima") — por isso o corte também é por
 * espaço. Para a tela, isso não serve: quem lê é a
 * advogada, e ela conhece a pessoa pelo nome.
 *
 * As partículas ficam minúsculas ("de", "da", "dos") porque é assim que se
 * escreve nome próprio em português.
 */
const PARTICULAS = new Set(["de", "da", "do", "das", "dos", "e"]);

export function nomeDoSlug(slug: string): string {
  const partes = slug.split(/[-_\s]+/).filter(Boolean);
  if (partes.length === 0) return slug;
  return partes
    .map((parte, indice) => {
      const minuscula = parte.toLocaleLowerCase("pt-BR");
      if (indice > 0 && PARTICULAS.has(minuscula)) return minuscula;
      return minuscula.charAt(0).toLocaleUpperCase("pt-BR") + minuscula.slice(1);
    })
    .join(" ");
}
