"use client";

import { useCallback, useMemo, useState } from "react";
import { emitirLinkDeEnvio, listarLinks, ErroFicha360Api } from "@/components/ficha360/api";
import { derivarEnvios, type ItemEnvio, type TipoEnvio } from "@/lib/pasta/envios";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { formatarData } from "@/lib/formatar";
import type { Ficha360 } from "@/lib/api";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { ConfirmarAcao } from "@/components/ui/ConfirmarAcao";
import { EstadoCarregando, EstadoErro } from "@/components/ui/Estado";
import { Gaveta } from "@/components/ui/Gaveta";
import { Selo, type TomSelo } from "@/components/ui/Selo";
import { LinksAba } from "./LinksAba";

/**
 * A barra "Enviar" da Ficha (Fase 6 §5.4/§5.5).
 *
 * O pedido, literal: *"ele tem que preencher o formulário, aí CADÊ O LINK pra
 * eu mandar o formulário? Eu tenho que ficar caçando onde está o link."*
 * Antes: Pasta -> cartão Links -> gaveta -> "Emitir link de Formulário" ->
 * caixa âmbar -> "Copiar". Agora: um clique, aqui, sempre à vista.
 *
 * ------------------------------------------------------------------
 * POR QUE NEM SEMPRE É UM CLIQUE — e por que isso não é preguiça de UI
 *
 * O banco guarda o HASH do token, não o token (0028:70-73): o endereço
 * completo existe uma única vez, na resposta da emissão. E emitir um link novo
 * REVOGA o anterior do mesmo tipo, na mesma transação (0028:829-833). Logo:
 *   - sem link ativo -> 1 clique: emite, copia, avisa. É o caso do João.
 *   - com link ativo -> "Copiar link novo" + confirmação de UMA linha, porque
 *                       o link que já está no WhatsApp do cliente para de
 *                       funcionar. Dois cliques só quando algo se perde.
 * Não existe "copiar de novo" — e a tela diz isso, em vez de esconder.
 * ------------------------------------------------------------------
 *
 * Zero requisição nova: `derivarEnvios` (pura) cruza a listagem de links que
 * esta barra já busca com a `Ficha360` que a página já tem. A gaveta "Todos os
 * links" recebe a MESMA listagem por prop — um fetch para a tela inteira, e um
 * único caminho de emissão na UI.
 */

const TOM_ESTADO: Record<ItemEnvio["estado"], TomSelo> = {
  nao_emitido: "neutro",
  ativo: "verde",
  consumido: "azul",
  expirado: "ambar",
  revogado: "neutro",
  indisponivel: "neutro",
};

const ROTULO_ESTADO: Record<ItemEnvio["estado"], string> = {
  nao_emitido: "Não emitido",
  ativo: "Ativo",
  consumido: "Consumido",
  expirado: "Expirado",
  revogado: "Revogado",
  indisponivel: "Indisponível",
};

/** Glifo por estado — estado nunca é só cor (DS §6). */
const GLIFO_ESTADO: Record<ItemEnvio["estado"], string> = {
  nao_emitido: "○",
  ativo: "✓",
  consumido: "✓",
  expirado: "!",
  revogado: "×",
  indisponivel: "—",
};

interface ResultadoEnvio {
  tipo: TipoEnvio;
  url: string;
  copiado: boolean;
  aviso: string | null;
  horariosOfertados: number | null;
}

