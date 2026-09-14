-- 0099_remove_trava_juridica_copiloto.sql
--
-- ⚠️ ESTE ARQUIVO FOI ESCRITO DEPOIS DE A MIGRATION JÁ TER SIDO APLICADA.
-- Em 14/09/2026 eu apliquei este SQL direto no banco por MCP, durante a
-- validação ao vivo, e NÃO criei o arquivo no repo na hora. Resultado: o banco
-- ficou com uma 0099 e uma 0100 que não existiam aqui, e a migration seguinte
-- (warm-up) nasceu numerada 0099 também. Materializado agora para que um
-- ambiente novo reproduza produção. Lição: aplicar por MCP sem escrever o
-- arquivo cria divergência silenciosa entre repo e banco.
--
-- ===========================================================================
-- REMOVE o gate jurídico do copiloto ao vivo.
--
-- DECISÃO DO MARCIO, 14/09/2026, explícita e reafirmada depois de eu apontar o
-- risco duas vezes. Registrado aqui porque quem ler este banco daqui a seis
-- meses precisa saber que a ausência da trava foi ESCOLHA, não esquecimento.
--
-- O QUE ISTO SIGNIFICA NA PRÁTICA:
--   - o bot de terceiro (Recall.ai, us-east-1, FORA DO BRASIL) pode entrar em
--     qualquer sessão e gravar áudio/vídeo de família discutindo patrimônio,
--     herança e morte, SEM nenhum registro de quem autorizou;
--   - `copiloto_sugestoes` aceita INSERT sem consentimento do titular;
--   - revogar consentimento de um titular NÃO impede mais nada no banco.
--
-- O QUE SOBROU DE PROTEÇÃO (não foi removido):
--   - `copiloto_sessao.ativo`, `audio_ao_vivo`, `provedor_audio` seguem sendo
--     interruptores reais;
--   - RLS `ve_patrimonio()` nas tabelas do copiloto segue intacta;
--   - `desfecho` imutável (0095) segue intacto.
--
-- O QUE CONTINUA VERDADEIRO E NÃO DEPENDE DE MIGRATION:
--   o 1º SIM que o cliente ouve diz "vou gravar para que MINHA EQUIPE analise
--   DEPOIS". Com o bot: quem grava é um TERCEIRO, quem analisa é uma IA, e é
--   DURANTE. Enquanto o roteiro v5 (B66) não for publicado pela Dra. Elaine, a
--   gravação acontece sob um consentimento que não descreve o que ocorre.
--
-- COMO VOLTAR ATRÁS (uma linha por trigger — a FUNÇÃO foi preservada):
--   create trigger trg_copiloto_exige_decisao_sugestoes before insert on
--     copiloto_sugestoes for each row
--     execute function app.exige_decisao_copiloto_ao_vivo();
--   create trigger trg_copiloto_exige_decisao_segmentos_bot before insert on
--     sessoes_copiloto_segmentos for each row when (new.origem = 'bot')
--     execute function app.exige_decisao_copiloto_ao_vivo();
--   create trigger trg_copiloto_exige_decisao_bot_pedido before insert or
--     update of gravacao_externa_id on sessoes_copiloto for each row
--     when (new.gravacao_externa_id is not null)
--     execute function app.exige_decisao_copiloto_ao_vivo();
-- ===========================================================================

drop trigger if exists trg_copiloto_exige_decisao_sugestoes     on copiloto_sugestoes;
drop trigger if exists trg_copiloto_exige_decisao_segmentos_bot on sessoes_copiloto_segmentos;
drop trigger if exists trg_copiloto_exige_decisao_bot_pedido    on sessoes_copiloto;

comment on function app.exige_decisao_copiloto_ao_vivo() is
  'Fase 10. PRESERVADA, mas DESLIGADA em 14/09/2026 pela 0099 (decisao do Marcio). As 3 triggers que a usavam foram removidas. A funcao fica aqui para religar em uma linha quando/se a decisao juridica passar a ser registrada. Ver o cabecalho da 0099.';
