# Protocolo 01 — Briefing Estratégico (o cérebro da IA)

Fonte: `06 - Materiais/SIC-HF (documento da Dra. Elaine).md`, seção PROTOCOLO 01 + Prompt Mestre.
Este é o contrato de saída da IA. **O JSON schema do briefing no código tem que espelhar isto, campo a campo.**

## Entrada

- respostas do Formulário Estratégico (POP 02);
- transcrição da Ligação Estratégica (POP 03 / 03-B);
- observações comportamentais do colaborador;
- histórico e cadastro disponíveis;
- informações complementares (fontes públicas, quando houver).

## Saída obrigatória, nesta ordem

1. **Resumo Executivo** — quem é esse cliente, como pensa (não só patrimônio).
2. **Perfil DISC** — predominante + secundário + **grau de confiança 0-100%** + evidências. Nunca inferir de profissão ou idade; inferir de linguagem, velocidade de decisão, palavras, contexto.
3. **Arquétipo Patrimonial** — apenas um: Construtor · Patriarca · Protetor · Empresário · Planejador · Investidor · Realizador (se nenhum servir, explicar).
4. **Motivadores** — o que ele realmente quer proteger (filhos, esposa, empresa, legado, autonomia, controle, tranquilidade, reconhecimento) e **um** motivador predominante.
5. **Objeções prováveis** — a mais provável primeiro (honorários, manutenção, "preciso falar com minha esposa", previdência privada, custo-benefício, adiamento) e por quê.
6. **Linguagem recomendada** — técnica · emocional · objetiva · detalhada · acolhedora · firme · consultiva. Justificada.
7. **Pontos de atenção** — o que NÃO fazer na sessão (excesso de detalhe, excesso de emoção, interromper, urgência artificial, falar demais), sempre justificado.
8. **Perguntas que devem ser aprofundadas** — com o porquê.
9. **Frases do cliente que voltam no fechamento** — as mais fortes emocionalmente, com instrução de uso.
10. **Estratégia da Sessão** — ritmo · temas que merecem tempo · temas a passar rápido · momento de apresentar o Croqui · momento de apresentar o investimento · como tratar objeção.
11. **Estratégia de Fechamento** — personalizada por identidade, motivador, DISC e arquétipo. **Preservando a autonomia do cliente, sem pressão nem urgência artificial.**
12. **Grau de confiança da análise.**

Também exigido pelo POP 03: processo decisório (velocidade, necessidade de segurança/validação/detalhe/autoridade), **nível de autoridade para decidir**, decisores necessários e se estarão presentes, grau de urgência, estágio de maturidade.

## Regra de ouro

- Jamais análise genérica. Toda conclusão presa a evidência observada.
- Sempre separar **fato observado · hipótese · inferência · recomendação**.
- Sem evidência suficiente → dizer isso expressamente e baixar o grau de confiança. **Nunca inventar característica.**
- O objetivo não é convencer o cliente; é permitir uma sessão personalizada, ética e eficaz.

## Consequência para a arquitetura

- O prompt é **versionado** (o método é declarado "sistema vivo", com histórico de versões preservado). Todo briefing guarda com qual versão de prompt foi gerado.
- A saída é **estruturada** (JSON), não texto solto — senão não dá para medir padrão nem alimentar o Módulo 4.
- Cada campo carrega sua **evidência** e seu **grau de confiança**; a tela tem que mostrar isso, não esconder.
- Base de conhecimento (Módulo 4): sessões convertidas x não convertidas, frases que aumentam e que reduzem conversão, objeções, estratégias. Toda SV analisada realimenta o método.
