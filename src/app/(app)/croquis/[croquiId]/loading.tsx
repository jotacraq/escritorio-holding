/**
 * Estado de carregamento da rota (Fase 7, PERF). Sem ele o App Router segura a
 * navegação com a tela ANTERIOR na frente até o RSC da nova chegar: quem
 * clicou fica sem retorno visual e clica de novo. O esqueleto tem a forma do
 * que vem — nunca um giro no vazio — e anuncia "Carregando" uma vez
 * (`role="status"` dentro dos componentes de `ui/Esqueleto`).
 *
 * Não é dado inventado: é a silhueta do layout, `aria-hidden`, sem número
 * nenhum na tela.
 */
import { EsqueletoLista } from "@/components/ui/Esqueleto";

export default function CarregandoCroqui() {
  return <EsqueletoLista linhas={6} rotulo="Abrindo o croqui…" />;
}
