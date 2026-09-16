-- 0107_copiloto_prompt_v3_inferencia_bloco.sql
-- Fase 12 · Fatia 1 — 3ª correção do Fable, achada em produção antes de
-- publicar: a 0106 originalmente fazia `update prompts_versoes ... where
-- chave='copiloto_sessao' and versao=1` para acrescentar a regra de
-- `bloco_inferido` ao corpo do prompt. Medido no banco real
-- (`fcfsnqqaphtamhrpuyoh`) por quem revisou a entrega:
--
--   chave            | versao | ativo | tamanho | tem "FASE 12"?
--   copiloto_sessao  |   1    | false |  4880   | não
--   copiloto_sessao  |   2    | TRUE  |  4612   | não
--
-- A v1 nunca foi ativada (a premissa da 0106 estava certa quanto a ISSO),
-- mas é a v2 que está ATIVA hoje — uma versão que a 0106 nem sabia que
-- existia (nasceu depois da 0094, fora do escopo lido por este agente). Um
-- UPDATE na v1 não teria efeito nenhum: a IA que roda de verdade continuaria
-- sem o pedido de inferir o bloco, `bloco_inferido` voltaria sempre ausente,
-- e a tela ficaria em "ainda identificando…" a sessão inteira — sobe inerte,
-- sem erro, sem alarme, só descoberto em produção.
--
-- CORREÇÃO: cria a v3 por INSERT ... SELECT, DERIVANDO o corpo da v2 (a que
-- está ativa) + o mesmo bloco "FASE 12 — INFERÊNCIA DO BLOCO ATUAL" que a
-- 0106 escrevia — nunca por UPDATE (regra da casa, CLAUDE.md: "prompt é
-- versionado", sem exceção desta vez). `ativo` nasce FALSE: sobe desligada,
-- liga por SQL — mesmo padrão de todo prompt novo desta base (0070, 0090,
-- 0094).
--
-- ⚠️ Este agente NÃO tem acesso ao banco de produção nesta máquina e NÃO
-- buscou credencial nenhuma. A migration NÃO reproduz o corpo da v2 de
-- memória (não foi lido) — deriva por SQL (`select corpo_sistema from
-- prompts_versoes where chave=... and versao=2`), então o texto-base é
-- SEMPRE o real de produção, qualquer que ele seja. `on conflict (chave,
-- versao) do nothing` (unique de 0009) — reaplicar a migration não duplica
-- nem sobrescreve.
--
-- ATIVAÇÃO — PASSO DE OPERAÇÃO, NÃO PARTE DESTA MIGRATION (mesma regra dos
-- interruptores: sobe desligado, liga por SQL, só depois da sonda de schema
-- + bancada de latência de praxe, CLAUDE.md/0094):
--   begin;
--     update prompts_versoes set ativo = false where chave = 'copiloto_sessao' and versao = 2;
--     update prompts_versoes set ativo = true  where chave = 'copiloto_sessao' and versao = 3;
--   commit;
--   -- `uniq_prompt_ativo` (0009, unique parcial em (chave) where ativo) exige
--   -- que a v2 seja desativada ANTES (ou na mesma transação) da v3 ativar —
--   -- a ordem acima já respeita isso.
--
-- ROLLBACK DA ATIVAÇÃO (volta a v2 a valer, se a v3 se comportar mal):
--   begin;
--     update prompts_versoes set ativo = false where chave = 'copiloto_sessao' and versao = 3;
--     update prompts_versoes set ativo = true  where chave = 'copiloto_sessao' and versao = 2;
--   commit;
--
-- ROLLBACK DESTA MIGRATION (remove a v3; só é seguro se ela nunca tiver sido
-- ativada — se `ativo=true`, ativar a v2 de volta ANTES, pelo bloco acima):
--   delete from prompts_versoes where chave = 'copiloto_sessao' and versao = 3;
--
-- MEDIÇÃO — `insert ... select ... where chave=$1 and versao=$2 on conflict
-- (chave, versao) do nothing`: o SELECT interno usa a mesma unique (chave,
-- versao) de 0009 (Index Scan, igualdade nas duas colunas) — mesmo padrão já
-- medido em produção para toda leitura de `prompts_versoes` por essa chave
-- (0042, 0059, 0066, 0090, 0094); o INSERT resultante é 1 linha, sem
-- varredura. Nenhum SELECT sem predicado, nenhuma tabela nova, nenhum índice
-- novo.
-- ===========================================================================

insert into prompts_versoes (chave, versao, titulo, corpo_sistema, esquema_saida, modelo_padrao, effort, ativo, notas)
select
  chave,
  3,
  titulo,
  corpo_sistema || $incremento$

FASE 12 — INFERÊNCIA DO BLOCO ATUAL (acréscimo ao contrato de saída acima)

Além dos campos originais, sua saída agora tem um campo adicional, `bloco_inferido`, que
responde a uma pergunta DIFERENTE de `desvio_sugerido`: não "para onde a sessão deveria ir",
mas "em que bloco do roteiro a conversa está AGORA, a julgar pela fala dos últimos ~90
segundos".

- `bloco_inferido`: objeto com `bloco_id` (de um bloco que existe LITERALMENTE na lista de
  blocos do roteiro ativo que você recebeu), `confianca` (0 a 1) e `evidencia` (uma citação
  literal da janela de transcrição que sustenta a inferência, até 200 caracteres) — ou nulo.

REGRA DURA, sem exceção: `bloco_inferido.bloco_id` só pode ser um id presente na lista de
blocos que você recebeu. Se a fala dos últimos 90 segundos não permitir identificar com
segurança em que bloco a conversa está, devolva `bloco_inferido: null` — NUNCA o bloco
anterior por inércia, e nunca um palpite sem uma citação literal que o sustente. Um
`bloco_inferido` errado move o ponteiro que a advogada vê na tela; "não sei" aqui é sempre
preferível a um palpite fraco disfarçado de fato.
$incremento$,
  esquema_saida,
  modelo_padrao,
  effort,
  false, -- nasce desligada — ativação é passo de operação, ver cabeçalho
  coalesce(notas, '') || ' | v3: acrescenta bloco_inferido (Fase 12, Fatia 1) ao corpo da v2.'
from prompts_versoes
where chave = 'copiloto_sessao' and versao = 2
on conflict (chave, versao) do nothing;
