import { Suspense } from "react";
import { FormularioLogin } from "./formulario-login";

export const dynamic = "force-dynamic";

export default function PaginaLogin() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-papel-fundo px-4 py-10">
      <main className="anim-surgir w-full max-w-md rounded-cartao border border-linha bg-papel-elevado p-7 shadow-cartao sm:p-9">
        <p className="text-rotulo font-medium uppercase text-[color:var(--latao)]">Time Holding Brasil · Acesso da equipe</p>
        <h1 className="mt-2 text-display font-bold text-tinta">Entrar no SIC-HF</h1>
        <p className="mt-2 text-corpo text-tinta-suave">Use o e-mail e a senha que você recebeu do escritório.</p>

        <div className="mt-7">
          <Suspense fallback={null}>
            <FormularioLogin />
          </Suspense>
        </div>

        <p className="mt-7 border-t border-linha pt-5 text-xs text-tinta-suave">
          O acesso é só por convite. Se você ainda não tem conta ou esqueceu a senha, fale com quem administra o sistema no escritório.
        </p>
      </main>
      <p className="mt-6 text-legenda text-tinta-fraca">Dra. Elaine Montenegro · Planejamento Patrimonial</p>
    </div>
  );
}
