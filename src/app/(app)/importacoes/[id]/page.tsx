"use client";

import { use } from "react";
import { DetalheImportacao } from "@/components/importacao/DetalheImportacao";

export default function PaginaDetalheImportacao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <DetalheImportacao importacaoId={id} />;
}
