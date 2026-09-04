import { Suspense } from "react";
import { FormularioLogin } from "./formulario-login";

export const dynamic = "force-dynamic";

export default function PaginaLogin() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-lg font-bold text-slate-900">SIC-HF</h1>
        <p className="mb-6 text-sm text-slate-500">Acesso da equipe — Time Holding Brasil</p>

        <Suspense fallback={null}>
          <FormularioLogin />
        </Suspense>

        <p className="mt-6 text-xs text-slate-400">
          Acesso só por convite. Fale com o administrador se ainda não tem conta.
        </p>
      </div>
    </div>
  );
}
