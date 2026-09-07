"use client";

import { useCallback, useState, type FormEvent } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { Botao } from "@/components/ui/Botao";
import { Campo, Entrada, Selecao } from "@/components/ui/Campo";
import { Cartao } from "@/components/ui/Cartao";
import { ConfirmarAcao } from "@/components/ui/ConfirmarAcao";
import { EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Selo } from "@/components/ui/Selo";
import { formatarDataHora } from "@/lib/formatar";
import { atualizarPerfilEquipe, criarConviteEquipe, listarEquipe, reenviarConviteEquipe } from "../adminApi";
import { mensagemDeErro } from "../http";
import { Tabela, type ColunaTabela } from "@/components/ui/Tabela";
import { IntroAba, SeloAtivo } from "../comum";
import type { PapelEquipe, PerfilEquipeAdmin } from "@/types/admin";

const ROTULO_PAPEL: Record<PapelEquipe, string> = {
  admin: "Admin",
  advogada: "Advogada",
  relacionamento: "Relacionamento",
  assistente: "Assistente",
};

const PAPEIS: PapelEquipe[] = ["admin", "advogada", "relacionamento", "assistente"];

interface Rascunho {
  nome: string;
  email: string;
  papel: PapelEquipe;
}

type ConfirmacaoDesativar = { perfil: PerfilEquipeAdmin } | null;
type ConfirmacaoPapel = { perfil: PerfilEquipeAdmin; novoPapel: PapelEquipe } | null;

/**
 * Acesso é por convite: criar a linha aqui sempre funciona; o e-mail de
 * convite depende de `SUPABASE_SERVICE_ROLE_KEY` — quando não sai, a linha
 * fica pronta para entregar o acesso por fora (CONFLITO C15).
 */
