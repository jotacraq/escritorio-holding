"use client";

import { useCallback, useState } from "react";
import { emitirLink, listarLinks, listarMateriais, revogarLink, ErroFicha360Api } from "@/components/ficha360/api";
import type { LinkPublicoResumo, TipoLinkPublico } from "@/types/publico";
import { useRecurso } from "@/hooks/useRecurso";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Botao } from "@/components/ui/Botao";
import { Selo } from "@/components/ui/Selo";
import { AvisoInline } from "@/components/admin/AvisoInline";
import { ConfirmarAcao } from "@/components/admin/ConfirmarAcao";
import { formatarDataHora } from "@/lib/formatar";

const ROTULOS_TIPO: Record<TipoLinkPublico, string> = {
  formulario: "Formulário",
  agendamento: "Agendamento",
  documentos: "Documentos",
  material: "Material",
};

const TIPOS: TipoLinkPublico[] = ["formulario", "agendamento", "documentos", "material"];

function tomEstado(estado: LinkPublicoResumo["estado"]): "verde" | "vermelho" | "azul" | "neutro" {
  if (estado === "ativo") return "verde";
  if (estado === "usado") return "azul";
  return "neutro";
}

const ROTULOS_ESTADO: Record<LinkPublicoResumo["estado"], string> = {
  ativo: "Ativo",
  usado: "Usado",
  expirado: "Expirado",
  revogado: "Revogado",
};

