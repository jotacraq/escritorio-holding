import type {
  CategoriaFichaCliente,
  ObservacaoDoClienteRetrospecto,
  RetrospectoDaSessao,
  SaudeMotorRetrospecto,
  TipoObservacaoCopiloto,
} from "@/types/copiloto";
import { formatarDataHora } from "@/lib/formatar";
import { colapsarObservacoes, type ObservacaoColapsada } from "./colapsarObservacoes";

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
 *
 * ---
 *
 * 🔴 **ORDEM DAS SEÇÕES, revista em 22/09 a pedido do dono** ("tá muito feio,
 * confuso, a disposição dos dados fica confusa"). A causa não era CSS: o
 * documento dava o MESMO peso visual à telemetria do sistema e aos fatos
 * sobre a cliente, e não existe hierarquia possível entre "confiança média
 * 0,70" e "ela quer evitar inventário para os dois filhos". A ordem hoje:
 *
 *  1. **O que a cliente disse** — o documento abre pelos fatos dela, agrupados
 *     por assunto. É o que a advogada vem ler.
 *  2. **Pontos de melhoria da condução** — o que ficou por perguntar.
 *  3. **Registro do sistema** — cobertura, duração, patrimônio captado e saúde
 *     do motor, juntos, em letra miúda, no pé. Continuam auditáveis e
 *     continuam inteiros; só deixam de disputar a atenção com o conteúdo.
 *
 * Hierarquia por POSIÇÃO e por peso de texto — sem card, sem ícone, sem
 * sombra, sem cor de estado. Este documento abre DEPOIS que a sessão acabou:
 * ninguém o lê de relance, então a exceção visual da tela `/conduzir` ao vivo
 * **não vale aqui** (decisão de 18/09, escopo fechado em uma tela).
 */

/** Subtítulo de GRUPO — plural, porque encabeça uma lista.
 *
 * Substitui o `ROTULO_CATEGORIA_FICHA` singular que existia aqui: o rótulo
 * saiu de dentro de cada linha e virou o cabeçalho do grupo, então a forma
 * singular deixou de ter chamador. A ORDEM das chaves é irrelevante para a
 * tela — quem manda na ordem é o servidor (`RANK_CATEGORIA`), e
 * `agruparObservacoes` só a preserva. */
const TITULO_GRUPO_FICHA: Record<CategoriaFichaCliente | "patrimonio", string> = {
  objecao: "Objeções",
  dor: "Dores",
  desejo: "Desejos",
  fato_decisor: "Fatos do decisor",
  patrimonio: "Patrimônio",
};

/** Subtítulo de grupo das observações da IA (substitui o
 * `ROTULO_TIPO_OBSERVACAO` singular, pelo mesmo motivo do de categoria). A separação `fato · hipótese ·
 * inferência · recomendação` é regra da casa: a IA nunca mistura o que foi
 * dito com o que ela deduziu, e o agrupamento torna isso visível de uma vez. */
const TITULO_GRUPO_OBSERVACAO: Record<TipoObservacaoCopiloto, string> = {
  fato: "Fatos observados pelo copiloto",
  hipotese: "Hipóteses do copiloto",
  inferencia: "Inferências do copiloto",
  recomendacao: "Recomendações do copiloto",
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

/** Um grupo de fatos com o mesmo assunto, pronto para desenhar. */
interface GrupoObservacoes {
  chave: string;
  titulo: string;
  itens: ObservacaoColapsada[];
}

/**
 * Agrupa por assunto **preservando a ordem de chegada do servidor**.
 *
 * 🔴 O servidor entrega objeção › dor › desejo › fato_decisor › patrimônio
 * (`ficha.ts::RANK_CATEGORIA`) e só depois as observações da IA. Esta função
 * NÃO ordena nada: ela abre um grupo na primeira vez que vê cada assunto e
 * anexa os demais ali. O resultado herda a ordem do servidor exatamente —
 * reordenar aqui seria uma segunda regra de negócio na tela, divergindo da do
 * dono.
 */
function agruparObservacoes(observacoes: ObservacaoDoClienteRetrospecto[]): GrupoObservacoes[] {
  const grupos: GrupoObservacoes[] = [];
  const porChave = new Map<string, ObservacaoDoClienteRetrospecto[]>();

  for (const o of observacoes) {
    const chave = o.categoria !== null ? `categoria:${o.categoria}` : o.tipo !== null ? `tipo:${o.tipo}` : "outros";
    const existente = porChave.get(chave);
    if (existente === undefined) {
      const lista = [o];
      porChave.set(chave, lista);
      grupos.push({ chave, titulo: tituloDoGrupo(o), itens: [] });
    } else {
      existente.push(o);
    }
  }

  // O colapso roda DENTRO de cada grupo, já homogêneo.
  return grupos.map((g) => ({ ...g, itens: colapsarObservacoes(porChave.get(g.chave) ?? []) }));
}

function tituloDoGrupo(o: ObservacaoDoClienteRetrospecto): string {
  if (o.categoria !== null) return TITULO_GRUPO_FICHA[o.categoria];
  if (o.tipo !== null) return TITULO_GRUPO_OBSERVACAO[o.tipo];
  return "Outras observações";
}

export function CorpoRetrospecto({ retrospecto }: { retrospecto: RetrospectoDaSessao }) {
  const { conteudo } = retrospecto;
  const cobertura = conteudo.cobertura;
  const duracao = formatarDuracao(conteudo.duracao.minutos);
  const patrimonio = conteudo.patrimonio;
  const melhorias = conteudo.pontos_de_melhoria;
  const grupos = agruparObservacoes(conteudo.observacoes_do_cliente);

  return (
    <div className="flex flex-col gap-cartao text-tinta">
      {/* ============================================ 1. o que a cliente disse
        * Primeiro, porque é o que a advogada vem ler. Antes ficava em 3º,
        * embaixo de duas seções de telemetria. */}
      <section aria-labelledby="retrospecto-observacoes" className="flex flex-col gap-3">
        <h3 id="retrospecto-observacoes" className="text-rotulo font-bold uppercase tracking-wide text-tinta-fraca">
          O que a cliente disse
        </h3>
        {grupos.length === 0 ? (
          <p className="text-sm text-tinta-suave">Nenhuma observação registrada durante a sessão.</p>
        ) : (
          grupos.map((grupo) => (
            <section key={grupo.chave} aria-labelledby={`retrospecto-grupo-${grupo.chave}`} className="flex flex-col gap-1">
              {/* h4: filho do h3 da seção — nível coerente, sem pular. */}
              <h4 id={`retrospecto-grupo-${grupo.chave}`} className="text-rotulo font-semibold text-tinta-suave">
                {grupo.titulo}
              </h4>
              <ul className="flex flex-col gap-2">
                {grupo.itens.map((item, i) => (
                  <ItemObservacao key={`${grupo.chave}-${i}`} item={item} />
                ))}
              </ul>
            </section>
          ))
        )}
      </section>

      {/* ================================== 2. pontos de melhoria da condução */}
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

      {/* ==================================== 3. registro do sistema (rodapé)
        * Cobertura, duração, patrimônio captado e saúde do motor, JUNTOS e em
        * letra miúda. Nada foi removido — tudo continua auditável, e toda
        * proporção continua NUMERADOR de DENOMINADOR. O que mudou é o peso:
        * telemetria não disputa mais a atenção com o que a cliente disse. */}
      <section aria-labelledby="retrospecto-sistema" className="flex flex-col gap-2 border-t border-linha pt-cartao">
        <h3 id="retrospecto-sistema" className="text-legenda font-semibold uppercase tracking-wide text-tinta-fraca">
          Registro do sistema
        </h3>

        <dl className="flex flex-col gap-0.5 text-legenda">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-tinta-fraca">Cobertura do roteiro</dt>
            <dd className="tabular-nums text-tinta-suave">
              {cobertura.blocos_com_atividade} de {cobertura.blocos_no_roteiro}{" "}
              {cobertura.blocos_no_roteiro === 1 ? "parte" : "partes"} com registro do copiloto
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-tinta-fraca">Duração</dt>
            <dd className={duracao === null ? "text-tinta-fraca" : "tabular-nums text-tinta-suave"}>
              {duracao ?? "não registrada"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-tinta-fraca">Patrimônio captado</dt>
            <dd className={patrimonio === null ? "text-tinta-fraca" : "tabular-nums text-tinta-suave"}>
              {patrimonio === null ? (
                "nenhum item mencionado"
              ) : (
                <>
                  {patrimonio.total_itens_proprios + patrimonio.total_itens_incertos} captados
                  {patrimonio.total_itens_incertos > 0 && <> · {patrimonio.total_itens_incertos} a confirmar</>}
                </>
              )}
            </dd>
          </div>
        </dl>

        {patrimonio !== null && patrimonio.por_categoria.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-legenda text-tinta-fraca">
            {patrimonio.por_categoria.map((c) => (
              <li key={c.categoria} className="tabular-nums">
                {ROTULO_CATEGORIA_INVENTARIO[c.categoria] ?? c.categoria}: {c.contagem_propria}
                {c.contagem_incerta > 0 && <> · {c.contagem_incerta} a confirmar</>}
              </li>
            ))}
          </ul>
        )}

        {cobertura.nao_percorridos.length > 0 && (
          <div className="flex flex-col gap-0.5">
            <p className="text-legenda text-tinta-fraca">Partes sem registro nesta sessão</p>
            <ul className="flex flex-col">
              {cobertura.nao_percorridos.map((parte) => (
                <li key={parte.id} className="text-legenda text-tinta-suave">
                  {parte.titulo}
                </li>
              ))}
            </ul>
          </div>
        )}

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

/**
 * Um fato sobre a cliente, já colapsado.
 *
 * O rótulo de categoria/tipo NÃO se repete por item: ele virou o subtítulo do
 * grupo. Antes cada linha carregava "OBJEÇÃO"/"DOR" na frente, e com a lista
 * corrida isso era ruído repetido a cada linha.
 *
 * **Toda evidência das linhas colapsadas fica na tela**, empilhada sob o item.
 * Nunca se descarta citação em silêncio — quando N linhas viram uma, as N
 * citações continuam ali, e a contagem de linhas colapsadas é dita por
 * extenso.
 */
function ItemObservacao({ item }: { item: ObservacaoColapsada }) {
  return (
    <li className="flex flex-col gap-0.5">
      <p className="text-sm text-tinta">
        {item.texto}
        {item.n > 1 && <span className="ml-1.5 text-legenda tabular-nums text-tinta-fraca">dito {item.n}×</span>}
      </p>
      {item.linhas > 1 && (
        <p className="text-legenda text-tinta-fraca">
          {item.linhas} registros do copiloto reunidos aqui — as citações de todos estão abaixo.
        </p>
      )}
      {item.evidencias.map((evidencia, i) => (
        <p key={i} className="text-legenda italic text-tinta-fraca">
          &ldquo;{evidencia}&rdquo;
        </p>
      ))}
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
      <p className="text-legenda tabular-nums text-tinta-fraca">{partes.join(" · ")}</p>
      {saude.execucoes_ia === null && (
        <p className="text-legenda text-tinta-fraca">
          Respostas truncadas: não foi possível medir nesta sessão (falta o início ou o fim registrado).
        </p>
      )}
    </>
  );
}
