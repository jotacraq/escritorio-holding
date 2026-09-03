import { SeloStub } from "@/components/ui/Selo";

/**
 * Pesquisa em fonte pública (0036, `pesquisas_publicas`) — o backend já tem o
 * arcabouço com trava de consentimento (BLOQUEIO B-4B do ARQUITETURA-FASE-2),
 * mas usar qualquer fonte pública sobre a família ainda depende de decisão
 * jurídica da Dra. Elaine sobre base legal (LGPD, art. 7º/11º) — não é
 * decisão de engenharia. Enquanto isso não vier, esta aba fica como stub
 * explícito, nunca como funcionalidade "quase pronta" escondida atrás de um
 * botão que parece funcionar.
 */
export function PesquisaPublicaAba() {
  return (
    <SeloStub texto="Pesquisa em fonte pública — arcabouço existe no banco (0036), mas depende de decisão jurídica da Dra. Elaine sobre a base legal (LGPD) antes de qualquer busca real. Sem essa decisão, esta aba não consulta fonte nenhuma." />
  );
}
