import type {
  CategoriaFichaCliente,
  ObservacaoDoClienteRetrospecto,
  RetrospectoDaSessao,
  SaudeMotorRetrospecto,
  TipoObservacaoCopiloto,
} from "@/types/copiloto";
import { formatarDataHora } from "@/lib/formatar";

/**
 * Fase 13, §D — **o corpo do Retrospecto da Sessão, um só, em dois
 * containers**: o pop-up do encerramento (`PopupRetrospecto`) e a gaveta de
 * consulta da Ficha 360 (`ficha360/RetrospectoAba`). A tela de consulta não
 * é código novo — é este mesmo componente dentro de outra moldura. É o item
 * de "otimização" da fase, não um detalhe de organização.
 *
 * **Não se chama "Relatório", e isto é regra, não gosto.** `Glossario.md`
 * já define *Relatório da SV* como o documento que a Dra. Elaine preenche à
 * mão (`relatorios_sessao`, `RelatorioAba.tsx`, item de pasta
 * `relatorio_sv`). O Retrospecto é o fechamento do COPILOTO: o que a máquina
 * observou enquanto a sessão acontecia, congelado no instante em que ela
 * terminou. É gerado, não preenchido; é da sessão de copiloto, não do
 * cliente; e é imutável.
 *
 * **Não existe nota de 0 a 10 aqui, e a ausência é deliberada** (§D.2,
 * BLOQUEIO B-2 respondido pelo dono em 19/09). Os dois campos que a 0119
 * criou para julgar a condução estão vazios em produção: `cobriu_no_bloco` =
 * 11 itens em 369 sugestões, em 1 de 3 sessões; `desfecho` = 99,2%
 * `expirada`. Uma nota construída sobre isso daria um número plausível e
 * falso. O que existe medido e é auditável é COBERTURA: partes do roteiro em
 * que o copiloto registrou atividade, sobre o total do roteiro DAQUELA
 * sessão. Fração, com denominador na tela, sempre. A frase que explica isso
 * vem do próprio documento (`conteudo.nota_de_rodape`) e não de uma
 * constante desta tela: o Retrospecto é artefato CONGELADO — o que ele diz é
 * o que ele dizia no dia em que foi gerado.
 *
 * **Regra de vazio, sem exceção:** campo ausente escreve a ausência por
 * extenso; nunca 0, nunca percentual de um denominador que não veio. Toda
 * proporção aparece como NUMERADOR de DENOMINADOR ("223 de 369"), nunca como
 * porcentagem pronta — mesma disciplina da cobertura.
 */

const ROTULO_CATEGORIA_FICHA: Record<CategoriaFichaCliente | "patrimonio", string> = {
  objecao: "Objeção",
  dor: "Dor",
  desejo: "Desejo",
  fato_decisor: "Fato",
  patrimonio: "Patrimônio",
};

const ROTULO_TIPO_OBSERVACAO: Record<TipoObservacaoCopiloto, string> = {
  fato: "Fato",
  hipotese: "Hipótese",
  inferencia: "Inferência",
  recomendacao: "Recomendação",
};

const ROTULO_CATEGORIA_INVENTARIO: Record<string, string> = {
  imovel: "Imóveis",
  empresa: "Empresas",
  investimento: "Investimentos",
  outro: "Outros",
};

/** "2 h 01 min" / "54 min". `null` não vira "0 min": vira linha nenhuma. */
function formatarDuracao(minutos: number | null): string | null {
  if (minutos === null || minutos <= 0) return null;
  const inteiros = Math.round(minutos);
  const horas = Math.floor(inteiros / 60);
  const resto = inteiros % 60;
  return horas === 0 ? `${resto} min` : `${horas} h ${String(resto).padStart(2, "0")} min`;
}

