import Link from "next/link";
import { CabecalhoPagina } from "@/components/ui/CabecalhoPagina";
import { ListaImportacoes } from "@/components/importacao/ListaImportacoes";

export const metadata = { title: "Importações · SIC-HF" };

/* O CTA é um `<Link>` (navegação, não ação) vestido com a mesma pílula do
   `Botao` primário — mantém semântica de âncora (abre em nova aba, teclado)
   sem aninhar botão dentro de link. */
const CLASSE_CTA =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-pilula border border-transparent bg-[color:var(--latao-cta)] px-5 py-2 text-sm font-medium text-[color:var(--latao-cta-texto)] shadow-[0_3px_0_0_var(--latao-cta-forte)] transition-[background-color,box-shadow,transform] duration-[var(--transicao-rapida)] ease-[var(--suavizacao)] hover:-translate-y-px hover:bg-[color:var(--latao-cta-forte)] active:translate-y-px active:shadow-none";

export default function PaginaImportacoes() {
  return (
    <div className="flex flex-col gap-8">
      <CabecalhoPagina
        rotulo="Administração"
        titulo="Importações"
        descricao="Suba a lista de leads de uma edição do seminário em CSV. O sistema mostra uma prévia do que entra e do que fica de fora — nada é gravado antes de você confirmar."
        acoes={
          <Link href="/importacoes/nova" className={CLASSE_CTA}>
            Nova importação
          </Link>
        }
      />
      <ListaImportacoes />
    </div>
  );
}
