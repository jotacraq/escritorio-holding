"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { criarClienteNavegador } from "@/lib/supabase/browser";
import { Botao } from "@/components/ui/Botao";
import { Campo, Entrada } from "@/components/ui/Campo";

/**
 * Login e-mail/senha da equipe interna. Não há cadastro público aqui — acesso é
 * por convite (linha pré-criada em `perfis_equipe` pelo admin). Depois do login,
 * chama `/api/auth/vincular` para casar a sessão com o convite e só então navega.
 * (Lógica de auth intacta desde a Fase 1 — só a forma mudou.)
 */
export function FormularioLogin() {
  const router = useRouter();
  const parametros = useSearchParams();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
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
        setMensagemErro("E-mail ou senha não conferem. Confira as letras maiúsculas e tente de novo.");
        return;
      }

      // Melhor esforço: se falhar, o middleware ainda deixa entrar (autenticado),
      // mas a RLS/guard de papel vão negar tudo até isto rodar com sucesso.
      try {
        await fetch("/api/auth/vincular", { method: "POST" });
      } catch {
        // Falha de rede aqui não deve impedir a navegação.
      }

      const destino = parametros.get("proximo") || "/";
      router.replace(destino);
      router.refresh();
    } catch {
      setMensagemErro("Não foi possível falar com o servidor. Verifique sua internet e tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={aoSubmeter} noValidate className="flex flex-col gap-5">
      <Campo rotulo="E-mail" id="email">
        <Entrada
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          autoFocus
          value={email}
          onChange={(evento) => setEmail(evento.target.value)}
        />
      </Campo>

      <Campo
        rotulo="Senha"
        id="senha"
        extra={
          <button
            type="button"
            onClick={() => setMostrarSenha((v) => !v)}
            aria-pressed={mostrarSenha}
            className="-my-2 inline-flex min-h-11 items-center text-xs font-medium text-[color:var(--latao)] underline-offset-4 hover:underline"
          >
            {mostrarSenha ? "Esconder senha" : "Mostrar senha"}
          </button>
        }
      >
        <Entrada
          type={mostrarSenha ? "text" : "password"}
          name="senha"
          autoComplete="current-password"
          required
          value={senha}
          onChange={(evento) => setSenha(evento.target.value)}
        />
      </Campo>

      {mensagemErro && (
        <p role="alert" className="flex items-start gap-2 rounded-controle border border-[color:var(--vermelho)] bg-vermelho-fraco px-3.5 py-3 text-sm text-[color:var(--vermelho)]">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 fill-current">
            <path d="M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm0 4a1 1 0 0 0-1 1v4a1 1 0 1 0 2 0V7a1 1 0 0 0-1-1Zm0 7.5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z" />
          </svg>
          <span>{mensagemErro}</span>
        </p>
      )}

      <Botao type="submit" variante="primario" tamanho="grande" largo carregando={enviando} disabled={!email || !senha}>
        {enviando ? "Entrando…" : "Entrar"}
      </Botao>
    </form>
  );
}
