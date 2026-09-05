"use client";

import { useState } from "react";
import type { CondicaoOferta, Oferta } from "@/types/roteiro";
import { CHAVE_PARAMETRO, type PrecoCroqui } from "@/types/cenario";
import { ErroSessao, marcarOfertaAceita, registrarOferta } from "@/components/sessao/api";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { Campo, Entrada, Opcao } from "@/components/ui/Campo";
import { Selo, SeloStub } from "@/components/ui/Selo";
import { useToast } from "@/hooks/useToast";
import { formatarDataHora, formatarMoeda } from "@/lib/formatar";

const ROTULO_CONDICAO: Record<CondicaoOferta, string> = {
  padrao: "Preço padrão",
  incentivo_resolvedor: "Incentivo do Resolvedor",
};

const CHAVE_DA_CONDICAO: Record<CondicaoOferta, string> = {
  padrao: CHAVE_PARAMETRO.croquiPadrao,
  incentivo_resolvedor: CHAVE_PARAMETRO.croquiIncentivo,
};

/** Preço de tabela da condição — `null` quando o parâmetro não está cadastrado (B27: nunca um número de fallback). */
function precoDaCondicao(preco: PrecoCroqui | null, condicao: CondicaoOferta): number | null {
  if (!preco) return null;
  return condicao === "padrao" ? preco.padrao : preco.incentivo;
}

function LinhaOferta({ jornadaId, oferta, aoAtualizar }: { jornadaId: string; oferta: Oferta; aoAtualizar: (oferta: Oferta) => void }) {
  const [enviando, setEnviando] = useState<"sim" | "nao" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const { notificar } = useToast();

  async function decidir(aceita: boolean) {
    setErro(null);
    setEnviando(aceita ? "sim" : "nao");
    try {
      aoAtualizar(await marcarOfertaAceita(jornadaId, oferta.id, aceita));
      notificar({ tom: "sucesso", titulo: aceita ? "Oferta aceita registrada" : "Recusa registrada" });
    } catch (e) {
      setErro(e instanceof ErroSessao ? e.message : "Não deu para registrar a decisão. Tente de novo.");
    } finally {
      setEnviando(null);
    }
  }

  return (
    <li className="flex flex-col gap-2 px-5 py-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-sm font-medium text-tinta">{ROTULO_CONDICAO[oferta.condicao]}</span>
          <span className="text-subtitulo font-bold text-tinta">{formatarMoeda(oferta.valor_ofertado)}</span>
          {oferta.condicao === "incentivo_resolvedor" && <span className="text-xs text-tinta-fraca line-through">{formatarMoeda(oferta.valor_padrao)}</span>}
        </div>
        {oferta.aceita === null ? (
          <div className="flex items-center gap-2">
            <Botao variante="primario" tamanho="compacto" carregando={enviando === "sim"} disabled={enviando !== null} onClick={() => decidir(true)}>
              Sim, fechou
            </Botao>
            <Botao variante="perigo" tamanho="compacto" carregando={enviando === "nao"} disabled={enviando !== null} onClick={() => decidir(false)}>
              Não
            </Botao>
          </div>
        ) : oferta.aceita ? (
          <Selo tom="verde">Aceitou</Selo>
        ) : (
          <Selo tom="vermelho">Não aceitou</Selo>
        )}
      </div>
      {erro && (
        <p role="alert" className="text-xs text-[color:var(--vermelho)]">
          {erro}
        </p>
      )}
      <p className="text-xs text-tinta-fraca">
        Ofertada em {formatarDataHora(oferta.ofertada_em)}
        {oferta.valida_ate && ` · válida até ${formatarDataHora(oferta.valida_ate)}`}
      </p>
    </li>
  );
}

/**
 * Oferta do Croqui (PARTE 11/12 do roteiro). O preço de tabela vem de
 * `parametros_metodo` pelo bloco `preco` de `GET /api/jornadas/[id]/ofertas`
 * (B27) — sem parâmetro ativo não há número nenhum na tela, só o
 * `SeloStub` dizendo onde cadastrar, e o botão de registrar fica desabilitado
 * com o motivo. O servidor recusa com 409 `parametro_ausente` de qualquer
 * jeito; a tela só evita a viagem.
 */
