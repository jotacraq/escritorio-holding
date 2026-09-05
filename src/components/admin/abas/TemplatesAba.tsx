"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { Botao } from "@/components/ui/Botao";
import { AreaTexto, Campo, Entrada, Opcao, Selecao } from "@/components/ui/Campo";
import { Cartao } from "@/components/ui/Cartao";
import { ConfirmarAcao } from "@/components/ui/ConfirmarAcao";
import { EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Selo } from "@/components/ui/Selo";
import { formatarData } from "@/lib/formatar";
import { ativarTemplate, criarTemplateVersao, listarTemplates } from "../adminApi";
import { mensagemDeErro } from "../http";
import { IntroAba, SeloAtivo } from "../comum";
import type { CanalMensagemAdmin, MensagemTemplateAdmin } from "@/types/admin";

const ROTULO_CHAVE: Record<string, string> = {
  boas_vindas: "Boas-vindas",
  confirmacao_d7: "Confirmação D-7",
  dia_da_sessao: "Dia da sessão (link da sala)",
  pos_sessao: "Material pós-sessão",
  croqui_convite: "Convite do croqui",
  agendamento_link: "Link de agendamento",
};

function rotuloChave(chave: string): string {
  return ROTULO_CHAVE[chave] ?? chave.replace(/_/g, " ");
}

function formularioVazio(chave = "", canal: CanalMensagemAdmin = "email") {
  return { chave, canal, assunto: "", corpo: "", ativar: false };
}

/** Agrupa por (chave, canal) — cada grupo é uma linha do tempo de versões. */
function agrupar(itens: MensagemTemplateAdmin[]) {
  const grupos = new Map<string, MensagemTemplateAdmin[]>();
  for (const item of itens) {
    const id = `${item.chave}::${item.canal}`;
    if (!grupos.has(id)) grupos.set(id, []);
    grupos.get(id)!.push(item);
  }
  return grupos;
}

/**
 * Template é dado versionado: uma versão nova nunca substitui a anterior —
 * é criada e, se marcada, promovida a ativa. A tela nunca edita texto em uso.
 */
