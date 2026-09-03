"use client";

import { use } from "react";
import { FormularioPublico } from "@/components/publico/FormularioPublico";

/** `/p/f/[token]` — Formulário Estratégico (POP 02), respondido pelo cliente. */
export default function PaginaFormularioPublico({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return <FormularioPublico token={token} />;
}
