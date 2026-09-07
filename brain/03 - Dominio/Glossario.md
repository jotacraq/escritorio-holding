# Glossário do SIC-HF

Vocabulário do negócio. **Estes são os nomes que valem no código, no banco e na tela.**

| Termo | O que é | O que NÃO é |
|---|---|---|
| **Seminário** | Lançamento gratuito de 3 dias da Dra. Elaine. Recapta leads em massa. Tem **edições** por mês (jun/jul/ago/set/out/dez). | Não é a sessão. Não é pago. |
| **Edição do seminário** | Uma rodada específica do seminário. É a **origem** do lead — todo cliente tem que ser rastreável até a edição de onde veio. | Não é uma turma com progresso. |
| **Lead** | Pessoa que passou pelo seminário (ou entrou por outra porta) e ainda não comprou a Sessão de Viabilidade. | Não é cliente. |
| **MQL** | Lead com patrimônio declarado **acima de R$ 1 milhão** — o corte de interesse comercial. | Não é quem comprou. |
| **Cliente** | Quem **comprou** a Sessão de Viabilidade (pagamento confirmado na Hotmart). | Não é quem só agendou. |
| **Sessão de Viabilidade (SV)** | Reunião técnica paga, conduzida pela Dra. Elaine, que diagnostica se a Holding Familiar serve para aquela família. Termina com a oferta do Croqui. | **Não é reunião de vendas.** É diagnóstico estratégico (princípio do documento institucional). |
| **Croqui Estrutural** | Estudo técnico pago (R$ 7.200 padrão; R$ 4.500 no "Incentivo do Resolvedor", para quem decide na hora). Planta baixa da holding: cenários, distribuição dos bens, comando, orçamento de custos e impostos. | **Não é o produto.** É prescrição técnica. |
| **Holding** | Contratação final, a execução da estrutura. Sessão e croqui são abatidos dos honorários. | — |
| **Formulário Estratégico** | POP 02. 17 perguntas, máx. 3 min, respondido **antes** da SV. Hoje vive no Typeform; migra para o sistema. | Não é cadastro. Não tem pergunta técnica. |
| **Ligação Estratégica** | POP 03. Ligação **humana** de até 5 min, feita pela equipe de relacionamento antes da SV. Colhe expectativa, preocupação, processo decisório e sinais comportamentais. | **Não é entrevista, não é venda, não é mini-sessão.** O cliente não pode perceber que está sendo avaliado. |
| **Briefing Estratégico** | Saída da IA antes da SV: DISC provável, arquétipo patrimonial, motivador, objeção provável, processo decisório, linguagem recomendada, frases-âncora, estratégia de condução e de fechamento, **grau de confiança**. | Não é resumo. Não pode ser genérico. |
| **Relatório da SV** | Documento preenchido pela advogada durante/depois da sessão: composição familiar, composição patrimonial detalhada, receita, ITCMD/ITBI/cartórios, resultado. | Não é o briefing (briefing é ANTES, relatório é DEPOIS). |
| **Arquétipo Patrimonial** | Construtor · Patriarca · Protetor · Empresário · Planejador · Investidor · Realizador. Escolhe-se **apenas um**. | — |
| **DISC** | Perfil comportamental (D/I/S/C) inferido de linguagem, velocidade de decisão, palavras e contexto — **nunca de profissão ou idade**. Sempre com grau de confiança. | Não é classificado durante a ligação; é inferido depois. |
| **Os 4 SIMs** | Abertura da SV: sigilo/gravação · licitude · presença dos decisores · aceite do próximo passo (croqui). | — |
| **Decisor conjunto / Influenciador / Comunicador** | Três papéis distintos na decisão familiar. Só o **decisor conjunto** trava a contratação. Distinção obrigatória no Briefing. | — |

## A língua do advogado (Fase 8, 07/09/2026)

Quatro termos que o advogado brasileiro já usa em PJe, e-SAJ, Astrea, Projuris e ADVBOX. Eles
entram no glossário como **rótulo de tela**: o banco e o código continuam com os nomes de sempre
(`jornadas`, `eventos_timeline`, `etapa`, `tarefas.vence_em`, `desfecho='congelada'`), e a tradução
vive num lugar só, `src/lib/vocabulario.ts`. Inventar sinônimo na tela sem registrar aqui é o que
faz um sistema ter dois vocabulários.

| Termo | O que é | O que NÃO é | No código |
|---|---|---|---|
| **Processo** | O caminho de um cliente, do seminário à holding contratada. É a unidade de trabalho do escritório — o que o advogado abre, acompanha e fecha. | **Não é "pipeline", "funil" nem "deal".** Não é o processo judicial: aqui não há tribunal. | `jornadas` |
| **Andamento** | Cada movimentação registrada de um processo: contato feito, sessão realizada, croqui calculado, pagamento confirmado. Sempre datado, sempre do mais recente para o mais antigo. | Não é "atividade", não é "log", não é "histórico do sistema". | `eventos_timeline` |
| **Fase** | Em qual das três sessões o processo está: Viabilidade · Croqui Estrutural · Holding. É por ela que se filtra a lista de clientes. | Não é o passo do trilho (são 9); a fase agrupa os 9 em 3. Não é o desfecho. | `etapa` (`etapa_jornada`), agrupada por `agruparPorSessao` |
| **Prazo** | A data-limite de uma tarefa do processo. Tem destaque visual próprio — vencido, vence hoje, vence em breve — separado do status do andamento. | Não é a data da sessão (essa é agendamento). Não é o mesmo que "status": um processo em dia pode ter prazo vencido. | `tarefas.vence_em` |
| **Arquivado** | Processo que não andou e saiu da lista ativa, sem afirmar ganho nem perda. Reversível: desarquivar devolve o processo à lista. | Não é "perdido" (isso é decisão comercial) nem "descartado" (isso é inelegível/duplicado). | `desfecho = 'congelada'` |

## Princípios que não se negociam (do documento institucional)

1. A Sessão de Viabilidade **não é reunião de vendas** — é diagnóstico estratégico.
2. O Croqui **não é produto** — é prescrição técnica.
3. O cliente compra quando percebe que **foi profundamente compreendido**.
4. O patrimônio raramente é o motivo real da decisão — valores, pessoas e legado são.
5. **Nenhuma pergunta existe sem finalidade estratégica.** Toda informação coletada tem que mudar a forma como a sessão será conduzida.
6. A IA **nunca** produz análise genérica: toda conclusão presa a evidência, sempre separando fato · hipótese · inferência · recomendação, sempre com grau de confiança.
