-- 0073_ligacao_ia_janela_retencao.sql
-- Fase 7 · agente LIG — janela de discagem, retenção de voz e o token do link
-- de agendamento emitido pelo sistema.
--
-- Aplicar depois da 0053 (`ligacoes_ia`) e da 0072 (`links_publicos` só por RPC).
--
-- TUDO ADITIVO: nenhuma coluna some, nenhum valor de cliente é reescrito, nenhum
-- DELETE. O código de `src/server/ligacao-ia/*` FUNCIONA SEM esta migration —
-- é requisito da casa. O que muda ao aplicá-la:
--   (a) `ligacao_ia.janela` passa a ser editável em Admin → Configurações (antes,
--       o default do código valia e a tela dizia "padrão do código");
--   (b) `ligacoes_ia.expurgado_em` passa a existir e a etapa de retenção sai de
--       `pulada: 'coluna_ausente'`;
--   (c) `ligacoes_ia.token_link_cifrado` passa a existir e o link de agendamento
--       do sistema sobrevive a restart sem revogar o link que a equipe enviou.
--
-- Sem ela, na ordem: (a) a janela é a do código (seg–sex 9h–19h, America/Sao_Paulo);
-- (b) nada é expurgado (que é o default de qualquer forma); (c) volta o
-- comportamento de memória da Fase 4.

-- ===========================================================================
-- (a) Colunas novas em `ligacoes_ia`
-- ===========================================================================

-- Carimbo da retenção de voz (LGPD, B19). NULL = nunca expurgada. O expurgo
-- zera `transcricao` e `gravacao_url` e MANTÉM `resumo`, `custo_usd`,
-- `duracao_segundos` e `resultado`: o registro de que a ligação existiu, quanto
-- custou e no que deu continua auditável.
alter table ligacoes_ia add column if not exists expurgado_em timestamptz;

-- Token do link `/p/a` que o SISTEMA emitiu para esta ligação, CIFRADO
-- (AES-256-GCM, chave derivada por HKDF do `LINK_PUBLICO_PEPPER`, que vive só
-- na env do servidor). Ver `src/server/ligacao-ia/token-cifrado.ts`.
--
-- POR QUE ISTO EXISTE: `links_publicos` guarda só `sha256(token || pepper)` —
-- de propósito. O processo Next.js guardava o token em memória para o fallback
-- reenviar o MESMO link; depois de um deploy a memória sumia, o sistema emitia
-- outro link e `emitir_link_agendamento_sistema` REVOGAVA o ativo. Se quem
-- emitiu o anterior foi uma pessoa da equipe e já mandou ao cliente, o link do
-- cliente morria sem aviso.
--
-- POR QUE NÃO DUAS LINHAS ATIVAS: `uniq_link_ativo (jornada_id, tipo) where
-- estado='ativo'` (0028) é o que sustenta a promessa "emitir de novo revoga o
-- anterior" da barra Enviar. Derrubar esse índice mudaria o modelo de segurança
-- dos links inteiro; guardar o token cifrado não encosta nele.
--
-- POR QUE CIFRADO E NÃO EM CLARO: em claro, um vazamento do banco viraria
-- vazamento de link de cliente — exatamente o que a 0028 evita. Sem o pepper
-- certo, esta coluna não vale nada.
alter table ligacoes_ia add column if not exists token_link_cifrado text;

comment on column ligacoes_ia.expurgado_em is
  'Quando a retenção de voz (configuracoes[''ligacao_ia.retencao_dias'']) apagou transcricao e gravacao_url. '
  'NULL = nunca expurgada. Resumo, custo e duração são preservados.';
comment on column ligacoes_ia.token_link_cifrado is
  'Token do link /p/a emitido PELO SISTEMA para esta ligação, cifrado com chave derivada de LINK_PUBLICO_PEPPER '
  '(AES-256-GCM, server/ligacao-ia/token-cifrado.ts). NUNCA em claro, nunca devolvido por rota. '
  'Existe para o fallback reenviar o MESMO link sem revogar o link que a equipe já mandou ao cliente.';

-- A coluna é segredo derivado: `authenticated` já não podia escrever em
-- `ligacoes_ia` (0053 dá grant só de `status`), mas SELECT é liberado para a
-- equipe (`lia_sel`). Revogar a leitura desta coluna específica evita que ela
-- vaze pelo `select *` da Ficha e do histórico.
revoke select (token_link_cifrado) on ligacoes_ia from authenticated;

-- Índice do expurgo: só as terminais e ainda não expurgadas interessam. Parcial
-- e pequeno — a varredura do cron não faz Seq Scan na tabela inteira.
create index if not exists idx_ligacoes_ia_expurgo
  on ligacoes_ia (encerrada_em)
  where expurgado_em is null and status in ('concluida', 'sem_resposta', 'falhou', 'cancelada');

-- ===========================================================================
-- (b) Configurações novas — UPSERT QUE NÃO SOBRESCREVE valor existente
-- ===========================================================================
insert into configuracoes (chave, valor, descricao) values
 ('ligacao_ia.janela',
  '{"dias":[1,2,3,4,5],"inicio":"09:00","fim":"19:00","fuso":"America/Sao_Paulo"}'::jsonb,
  'VALOR INICIAL (não vem do método): horário em que a IA pode ligar sozinha. dias: 0=domingo..6=sábado; inicio/fim em HH:MM no fuso (IANA); fim exclusivo. Vale para a fila do cron e para a retentativa. O botão "Ligar por IA agora" da Ficha ignora a janela de propósito (é ordem de gente) e a tela avisa. A Dra. Elaine confirma a faixa.'),
 ('ligacao_ia.retencao_dias',
  'null'::jsonb,
  'VALOR INICIAL (decisão de LGPD pendente — B19): dias após o fim da ligação em que transcrição e gravação são apagadas. null (ou 0) = NÃO expurga nada, que é o padrão até a Dra. Elaine decidir. Resumo, custo, duração e resultado nunca são apagados.')
on conflict (chave) do nothing;

-- ===========================================================================
-- ROTEIRO DE VERIFICAÇÃO: scripts/verificacao-0073.sql (idempotente, com
-- `raise exception` em falha). O orquestrador aplica esta migration e roda o
-- roteiro; nenhum agente aplica migration.
--
-- REVERSÃO:
--   drop index if exists idx_ligacoes_ia_expurgo;
--   alter table ligacoes_ia drop column if exists token_link_cifrado;
--   alter table ligacoes_ia drop column if exists expurgado_em;
--   delete from configuracoes where chave in ('ligacao_ia.janela', 'ligacao_ia.retencao_dias');
-- Atenção: derrubar `expurgado_em` apaga o registro de QUE ligações foram
-- expurgadas — a transcrição, essa, já não volta.
-- ===========================================================================
