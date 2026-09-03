"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { criarClienteNavegador } from "@/lib/supabase/browser";

/**
 * Login e-mail/senha da equipe interna. Não há cadastro público aqui — acesso é
 * por convite (linha pré-criada em `perfis_equipe` pelo admin). Depois do login,
 * chama `/api/auth/vincular` para casar a sessão com o convite e só então navega.
 */
export function FormularioLogin() {
  const router = useRouter();
  const parametros = useSearchParams();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [mensagemErro, setMensagemErro] = useState<string | null>(null);

  async function aoSubmeter(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setMensagemErro(null);
    setEnviando(true);

    try {
      const supabase = criarClienteNavegador();
      const { error: erroLogin } = await supabase.auth.signInWithPassword({ email, password: senha });

      if (erroLogin) {
        setMensagemErro("E-mail ou senha inválidos.");
        return;
      }

      // Melhor esforço: se falhar, o middleware ainda deixa entrar (autenticado),
      // mas a RLS/guard de papel vão negar tudo até isto rodar com sucesso.
      // Não travamos o login por causa disso — só seguimos e o guard tenta de novo.
      try {
        await fetch("/api/auth/vincular", { method: "POST" });
      } catch {
        // Falha de rede aqui não deve impedir a navegação.
      }

      const destino = parametros.get("proximo") || "/";
      router.replace(destino);
      router.refresh();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={aoSubmeter} className="space-y-4">
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
          E-mail
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(evento) => setEmail(evento.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="senha" className="mb-1 block text-sm font-medium text-slate-700">
          Senha
        </label>
        <input
          id="senha"
          type="password"
          autoComplete="current-password"
          required
          value={senha}
          onChange={(evento) => setSenha(evento.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />
      </div>

      {mensagemErro ? (
        <p role="alert" className="text-sm text-red-600">
          {mensagemErro}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={enviando}
        className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {enviando ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
