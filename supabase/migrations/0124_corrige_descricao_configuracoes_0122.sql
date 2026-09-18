-- 0124_corrige_descricao_configuracoes_0122.sql
--
-- CORREÇÃO DE TEXTO (achado do Fable, 3ª rodada, 18/09/2026) — a 0122 JÁ
-- ESTÁ APLICADA em produção (fcfsnqqaphtamhrpuyoh), então corrigir só o
-- arquivo da 0122 não basta: a `descricao` errada já está gravada no banco
-- e é o que qualquer admin lê hoje pela tela/REST. Esta migration faz
-- `update configuracoes set descricao=...` nas mesmas 5 chaves da 0122 —
-- NENHUM `valor` muda, só o TEXTO que explica cada chave para quem não leu
-- o código.
--
-- O QUE ESTAVA ERRADO
--
--   (1) `copiloto_sessao.rodape_transcricao` prometia "FALSE volta ao
--       layout anterior (aba propria)". A aba própria
--       (`ColunaTranscricaoInventario`) foi REMOVIDA neste mesmo diff
--       (−105 linhas) — não existe layout anterior para voltar. Decisão de
--       produto (do dono, já tomada nesta rodada): `false` agora significa
--       ESCONDER o rodapé, não trocar de layout.
--
--   (2) `copiloto_sessao.silencio_atencao_s` e `silencio_alerta_s` diziam
--       "Lido por lerConfiguracaoInt" — nome que nunca existiu para leitura
--       em LOTE (a função unitária existe, mas não é quem lê estas 2
--       chaves). O nome real, depois da correção desta mesma rodada
--       (`server/ia/configuracao.ts`), é `lerConfiguracoesEmLote` — leitor
--       único que resolve bool + int + json numa só ida ao banco por tick
--       de polling (substituiu as 3 idas que a 2ª rodada tinha deixado).
--
--   (3) `copiloto_sessao.ficha_cliente` e `copiloto_sessao.ficha_teto_fixos`
--       citavam, respectivamente, `lerConfiguracoesBool` e
--       `lerConfiguracaoJson` — corretos na 2ª rodada, mas ambos deixaram de
--       ser o leitor real depois desta correção: as 5 chaves da 0122 agora
--       passam pelo MESMO `lerConfiguracoesEmLote`, no mesmo lote das
--       demais flags do polling.
--
-- NENHUMA chave, NENHUM `valor` de nascença muda aqui — só a `descricao`,
-- para o texto no banco bater com o comportamento real do código e com o
-- arquivo da 0122 (corrigido na mesma rodada).
--
-- ROLLBACK: não aplicável a perda de dado (é troca de texto por texto);
-- para desfazer, reaplicar a `descricao` anterior de cada chave está
-- registrado no histórico de `0122_copiloto_ficha_cliente.sql` anterior a
-- esta correção (git).
-- ===========================================================================

update configuracoes set descricao =
  '18/09/2026 — liga a EXIBICAO da Ficha do cliente na coluna 3 da tela '
  '/conduzir (server/copiloto/ficha.ts + estado.ts::montarEstadoCopiloto). '
  'Nasce FALSE (feature nova de tela — o dono confere e ativa depois de '
  'medir, mesma disciplina de toda feature nova do copiloto ao vivo). '
  'FALSE nao impede o ACUMULADOR de continuar gravando itens novos em '
  'sessoes_copiloto.ficha_acumulada (desligar e sobre o que a TELA mostra, '
  'nao sobre o que se grava — mesmo raciocinio de '
  'copiloto_sessao.inventario_mencionado, 0111). Lido por '
  'lerConfiguracoesEmLote (server/ia/configuracao.ts).'
 where chave = 'copiloto_sessao.ficha_cliente';

update configuracoes set descricao =
  '18/09/2026 — teto de quantos itens FIXOS da Ficha do cliente aparecem '
  'sempre visiveis na tela, sem rolagem. NULL (o padrao de fabrica) faz a '
  'TELA derivar o teto do VIEWPORT do dispositivo (decisao do arquiteto: '
  'altura de card em 768p com escala de 18px nao fecha com um numero fixo '
  'generico para todo tamanho de tela). Gravar um NUMERO aqui faz esse '
  'valor VENCER a derivacao automatica — override explicito, sem deploy, '
  'para o dia em que a Dra. Elaine pedir um teto fixo por qualquer motivo '
  'de metodo. Lido por lerConfiguracoesEmLote (server/ia/configuracao.ts), '
  'tipo "json": o valor NULL e um 3o estado valido (deriva do viewport), '
  'nunca colapsado em 0 nem tratado como chave ausente.'
 where chave = 'copiloto_sessao.ficha_teto_fixos';

update configuracoes set descricao =
  '18/09/2026 — mostra a transcricao bruta como RODAPE sempre visivel na '
  'tela /conduzir, substituindo a aba propria que a advogada nunca '
  'clicava. Nasce TRUE (e reorganizacao de UI sobre um dado que ja existe '
  'e ja e exibido hoje, nao uma capacidade nova a testar com cautela — '
  'diferente de copiloto_sessao.ficha_cliente acima). FALSE esconde o '
  'rodape (decisao do dono, 18/09/2026, 3a rodada: a aba propria '
  '(ColunaTranscricaoInventario) foi REMOVIDA neste mesmo diff — nao ha '
  'layout anterior para voltar). Lido por lerConfiguracoesEmLote '
  '(server/ia/configuracao.ts).'
 where chave = 'copiloto_sessao.rodape_transcricao';

update configuracoes set descricao =
  '18/09/2026 — segundos de silencio na sala a partir dos quais a tela '
  '/conduzir acende o indicador visual de ATENCAO (nivel mais brando). '
  'Editavel sem deploy. Lido por lerConfiguracoesEmLote '
  '(server/ia/configuracao.ts).'
 where chave = 'copiloto_sessao.silencio_atencao_s';

update configuracoes set descricao =
  '18/09/2026 — segundos de silencio na sala a partir dos quais a tela '
  '/conduzir acende o indicador visual de ALERTA (nivel mais forte, acima '
  'de copiloto_sessao.silencio_atencao_s). Editavel sem deploy. Lido por '
  'lerConfiguracoesEmLote (server/ia/configuracao.ts).'
 where chave = 'copiloto_sessao.silencio_alerta_s';
