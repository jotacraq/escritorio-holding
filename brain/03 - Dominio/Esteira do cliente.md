# Esteira do cliente — do seminário à holding

O sistema existe para responder, a qualquer momento: **onde está cada pessoa, de onde ela veio, e o que se sabe sobre ela.**

## O caminho

```
Seminário (edição X)
  ↓  assistiu aos 3 dias
Lead  →  patrimônio > R$ 1 mi  →  MQL
  ↓  compra a Sessão de Viabilidade (Hotmart)
Cliente
  ↓  [AUTO]    boas-vindas: e-mail completo + aviso de que a equipe vai ligar
  ↓  [AUTO]    formulário estratégico (POP 02) enviado
  ↓  [HUMANO]  ligação estratégica de 5 min (POP 03) — equipe registra no sistema
  ↓  [IA]      Briefing Estratégico gerado (Protocolo 01)
  ↓  agendamento: equipe/IA sugere horários → cliente escolhe → cai no sistema
  ↓  [AUTO]    D-7: mensagem de confirmação, pede confirmação do cliente
  ↓  [AUTO]    no dia: e-mail com link da sala (aberta 10 min antes)
  ↓  [MANUAL]  fallback WhatsApp se o cliente não conseguir pelo e-mail
Sessão de Viabilidade realizada
  ↓  advogada preenche o Relatório da SV
  ↓  [AUTO]    pós-sessão: material em PDF personalizado pela DOR do cliente + conclusão da sessão
  ↓  Dra. Elaine envia pessoalmente o link de pagamento do croqui + data da apresentação + pede o IR
Croqui contratado
  ↓  cliente envia IR e contrato social da empresa
  ↓  apresentação do Croqui em HTML, modo apresentação, dentro do sistema
Holding contratada
```

## Regras que a esteira tem que respeitar

- **Origem nunca se perde.** A edição do seminário é atributo permanente da pessoa, não do evento.
- **Etapa é estado; mudança de etapa é evento.** Guardar as duas coisas: o estado atual e a linha do tempo de como se chegou nele. Sem isso não se mede conversão por coorte.
- **Métrica de funil é por coorte, nunca por janela de evento.** Quem entra num mês converte em outro; cruzar duas janelas compara gente diferente.
- **Pagamento é a fronteira entre lead e cliente.** Três produtos distintos na Hotmart (sessão · croqui · holding); cada um empurra a esteira adiante.
- **Campo novo nasce vazio.** KPI sobre coluna recém-criada mostra vazio, não zero. Backfill que reclassifica gente em silêncio é proibido: contar quem muda de valor antes de aplicar.

## Perguntas que o sistema tem que responder de cara

- Quantas pessoas em cada etapa, agora?
- Desta edição do seminário: quantos viraram MQL, quantos compraram SV, quantos compraram croqui, quantos fecharam holding?
- Esta pessoa: de qual seminário veio, o que respondeu, o que disse na ligação, quanto tem, o que teme, quem decide junto com ela, e qual é o briefing?
- Quais sessões acontecem nos próximos 7 dias e quais já confirmaram presença?
- Quem comprou e ainda não foi contatado? (é o furo que mais dói — dinheiro pago sem atendimento)
