"use client";

import { useCallback, useState } from "react";
import { ApiError } from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { Selo, SeloStub } from "@/components/ui/Selo";
import { LinkBotao } from "@/components/painel/LinkBotao";
import { rotulo } from "@/lib/vocabulario";
import type { CroquiNarrativa } from "@/server/ia/schema-croqui-narrativa";
import { buscarNarrativaCroqui, gerarNarrativaCroqui, narrativaInativa } from "./apiNarrativa";

/**
 * As notas do apresentador — o único lugar em que a IA entra no croqui novo.
 *
 * O motor calcula as 19 tabelas; a narrativa só diz COMO conduzir cada uma,
 * que pergunta fazer e que objeção esperar. Quem a lê é a apresentação (tecla
 * N), nunca o slide: texto gerado não vai ao projetor.
 *
 * Enquanto o prompt está inativo (`ativo: false` no `GET`, 409
 * `narrativa_inativa` no `POST`), o cartão mostra UMA linha com `SeloStub` e o
 * caminho do Admin — recurso que ainda não existe é rotulado, nunca escondido
 * atrás de um botão que só devolve erro.
 */
export function NarrativaCroqui({ croquiId }: { croquiId: string }) {
  const { notificar } = useToast();
  const buscar = useCallback(() => buscarNarrativaCroqui(croquiId), [croquiId]);
  const { dados, carregando, erro } = useRecurso(buscar, [croquiId]);

  const [gerada, setGerada] = useState<{ conteudo: CroquiNarrativa; versao: number | null } | null>(null);
  const [gerando, setGerando] = useState(false);
  const [inativaAoGerar, setInativaAoGerar] = useState(false);

  const atual = gerada ?? (dados?.narrativa ? { conteudo: dados.narrativa.conteudo, versao: dados.narrativa.versao } : null);
  // Sem resposta do servidor não afirmamos que está ligado: a falha do `GET`
  // deixa o cartão sem botão, e não um botão que devolve erro no clique.
  const inativa = inativaAoGerar || narrativaInativa(erro) || (dados ? !dados.ativo : Boolean(erro));

  async function gerar() {
    setGerando(true);
    try {
      const r = await gerarNarrativaCroqui(croquiId);
      setGerada({ conteudo: r.narrativa, versao: null });
      notificar({ tom: "sucesso", titulo: "Narrativa gerada", descricao: "Aparece nas notas da apresentação (tecla N)." });
    } catch (e) {
      if (narrativaInativa(e)) {
        setInativaAoGerar(true);
      } else {
        notificar({
          tom: "erro",
          titulo: "Não deu para gerar a narrativa",
          descricao: e instanceof ApiError ? e.message : "Tente de novo em instantes.",
        });
      }
    } finally {
      setGerando(false);
    }
  }

  // Espaço reservado enquanto a resposta não chega: sem pulo de layout e sem
  // controle falso na tela.
  if (carregando) return <Cartao preenchimento="compacto" aria-hidden="true" className="h-[4.5rem]" />;

  if (inativa) {
    return (
      <Cartao rotulo={rotulo("croqui")} titulo="Notas do apresentador" preenchimento="compacto">
        <div className="mt-3 flex flex-wrap items-center gap-item">
          <SeloStub texto="Narrativa por IA ainda não ativada" />
          <LinkBotao href="/admin#prompts">Admin · Prompts</LinkBotao>
        </div>
      </Cartao>
    );
  }

  return (
    <Cartao
      rotulo={rotulo("croqui")}
      titulo="Notas do apresentador"
      preenchimento="compacto"
      acao={
        <Botao variante="secundario" tamanho="compacto" carregando={gerando} onClick={gerar}>
          {atual ? "Gerar de novo" : "Gerar narrativa"}
        </Botao>
      }
    >
      <p className="mt-3 text-sm text-tinta-suave">
        {atual ? (
          <>
            <Selo tom="verde">{atual.versao ? `Pronta v${atual.versao}` : "Pronta"}</Selo>{" "}
            <span className="align-middle">
              {atual.conteudo.como_apresentar.length} notas · {atual.conteudo.perguntas.length} perguntas
            </span>
          </>
        ) : (
          "Ainda não gerada"
        )}
      </p>
    </Cartao>
  );
}
