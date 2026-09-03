"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { AssistenteImportacao } from "@/components/importacao/AssistenteImportacao";

export default function PaginaNovaImportacao() {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/importacoes" className="text-xs font-medium text-[color:var(--latao)] hover:underline">
          ← Todas as importações
        </Link>
        <h1 className="font-serif text-2xl font-semibold text-tinta">Nova importação</h1>
        <p className="text-sm text-tinta-suave">
          Escolha a edição do seminário, suba o CSV e case cada coluna com um campo do sistema. O arquivo inteiro só é
          processado depois deste mapeamento — e mesmo assim vira só uma PRÉVIA: pessoa e jornada só são gravadas
          quando você confirmar na próxima tela.
        </p>
      </div>

      <AssistenteImportacao aoCriada={(importacao) => router.push(`/importacoes/${importacao.id}`)} />
    </div>
  );
}
