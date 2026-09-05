"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { CabecalhoPagina } from "@/components/ui/CabecalhoPagina";
import { AssistenteImportacao } from "@/components/importacao/AssistenteImportacao";

export default function PaginaNovaImportacao() {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-8">
      <CabecalhoPagina
        rotulo="Administração · Importações"
        acima={
          <Link href="/importacoes" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-[color:var(--latao)] underline-offset-4 hover:underline">
            ← Todas as importações
          </Link>
        }
        titulo="Nova importação"
        descricao="Quatro passos: enviar o arquivo, casar as colunas, conferir uma amostra e confirmar a prévia. Pessoas e jornadas só são gravadas no último passo."
      />

      <AssistenteImportacao aoCriada={(importacao) => router.push(`/importacoes/${importacao.id}`)} />
    </div>
  );
}
