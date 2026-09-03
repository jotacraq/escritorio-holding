"use client";

import { use } from "react";
import { MaterialPublico } from "@/components/publico/MaterialPublico";

/** `/p/m/[token]` — material pós-sessão, leitura e impressão. */
export default function PaginaMaterialPublico({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return <MaterialPublico token={token} />;
}