export function CorpoRetrospecto({ retrospecto }: { retrospecto: RetrospectoDaSessao }) {
  const { conteudo } = retrospecto;
  const cobertura = conteudo.cobertura;
  const duracao = formatarDuracao(conteudo.duracao.minutos);
  const patrimonio = conteudo.patrimonio;
  const observacoes = conteudo.observacoes_do_cliente;
  const melhorias = conteudo.pontos_de_melhoria;

  return (
    <div className="flex flex-col gap-cartao text-tinta">
      {/* ------------------------------------------------------ cobertura */}
      <section aria-labelledby="retrospecto-cobertura" className="flex flex-col gap-2">
        <h3 id="retrospecto-cobertura" className="text-rotulo font-bold uppercase tracking-wide text-tinta-fraca">
          Cobertura do roteiro
        </h3>
        <p>
          <span className="text-titulo font-bold tabular-nums">{cobertura.blocos_com_atividade}</span>
          <span className="ml-1.5 text-corpo text-tinta-suave">
            de {cobertura.blocos_no_roteiro} {cobertura.blocos_no_roteiro === 1 ? "parte" : "partes"} com registro do
            copiloto
          </span>
        </p>
        {cobertura.nao_percorridos.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-rotulo font-semibold text-tinta-fraca">Partes sem registro nesta sessão</p>
            <ul className="flex flex-col gap-0.5">
              {cobertura.nao_percorridos.map((parte) => (
                <li key={parte.id} className="text-sm text-tinta-suave">
                  {parte.titulo}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------- fatos da sessão */}
      <section aria-labelledby="retrospecto-fatos" className="flex flex-col gap-2 border-t border-linha pt-cartao">
        <h3 id="retrospecto-fatos" className="text-rotulo font-bold uppercase tracking-wide text-tinta-fraca">
          A sessão
        </h3>
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-tinta-suave">Duração</dt>
            <dd className={duracao === null ? "text-tinta-suave" : "font-semibold tabular-nums"}>
              {duracao ?? "não registrada"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-tinta-suave">Patrimônio captado</dt>
            <dd className={patrimonio === null ? "text-tinta-suave" : "font-semibold tabular-nums"}>
              {patrimonio === null ? (
                "nenhum item mencionado"
              ) : (
                <>
                  {patrimonio.total_itens_proprios + patrimonio.total_itens_incertos} captados
                  {patrimonio.total_itens_incertos > 0 && (
                    <span className="ml-1.5 font-normal text-tinta-fraca">
                      · {patrimonio.total_itens_incertos} a confirmar
                    </span>
                  )}
                </>
              )}
            </dd>
          </div>
        </dl>
        {patrimonio !== null && patrimonio.por_categoria.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-legenda text-tinta-suave">
            {patrimonio.por_categoria.map((c) => (
              <li key={c.categoria} className="tabular-nums">
                {ROTULO_CATEGORIA_INVENTARIO[c.categoria] ?? c.categoria}: {c.contagem_propria}
                {c.contagem_incerta > 0 && <> · {c.contagem_incerta} a confirmar</>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------------------------------------------- observações do cliente */}
      <section aria-labelledby="retrospecto-observacoes" className="flex flex-col gap-2 border-t border-linha pt-cartao">
        <h3 id="retrospecto-observacoes" className="text-rotulo font-bold uppercase tracking-wide text-tinta-fraca">
          Observações sobre o cliente
        </h3>
        {observacoes.length === 0 ? (
          <p className="text-sm text-tinta-suave">Nenhuma observação registrada durante a sessão.</p>
        ) : (
          // Ordem do SERVIDOR, sem reordenar: ele já entrega objeção › dor ›
          // desejo › fato › patrimônio (a hierarquia de negócio do dono) e só
          // depois as observações da IA. Reordenar aqui seria uma segunda
          // regra de negócio na tela, divergindo da do servidor.
          <ul className="flex flex-col gap-2.5">
            {observacoes.map((o, i) => (
              <ItemObservacao key={i} observacao={o} />
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------ pontos de melhoria */}
      <section aria-labelledby="retrospecto-melhorias" className="flex flex-col gap-2 border-t border-linha pt-cartao">
        <h3 id="retrospecto-melhorias" className="text-rotulo font-bold uppercase tracking-wide text-tinta-fraca">
          Pontos de melhoria da condução
        </h3>
        {melhorias.length === 0 ? (
          <p className="text-sm text-tinta-suave">Nada ficou apontado como não perguntado durante a sessão.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {melhorias.map((m, i) => (
              <li key={i} className="flex flex-col gap-0.5">
                <p className="text-sm text-tinta">
                  {m.item}
                  {m.n > 1 && <span className="ml-1.5 text-legenda tabular-nums text-tinta-fraca">apontado {m.n}×</span>}
                </p>
                {m.bloco_titulo !== null && <p className="text-legenda text-tinta-fraca">{m.bloco_titulo}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --------------------------------------------------- saúde do motor */}
      <section aria-labelledby="retrospecto-motor" className="flex flex-col gap-1 border-t border-linha pt-cartao">
        <h3 id="retrospecto-motor" className="text-legenda font-semibold uppercase tracking-wide text-tinta-fraca">
          Saúde do motor nesta sessão
        </h3>
        {/* Responde "dá para confiar neste retrospecto?" antes de alguém
         * perguntar — e por isso vem discreto, no rodapé, nunca disputando
         * com o conteúdo. */}
        <LinhasDoMotor saude={conteudo.saude_do_motor} />
        {conteudo.podado && (
          <p className="text-legenda text-tinta-suave">
            Parte do conteúdo foi cortada por tamanho — o documento diz que cortou, em vez de omitir em silêncio.
          </p>
        )}
        {retrospecto.evidencias_redigidas_em !== null && (
          <p className="text-legenda text-tinta-suave">
            As citações literais deste documento já foram removidas pelo expurgo de dados.
          </p>
        )}
        <p className="mt-1 text-legenda text-tinta-fraca">{conteudo.nota_de_rodape}</p>
        <p className="text-legenda text-tinta-fraca">Gerado em {formatarDataHora(retrospecto.criado_em)}.</p>
      </section>
    </div>
  );
}

/** Um fato sobre o cliente. O rótulo sai da CATEGORIA quando veio da Ficha
 * (objeção/dor/desejo/fato/patrimônio) e do TIPO quando veio de uma
 * observação da IA (fato/hipótese/inferência/recomendação) — os dois campos
 * são mutuamente exclusivos por contrato, e a separação existe porque a
 * regra da casa exige que a IA nunca misture o que foi dito com o que ela
 * deduziu. */
function ItemObservacao({ observacao }: { observacao: ObservacaoDoClienteRetrospecto }) {
  const rotulo =
    observacao.categoria !== null
      ? ROTULO_CATEGORIA_FICHA[observacao.categoria]
      : observacao.tipo !== null
        ? ROTULO_TIPO_OBSERVACAO[observacao.tipo]
        : null;

  return (
    <li className="flex flex-col gap-0.5">
      <p className="text-sm text-tinta">
        {rotulo !== null && (
          <span className="mr-1.5 text-legenda font-bold uppercase tracking-wide text-tinta-fraca">{rotulo}</span>
        )}
        {observacao.texto}
        {observacao.n > 1 && <span className="ml-1.5 text-legenda tabular-nums text-tinta-fraca">dito {observacao.n}×</span>}
      </p>
      {observacao.evidencia !== null && (
        <p className="text-legenda italic text-tinta-fraca">&ldquo;{observacao.evidencia}&rdquo;</p>
      )}
    </li>
  );
}

/** Tudo em NUMERADOR de DENOMINADOR — nunca porcentagem pronta (a mesma
 * razão pela qual a cobertura é "9 de 13", e não "69%"). `null` vira
 * ausência por extenso, nunca 0. */
function LinhasDoMotor({ saude }: { saude: SaudeMotorRetrospecto }) {
  const partes: string[] = [];
  partes.push(`${saude.sugestoes} ${saude.sugestoes === 1 ? "sugestão" : "sugestões"}`);
  if (saude.confianca_media !== null) {
    partes.push(`confiança média ${saude.confianca_media.toFixed(2).replace(".", ",")}`);
  }
  if (saude.sugestoes > 0) {
    partes.push(`${saude.sugestoes_com_evidencia_nao_conferida} de ${saude.sugestoes} com evidência não conferida`);
  }
  if (saude.execucoes_ia !== null && saude.execucoes_truncadas !== null) {
    partes.push(`${saude.execucoes_truncadas} de ${saude.execucoes_ia} respostas da IA truncadas`);
  }

  return (
    <>
      <p className="text-legenda tabular-nums text-tinta-suave">{partes.join(" · ")}</p>
      {saude.execucoes_ia === null && (
        <p className="text-legenda text-tinta-fraca">
          Respostas truncadas: não foi possível medir nesta sessão (falta o início ou o fim registrado).
        </p>
      )}
    </>
  );
}
