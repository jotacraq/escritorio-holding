"use client";

import { use } from "react";
import { DocumentosPublico } from "@/components/publico/DocumentosPublico";

/** `/p/d/[token]` — envio de documentos (IR, contrato social) pelo cliente. */
export default function PaginaDocumentosPublico({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return <DocumentosPublico token={token} />;
}