export function BarraEnviar({ jornadaId, ficha }: { jornadaId: string; ficha: Ficha360 }) {
  // O instante em que a listagem foi LIDA — é com ele que `derivarEnvios`
  // decide o que já venceu. Ler o relógio durante o render seria impuro (o
  // mesmo render devolveria estados diferentes a cada repintura); aqui o
  // carimbo é do fato, não do desenho.
  const [lidoEm, setLidoEm] = useState<number | null>(null);
  const buscar = useCallback(async () => {
    const itens = await listarLinks(jornadaId);
    setLidoEm(Date.now());
    return itens;
  }, [jornadaId]);
  const { dados: links, carregando, erro, recarregar } = useRecurso(buscar, [jornadaId]);
  const { notificar } = useToast();

  const [emitindo, setEmitindo] = useState<TipoEnvio | null>(null);
  const [confirmando, setConfirmando] = useState<ItemEnvio | null>(null);
  const [resultado, setResultado] = useState<ResultadoEnvio | null>(null);
  const [motivoDoServidor, setMotivoDoServidor] = useState<Partial<Record<TipoEnvio, string>>>({});
  const [todosOsLinks, setTodosOsLinks] = useState(false);

  const envios = useMemo(
    () => (links && lidoEm !== null ? derivarEnvios(links, ficha, lidoEm, { motivoDoServidor }) : []),
    [links, lidoEm, ficha, motivoDoServidor],
  );

  async function emitirECopiar(item: ItemEnvio) {
    setEmitindo(item.tipo);
    setResultado(null);
    try {
      const res = await emitirLinkDeEnvio(jornadaId, item.tipo);
      const url = res.link.url;
      let copiado = false;
      try {
        await navigator.clipboard.writeText(url);
        copiado = true;
      } catch {
        // Contexto não seguro ou permissão negada. Antes isto era engolido em
        // silêncio (LinksAba: só `setCopiado(false)`) e o operador achava que
        // tinha copiado. Agora vira toast de erro E o endereço fica na tela,
        // selecionável — o token só aparece uma vez, perdê-lo é caro.
        copiado = false;
      }
      setResultado({
        tipo: item.tipo,
        url,
        copiado,
        aviso: res.aviso ?? null,
        horariosOfertados: res.horarios_ofertados ?? null,
      });
      setMotivoDoServidor((m) => {
        const resto = { ...m };
        delete resto[item.tipo];
        return resto;
      });
      notificar(
        copiado
          ? {
              tom: "sucesso",
              titulo: `Link ${item.rotulo.toLowerCase()} copiado`,
              descricao: "Cole no WhatsApp ou no e-mail do cliente.",
            }
          : {
              tom: "erro",
              titulo: "O navegador bloqueou a cópia",
              descricao: "O endereço está na tela, logo abaixo. Selecione e copie à mão antes de sair.",
            },
      );
      recarregar();
    } catch (e) {
      const mensagem = e instanceof ErroFicha360Api ? e.message : "Não foi possível gerar o link.";
      // A frase do SERVIDOR (503 sem service role, 409 sem agendamento) entra
      // em `derivarEnvios` e passa a rotular a linha: a tela mostra o motivo
      // real, nunca promete o que não vai entregar.
      setMotivoDoServidor((m) => ({ ...m, [item.tipo]: mensagem }));
      notificar({ tom: "erro", titulo: `Não deu para gerar o link ${item.rotulo.toLowerCase()}`, descricao: mensagem });
    } finally {
      setEmitindo(null);
      setConfirmando(null);
    }
  }

  function aoClicar(item: ItemEnvio) {
    if (item.substituiAtivo) {
      setConfirmando(item);
      return;
    }
    emitirECopiar(item);
  }

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar os links desta pessoa" />;
  if (carregando && !links) return <EstadoCarregando rotulo="Carregando os links…" />;

  // Jornada encerrada bloqueia os CINCO tipos pelo MESMO motivo (a RPC recusa,
  // 0028:816-818) — e a barra virava cinco cartões repetindo a mesma frase.
  // Cinco vezes a mesma informação não é informação, é ruído: vira uma linha.
  const motivoUnico =
    envios.length > 0 && envios.every((e) => e.estado === "indisponivel" && e.motivo && e.motivo === envios[0].motivo)
      ? envios[0].motivo
      : null;

  return (
    <Cartao
      como="section"
      rotulo="Enviar ao cliente"
      titulo="Links desta pessoa"
      preenchimento="compacto"
      acao={
        <Botao variante="fantasma" tamanho="compacto" onClick={() => setTodosOsLinks(true)}>
          Todos os links
        </Botao>
      }
    >
      <div className="nao-imprimir flex flex-col gap-item">
        {motivoUnico ? (
          <p className="flex min-h-11 flex-wrap items-center gap-item rounded-controle border border-dashed border-linha bg-papel-fundo px-3 py-2 text-sm text-tinta-suave">
            <span aria-hidden="true">—</span>
            <span>{motivoUnico}</span>
            <span className="text-legenda text-tinta-fraca">Nenhum link novo pode ser enviado.</span>
          </p>
        ) : (
        <ul className="grid gap-item sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {envios.map((item) => {
            const ocupado = emitindo === item.tipo;
            return (
              <li key={item.tipo} data-envio={item.tipo} className="flex min-w-0 flex-col gap-1 rounded-controle border border-linha bg-papel-fundo px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                  <p className="text-sm font-bold text-tinta">{item.rotulo}</p>
                  <Selo tom={TOM_ESTADO[item.estado]}>
                    <span aria-hidden="true" className="mr-1">
                      {GLIFO_ESTADO[item.estado]}
                    </span>
                    {ROTULO_ESTADO[item.estado]}
                    {item.estado === "ativo" && item.expiraEm ? ` · expira ${formatarData(item.expiraEm)}` : ""}
                  </Selo>
                </div>
                {/* O motivo vai NA TELA, não só no `title`: quem opera não passa
                    o mouse em cada botão para descobrir por que não funciona. */}
                {/* Uma linha. A frase inteira fica no `title` e no `aria-label`
                    do botao: o motivo precisa ser LIDO, nao ocupar tres linhas
                    em cinco cartoes ao mesmo tempo. */}
                {item.motivo && (
                  <p className="truncate text-legenda text-tinta-suave" title={item.motivo}>
                    {item.motivo}
                  </p>
                )}
                {/* Secundário de propósito: cinco CTAs laranja lado a lado
                    brigariam entre si e com o botão da ação de agora, que é o
                    ÚNICO primário da ficha (DS §3, "um primário por tela"). */}
                <Botao
                  variante="secundario"
                  tamanho="compacto"
                  largo
                  disabled={!item.podeEmitir}
                  carregando={ocupado}
                  aria-label={`Copiar link ${item.rotulo.toLowerCase()} de ${ficha.pessoa.nome}${item.motivo ? ` — ${item.motivo}` : ""}`}
                  onClick={() => aoClicar(item)}
                >
                  {item.substituiAtivo ? "Copiar link novo" : "Copiar link"}
                </Botao>
              </li>
            );
          })}
        </ul>
        )}

        {resultado && (
          <div
            role="alert"
            className={`flex flex-col gap-1 rounded-controle border px-3 py-2 ${
              resultado.copiado ? "border-linha-forte bg-papel-fundo" : "border-ambar-borda bg-ambar-fraco"
            }`}
          >
            <p className="text-sm font-bold text-tinta">
              {resultado.copiado ? "Copiado. Este endereço não volta a aparecer." : "Copie agora — este endereço não volta a aparecer."}
            </p>
            <code className="break-all rounded-controle bg-papel-elevado px-2 py-1 text-legenda text-tinta">{resultado.url}</code>
            {resultado.tipo === "agendamento" && (
              <p className={`text-legenda ${resultado.horariosOfertados ? "text-tinta-suave" : "text-[color:var(--vermelho)]"}`}>
                {resultado.horariosOfertados
                  ? `${resultado.horariosOfertados} horário(s) ofertado(s) ao cliente.`
                  : "Nenhum horário ofertado — a página do cliente abriria vazia."}
                {resultado.aviso ? ` ${resultado.aviso}` : ""}{" "}
                <a href="/agenda#disponibilidade" className="font-medium text-[color:var(--latao)] underline underline-offset-2">
                  Abrir a disponibilidade da equipe
                </a>
              </p>
            )}
            {/* Fase 7 — a frase dizia "até 5 arquivos por link", um número
                CRAVADO aqui. Desde a 0075 o limite é UM só, e vem do banco:
                `configuracoes['link.limite_arquivos']`, lido por
                `app.limite_arquivos_por_link()` — o mesmo número que a RPC
                aplica e que viaja no `limite_arquivos` do payload até a página
                do cliente. Uma tela da equipe não pode afirmar um número que
                ela não mede, e a Dra. Elaine pode mudá-lo em Admin sem deploy:
                quem sabe o limite é a página do cliente, que o recebe do
                servidor a cada abertura. */}
            {resultado.tipo === "documentos" && <p className="text-legenda text-tinta-suave">O limite de arquivos aparece para o cliente na própria página de envio.</p>}
          </div>
        )}
      </div>

      <ConfirmarAcao
        aberto={confirmando !== null}
        titulo={confirmando ? `Gerar um link ${confirmando.rotulo.toLowerCase()} novo?` : ""}
        efeito="O link anterior deixa de funcionar. O cliente vai precisar do novo."
        rotuloConfirmar="Gerar e copiar"
        confirmando={emitindo !== null}
        aoConfirmar={() => confirmando && emitirECopiar(confirmando)}
        aoCancelar={() => setConfirmando(null)}
      />

      <Gaveta
        aberta={todosOsLinks}
        aoFechar={() => setTodosOsLinks(false)}
        rotulo={ficha.pessoa.nome}
        titulo="Todos os links"
        descricao="O histórico completo, com o prefixo de cada endereço e quem já usou. Para gerar um link, use a barra Enviar."
        largura="larga"
      >
        <LinksAba links={links ?? []} aoAtualizar={recarregar} />
      </Gaveta>
    </Cartao>
  );
}
