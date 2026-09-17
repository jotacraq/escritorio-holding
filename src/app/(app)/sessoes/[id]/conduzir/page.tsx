import { ConduzirSessaoApp } from "@/components/sessao/ConduzirSessaoApp";
import { usuarioAtual } from "@/server/auth";

/** `id` é o id da JORNADA (não o da sessão) — mesmo parâmetro de `/jornadas/[id]`.
 * A Ficha 360 (`GET /api/jornadas/[id]`, já existente) é a única rota que junta
 * pessoa + sessão numa consulta só; a partir dela a tela resolve o id real de
 * `sessoes_viabilidade` para chamar `/api/sessoes/[id]/sims`.
 *
 * Correção (Fase 12, Fatia 7): esta página deixa de ser `"use client"`. O
 * executor anterior relatou "zero query" para `PainelTranscricao` saber quem
 * é a advogada — estava errado: `useUsuarioAtual()` fazia 2 idas à rede
 * (`auth.getUser()` + `SELECT nome, papel FROM perfis_equipe`) TODA VEZ que o
 * componente montava, e ele desmontava a cada troca de aba Transcrição↔
 * Inventário (`ColunaTranscricaoInventario` desmonta a aba inativa de
 * propósito) — uma query ao banco por clique, mais o flicker de pintar
 * neutro e só depois trocar o recuo quando a resposta chegava.
 *
 * Server component resolve o usuário UMA vez por carregamento da página
 * (`usuarioAtual()`, `@/server/auth` — mesma função que todo o resto do
 * sistema já usa, nenhuma rota nova) e desce só os DOIS campos que a
 * transcrição precisa: `nome` e `papel`. Nunca a linha inteira de
 * `perfis_equipe` (que tem `email`, `auth_user_id` etc.) — regra da casa,
 * PII não vai além do necessário. Nem `(app)/layout.tsx` nem o `layout.tsx`
 * desta rota resolvem usuário hoje, então isto não duplica trabalho já feito
 * mais acima na árvore.
 *
 * `ConduzirSessaoApp` continua `"use client"` — só passa a receber
 * `usuarioLogado` por prop e descer para quem precisa, em vez de cada folha
 * buscar sozinha. Resultado líquido: −1 query no caminho quente (a troca de
 * aba deixa de bater no banco).
 */
export default async function PaginaConduzirSessao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const usuario = await usuarioAtual();
  return (
    <ConduzirSessaoApp
      jornadaId={id}
      usuarioLogado={usuario ? { nome: usuario.nome, papel: usuario.papel } : null}
    />
  );
}
