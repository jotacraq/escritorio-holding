"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { Botao } from "@/components/ui/Botao";
import { AreaTexto, Campo, Entrada, Selecao } from "@/components/ui/Campo";
import { Cartao } from "@/components/ui/Cartao";
import { EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Passos } from "@/components/ui/Passos";
import { Selo, SeloDadoExemplo, SeloStub } from "@/components/ui/Selo";
import { formatarCidadeUf, formatarData, formatarDataHora } from "@/lib/formatar";
import {
  ApiError,
  CANAIS_PEDIDO_TITULAR,
  anonimizarTitular,
  buscarInventarioTitular,
  concluirExpurgoTitular,
  exportarDadosDoTitular,
  listarJornadas,
  type CanalPedidoTitular,
  type JornadaKanban,
  type PedidoDoTitular,
  type SolicitacaoTitular,
} from "@/lib/api";
import { mensagemDeErro } from "../http";
import { IntroAba, TRACO } from "../comum";

/**
 * "Direitos do titular" (Fase 7 r3, §B5) — LGPD art. 18: acesso/portabilidade
 * (exportar tudo que o sistema guarda de uma pessoa) e eliminação (encerrar o
 * tratamento).
 *
 * Anonimizar NÃO é apagar cadastro: é encerrar o tratamento dos dados pessoais
 * preservando o esqueleto contábil e temporal. Sai o que identifica; fica o
 * fato econômico (pagamento, valor, data), o fato processual (houve sessão,
 * quando) e os consentimentos — que são a prova da base legal. Nenhum DELETE:
 * é tudo substituição por marcador, com motivo, base legal, quem e quando
 * gravados numa tabela que ninguém altera depois.
 *
 * A tela é deliberadamente de QUATRO passos, e não um formulário só: quem
 * executa precisa ver o que existe antes de decidir, e o passo 4 é a prova de
 * que aconteceu.
 */

const BASES_LEGAIS_SUGERIDAS = [
  "Art. 18, II — confirmação e acesso do titular",
  "Art. 18, V — portabilidade dos dados",
  "Art. 18, VI — eliminação dos dados tratados com consentimento",
  "Art. 18, IX — revogação do consentimento",
  "Determinação judicial",
];

/** Os canais são enum no servidor; aqui só se dá nome de gente a cada um. */
const ROTULO_CANAL: Record<CanalPedidoTitular, string> = {
  email: "E-mail",
  whatsapp: "WhatsApp",
  telefone: "Telefone",
  presencial: "Presencial",
  oficio: "Ofício / processo judicial",
  iniciativa_do_escritorio: "Iniciativa do escritório",
};

const PASSOS = [
  { id: "buscar", rotulo: "Achar a pessoa" },
  { id: "inventario", rotulo: "O que o sistema guarda" },
  { id: "acoes", rotulo: "Exportar ou encerrar" },
  { id: "depois", rotulo: "Registro" },
];

function pedidoVazio(): PedidoDoTitular {
  return { motivo: "", base_legal: "", canal_pedido: "email", solicitado_em: new Date().toISOString().slice(0, 10) };
}

function errosDoPedido(pedido: PedidoDoTitular): { motivo?: string; base_legal?: string; solicitado_em?: string } {
  const erros: { motivo?: string; base_legal?: string; solicitado_em?: string } = {};
  if (pedido.motivo.trim().length < 10) erros.motivo = "Escreva o motivo com pelo menos 10 caracteres — é o que fica no registro.";
  if (!pedido.base_legal.trim()) erros.base_legal = "Diga em que base legal o pedido se apoia.";
  if (!pedido.solicitado_em) erros.solicitado_em = "Diga quando o titular pediu.";
  return erros;
}

