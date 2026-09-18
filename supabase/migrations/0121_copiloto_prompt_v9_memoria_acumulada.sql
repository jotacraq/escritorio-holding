-- 0121_copiloto_prompt_v9_memoria_acumulada.sql
--
-- 18/09/2026 — prompt do copiloto: instrução para USAR a MEMÓRIA
-- (`sessoes_copiloto.resumo_acumulado`, bloco E do contexto — Fatia A,
-- migration 0120). Sem esta instrução, a existência do bloco E no contexto é
-- necessária mas NÃO SUFICIENTE: a IA precisa ser dita, em palavras, que o
-- bloco existe para ORIENTAR a próxima pergunta, não é só mais um dado para
-- ignorar (o defeito medido não era "falta de dado", era "o modelo nunca foi
-- instruído a olhar para trás" — 122 perguntas distintas em 118 min, 49
-- sobre família, ainda 8 perguntas sobre filhos no 4º quarto da sessão com 2h
-- já ouvidas).
--
-- TRÊS INSTRUÇÕES NOVAS, NESTA ORDEM DE FORÇA (pedido do dono):
--
-- (1) PROIBIÇÃO DIRETA de repetir tema que está em `perguntado`. A mais
--     forte das três — vem primeiro, em frase imperativa, não sugestão.
--
-- (2) `proxima_pergunta: null` é RESPOSTA CORRETA quando `pendente` do bloco
--     atual está vazio (tudo já coberto). Sem esta instrução explícita, o
--     modelo INVENTA uma pergunta para preencher o campo obrigatório do
--     schema (schema estrito da IA não muda nesta fatia — `proxima_pergunta`
--     já é nulável desde a v1, 0094; o problema nunca foi o schema, foi o
--     modelo não saber que null é uma resposta VÁLIDA e não uma falha) — foi
--     exatamente o padrão que gerou as 122 perguntas medidas: bloco coberto,
--     a IA perguntou de novo em vez de dizer "nada pendente aqui".
--
-- (3) NÃO RE-DERIVAR o que já está em `perguntado`/`pendente`. O bloco E já
--     chega PRONTO (pendente é DERIVADO NO SERVIDOR, nunca pela IA — decisão
--     do dono, B72) — a IA só CONSOME o que está lá, nunca recalcula por
--     conta própria a partir da janela de transcrição.
--
-- MESMO PADRÃO DA 0107/0110/0112/0116/0119 (regra da casa, sem exceção):
-- NUNCA `update` na versão ativa. Cria a versão nova por `INSERT ... SELECT`,
-- DERIVANDO do `max(versao)` — NÃO de `ativo = true`. Isso vale mesmo que a
-- versão mais recente já publicada não tenha migration própria neste
-- repositório (aplicada direto em produção por uma sessão anterior, mesmo
-- precedente já registrado em 0105/0119: "aplicada em produção via
-- apply_migration") — `max(versao)` sempre pega a cadeia real de capacidades
-- acumuladas (dossiê 0110, inventário 0112, performance 0116, acerto/erro
-- 0119, e qualquer versão intermediária aplicada fora deste repo), nunca um
-- número fixado no código desta migration.
--
-- Nasce `ativo=false` — o dono confere e ativa (mesmo padrão de toda versão
-- de prompt desta família). NENHUMA capacidade anterior é removida ou
-- alterada — só ACRESCENTA a instrução de usar a memória.
--
-- ===========================================================================
-- AS 5 PERGUNTAS DO PROTOCOLO DE SUSTENTABILIDADE
-- ===========================================================================
--
-- 1. Escala — 1 INSERT de 1 linha em `prompts_versoes` (versão nova). Não
--    introduz coluna nem tabela; `corpo_sistema` cresce por um trecho de
--    texto fixo (não escala com uso).
--
-- 2. Índice — não aplicável: nenhum índice novo, nenhuma query nova. A
--    versão ativa já é lida por `(chave, ativo)` (índice existente desde a
--    0009/0042).
--
-- 3. Frequência — mesma cadência do resto do prompt: 1× por chamada de IA do
--    copiloto (ciclo automático ~20s, ou botão "Me ajuda agora"). Nenhuma
--    leitura nova de configuração — o prompt ativo já é lido pelo caminho
--    existente de `executarIaCopiloto`/`executarComAuditoria`.
--
-- 4. Repetição — não aplicável: não há N telas pedindo a mesma coisa.
--
-- 5. Reversão — sem deploy:
--      - a v nasce `ativo=false` — "não usar" é simplesmente não ativar (a
--        versão anterior continua conduzindo a IA).
--      - se já ativada e precisar reverter: reativar a versão anterior pelo
--        mesmo padrão de sempre (`update prompts_versoes set ativo=false
--        where versao=<nova>; update ... set ativo=true where
--        versao=<anterior>`, mesma transação).
--      - o kill-switch de LEITURA do bloco E (`copiloto_sessao.
--        resumo_acumulado`, 0120) é independente: mesmo com este prompt
--        ativo, desligar aquela chave faz o bloco E sair `null` do contexto
--        — a instrução do prompt vira letra morta sem dado para aplicar,
--        nunca um erro.
--
-- MEDIÇÃO — teto de bytes do SCHEMA ESTRITO da IA: NÃO SE APLICA a esta
-- migration. Esta fatia NÃO toca `esquema_saida`/`SugestaoCopilotoIaSchema`
-- (decisão do dono, B72: "não mexer no schema estrito da IA") — só o texto
-- de `corpo_sistema` muda, que não tem o teto de 4096/3.905 bytes das
-- migrations que mexem em `esquema_saida` (0116/0119, que acrescentavam
-- CAMPO novo à saída estruturada). A sonda de schema
-- (`POST /api/admin/sonda-schema`) é para quando `esquema_saida` muda — não
-- é o caso aqui.
--
-- MEDIÇÃO — `explain (analyze)`: PENDENTE, mesma ressalva de toda migration
-- desta família (este agente não tem credencial de banco de produção nesta
-- máquina). Mesmo padrão de plano já medido em 0107/0110/0112/0116/0119: um
-- INSERT de 1 linha sobre `(chave, versao)` (unique da 0009), sub-ms.
--
-- ROTEIRO DE VERIFICAÇÃO (dentro de begin; ...; rollback;):
--   1. select versao, ativo, length(corpo_sistema) from prompts_versoes
--        where chave='copiloto_sessao' order by versao;
--      -> a versão nova aparece com ativo=false e length MAIOR que a
--         anterior (acréscimo).
--   2. select corpo_sistema like '%MEMÓRIA%' and corpo_sistema like
--        '%perguntado%' and corpo_sistema like '%pendente%' from
--        prompts_versoes where chave='copiloto_sessao' and versao=(select
--        max(versao) from prompts_versoes where chave='copiloto_sessao');
--      -> true.
-- ===========================================================================

insert into prompts_versoes (chave, versao, titulo, corpo_sistema, esquema_saida, modelo_padrao, effort, ativo, notas)
select
  chave,
  versao + 1,
  titulo,
  corpo_sistema || $incremento$

MEMÓRIA DO COPILOTO — Fatia A (18/09/2026)

O bloco "resumo_acumulado" do contexto (quando presente) mostra o que JÁ FOI PERGUNTADO nesta
sessão até agora ("perguntado", com o tema e quantas vezes foi tocado) e o que AINDA FALTA no
bloco atual do roteiro ("pendente"). Três regras, NESTA ORDEM DE FORÇA:

1. PROIBIDO perguntar de novo sobre um tema que já está em "perguntado". Se um assunto já foi
   levantado 1 vez ou mais nesta sessão, NÃO o repita em "proxima_pergunta" — mesmo que a
   resposta do cliente tenha sido incompleta ou vaga. Repetir tema já tocado é o defeito que
   esta instrução existe para corrigir: uma sessão real chegou a perguntar sobre família 49
   vezes em 118 minutos, incluindo 8 vezes já na reta final, com duas horas de conversa já
   ouvidas.

2. "proxima_pergunta": null é uma RESPOSTA CORRETA, não uma falha sua, sempre que "pendente"
   do bloco atual estiver vazio (nada mais a perguntar naquele bloco) ou quando tudo que resta
   perguntar já foi coberto por "perguntado". NÃO invente uma pergunta só para preencher o
   campo — devolver null nesse caso é exatamente o comportamento esperado, e o servidor sabe
   interpretar: ele mostra à advogada que os temas deste bloco estão cobertos e aponta o
   próximo bloco.

3. NÃO tente re-derivar ou recalcular "perguntado"/"pendente" a partir da janela de
   transcrição — esses dois campos já vêm PRONTOS, calculados pelo servidor a partir de toda a
   sessão (não só dos últimos ~90 segundos que você vê). Sua única tarefa é CONSULTAR esse
   bloco antes de decidir "proxima_pergunta", nunca reconstruí-lo.

Nenhuma das regras anteriores desta saída (formato dos outros campos, disciplina de evidência,
proibição de valor em reais, proibição de fala pronta, teto de itens em falta_no_bloco/
cobriu_no_bloco) muda com esta instrução.
$incremento$,
  esquema_saida,
  modelo_padrao,
  effort,
  false, -- nasce desligada — ativação é passo de operação, ver cabeçalho
  coalesce(notas, '') || ' | v' || (versao + 1) || ': memoria do copiloto, Fatia A (18/09/2026) — '
  || 'instrui a IA a USAR resumo_acumulado (bloco E): proibicao de repetir tema perguntado, '
  || 'proxima_pergunta=null como resposta correta quando o bloco esta coberto, proibicao de '
  || 're-derivar perguntado/pendente. Nao muda esquema_saida (schema estrito intacto, B72). '
  || 'Kill-switch do BLOCO (dado): copiloto_sessao.resumo_acumulado (0120).'
from prompts_versoes
-- deriva da MAIOR versão existente, NÃO da ativa — mesmo raciocínio das
-- migrations irmãs (0110/0112/0116/0119): a versão mais recente pode ter
-- nascido desligada e carregar capacidades que `ativo=true` ainda não tem
-- (dossiê, inventário, performance, acerto/erro) — derivar da ativa
-- perderia essas capacidades se a versão mais recente ainda não tiver sido
-- promovida.
where chave = 'copiloto_sessao'
  and versao = (select max(versao) from prompts_versoes where chave = 'copiloto_sessao')
on conflict (chave, versao) do nothing;
