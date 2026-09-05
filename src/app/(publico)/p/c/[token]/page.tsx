"use client";

import { use } from "react";
import { ConfirmacaoPublico } from "@/components/publico/ConfirmacaoPublico";

/** `/p/c/[token]` — confirmação de presença com um toque (link `confirmacao`, 0050/0051). */
export default function PaginaConfirmacaoPublica({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return <ConfirmacaoPublico token={token} />;
}