export function TemplatesAba() {
  const buscar = useCallback(() => listarTemplates(), []);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, []);
  const { notificar } = useToast();

  const [novo, setNovo] = useState<ReturnType<typeof formularioVazio> | null>(null);
  const [erros, setErros] = useState<{ chave?: string; corpo?: string }>({});
  const [salvando, setSalvando] = useState(false);
  const [confirmarAtivar, setConfirmarAtivar] = useState<MensagemTemplateAdmin | null>(null);
  const [expandida, setExpandida] = useState<string | null>(null);

  const grupos = useMemo(() => (dados ? agrupar(dados.itens) : new Map<string, MensagemTemplateAdmin[]>()), [dados]);

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar os templates" />;
  if (carregando && !dados) return <EsqueletoLista linhas={4} rotulo="Carregando templates…" />;
  if (!dados) return null;

  async function salvarNovo(evento: FormEvent) {
    evento.preventDefault();
    if (!novo) return;
    const e: typeof erros = {};
    if (!/^[a-z][a-z0-9_]{1,49}$/.test(novo.chave.trim())) e.chave = "Minúsculas, dígitos e _ (ex.: boas_vindas).";
    if (!novo.corpo.trim()) e.corpo = "Escreva o texto da mensagem.";
    setErros(e);
    if (Object.keys(e).length > 0) return;
    setSalvando(true);
    try {
      await criarTemplateVersao({
        chave: novo.chave.trim(),
        canal: novo.canal,
        assunto: novo.canal === "email" ? novo.assunto.trim() || null : null,
        corpo: novo.corpo,
        ativar: novo.ativar,
      });
      notificar({ tom: "sucesso", titulo: novo.ativar ? "Versão criada e ativada" : "Versão criada", descricao: `${rotuloChave(novo.chave)} (${novo.canal === "email" ? "e-mail" : "WhatsApp"}).` });
      setNovo(null);
      recarregar();
    } catch (err) {
      notificar({ tom: "erro", titulo: "Não foi possível criar a versão", descricao: mensagemDeErro(err, "Tente de novo em instantes.") });
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarAtivarVersao() {
    if (!confirmarAtivar) return;
    setSalvando(true);
    try {
      await ativarTemplate(confirmarAtivar.id);
      notificar({ tom: "sucesso", titulo: "Versão ativada", descricao: `${rotuloChave(confirmarAtivar.chave)} v${confirmarAtivar.versao} em uso.` });
      setConfirmarAtivar(null);
      recarregar();
    } catch (err) {
      notificar({ tom: "erro", titulo: "Não foi possível ativar", descricao: mensagemDeErro(err, "Tente de novo em instantes.") });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <IntroAba>
          O texto de cada mensagem da régua, por canal. Versão nova nunca substitui a anterior: ela é criada e, se marcada, passa a valer. O que já
          saiu guarda o texto que foi enviado.
        </IntroAba>
        {!novo && (
          <Botao variante="primario" onClick={() => setNovo(formularioVazio())}>
            Novo template
          </Botao>
        )}
      </div>

      {novo && (
        <Cartao rotulo="Nova versão" titulo={novo.chave ? rotuloChave(novo.chave) : "Template"} descricao="Não altera a versão em uso.">
          <form noValidate onSubmit={salvarNovo} className="flex flex-col gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Campo rotulo="Chave" obrigatorio erro={erros.chave} ajuda="Identificador que a régua usa (boas_vindas, confirmacao_d7…).">
                <Entrada value={novo.chave} onChange={(e) => setNovo({ ...novo, chave: e.target.value })} autoComplete="off" />
              </Campo>
              <Campo rotulo="Canal" obrigatorio>
                <Selecao value={novo.canal} onChange={(e) => setNovo({ ...novo, canal: e.target.value as CanalMensagemAdmin })}>
                  <option value="email">E-mail</option>
                  <option value="whatsapp">WhatsApp</option>
                </Selecao>
              </Campo>
            </div>
            {novo.canal === "email" && (
              <Campo rotulo="Assunto" extra="opcional">
                <Entrada value={novo.assunto} onChange={(e) => setNovo({ ...novo, assunto: e.target.value })} />
              </Campo>
            )}
            <Campo rotulo="Texto" obrigatorio erro={erros.corpo} ajuda="Campos entre chaves duplas são preenchidos na hora: {{primeiro_nome}}, {{data_sessao}}, {{link_sala}}, {{link_confirmacao}}, {{link_material}}.">
              <AreaTexto rows={8} value={novo.corpo} onChange={(e) => setNovo({ ...novo, corpo: e.target.value })} />
            </Campo>
            <Opcao tipo="checkbox" rotulo="Ativar assim que criar" descricao="Mensagens agendadas a partir de agora usam este texto." checked={novo.ativar} onChange={(e) => setNovo({ ...novo, ativar: e.target.checked })} />
            <div className="flex flex-wrap justify-end gap-2">
              <Botao variante="fantasma" onClick={() => setNovo(null)}>
                Cancelar
              </Botao>
              <Botao type="submit" variante="primario" carregando={salvando}>
                Criar versão
              </Botao>
            </div>
          </form>
        </Cartao>
      )}

      {grupos.size === 0 && !novo && <EstadoVazio ilustracao="lista" titulo="Nenhum template cadastrado" descricao="Sem template ativo, a régua não tem texto para enviar." />}

      {Array.from(grupos.entries()).map(([id, versoes]) => {
        const [chave, canal] = id.split("::");
        const ativa = versoes.find((v) => v.ativo);
        return (
          <Cartao
            key={id}
            preenchimento="sem"
            rotulo={canal === "email" ? "E-mail" : "WhatsApp"}
            titulo={rotuloChave(chave)}
            descricao={ativa ? `Em uso: v${ativa.versao}, criada em ${formatarData(ativa.criado_em)}` : "Nenhuma versão em uso — a régua não envia esta mensagem."}
            acao={
              <>
                {!ativa && <Selo tom="ambar">Sem versão ativa</Selo>}
                <Botao variante="secundario" tamanho="compacto" onClick={() => setNovo({ ...formularioVazio(chave, canal as CanalMensagemAdmin), assunto: ativa?.assunto ?? "", corpo: ativa?.corpo ?? "" })}>
                  Nova versão
                </Botao>
              </>
            }
          >
            <ul className="divide-y divide-linha">
              {versoes.map((versao) => (
                <li key={versao.id} className="flex flex-col gap-2 px-5 py-4 sm:px-6">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-tinta">
                        v{versao.versao}
                        <SeloAtivo ativo={versao.ativo} rotuloAtivo="Em uso" rotuloInativo="Histórico" />
                        <span className="text-xs font-normal text-tinta-fraca">criada em {formatarData(versao.criado_em)}</span>
                      </p>
                      {versao.assunto && <p className="text-sm text-tinta-suave">Assunto: {versao.assunto}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpandida(expandida === versao.id ? null : versao.id)}
                      aria-expanded={expandida === versao.id}
                      className="min-h-11 text-sm font-medium text-[color:var(--latao)] underline-offset-2 hover:underline"
                    >
                      {expandida === versao.id ? "Esconder o texto" : "Ver o texto"}
                    </button>
                    {!versao.ativo && (
                      <Botao variante="secundario" tamanho="compacto" onClick={() => setConfirmarAtivar(versao)}>
                        Usar esta versão
                      </Botao>
                    )}
                  </div>
                  {expandida === versao.id ? (
                    <p className="whitespace-pre-wrap rounded-controle bg-papel px-4 py-3 text-sm leading-relaxed text-tinta">{versao.corpo}</p>
                  ) : (
                    <p className="line-clamp-2 whitespace-pre-wrap text-sm text-tinta-suave">{versao.corpo}</p>
                  )}
                </li>
              ))}
            </ul>
          </Cartao>
        );
      })}

      <ConfirmarAcao
        aberto={confirmarAtivar !== null}
        titulo="Usar esta versão"
        efeito={`Substitui imediatamente a versão em uso de "${confirmarAtivar ? rotuloChave(confirmarAtivar.chave) : ""}" (${confirmarAtivar?.canal === "email" ? "e-mail" : "WhatsApp"}). Mensagens agendadas a partir de agora usam este texto.`}
        rotuloConfirmar="Usar esta versão"
        confirmando={salvando}
        aoConfirmar={confirmarAtivarVersao}
        aoCancelar={() => setConfirmarAtivar(null)}
      />
    </div>
  );
}