export function EquipeAba() {
  const buscar = useCallback(() => listarEquipe(), []);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, []);
  const { notificar } = useToast();

  const [novo, setNovo] = useState<Rascunho | null>(null);
  const [erros, setErros] = useState<Partial<Rascunho>>({});
  const [convidando, setConvidando] = useState(false);
  const [reenviandoId, setReenviandoId] = useState<string | null>(null);
  const [confirmarDesativar, setConfirmarDesativar] = useState<ConfirmacaoDesativar>(null);
  const [confirmarPapel, setConfirmarPapel] = useState<ConfirmacaoPapel>(null);
  const [processando, setProcessando] = useState(false);

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar a equipe" />;
  if (carregando && !dados) return <EsqueletoLista linhas={4} rotulo="Carregando equipe…" />;
  if (!dados) return null;

  function avisarResultado(email: string, convite: { enviado: boolean; motivo?: string }) {
    if (convite.enviado) {
      notificar({ tom: "sucesso", titulo: "Convite enviado", descricao: email });
    } else if (convite.motivo === "service_role_ausente") {
      notificar({ tom: "aviso", titulo: "Acesso criado, e-mail não saiu", descricao: `${email} está na equipe, mas o servidor está sem SUPABASE_SERVICE_ROLE_KEY. Entregue o acesso por fora.` });
    } else {
      notificar({ tom: "aviso", titulo: "Acesso criado, e-mail falhou", descricao: `${email} está na equipe. Use "Reenviar convite" para tentar de novo.` });
    }
  }

  async function convidar(evento: FormEvent) {
    evento.preventDefault();
    if (!novo) return;
    const e: Partial<Rascunho> = {};
    if (!novo.nome.trim()) e.nome = "Informe o nome.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(novo.email.trim())) e.email = "Informe um e-mail válido.";
    setErros(e);
    if (Object.keys(e).length > 0) return;
    setConvidando(true);
    try {
      const resultado = await criarConviteEquipe({ nome: novo.nome.trim(), email: novo.email.trim(), papel: novo.papel });
      avisarResultado(resultado.perfil.email, resultado.convite);
      setNovo(null);
      recarregar();
    } catch (err) {
      notificar({ tom: "erro", titulo: "Não foi possível convidar", descricao: mensagemDeErro(err, "Tente de novo em instantes.") });
    } finally {
      setConvidando(false);
    }
  }

  async function reenviar(perfil: PerfilEquipeAdmin) {
    setReenviandoId(perfil.id);
    try {
      const resultado = await reenviarConviteEquipe(perfil.id, perfil);
      avisarResultado(perfil.email, resultado.convite);
      recarregar();
    } catch (err) {
      notificar({ tom: "erro", titulo: "Não foi possível reenviar", descricao: mensagemDeErro(err, "Tente de novo em instantes.") });
    } finally {
      setReenviandoId(null);
    }
  }

  async function mudarAtivo(perfil: PerfilEquipeAdmin, ativo: boolean) {
    setProcessando(true);
    try {
      await atualizarPerfilEquipe(perfil.id, { ativo });
      notificar({ tom: "sucesso", titulo: ativo ? "Acesso reativado" : "Acesso desativado", descricao: perfil.nome });
      setConfirmarDesativar(null);
      recarregar();
    } catch (err) {
      notificar({ tom: "erro", titulo: ativo ? "Não foi possível reativar" : "Não foi possível desativar", descricao: mensagemDeErro(err, "Tente de novo em instantes.") });
    } finally {
      setProcessando(false);
    }
  }

  async function confirmarMudancaPapel() {
    if (!confirmarPapel) return;
    setProcessando(true);
    try {
      await atualizarPerfilEquipe(confirmarPapel.perfil.id, { papel: confirmarPapel.novoPapel });
      notificar({ tom: "sucesso", titulo: "Papel alterado", descricao: `${confirmarPapel.perfil.nome} agora é ${ROTULO_PAPEL[confirmarPapel.novoPapel]}.` });
      setConfirmarPapel(null);
      recarregar();
    } catch (err) {
      notificar({ tom: "erro", titulo: "Não foi possível alterar o papel", descricao: mensagemDeErro(err, "Tente de novo em instantes.") });
    } finally {
      setProcessando(false);
    }
  }

  /* Fase 8 §C3 M2: uma descrição de colunas serve a grade do desktop e o
     cartão do celular. O `<select>` de papel continua na linha — é a mesma
     ação, no mesmo lugar, nas duas formas (M7). */
  const colunas: readonly ColunaTabela<PerfilEquipeAdmin>[] = [
    { chave: "nome", cabecalho: "Nome", celula: (p) => p.nome },
    { chave: "email", cabecalho: "E-mail", celula: (p) => <span className="break-all">{p.email}</span> },
    {
      chave: "papel",
      cabecalho: "Papel",
      celula: (p) => (
        <Selecao
          aria-label={`Papel de ${p.nome}`}
          value={p.papel}
          className="sm:w-44"
          onChange={(e) => setConfirmarPapel({ perfil: p, novoPapel: e.target.value as PapelEquipe })}
        >
          {PAPEIS.map((papel) => (
            <option key={papel} value={papel}>
              {ROTULO_PAPEL[papel]}
            </option>
          ))}
        </Selecao>
      ),
    },
    { chave: "estado", cabecalho: "Estado", celula: (p) => <SeloAtivo ativo={p.ativo} rotuloAtivo="Ativo" rotuloInativo="Desativado" /> },
    {
      chave: "convite",
      cabecalho: "Convite",
      celula: (p) => (p.convite_enviado_em ? `enviado em ${formatarDataHora(p.convite_enviado_em)}` : <Selo tom="ambar">não enviado</Selo>),
    },
  ];

  return (
    <div className="flex flex-col gap-bloco">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <IntroAba>Só admin e advogada veem patrimônio; relacionamento vê a lista de clientes e a comunicação.</IntroAba>
        {!novo && (
          <Botao variante="primario" onClick={() => setNovo({ nome: "", email: "", papel: "relacionamento" })}>
            Convidar
          </Botao>
        )}
      </div>

      {novo && (
        <Cartao rotulo="Convite" titulo="Nova pessoa na equipe" descricao="A linha é criada na hora; o e-mail de convite sai se o servidor tiver a chave de envio.">
          <form noValidate onSubmit={convidar} className="flex flex-col gap-5">
            <div className="grid gap-5 sm:grid-cols-3">
              <Campo rotulo="Nome" obrigatorio erro={erros.nome}>
                <Entrada value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} autoComplete="name" />
              </Campo>
              <Campo rotulo="E-mail" obrigatorio erro={erros.email}>
                <Entrada type="email" inputMode="email" value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} autoComplete="email" />
              </Campo>
              <Campo rotulo="Papel" obrigatorio>
                <Selecao value={novo.papel} onChange={(e) => setNovo({ ...novo, papel: e.target.value as PapelEquipe })}>
                  {PAPEIS.map((p) => (
                    <option key={p} value={p}>
                      {ROTULO_PAPEL[p]}
                    </option>
                  ))}
                </Selecao>
              </Campo>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Botao variante="fantasma" onClick={() => setNovo(null)}>
                Cancelar
              </Botao>
              <Botao type="submit" variante="primario" carregando={convidando}>
                Convidar
              </Botao>
            </div>
          </form>
        </Cartao>
      )}

      <Cartao preenchimento="sem">
        <div className="px-cartao py-item">
          <Tabela
            legenda="Equipe com papel, estado e convite"
            colunas={colunas}
            linhas={dados.itens}
            chaveDaLinha={(p) => p.id}
            tituloDoCartao={(p) => p.nome}
            vazio={<EstadoVazio ilustracao="lista" titulo="Ninguém na equipe ainda" descricao="Convide a Dra. Elaine e a equipe de relacionamento." />}
            acoes={(perfil) => (
              <>
                <Botao variante="fantasma" tamanho="compacto" carregando={reenviandoId === perfil.id} onClick={() => reenviar(perfil)}>
                  Reenviar convite
                </Botao>
                {perfil.ativo ? (
                  <Botao variante="perigo" tamanho="compacto" onClick={() => setConfirmarDesativar({ perfil })}>
                    Desativar
                  </Botao>
                ) : (
                  <Botao variante="secundario" tamanho="compacto" carregando={processando} onClick={() => mudarAtivo(perfil, true)}>
                    Reativar
                  </Botao>
                )}
              </>
            )}
          />
        </div>
      </Cartao>

      <ConfirmarAcao
        aberto={confirmarDesativar !== null}
        titulo="Desativar acesso"
        efeito={`Desativa o acesso de ${confirmarDesativar?.perfil.nome} imediatamente — a pessoa não consegue mais entrar no sistema até ser reativada.`}
        rotuloConfirmar="Desativar"
        perigo
        confirmando={processando}
        aoConfirmar={() => confirmarDesativar && mudarAtivo(confirmarDesativar.perfil, false)}
        aoCancelar={() => setConfirmarDesativar(null)}
      />

      <ConfirmarAcao
        aberto={confirmarPapel !== null}
        titulo="Alterar papel"
        efeito={
          confirmarPapel
            ? `Muda o papel de ${confirmarPapel.perfil.nome} de ${ROTULO_PAPEL[confirmarPapel.perfil.papel]} para ${ROTULO_PAPEL[confirmarPapel.novoPapel]} — muda na hora o que essa pessoa vê e pode fazer.`
            : ""
        }
        rotuloConfirmar="Alterar"
        confirmando={processando}
        aoConfirmar={confirmarMudancaPapel}
        aoCancelar={() => setConfirmarPapel(null)}
      />
    </div>
  );
}
