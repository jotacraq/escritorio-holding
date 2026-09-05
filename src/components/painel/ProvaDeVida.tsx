"use client";

import { useCallback } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { formatarDataHora, formatarRelativo } from "@/lib/formatar";
import { Cartao } from "@/components/ui/Cartao";
import { EsqueletoLinha } from "@/components/ui/Esqueleto";
import { EstadoErro } from "@/components/ui/Estado";
import { Selo, SeloStub } from "@/components/ui/Selo";
import { buscarProvaDeVida, motivoDoTemplate } from "./api-regua";
import { LinkBotao } from "./LinkBotao";

const ICONE_CHECK = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 10.5l3.6 3.5 7.4-8" />
  </svg>
);

/**
 * "Prova de vida da esteira" (Fase 4 §1.6): a régua de mensagens só sai se
 * o cron da Hostinger chamar `/api/cron/regua`. Este bloco mostra a última
 * passagem registrada (`configuracoes['regua.ultimo_cron_em']`, via o bloco
 * `regua` de `GET /api/mensagens`) e o que está na fila. Enquanto a API não
 * expõe o bloco, o texto diz "cron ainda não configurado" — rotulado, nunca
 * vazio mudo. Sem polling: um fetch ao montar e um a cada "Atualizar".
 */
export function ProvaDeVida({ versao }: { versao: number }) {
  const buscar = useCallback(() => buscarProvaDeVida(), []);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, [versao]);
  const proxima = dados?.pendentes[0];

  return (
    <Cartao rotulo="Esteira automática" titulo="Prova de vida da esteira" descricao="A régua só envia e-mail e WhatsApp se o cron da Hostinger passar aqui a cada 5 minutos." acao={<LinkBotao href="/comunicacao">Abrir Comunicação</LinkBotao>}>
      {carregando && !dados && (
        <div role="status" aria-live="polite" className="flex flex-col gap-3">
          <span className="sr-only">Carregando a prova de vida…</span>
          <EsqueletoLinha largura="w-2/3" altura="h-5" />
          <EsqueletoLinha largura="w-1/2" altura="h-5" />
        </div>
      )}

      {Boolean(erro) && !dados && <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não deu para ler a fila de mensagens" />}

      {dados && (
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <dt className="text-rotulo font-medium uppercase text-tinta-fraca">Última passagem do cron</dt>
            <dd className="flex flex-col gap-2 text-sm text-tinta">
              {dados.regua === null && (
                <SeloStub texto="Cron ainda não configurado — o sistema ainda não registra a última passagem da régua. Falta o cron da Hostinger chamar /api/cron/regua a cada 5 minutos com o CRON_SECRET de produção." />
              )}
              {dados.regua !== null && dados.regua.ultimo_cron_em === null && (
                <>
                  <Selo tom="ambar">Nunca rodou</Selo>
                  <p className="text-xs text-tinta-suave">A rota existe, mas nenhuma passagem foi registrada ainda. Confira o cron da Hostinger.</p>
                </>
              )}
              {dados.regua !== null && dados.regua.ultimo_cron_em !== null && (
                <>
                  <span className="flex flex-wrap items-center gap-2">
                    <Selo tom={dados.regua.cron_atrasado ? "ambar" : "verde"} icone={dados.regua.cron_atrasado ? undefined : ICONE_CHECK}>
                      {dados.regua.cron_atrasado ? "Atrasada" : "Rodando"}
                    </Selo>
                    <span>{formatarRelativo(dados.regua.ultimo_cron_em)}</span>
                  </span>
                  <p className="text-xs text-tinta-suave">{formatarDataHora(dados.regua.ultimo_cron_em)}</p>
                </>
              )}
            </dd>
          </div>

          <div className="flex flex-col gap-1.5">
            <dt className="text-rotulo font-medium uppercase text-tinta-fraca">Aguardando envio</dt>
            <dd className="flex flex-col gap-1 text-sm text-tinta">
              {dados.pendentes.length === 0 ? (
                <span className="text-tinta-suave">Nenhuma mensagem na fila agora.</span>
              ) : (
                <>
                  <span>
                    <span className="text-subtitulo font-bold tabular-nums">{dados.pendentes.length}</span> {dados.pendentes.length === 1 ? "mensagem" : "mensagens"}
                  </span>
                  {proxima && (
                    <span className="text-xs text-tinta-suave">
                      Próxima: {motivoDoTemplate(proxima.template_chave)}
                      {proxima.pessoa_nome ? ` para ${proxima.pessoa_nome}` : ""} · {formatarDataHora(proxima.agendada_para)}
                    </span>
                  )}
                </>
              )}
            </dd>
          </div>
        </dl>
      )}
    </Cartao>
  );
}