/** Formulário comum aos dois cartões — os mesmos quatro campos de registro. */
function CamposDoPedido({
  idBase,
  pedido,
  erros,
  aoMudar,
  desabilitado,
}: {
  idBase: string;
  pedido: PedidoDoTitular;
  erros: ReturnType<typeof errosDoPedido>;
  aoMudar: (pedido: PedidoDoTitular) => void;
  desabilitado?: boolean;
}) {
  return (
    <>
      <Campo rotulo="Motivo" obrigatorio erro={erros.motivo} ajuda="O que o titular pediu, nas palavras de quem atendeu.">
        <AreaTexto rows={2} value={pedido.motivo} disabled={desabilitado} onChange={(e) => aoMudar({ ...pedido, motivo: e.target.value })} />
      </Campo>
      <Campo rotulo="Base legal" obrigatorio erro={erros.base_legal} ajuda="A sugestão é atalho; o texto é livre e é da advogada.">
        <Entrada
          list={`${idBase}-bases`}
          value={pedido.base_legal}
          disabled={desabilitado}
          onChange={(e) => aoMudar({ ...pedido, base_legal: e.target.value })}
          autoComplete="off"
        />
        <datalist id={`${idBase}-bases`}>
          {BASES_LEGAIS_SUGERIDAS.map((base) => (
            <option key={base} value={base} />
          ))}
        </datalist>
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Como o pedido chegou">
          <Selecao
            value={pedido.canal_pedido}
            disabled={desabilitado}
            onChange={(e) => aoMudar({ ...pedido, canal_pedido: e.target.value as CanalPedidoTitular })}
          >
            {CANAIS_PEDIDO_TITULAR.map((canal) => (
              <option key={canal} value={canal}>
                {ROTULO_CANAL[canal]}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Data do pedido" obrigatorio erro={erros.solicitado_em}>
          <Entrada type="date" value={pedido.solicitado_em} disabled={desabilitado} onChange={(e) => aoMudar({ ...pedido, solicitado_em: e.target.value })} />
        </Campo>
      </div>
    </>
  );
}

function LinhaSolicitacao({ solicitacao }: { solicitacao: SolicitacaoTitular }) {
  return (
    <li className="flex flex-col gap-0.5 px-5 py-3 sm:px-6">
      <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-tinta">
        {solicitacao.tipo === "exportacao" ? "Exportação" : "Encerramento do tratamento"}
        <span className="font-normal text-tinta-suave">{formatarDataHora(solicitacao.executado_em)}</span>
      </p>
      <p className="text-legenda text-tinta-fraca">
        {solicitacao.base_legal}
        {solicitacao.canal_pedido ? ` · pedido por ${ROTULO_CANAL[solicitacao.canal_pedido] ?? solicitacao.canal_pedido}` : ""}
        {solicitacao.solicitado_em ? ` em ${formatarData(solicitacao.solicitado_em)}` : ""}
      </p>
      <p className="break-words text-sm text-tinta-suave">{solicitacao.motivo}</p>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Passo 2 a 4 — depende de uma pessoa escolhida
// ---------------------------------------------------------------------------

function PainelDoTitular({ pessoa, aoTrocar }: { pessoa: JornadaKanban; aoTrocar: () => void }) {
  const buscar = useCallback(() => buscarInventarioTitular(pessoa.pessoa_id), [pessoa.pessoa_id]);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, [pessoa.pessoa_id]);
  const { notificar } = useToast();

  const [pedidoExportacao, setPedidoExportacao] = useState<PedidoDoTitular>(pedidoVazio);
  const [formato, setFormato] = useState<"json" | "pdf">("json");
  const [errosExportacao, setErrosExportacao] = useState<ReturnType<typeof errosDoPedido>>({});
  const [exportando, setExportando] = useState(false);

  const [pedidoAnonimizacao, setPedidoAnonimizacao] = useState<PedidoDoTitular>(pedidoVazio);
  const [errosAnonimizacao, setErrosAnonimizacao] = useState<ReturnType<typeof errosDoPedido>>({});
  const [confirmacaoNome, setConfirmacaoNome] = useState("");
  const [anonimizando, setAnonimizando] = useState(false);
  const [expurgando, setExpurgando] = useState(false);

  const anonimizada = Boolean(dados?.pessoa.anonimizada_em);
  const ehExemplo = (dados?.pessoa.origem_dado ?? pessoa.origem_dado) === "exemplo";
  const registroAnonimizacao = useMemo(() => dados?.solicitacoes.find((s) => s.tipo === "anonimizacao") ?? null, [dados]);
  const pendentesNoStorage = registroAnonimizacao?.resultado.storage_pendente?.length ?? 0;
  const expurgoPendente = Boolean(registroAnonimizacao && !registroAnonimizacao.resultado.storage_removido_em && pendentesNoStorage > 0);
  const tabelasAlteradas = registroAnonimizacao?.resultado.tabelas ?? null;
  const registrosAlterados = tabelasAlteradas ? Object.values(tabelasAlteradas).reduce((total, n) => total + n, 0) : null;

  /*
   * Rota que ainda não existe no servidor não pode virar tela quebrada nem,
   * pior, tela com número inventado: enquanto a 0080 não estiver aplicada,
   * o que aparece é um stub que diz exatamente isso.
   */
  const naoLigado = erro instanceof ApiError && [404, 501, 503].includes(erro.status);

  function baixar(blob: Blob, nomeArquivo: string) {
    const url = URL.createObjectURL(blob);
    const ancora = document.createElement("a");
    ancora.href = url;
    ancora.download = nomeArquivo;
    document.body.appendChild(ancora);
    ancora.click();
    ancora.remove();
    URL.revokeObjectURL(url);
  }

  async function exportar(evento: FormEvent) {
    evento.preventDefault();
    const erros = errosDoPedido(pedidoExportacao);
    setErrosExportacao(erros);
    if (Object.keys(erros).length > 0) return;
    setExportando(true);
    try {
      const { blob, nomeArquivo, solicitacaoId } = await exportarDadosDoTitular(pessoa.pessoa_id, { ...pedidoExportacao, formato });
      baixar(blob, nomeArquivo);
      notificar({
        tom: "sucesso",
        titulo: "Dossiê gerado",
        descricao: solicitacaoId ? "O download ficou registrado com o seu nome." : "O download começou.",
      });
      recarregar();
    } catch (e) {
      notificar({ tom: "erro", titulo: "Não foi possível exportar", descricao: mensagemDeErro(e, "Tente de novo em instantes.") });
    } finally {
      setExportando(false);
    }
  }

  async function anonimizar(evento: FormEvent) {
    evento.preventDefault();
    const erros = errosDoPedido(pedidoAnonimizacao);
    setErrosAnonimizacao(erros);
    if (Object.keys(erros).length > 0) return;
    setAnonimizando(true);
    try {
      const resultado = await anonimizarTitular(pessoa.pessoa_id, { ...pedidoAnonimizacao, confirmacao_nome: confirmacaoNome.trim() });
      const falhos = resultado.storage.falhos.length;
      notificar({
        tom: falhos > 0 ? "aviso" : "sucesso",
        titulo: "Tratamento encerrado",
        descricao: falhos > 0 ? `${falhos} arquivo(s) continuam no armazenamento — conclua o expurgo abaixo.` : "Os dados pessoais foram substituídos por marcadores.",
      });
      setConfirmacaoNome("");
      recarregar();
    } catch (e) {
      notificar({ tom: "erro", titulo: "Não foi possível encerrar o tratamento", descricao: mensagemDeErro(e, "Tente de novo em instantes.") });
    } finally {
      setAnonimizando(false);
    }
  }

  async function concluirExpurgo() {
    if (!registroAnonimizacao) return;
    setExpurgando(true);
    try {
      const resultado = await concluirExpurgoTitular(pessoa.pessoa_id, registroAnonimizacao.id);
      const falhos = resultado.falhos.length;
      notificar({
        tom: falhos > 0 ? "aviso" : "sucesso",
        titulo: falhos > 0 ? "Ainda faltam arquivos" : "Arquivos removidos",
        descricao: falhos > 0 ? `${falhos} arquivo(s) não puderam ser removidos. Tente de novo em instantes.` : "Nada mais do titular está no armazenamento.",
      });
      recarregar();
    } catch (e) {
      notificar({ tom: "erro", titulo: "Não foi possível concluir o expurgo", descricao: mensagemDeErro(e, "Tente de novo em instantes.") });
    } finally {
      setExpurgando(false);
    }
  }

  const passoAtual = anonimizada ? "depois" : dados ? "acoes" : "inventario";

  return (
    <div className="flex flex-col gap-bloco">
      <Passos passos={PASSOS} atual={passoAtual} rotulo="Etapas do atendimento ao titular" />

      <Cartao
        rotulo="Titular"
        titulo={dados?.pessoa.nome ?? pessoa.nome}
        descricao={[formatarCidadeUf(pessoa.cidade, pessoa.uf) || null, pessoa.email, pessoa.telefone].filter(Boolean).join(" · ") || undefined}
        acao={
          <div className="flex flex-wrap items-center gap-2">
            {ehExemplo && <SeloDadoExemplo />}
            {anonimizada && <Selo tom="neutro">Tratamento encerrado</Selo>}
            <Botao variante="fantasma" tamanho="compacto" onClick={aoTrocar}>
              Buscar outra pessoa
            </Botao>
          </div>
        }
      >
        {naoLigado ? (
          <SeloStub texto="Direitos do titular ainda não está ligado no servidor: as rotas de inventário, exportação e encerramento chegam com a migration 0080. Nada aqui mostra número estimado." />
        ) : erro ? (
          <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível ler o que o sistema guarda desta pessoa" />
        ) : carregando && !dados ? (
          <EsqueletoLista linhas={5} rotulo="Lendo o que o sistema guarda…" />
        ) : dados ? (
          <div className="flex flex-col gap-item">
            <h3 className="text-subtitulo font-bold text-tinta">O que o sistema guarda</h3>
            {dados.tabelas.length === 0 ? (
              <p className="text-sm text-tinta-suave">Nenhum registro em nenhuma tabela.</p>
            ) : (
              <ul className="grid gap-x-cartao gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                {dados.tabelas.map((linha) => (
                  <li key={linha.tabela} className="flex items-baseline justify-between gap-2 border-b border-linha py-1 text-sm">
                    <span className="text-tinta-suave">{linha.rotulo}</span>
                    <span className="font-medium text-tinta">
                      {linha.linhas === null ? (
                        <span className="text-tinta-fraca">não foi possível contar</span>
                      ) : linha.linhas > 0 ? (
                        linha.linhas
                      ) : (
                        <span className="text-tinta-fraca">nenhum registro</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <h3 className="text-subtitulo font-bold text-tinta">Arquivos enviados</h3>
            {dados.documentos.length === 0 ? (
              <p className="text-sm text-tinta-suave">Nenhum arquivo.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-linha rounded-controle border border-linha">
                {dados.documentos.map((documento) => (
                  <li key={documento.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 break-words font-medium text-tinta">{documento.nome_arquivo}</span>
                    <span className="text-legenda text-tinta-fraca">{documento.tipo}</span>
                    <span className="text-legenda text-tinta-fraca">
                      {documento.tamanho_bytes > 0 ? `${Math.max(1, Math.round(documento.tamanho_bytes / 1024))} KB` : TRACO}
                    </span>
                    <span className="text-legenda text-tinta-fraca">{formatarData(documento.criado_em)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </Cartao>

      {dados && !anonimizada && (
        <>
          <Cartao titulo="Exportar os dados" descricao="Tudo que o sistema guarda desta pessoa, num arquivo — para entregar ao titular.">
            <form noValidate onSubmit={exportar} className="flex flex-col gap-4">
              <CamposDoPedido idBase="exportacao" pedido={pedidoExportacao} erros={errosExportacao} aoMudar={setPedidoExportacao} />
              <Campo rotulo="Formato">
                <Selecao value={formato} onChange={(e) => setFormato(e.target.value as "json" | "pdf")}>
                  <option value="json">JSON — estruturado, legível por máquina (portabilidade)</option>
                  <option value="pdf">PDF — legível por pessoa</option>
                </Selecao>
              </Campo>
              <p className="text-sm text-tinta-suave">
                O download fica registrado com o seu nome. Os arquivos enviados pelo cliente não vêm no pacote — cada um é baixado pelo link da lista acima, e
                cada download também fica registrado.
              </p>
              <div className="flex justify-end">
                <Botao type="submit" variante="primario" carregando={exportando}>
                  Gerar e baixar
                </Botao>
              </div>
            </form>
          </Cartao>

          <Cartao
            realce="vermelho"
            titulo="Encerrar o tratamento (anonimizar)"
            descricao="Substitui os dados pessoais por marcadores e remove os arquivos. Não há como desfazer."
          >
            {dados.impedimento ? (
              /* Quem decide se PODE anonimizar é o servidor (dado de exemplo,
                 holding em execução, titular com login). A tela repete o motivo
                 dele em vez de adivinhar o seu. */
              <SeloStub texto={dados.impedimento.mensagem} />
            ) : (
              <form noValidate onSubmit={anonimizar} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2 rounded-controle border border-linha bg-papel px-4 py-3 text-sm leading-relaxed text-tinta">
                  <p>
                    <strong>O que acontece.</strong> Nome, e-mail, telefone, endereço, respostas, transcrições, briefings, croquis e os arquivos enviados são
                    substituídos por marcadores e removidos.
                  </p>
                  <p>
                    <strong>O que fica.</strong> Os pagamentos (valor, data, transação), as etapas e as datas da jornada, e os consentimentos — obrigação
                    contábil e prova da base legal.
                  </p>
                  <p>
                    <strong>O que não dá para desfazer.</strong> Isto. Não há como voltar.
                  </p>
                  <p>
                    <strong>O que continua fora daqui.</strong> A gravação da ligação por IA fica no provedor de voz e precisa ser apagada lá.
                  </p>
                </div>
                <CamposDoPedido idBase="anonimizacao" pedido={pedidoAnonimizacao} erros={errosAnonimizacao} aoMudar={setPedidoAnonimizacao} />
                <Campo
                  rotulo="Digite o nome completo da pessoa para confirmar"
                  obrigatorio
                  ajuda={`Exatamente como está cadastrado: ${dados.pessoa.nome}. O servidor confere de novo.`}
                >
                  <Entrada value={confirmacaoNome} onChange={(e) => setConfirmacaoNome(e.target.value)} autoComplete="off" />
                </Campo>
                <div className="flex justify-end">
                  <Botao type="submit" variante="perigo" carregando={anonimizando} disabled={confirmacaoNome.trim() !== dados.pessoa.nome.trim()}>
                    Encerrar o tratamento
                  </Botao>
                </div>
              </form>
            )}
          </Cartao>
        </>
      )}

      {dados && anonimizada && (
        <Cartao realce="latao" titulo="Tratamento encerrado" descricao="O registro abaixo é imutável — é a prova de que o pedido foi atendido.">
          <div className="flex flex-col gap-item">
            {registroAnonimizacao ? (
              <div className="flex flex-col gap-1 text-sm text-tinta">
                <p className="font-bold">Encerrado em {formatarDataHora(registroAnonimizacao.executado_em)}.</p>
                <p className="text-tinta-suave">
                  Base legal: {registroAnonimizacao.base_legal}
                  {registroAnonimizacao.canal_pedido && registroAnonimizacao.solicitado_em
                    ? ` · pedido recebido por ${ROTULO_CANAL[registroAnonimizacao.canal_pedido] ?? registroAnonimizacao.canal_pedido} em ${formatarData(
                        registroAnonimizacao.solicitado_em,
                      )}`
                    : ""}
                </p>
                {registrosAlterados !== null && tabelasAlteradas && (
                  <p className="text-tinta-suave">
                    {registrosAlterados} registros alterados em {Object.keys(tabelasAlteradas).length} tabelas.
                  </p>
                )}
                {registroAnonimizacao.resultado.avisos?.map((aviso) => (
                  <p key={aviso} className="text-tinta-suave">
                    ⚠ {aviso}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-sm text-tinta-suave">
                A pessoa está marcada como anonimizada em {formatarDataHora(dados.pessoa.anonimizada_em)}, mas o registro do pedido não veio do servidor.
              </p>
            )}

            {expurgoPendente && registroAnonimizacao && (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-controle border border-[color:var(--vermelho)] bg-vermelho-fraco px-4 py-3">
                <p className="text-sm font-medium text-[color:var(--vermelho)]">
                  {pendentesNoStorage} arquivo(s) ainda estão no armazenamento. O banco já foi anonimizado; a remoção dos arquivos falhou.
                </p>
                <Botao variante="secundario" tamanho="compacto" carregando={expurgando} onClick={concluirExpurgo}>
                  Concluir expurgo
                </Botao>
              </div>
            )}
          </div>
        </Cartao>
      )}

      {dados && dados.solicitacoes.length > 0 && (
        <Cartao preenchimento="sem" titulo="Pedidos já atendidos" descricao="Cada exportação e cada encerramento fica registrado com quem executou.">
          <ul className="divide-y divide-linha">
            {dados.solicitacoes.map((solicitacao) => (
              <LinhaSolicitacao key={solicitacao.id} solicitacao={solicitacao} />
            ))}
          </ul>
        </Cartao>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Passo 1 — achar a pessoa
// ---------------------------------------------------------------------------

/**
 * `/admin?titular=<nome>#titulares` — a pendência "Concluir o expurgo"
 * (`PendenciasAba`) manda para cá com a pessoa já indicada. Lido de
 * `window.location` e não por `useSearchParams` de propósito: a aba é montada
 * sob demanda (`dynamic()`), e o hook exigiria um `<Suspense>` só para isto
 * (mesma escolha de `jornadas/[id]/diagnostico/page.tsx`).
 */
function titularDaUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("titular")?.trim() ?? "";
}

export function DireitosDoTitularAba() {
  const inicial = useMemo(() => titularDaUrl(), []);
  const [termo, setTermo] = useState(inicial);
  const [busca, setBusca] = useState(inicial);
  const [escolhida, setEscolhida] = useState<JornadaKanban | null>(null);

  const buscar = useCallback(
    () => (busca.trim().length >= 3 ? listarJornadas({ busca: busca.trim(), incluir_fechadas: true }) : Promise.resolve(null)),
    [busca],
  );
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, [busca]);

  /*
   * Veio pelo link da pendência e a busca achou UMA pessoa só (o marcador de
   * anonimização é único por pessoa): abre direto, que é o que quem clicou em
   * "Concluir o expurgo" pediu. Duas jornadas da mesma pessoa contam como uma.
   * Fora deste caso — busca digitada à mão — nada abre sozinho: escolher o
   * titular é ato deliberado numa tela de LGPD.
   */
  const jaAbriu = useRef(false);
  useEffect(() => {
    if (jaAbriu.current || !inicial || escolhida || !dados || busca !== inicial) return;
    const pessoas = new Set(dados.itens.map((i) => i.pessoa_id));
    if (pessoas.size !== 1) return;
    jaAbriu.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEscolhida(dados.itens[0]);
  }, [dados, inicial, busca, escolhida]);

  if (escolhida) {
    return (
      <div className="flex flex-col gap-bloco">
        <IntroAba>Toda ação aqui fica registrada com motivo, base legal, quem executou e quando — e o registro não pode ser alterado depois.</IntroAba>
        <PainelDoTitular pessoa={escolhida} aoTrocar={() => setEscolhida(null)} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-bloco">
      {/* A `descricao` da aba já diz o que ela faz; aqui só entra o que ela
          não diz. Ver o mesmo corte em `PendenciasAba`. */}
      <IntroAba>Toda ação aqui fica registrada com motivo, base legal, quem executou e quando — e o registro não pode ser alterado depois.</IntroAba>

      <Passos passos={PASSOS} atual="buscar" rotulo="Etapas do atendimento ao titular" />

      <Cartao titulo="Achar a pessoa" descricao="Esta tela não lista ninguém por padrão: numa tela de LGPD, listar todo mundo é o oposto do que ela serve.">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(evento) => {
            evento.preventDefault();
            setBusca(termo);
          }}
        >
          <Campo rotulo="Nome, e-mail ou telefone" className="min-w-0 flex-1 basis-64">
            <Entrada value={termo} onChange={(e) => setTermo(e.target.value)} autoComplete="off" placeholder="Pelo menos 3 letras" />
          </Campo>
          <Botao type="submit" variante="primario" carregando={carregando && busca.trim().length >= 3}>
            Buscar
          </Botao>
        </form>

        <div className="mt-item">
          {erro ? (
            <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível buscar" />
          ) : !busca.trim() ? (
            <p className="text-sm text-tinta-suave">Busque pelo nome, e-mail ou telefone da pessoa.</p>
          ) : busca.trim().length < 3 ? (
            <p className="text-sm text-tinta-suave">Escreva pelo menos 3 letras.</p>
          ) : carregando ? (
            <EsqueletoLista linhas={3} rotulo="Buscando…" />
          ) : !dados || dados.itens.length === 0 ? (
            <EstadoVazio
              compacto
              ilustracao="busca"
              titulo="Ninguém com esse termo"
              descricao="Quem já teve o tratamento encerrado não aparece em busca por nome, e-mail ou telefone — esses dados não existem mais."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-linha rounded-controle border border-linha">
              {dados.itens.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-tinta">
                      {item.nome}
                      {item.origem_dado === "exemplo" && <SeloDadoExemplo />}
                    </p>
                    <p className="text-legenda text-tinta-fraca">
                      {[formatarCidadeUf(item.cidade, item.uf) || null, item.email, item.etapa.replace(/_/g, " ")].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Botao variante="secundario" tamanho="compacto" onClick={() => setEscolhida(item)}>
                    Abrir
                  </Botao>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Cartao>
    </div>
  );
}
