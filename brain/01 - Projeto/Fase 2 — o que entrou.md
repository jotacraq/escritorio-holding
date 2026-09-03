# Fase 2 — o que entrou (03/09/2026, madrugada)

O João avaliou o MVP e disse: *"ainda está muito cru sobre o que a gente pediu, faltam muitas features"*. Esta é a rodada que fechou o gap entre o método da Dra. Elaine e o que o sistema fazia.

Plano completo: `C:\Users\João\projetos\sic-hf\docs\ARQUITETURA-FASE-2.md`.

## A ideia que organiza tudo

**O cliente passa a ser ator do sistema sem virar usuário do sistema.** Ele responde formulário, escolhe horário, envia documento e lê o material — tudo por **link público**, uma credencial de finalidade única presa a uma jornada, com prazo, contador de uso e trilha de auditoria. `pessoas.auth_user_id` continua NULL: ninguém cria conta.

## O que passou a existir

| Área | O que entrou |
|---|---|
| **Superfície pública** | Formulário do POP 02, escolha de horário, envio de documento e leitura do material — tudo pelo celular, sem senha. Quatro finalidades, quatro links distintos. |
| **Painel do dia** | A primeira tela deixa de ser um kanban para varrer: sessões de hoje · preparo pendente · **pagou e ninguém falou com a pessoa** · travado · números da semana. |
| **Agenda** | Janelas de disponibilidade e bloqueios da advogada. O slot livre é **derivado na consulta**, nunca materializado. |
| **Admin de verdade** | Equipe e convites, produtos, templates, versões de prompt, edições, configurações, custo de IA e **pendências** — o que travou e antes só aparecia rodando SQL à mão. |
| **Importação de leads** | CSV com casamento de coluna na tela e **prévia antes de acontecer**: quantos novos, quantos já existem e por qual chave casaram, quantas linhas têm problema. |
| **Roteiros como dado** | As 4 guias do script viram versões (a 4ª ativa); POP 03 e POP 03-B idem. Toda sessão guarda com qual versão foi conduzida. |
| **Modo conduzir sessão** | O roteiro na tela durante a reunião: uma parte por vez, navegação por teclado, os 4 SIMs virando registro no ato, e a oferta do croqui registrada na hora. |
| **Material pós-sessão** | Personalizado pela dor declarada, com a fonte gravada. Sem fonte, material padrão **rotulado como padrão**. |
| **Módulo 4** | 70 transcrições reais no banco (52 sessões + 18 croquis), 52 casos, 18 pares, busca full-text. |
| **Modo demonstração da IA** | Sem chave da Anthropic, um exemplo fixo — carimbado no banco, com selo na tela e **marca d'água até na impressão**. |

## Decisões que valem para sempre

- **Regra de negócio que só existe na rota não existe.** O PostgREST é uma segunda porta para a mesma tabela. Tudo que protege dinheiro, comunicação ou consentimento virou trigger ou RPC `security definer`, com escrita revogada de `authenticated`.
- **A IA ordena, não escolhe.** O método não define o que torna um horário "melhor" — nenhum POP, nenhum protocolo. Então a IA **ordena** os horários que a advogada abriu e escreve o motivo; sem evidência, ordem cronológica e a palavra "sugestão" não aparece.
- **"Sem desfecho conhecido" não é perda.** 18 casos avançaram para croqui; 34 são indefinidos. Os dois números aparecem separados e nunca viram uma taxa de conversão — o material não prova o contrário para as 34.
- **Material não sai sem aprovação humana.** É publicidade de advocacia assinada por uma advogada.
- **Pesquisa em fonte pública entra sem coletor.** Registro manual, com trava de consentimento no banco. Quando a decisão jurídica vier, ligar é `UPDATE` — e não haverá nenhum dado coletado indevidamente para desfazer.
- **Ingestão do Módulo 4 sem `service_role`**: a escrita foi dada ao papel `admin`, que é o dono legítimo do material — mesmo recorte que já vale para prompt, template e roteiro.

## Migrations da fase

`0027` travas do pentest + configurações · `0028` links públicos · `0029` agenda · `0030` roteiros e 4 SIMs · `0031` material · `0032` base de conhecimento · `0033` admin · `0034` painel do dia · `0035` importação · `0036` pesquisa em fonte pública · `0037` ingestão por admin.

Todas aplicadas. Detalhe em [[04 - Tecnico/Schema]].

## Defeitos reais achados no caminho

- A emissão de link de agendamento não populava os horários ofertados — a página do cliente abriria vazia.
- A remarcação editava `inicio_em`, o que um trigger da fase 1 recusa: viraria 500 em vez de erro tratado.
- As réguas de agendamento não eram `security definer` — **todo agendamento criado por usuário real falharia em produção**.
- `RAISE` com `%` sem argumento quebrava a aplicação de uma migration inteira.
- A verificação de policy escrita no plano testava o código errado (`polcmd='a'` é INSERT; ALL é `'*'`).