export function LinksAba({ jornadaId }: { jornadaId: string }) {
  const buscar = useCallback(() => listarLinks(jornadaId), [jornadaId]);
  const { dados: links, carregando, erro, recarregar } = useRecurso(buscar, [jornadaId]);
  // Estado de aprovação do material, só para avisar antes de emitir o link do
  // tipo "material" — não bloqueia a aba se essa busca falhar (o servidor já
  // recusa o link não aprovado; isto aqui é só o aviso na tela). Dois motivos
  // fazem o link de Material não funcionar hoje: nenhum material foi gerado
  // ainda, ou o material atual existe mas não tem `aprovado_em`.
  const buscarMaterial = useCallback(() => listarMateriais(jornadaId), [jornadaId]);
  const { dados: material } = useRecurso(buscarMaterial, [jornadaId]);
  const materialInexistente = material !== undefined && !material.atual;
  const materialPendente = Boolean(material?.atual) && !material?.atual?.aprovado_em;
  const materialNaoDisponivel = materialInexistente || materialPendente;

  const [emitindo, setEmitindo] = useState<TipoLinkPublico | null>(null);
  const [revogando, setRevogando] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [linkRecemEmitido, setLinkRecemEmitido] = useState<{ tipo: TipoLinkPublico; url: string; aviso: string | null; horariosOfertados: number | null } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [confirmandoMaterial, setConfirmandoMaterial] = useState(false);

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar os links" />;
  if (carregando) return <EstadoCarregando rotulo="Carregando links…" />;

  async function emitir(tipo: TipoLinkPublico) {
    setEmitindo(tipo);
    setErroAcao(null);
    setLinkRecemEmitido(null);
    setCopiado(false);
    try {
      const res = await emitirLink(jornadaId, tipo);
      setLinkRecemEmitido({
        tipo,
        url: res.link.url,
        aviso: res.aviso ?? null,
        horariosOfertados: res.horarios_ofertados ?? null,
      });
      recarregar();
    } catch (e) {
      setErroAcao(e instanceof ErroFicha360Api ? e.message : "Não foi possível emitir o link.");
    } finally {
      setEmitindo(null);
    }
  }

  function aoClicarEmitir(tipo: TipoLinkPublico) {
    if (tipo === "material" && materialNaoDisponivel) {
      setConfirmandoMaterial(true);
      return;
    }
    emitir(tipo);
  }

  function confirmarEmissaoMaterial() {
    setConfirmandoMaterial(false);
    emitir("material");
  }

  async function revogar(id: string) {
    setRevogando(id);
    setErroAcao(null);
    try {
      await revogarLink(id);
      recarregar();
    } catch (e) {
      setErroAcao(e instanceof ErroFicha360Api ? e.message : "Não foi possível revogar o link.");
    } finally {
      setRevogando(null);
    }
  }

  async function copiar(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  }

  return (
    <div className="nao-imprimir flex flex-col gap-5">
      <p className="text-xs text-tinta-fraca">
        Emitir um link novo revoga o anterior do mesmo tipo. O endereço com o token aparece <strong>uma única vez</strong>, aqui embaixo, na hora da emissão — depois só o prefixo fica visível.
      </p>

      {linkRecemEmitido && (
        <div role="alert" className="flex flex-col gap-2 rounded-sm border-2 border-ambar-borda bg-ambar-fraco px-3.5 py-3">
          <p className="text-sm font-semibold text-[color:var(--ambar)]">
            Link de {ROTULOS_TIPO[linkRecemEmitido.tipo]} emitido — copie agora, esta é a única vez que ele aparece.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="flex-1 break-all rounded-sm bg-papel-elevado px-2 py-1.5 text-xs text-tinta">{linkRecemEmitido.url}</code>
            <Botao variante="secundario" className="text-xs" onClick={() => copiar(linkRecemEmitido.url)}>
              {copiado ? "Copiado!" : "Copiar"}
            </Botao>
          </div>
          {linkRecemEmitido.tipo === "agendamento" && (
            <p className={`text-xs ${linkRecemEmitido.horariosOfertados ? "text-[color:var(--ambar)]" : "text-[color:var(--vermelho)]"}`}>
              {linkRecemEmitido.horariosOfertados
                ? `${linkRecemEmitido.horariosOfertados} horário(s) ofertado(s) ao cliente.`
                : "Nenhum horário ofertado — a página do cliente abriria vazia."}
              {linkRecemEmitido.aviso && ` ${linkRecemEmitido.aviso}`}
            </p>
          )}
        </div>
      )}

      {erroAcao && <p role="alert" className="text-sm text-[color:var(--vermelho)]">{erroAcao}</p>}

      {materialNaoDisponivel && (
        <AvisoInline tom="aviso">
          {materialInexistente
            ? 'Esta jornada ainda não tem material gerado — se você emitir o link agora, o cliente vai receber "link não disponível" até alguém gerar e aprovar o material na aba Material.'
            : 'O material desta jornada ainda não foi aprovado — se você emitir o link agora, o cliente vai receber "link não disponível" até alguém aprovar o material na aba Material.'}
        </AvisoInline>
      )}

      <div className="flex flex-wrap gap-2">
        {TIPOS.map((tipo) => (
          <Botao key={tipo} variante="secundario" carregando={emitindo === tipo} onClick={() => aoClicarEmitir(tipo)} className="text-xs">
            Emitir link de {ROTULOS_TIPO[tipo]}
          </Botao>
        ))}
      </div>

      <ConfirmarAcao
        aberto={confirmandoMaterial}
        titulo="Emitir link de Material sem aprovação?"
        efeito={
          materialInexistente
            ? "Esta jornada ainda não tem material gerado. Se você emitir o link agora, ele fica pronto para enviar, mas o cliente vai receber a mensagem “link não disponível” até alguém gerar e aprovar o material na aba Material. Emitir mesmo assim?"
            : "O material desta jornada ainda não foi aprovado. Se você emitir o link agora, ele fica pronto para enviar, mas o cliente vai receber a mensagem “link não disponível” até alguém aprovar o material na aba Material. Emitir mesmo assim?"
        }
        rotuloConfirmar="Emitir mesmo assim"
        confirmando={emitindo === "material"}
        aoConfirmar={confirmarEmissaoMaterial}
        aoCancelar={() => setConfirmandoMaterial(false)}
      />

      {!links || links.length === 0 ? (
        <EstadoVazio titulo="Nenhum link emitido para esta jornada" />
      ) : (
        <ul className="flex flex-col gap-2">
          {links.map((link) => (
            <li key={link.id} className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-linha bg-papel-fundo px-3 py-2 text-sm">
              <div>
                <p className="font-medium text-tinta">
                  {ROTULOS_TIPO[link.tipo]} <span className="font-mono text-xs text-tinta-fraca">({link.token_prefixo}…)</span>
                </p>
                <p className="text-xs text-tinta-fraca">
                  Emitido em {formatarDataHora(link.criado_em)} · expira em {formatarDataHora(link.expira_em)} · {link.usos} uso(s)
                  {link.revogado_em && ` · revogado em ${formatarDataHora(link.revogado_em)}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Selo tom={tomEstado(link.estado)}>{ROTULOS_ESTADO[link.estado]}</Selo>
                {link.estado === "ativo" && (
                  <Botao variante="perigo" className="text-xs" carregando={revogando === link.id} onClick={() => revogar(link.id)}>
                    Revogar
                  </Botao>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
