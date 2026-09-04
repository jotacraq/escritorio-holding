import Link from "next/link";
import { Botao } from "@/components/ui/Botao";
import { ListaImportacoes } from "@/components/importacao/ListaImportacoes";

export default function PaginaImportacoes() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-bold text-tinta">Importações</h1>
          <p className="text-sm text-tinta-suave">
            Suba a lista de leads de um seminário em CSV. Nada é gravado em pessoas ou jornadas antes de você conferir
            a prévia e confirmar.
          </p>
        </div>
        <Link href="/importacoes/nova">
          <Botao variante="primario">Nova importação</Botao>
        </Link>
      </div>

      <ListaImportacoes />
    </div>
  );
}