export function PainelOferta({
  jornadaId,
  ofertas,
  preco,
  aoAtualizar,
}: {
  jornadaId: string;
  ofertas: Oferta[];
  /** `null` = a resposta não trouxe o bloco `preco` (servidor antigo) — tratado como parâmetro ausente. */
  preco: PrecoCroqui | null;
  aoAtualizar: (ofertas: Oferta[]) => void;
}) {
  const { notificar } = useToast();
  const [mostrarFormulario, setMostrarFormulario] = useState(ofertas.length === 0);
  const [condicao, setCondicao] = useState<CondicaoOferta>("incentivo_resolvedor");
  const [valorOfertado, setValorOfertado] = useState<string>(() => {
    const inicial = precoDaCondicao(preco, "incentivo_resolvedor");
    return inicial == null ? "" : String(inicial);
  });
  const [registrando, setRegistrando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const precoTabela = precoDaCondicao(preco, condicao);
  const chaveAusente = precoTabela == null ? CHAVE_DA_CONDICAO[condicao] : null;
  const valorNumerico = valorOfertado.trim() === "" ? null : Number(valorOfertado);
  const valorInvalido = valorNumerico != null && (!Number.isFinite(valorNumerico) || valorNumerico < 0);
  const podeRegistrar = chaveAusente == null && valorNumerico != null && !valorInvalido;

  function aoTrocarCondicao(nova: CondicaoOferta) {
    setCondicao(nova);
    const tabela = precoDaCondicao(preco, nova);
    setValorOfertado(tabela == null ? "" : String(tabela));
    setErro(null);
  }

  async function registrar() {
    if (!podeRegistrar || valorNumerico == null) return;
    setErro(null);
    setRegistrando(true);
    try {
      const nova = await registrarOferta(jornadaId, { condicao, valor_ofertado: valorNumerico });
      aoAtualizar([nova, ...ofertas]);
      setMostrarFormulario(false);
      notificar({ tom: "sucesso", titulo: "Oferta registrada", descricao: `${ROTULO_CONDICAO[condicao]} · ${formatarMoeda(valorNumerico)}` });
    } catch (e) {
      if (e instanceof ErroSessao && e.codigo === "parametro_ausente") {
        setErro(`O preço de tabela desta condição não está cadastrado (${CHAVE_DA_CONDICAO[condicao]}). Cadastre em Admin → Parâmetros e tente de novo.`);
      } else {
        setErro(e instanceof ErroSessao ? e.message : "Não deu para registrar a oferta. Tente de novo.");
      }
    } finally {
      setRegistrando(false);
    }
  }

  function atualizarOfertaNaLista(atualizada: Oferta) {
    aoAtualizar(ofertas.map((o) => (o.id === atualizada.id ? atualizada : o)));
  }

  const motivoBloqueio = chaveAusente
    ? `Sem preço de tabela cadastrado para ${ROTULO_CONDICAO[condicao]} (${chaveAusente}).`
    : valorNumerico == null
      ? "Informe o valor ofertado."
      : valorInvalido
        ? "O valor precisa ser um número maior ou igual a zero."
        : null;

  return (
    <Cartao
      rotulo="Parte 11 / 12"
      titulo="Oferta do Croqui Estrutural"
      descricao="Registre o que foi ofertado antes do pagamento chegar — é o que reconcilia a venda com o webhook."
      preenchimento="sem"
      acao={
        ofertas.length > 0 && !mostrarFormulario ? (
          <Botao variante="secundario" tamanho="compacto" onClick={() => setMostrarFormulario(true)}>
            Registrar outra oferta
          </Botao>
        ) : undefined
      }
    >
      {ofertas.length > 0 && (
        <ul className="divide-y divide-linha">
          {ofertas.map((o) => (
            <LinhaOferta key={o.id} jornadaId={jornadaId} oferta={o} aoAtualizar={atualizarOfertaNaLista} />
          ))}
        </ul>
      )}

      {mostrarFormulario && (
        <div className={`flex flex-col gap-5 px-5 py-5 sm:px-6 ${ofertas.length > 0 ? "border-t border-linha" : ""}`}>
          {preco?.parametro_ausente && preco.parametro_ausente.length > 0 && (
            <SeloStub texto={`Honorário não cadastrado — Admin → Parâmetros (${preco.parametro_ausente.join(", ")}).`} />
          )}
          {!preco && <SeloStub texto="A API não devolveu o preço de tabela do Croqui — Admin → Parâmetros." />}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-rotulo font-medium uppercase text-tinta-fraca">Condição da oferta</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["padrao", "incentivo_resolvedor"] as const).map((opcao) => {
                const tabela = precoDaCondicao(preco, opcao);
                return (
                  <Opcao
                    key={opcao}
                    name="condicao-oferta"
                    checked={condicao === opcao}
                    onChange={() => aoTrocarCondicao(opcao)}
                    rotulo={ROTULO_CONDICAO[opcao]}
                    descricao={tabela == null ? "sem preço de tabela cadastrado" : `tabela ${formatarMoeda(tabela)}`}
                  />
                );
              })}
            </div>
          </fieldset>

          <Campo
            rotulo="Valor ofertado"
            ajuda={precoTabela != null ? `Ajustável na negociação ao vivo. O preço de tabela (${formatarMoeda(precoTabela)}) fica registrado como referência.` : "Sem preço de tabela, a oferta não pode ser registrada."}
            erro={valorInvalido ? "O valor precisa ser um número maior ou igual a zero." : undefined}
            obrigatorio
          >
            <Entrada
              type="number"
              inputMode="decimal"
              min={0}
              step={100}
              value={valorOfertado}
              disabled={chaveAusente != null}
              onChange={(e) => setValorOfertado(e.target.value)}
              className="w-48"
            />
          </Campo>

          {erro && (
            <p role="alert" className="text-sm text-[color:var(--vermelho)]">
              {erro}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Botao variante="primario" carregando={registrando} disabled={!podeRegistrar} onClick={registrar} aria-describedby={motivoBloqueio ? "motivo-oferta-bloqueada" : undefined}>
              Registrar oferta
            </Botao>
            {ofertas.length > 0 && (
              <Botao variante="fantasma" onClick={() => setMostrarFormulario(false)} disabled={registrando}>
                Cancelar
              </Botao>
            )}
            {motivoBloqueio && (
              <p id="motivo-oferta-bloqueada" className="text-xs text-tinta-fraca">
                {motivoBloqueio}
              </p>
            )}
          </div>
        </div>
      )}
    </Cartao>
  );
}
