"use client";

import { useCallback, useState } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { ApiError } from "@/lib/api";
import { Botao } from "@/components/ui/Botao";
import { EstadoCarregando, EstadoErro } from "@/components/ui/Estado";
import { formatarDataHora } from "@/lib/formatar";
import { atualizarPerfilEquipe, criarConviteEquipe, listarEquipe, reenviarConviteEquipe } from "../adminApi";
import { ConfirmarAcao } from "../ConfirmarAcao";
import { AvisoInline } from "../AvisoInline";
import type { PapelEquipe, PerfilEquipeAdmin } from "@/types/admin";

const ROTULO_PAPEL: Record<PapelEquipe, string> = {
  admin: "Admin",
  advogada: "Advogada",
  relacionamento: "Relacionamento",
  assistente: "Assistente",
};

const PAPEIS: PapelEquipe[] = ["admin", "advogada", "relacionamento", "assistente"];

function formularioVazio() {
  return { nome: "", email: "", papel: "relacionamento" as PapelEquipe };
}

type ConfirmacaoDesativar = { perfil: PerfilEquipeAdmin } | null;
type ConfirmacaoPapel = { perfil: PerfilEquipeAdmin; novoPapel: PapelEquipe } | null;

export function EquipeAba() {
  const buscar = useCallback(() => listarEquipe(), []);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, []);

  const [novo, setNovo] = useState<{ nome: string; email: string; papel: PapelEquipe } | null>(null);
  const [convidando, setConvidando] = useState(false);
  const [reenviandoId, setReenviandoId] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tom: "sucesso" | "aviso" | "erro"; texto: string } | null>(null);
  const [confirmarDesativar, setConfirmarDesativar] = useState<ConfirmacaoDesativar>(null);
  const [confirmarPapel, setConfirmarPapel] = useState<ConfirmacaoPapel>(null);
  const [processandoAcao, setProcessandoAcao] = useState(false);

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar a equipe" />;
  if (carregando && !dados) return <EstadoCarregando rotulo="Carregando equipe…" />;
  if (!dados) return null;

  function mensagemDoResultado(email: string, convite: { enviado: boolean; motivo?: string }): { tom: "sucesso" | "aviso"; texto: string } {
    if (convite.enviado) return { tom: "sucesso", texto: `Convite enviado para ${email}.` };
    if (convite.motivo === "service_role_ausente") {
      return { tom: "aviso", texto: `Linha de convite criada para ${email}. Envio de e-mail indisponível — entregue o acesso por fora.` };
    }
    return { tom: "aviso", texto: `Linha criada para ${email}. O envio do e-mail falhou — use "Reenviar convite" para tentar de novo.` };
  }

  async function convidar() {
    if (!novo || !novo.nome.trim() || !novo.email.trim()) return;
    setConvidando(true);
    setAviso(null);
    try {
      const resultado = await criarConviteEquipe(novo);
      setAviso(mensagemDoResultado(resultado.perfil.email, resultado.convite));
      setNovo(null);
      recarregar();
    } catch (e) {
      setAviso({ tom: "erro", texto: e instanceof ApiError ? e.message : "Não foi possível criar o convite." });
    } finally {
      setConvidando(false);
    }
  }

  async function reenviar(perfil: PerfilEquipeAdmin) {
    setReenviandoId(perfil.id);
    setAviso(null);
    try {
      const resultado = await reenviarConviteEquipe(perfil.id, perfil);
      setAviso(mensagemDoResultado(perfil.email, resultado.convite));
      recarregar();
    } catch (e) {
      setAviso({ tom: "erro", texto: e instanceof ApiError ? e.message : "Não foi possível reenviar o convite." });
    } finally {
      setReenviandoId(null);
    }
  }

  async function confirmarDesativarPerfil() {
    if (!confirmarDesativar) return;
    setProcessandoAcao(true);
    setAviso(null);
    try {
      await atualizarPerfilEquipe(confirmarDesativar.perfil.id, { ativo: false });
      setAviso({ tom: "sucesso", texto: `Acesso de ${confirmarDesativar.perfil.nome} desativado.` });
      setConfirmarDesativar(null);
      recarregar();
    } catch (e) {
      setAviso({ tom: "erro", texto: e instanceof ApiError ? e.message : "Não foi possível desativar o acesso." });
    } finally {
      setProcessandoAcao(false);
    }
  }

  async function reativar(perfil: PerfilEquipeAdmin) {
    setAviso(null);
    try {
      await atualizarPerfilEquipe(perfil.id, { ativo: true });
      setAviso({ tom: "sucesso", texto: `Acesso de ${perfil.nome} reativado.` });
      recarregar();
    } catch (e) {
      setAviso({ tom: "erro", texto: e instanceof ApiError ? e.message : "Não foi possível reativar o acesso." });
    }
  }

  async function confirmarMudancaPapel() {
    if (!confirmarPapel) return;
    setProcessandoAcao(true);
    setAviso(null);
    try {
      await atualizarPerfilEquipe(confirmarPapel.perfil.id, { papel: confirmarPapel.novoPapel });
      setAviso({ tom: "sucesso", texto: `Papel de ${confirmarPapel.perfil.nome} alterado para ${ROTULO_PAPEL[confirmarPapel.novoPapel]}.` });
      setConfirmarPapel(null);
      recarregar();
    } catch (e) {
      setAviso({ tom: "erro", texto: e instanceof ApiError ? e.message : "Não foi possível alterar o papel." });
    } finally {
      setProcessandoAcao(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-tinta-fraca">
        Acesso é por convite: criar a linha aqui sempre funciona; o e-mail de convite depende de uma chave que hoje não está
        configurada — quando não sair, a linha fica pronta para entregar o acesso por fora.
      </p>

      {aviso && <AvisoInline tom={aviso.tom}>{aviso.texto}</AvisoInline>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-linha-forte text-left text-tinta-suave">
              <th className="py-1.5 pr-3 font-medium">Nome</th>
              <th className="py-1.5 pr-3 font-medium">E-mail</th>
              <th className="py-1.5 pr-3 font-medium">Papel</th>
              <th className="py-1.5 pr-3 font-medium">Status</th>
              <th className="py-1.5 pr-3 font-medium">Convite</th>
              <th className="py-1.5 font-medium sr-only">Ações</th>
            </tr>
          </thead>
          <tbody>
            {dados.itens.map((perfil) => (
              <tr key={perfil.id} className="border-b border-linha align-top">
                <td className="py-2 pr-3 font-medium text-tinta">{perfil.nome}</td>
                <td className="py-2 pr-3 text-tinta-suave">{perfil.email}</td>
                <td className="py-2 pr-3">
                  <select
                    value={perfil.papel}
                    onChange={(e) => setConfirmarPapel({ perfil, novoPapel: e.target.value as PapelEquipe })}
                    className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1 text-sm"
                    aria-label={`Papel de ${perfil.nome}`}
                  >
                    {PAPEIS.map((p) => (
                      <option key={p} value={p}>
                        {ROTULO_PAPEL[p]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-3">
                  {perfil.ativo ? (
                    <span className="inline-flex items-center rounded-sm border border-transparent bg-verde-fraco px-1.5 py-0.5 text-[11px] font-medium text-[color:var(--verde)]">
                      Ativo
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-sm border border-linha bg-papel px-1.5 py-0.5 text-[11px] font-medium text-tinta-fraca">
                      Desativado
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 text-xs text-tinta-suave">
                  {perfil.convite_enviado_em ? (
                    <>enviado em {formatarDataHora(perfil.convite_enviado_em)}</>
                  ) : (
                    <span className="text-[color:var(--ambar)]">não enviado</span>
                  )}
                </td>
                <td className="py-2">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Botao
                      variante="fantasma"
                      className="text-xs"
                      carregando={reenviandoId === perfil.id}
                      onClick={() => reenviar(perfil)}
                    >
                      Reenviar convite
                    </Botao>
                    {perfil.ativo ? (
                      <Botao variante="perigo" className="text-xs" onClick={() => setConfirmarDesativar({ perfil })}>
                        Desativar
                      </Botao>
                    ) : (
                      <Botao variante="secundario" className="text-xs" onClick={() => reativar(perfil)}>
                        Reativar
                      </Botao>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {novo ? (
        <div className="flex flex-col gap-3 rounded-sm border border-linha bg-papel-fundo p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              Nome
              <input
                value={novo.nome}
                onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
                className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              E-mail
              <input
                type="email"
                value={novo.email}
                onChange={(e) => setNovo({ ...novo, email: e.target.value })}
                className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Papel
              <select
                value={novo.papel}
                onChange={(e) => setNovo({ ...novo, papel: e.target.value as PapelEquipe })}
                className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5"
              >
                {PAPEIS.map((p) => (
                  <option key={p} value={p}>
                    {ROTULO_PAPEL[p]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <Botao variante="primario" carregando={convidando} onClick={convidar}>
              Convidar
            </Botao>
            <Botao variante="fantasma" onClick={() => setNovo(null)}>
              Cancelar
            </Botao>
          </div>
        </div>
      ) : (
        <div>
          <Botao variante="secundario" onClick={() => setNovo(formularioVazio())}>
            + Convidar membro da equipe
          </Botao>
        </div>
      )}

      <ConfirmarAcao
        aberto={confirmarDesativar !== null}
        titulo="Desativar acesso"
        efeito={`Desativa o acesso de ${confirmarDesativar?.perfil.nome} imediatamente — a pessoa não consegue mais entrar no sistema até ser reativada.`}
        rotuloConfirmar="Desativar"
        perigo
        confirmando={processandoAcao}
        aoConfirmar={confirmarDesativarPerfil}
        aoCancelar={() => setConfirmarDesativar(null)}
      />

      <ConfirmarAcao
        aberto={confirmarPapel !== null}
        titulo="Alterar papel"
        efeito={
          confirmarPapel
            ? `Muda o papel de ${confirmarPapel.perfil.nome} de ${ROTULO_PAPEL[confirmarPapel.perfil.papel]} para ${ROTULO_PAPEL[confirmarPapel.novoPapel]} — isso muda imediatamente o que essa pessoa vê e pode fazer no sistema.`
            : ""
        }
        rotuloConfirmar="Alterar"
        confirmando={processandoAcao}
        aoConfirmar={confirmarMudancaPapel}
        aoCancelar={() => setConfirmarPapel(null)}
      />
    </div>
  );
}
