# Roteiro de apresentação do SIC-HF — 20 minutos

Para o João apresentar o sistema à Dra. Elaine e à equipe.
Todos os números deste roteiro foram **lidos do banco depois de rodar o seed** (06/09/2026).
Se você rodar o seed em outro dia, as datas relativas mudam junto — a estrutura não.

---

## 0. Antes de abrir a boca (5 minutos, sozinho)

1. **Suba os dados de demonstração:**

   ```
   npx tsx scripts/seed-demo.ts
   ```

   (ou `npx tsx scripts/seed-exemplo-completo.ts --demo` — é o mesmo comando.)
   Roda em ~40 s, é idempotente e **não chama IA nenhuma** (custo US$ 0,00).
   Ao terminar ele imprime as 4 URLs de Ficha. **Deixe esse terminal aberto** — é a sua cola.

2. **Confira que o terminal terminou com estas duas provas:**

   ```
   ligação fe9ecf32 (+5500900000002) → manual
   ligação 2079b7cb (+5500900000003) → manual
   ligação 33187c7c (+5500900000004) → manual
   ...
   mensagens da régua das 4 famílias: 8 — cancelada 8
   ```

   (Os oito dígitos do id mudam a cada vez; o que importa é `→ manual` nas três.)

   A primeira é a prova de que nenhuma ligação foi discada para as famílias de
   demonstração (os telefones são `+5500…`, DDD que não existe — a normalização recusa).
   A segunda é a prova de que **nenhum e-mail de demonstração saiu**: as 8 mensagens que
   a régua enfileirou de verdade estão canceladas. Se aparecer `enviada` ou `enviando`,
   o seed grita em vermelho — o cron passou antes dele, e o que fazer está escrito no
   próprio aviso.

3. **Faça login** com o seu usuário admin. A Dra. Elaine também é admin e enxerga tudo.

4. **Abra Admin → Integrações e leia a tela ANTES da apresentação.** O que está verde
   depende das variáveis do servidor de produção, não do seu `.env.local`. Hoje, o que
   se sabe que **não** está fechado (rodada 1 da Fase 7):
   - **Régua (cron da Hostinger)** — o `CRON_SECRET` ainda não foi colado no hPanel;
   - **Ligação por IA (Vapi via n8n)** — falta `N8N_WEBHOOK_LIGACAO_URL` /
     `VAPI_ASSISTENTE_ID` no servidor e `LIGACAO_IA_WEBHOOK_SECRET` no n8n.
   No banco, `ligacao_ia.automatica = true` e `ligacao_ia.provedor = "n8n"`: o sistema
   **quer** ligar sozinho, e enquanto o n8n não estiver configurado toda ligação cai em
   **modo manual** — vira tarefa para a equipe, com o motivo escrito na descrição.
   **Diga isso em voz alta na hora certa** (seção 7). É funcionalidade, não falha.

5. **Se for apresentar em tela compartilhada,** feche a aba do Supabase e do terminal com
   a `service_role`.

---

## 1. As quatro famílias (o que o seed criou)

| # | Família | Etapa | O que ela existe para mostrar |
|---|---|---|---|
| 1 | **Antônio Ribeiro de Andrade** | `captado` | Como entra quem veio do seminário: respostas, consentimento, nada mais. |
| 2 | **Cláudia Bittencourt Nogueira** | `sessao_agendada` | Sessão marcada + **Briefing Estratégico** pronto. |
| 3 | **Ubirajara Carvalho Pontes** | `croqui_contratado` | **Croqui em elaboração**: motor calculado, Cenário Patrimonial pela metade. |
| 4 | **Heloísa Delmonte Sampaio** | `holding_contratada` / `ganha` | Cliente fechado, **execução em andamento** (8 de 19 marcos). |

Todas têm `(demonstração)` no nome, e-mail `@exemplo.com.br` e telefone `+5500…`.
Ninguém confunde com cliente real, e nada sai do sistema em direção a elas.

---

## 2. Hoje (`/hoje`) — 2 minutos

**O que a tela vai mostrar** (medido no banco em 06/09, com o seed no ar):
- **“Sessões de hoje”** — o bloco varre as **próximas 48 horas**, então a sessão da
  **Cláudia Bittencourt, amanhã das 10h às 11h**, aparece aqui: com o selo de **presença
  confirmada** (ela mesma confirmou pelo link), **“Preparo pronto”** (o Briefing existe) e
  o chip de urgência **HOJE**, em vermelho.
- **Sistema → “Envio automático”**: selo âmbar **“Atrasado”**, com o tempo desde o último
  toque do cron (`regua.ultimo_cron_em`, 06/09 09h37). Enquanto o `CRON_SECRET` não estiver
  colado no hPanel, é isso que a tela vai dizer — e é a verdade.
- **Nenhuma mensagem pendente**: as 8 mensagens das famílias de demonstração estão
  `cancelada`, de propósito — o destinatário é fictício.
- **Esta tela não tem lista de tarefas.** A tarefa aberta “Montar o croqui estrutural”
  (família Carvalho, vence 07/09) aparece no **cartão dela em `/clientes`**, não aqui.
  Não prometa a tarefa no `/hoje`.

**O que dizer:**
> “Esta é a primeira tela do dia. Ela não é um resumo bonito: é o que precisa acontecer
> antes da próxima reunião: a sessão de amanhã, com a presença já confirmada e o preparo
> pronto. E ela é honesta sobre si mesma: aqui embaixo o sistema diz que o envio
> automático está atrasado, porque a tarefa agendada do servidor ainda não foi ligada.
> Prefiro uma tela que confessa a estar verde sem motivo.”

---

## 3. Clientes (`/clientes`) — 3 minutos

**O que a tela vai mostrar:** o kanban da esteira. Ele abre com **“5 clientes abertas”** —
Andrade (`captado`), a jornada de exemplo do João (`captado`), a linha de teste antiga
“Teste Preliminar POP03B” (`qualificado`), Bittencourt (`sessao_agendada`) e Carvalho
(`croqui_contratado`).

> **Antes de falar da Delmonte, marque “Mostrar fechadas”.** Ela está com desfecho `ganha`,
> e jornada fechada não entra no quadro aberto. Sem a caixa marcada, a coluna
> `holding_contratada` fica vazia e a família some. A alternativa é abrir a Ficha dela
> direto, pelo link que o seed imprimiu no terminal.

É também no cartão da Carvalho que aparece a tarefa aberta **“Montar o croqui estrutural”**
(vence 07/09) — o `/hoje` não lista tarefa.

**O que dizer:**
> “A esteira tem oito etapas, do seminário à holding constituída. Cada cartão é uma
> família, e ela só anda para frente quando o fato aconteceu: pagamento aprovado, sessão
> realizada, croqui apresentado. Ninguém arrasta cartão à mão para fingir progresso.”

**O que NÃO mostrar:** o cartão “Teste Preliminar POP03B” é resíduo de teste de QA, não
demonstração. Se alguém perguntar, diga que é isso mesmo e siga.

---

## 4. Família Andrade — o topo da esteira (`captado`) — 2 minutos

Abra a Ficha do Antônio.

**O que a tela vai mostrar:** as **4 respostas do seminário**, os 4 consentimentos
registrados, e **as abas de patrimônio e família vazias**.

**O que dizer:**
> “Quem acabou de sair do seminário entra assim: o que ele falou, e o consentimento dele.
> Repare que patrimônio e família estão vazios — não zerados, vazios. O sistema não
> preenche o que ninguém informou.”

---

## 5. Família Bittencourt — o Briefing (`sessao_agendada`) — 4 minutos

Abra a Ficha da Cláudia → aba do **Briefing**.

**O que a tela vai mostrar:**
- 3 familiares, 5 bens, **R$ 2.976.000** de patrimônio a valor de mercado;
- sessão **confirmada para amanhã, 10h**;
- **Briefing Estratégico** com grau de confiança **74**, perfil DISC **C** (secundário D),
  duas objeções prováveis, duas perguntas para aprofundar e duas frases literais dela
  para o fechamento.

**O que dizer:**
> “Esta é a peça que o sistema existe para entregar. Antes da sessão, a advogada abre a
> Ficha e sabe: como essa pessoa decide, quem decide com ela, o que ela quer proteger,
> qual objeção vem — e com que palavras responder, usando frases que ela mesma disse.
> Cada conclusão está presa a uma evidência. Onde não há evidência, o briefing diz que
> não há: veja as duas lacunas no fim.”

**Importante dizer:** *este briefing é de demonstração, escrito à mão — o seed não gasta
um centavo de IA.* O banco sabe disso: o registro está marcado como `origem_dado = exemplo`.

---

## 6. Família Carvalho — o Croqui em elaboração (`croqui_contratado`) — 5 minutos

Abra a Ficha do Ubirajara → **Croqui**.

**O que a tela vai mostrar (números reais, calculados pelo motor):**
- 4 familiares, 9 bens, **R$ 20.500.000** a valor de mercado (R$ 10.500.000 só em imóveis);
- **19 tabelas** calculadas, versão 1 fixada;
- comparativo geral:

  | Caminho | Custo | Diferença |
  |---|---:|---:|
  | Inventário | R$ 3.036.750 | — |
  | Doação em vida | R$ 1.294.080 | −57,4 % |
  | 1 célula | R$ 1.287.710 | −57,6 % |
  | 2 células | R$ 543.655 | −82,1 % |
  | **3 células** | **R$ 137.465** | **−95,5 %** |

- payback: custo de implementação R$ 137.465, **capital salvo R$ 2.899.285**;
- **1 parâmetro ausente**: `itcmd.faixas.doacao_reforma` para **MG** (a UF de domicílio
  fiscal vantajoso). A célula correspondente sai como **“—”**, não como zero.

**O que dizer:**
> “O croqui não é um PDF bonito: é uma conta. Cada célula tem fórmula, procedência e a
> versão do parâmetro que multiplicou. Repare nesta célula em branco: falta a tabela de
> ITCMD de Minas depois da reforma. O sistema não chuta — ele mostra o buraco e diz onde
> cadastrar.”

Depois desça para o **Cenário Patrimonial** (mesma Ficha):
- cenário **Inventário**: ITCMD R$ 800.000 (digitado), honorários R$ 1.435.000
  (calculado: 7 % sobre R$ 20.500.000), custas de cartório R$ 52.500 (calculado: 0,5 %
  sobre R$ 10.500.000) — **3 de 7 rubricas**, total em branco;
- cenário **Holding 3 células**: ITBI R$ 315.000 (calculado: 3 % sobre R$ 10.500.000),
  honorários da holding R$ 74.000 (digitado), manutenção anual **ausente**.

**O que dizer:**
> “O total dos dois cenários está em branco porque ainda faltam rubricas. É proposital:
> um total que soma só metade das linhas é pior do que nenhum total. Quando a última
> rubrica entrar, o total aparece sozinho.”

---

## 7. Família Delmonte — cliente fechado (`ganha`) — 2 minutos

Abra a Ficha da Heloísa.

**O que a tela vai mostrar:**
- desfecho **`ganha`**, 2 familiares, 6 bens, **R$ 19.342.000** a valor de mercado
  (R$ 8.350.000 em imóveis);
- comparativo: inventário **R$ 3.707.630** contra 3 células **R$ 128.865** (**−96,5 %**),
  diferença **R$ 3.578.765** — que é o **capital salvo** da tabela de payback
  (implementação R$ 128.865, benefício mensal R$ 29.032, **se paga em 4 meses**);
- a mesma falta da Carvalho: `itcmd.faixas.doacao_reforma` para **MG**, e por isso a coluna
  “após a reforma” da linha *2 células* sai como **“—”**;
- **execução: 8 de 19 marcos concluídos**, o mais recente há cerca de 2 semanas;
- na linha do tempo, a **ligação por IA** registrada como **concluída · manual**, com o
  motivo escrito: *“o telefone cadastrado não é um número discável… a IA não liga em
  número inválido.”*

**O que dizer (é aqui que entra a ligação por IA):**
> “Quando o cliente paga a Sessão de Viabilidade, o sistema tenta ligar sozinho — voz de
> IA — para oferecer os horários da agenda. Nestas famílias o telefone é inválido de
> propósito, então ele fez a coisa certa: não ligou, e abriu tarefa para a equipe ligar,
> explicando por quê. É esse o padrão: quando a automação não pode agir, ela devolve o
> trabalho para uma pessoa com o motivo por escrito. Nunca falha em silêncio.”

---

## 8. Agenda e Mensagens (`/agenda`, `/mensagens`) — 1 minuto

- **Agenda**: a sessão da Cláudia amanhã às 10h, confirmada pelo próprio cliente (pelo
  link público de confirmação).
- **Mensagens**: as 8 mensagens das famílias de demonstração aparecem como **canceladas**,
  com o motivo no registro (“demonstração: destinatário fictício, cancelada pelo seed”).

**O que dizer:**
> “A régua enfileira e-mail e WhatsApp sozinha. Como estes destinatários são fictícios, o
> seed cancelou todas — nenhuma mensagem de demonstração sai daqui para o mundo.”

---

## 9. Admin — 1 minuto, e só se sobrar tempo

Mostre **Admin → Parâmetros** (as alíquotas versionadas que o croqui usa) e feche.

**O que NÃO mostrar:**
- **Admin → Integrações** enquanto as variáveis não estiverem coladas — a tela vai listar
  pendências e desviar a conversa para infraestrutura;
- o botão **“Ligar por IA agora”** na Ficha (vai cair em modo manual e criar tarefa);
- **gerar briefing / análise por IA** ao vivo: custa dinheiro e depende de chave que pode
  não estar no servidor;
- qualquer tela pelo celular sem ter conferido antes.

---

## 10. Perguntas prováveis

**“Isso é seguro? São dados de patrimônio e de família.”**
> Sigilo profissional, tratado como tal. Toda tabela tem política de acesso no banco —
> quem é do relacionamento não enxerga patrimônio nem imposto, só a advogada e o admin.
> Documento de cliente fica em armazenamento privado, com link que expira. O que a IA
> recebe depende de consentimento registrado, e o registro fica na Ficha.

**“E a LGPD?”**
> Consentimento por finalidade, gravado com data, texto apresentado e versão — está na
> aba de cada pessoa. Ligação por IA é subprocessamento de voz: por isso ela nasceu
> desligada e só liga com decisão explícita. Retenção de gravação é configurável e
> expurgada por rotina.

**“Quanto custa a IA?”**
> Cada geração guarda modelo, tokens e custo em dólar, por jornada — dá para somar. O
> briefing desta demonstração custou zero: é conteúdo de exemplo, não geração.

**“O que acontece quando o cliente paga?”**
> O webhook de pagamento é validado por assinatura e, sem o segredo configurado, **recusa**
> — nunca aceita. Aprovado o pagamento, a jornada sobe de etapa sozinha, a régua de
> boas-vindas dispara e o sistema tenta ligar por IA para agendar. Se não puder ligar,
> vira tarefa para a equipe com o motivo.

**“Dá para desfazer? Esses dados de demonstração ficam para sempre?”**
> ```
> npx tsx scripts/seed-demo.ts --limpar
> ```
> Apaga as 4 famílias e tudo que pende delas — 400 linhas na última medição — e não toca
> em mais nada.

---

## 11. Depois da apresentação

- **Para limpar:** `npx tsx scripts/seed-demo.ts --limpar`
  (ou `npx tsx scripts/seed-exemplo-completo.ts --demo --limpar`).
- **Para deixar como estava e continuar:** não faça nada. As famílias são idempotentes;
  rodar o seed de novo reconcilia, não duplica.
- **Cuidado conhecido:** `scripts/seed-exemplo-completo.ts --limpar` (sem `--demo`) apaga
  **todo** dado `origem_dado='exemplo'` do banco, inclusive estas famílias. O seed normal
  (`seed-exemplo-completo.ts`, sem flag) **preserva** as famílias de demonstração e avisa
  no terminal.
- **O `--limpar` não apaga por engano:** ele apaga por id calculado, e antes do primeiro
  DELETE confere no banco que cada id é `origem_dado='exemplo'`. Se um id apontar para
  gente de verdade, o comando **recusa e não apaga nada** — a mensagem diz qual id era.

---

## 12. Três coisas que o seed faz no banco e você precisa saber

Nada disso atrapalha a apresentação. Está aqui porque some da vista e reaparece depois.

1. **Os links públicos das famílias existem, mas ninguém tem a URL.**
   O seed emite os links (`/p/*`) e **descarta o token**: o banco só guarda o hash, que é
   o desenho da migration 0072 (nem o servidor relê uma URL emitida). Na Ficha o link
   aparece com validade e contagem de usos — normal. Se quiser **abrir** uma página
   pública na apresentação, **reemita o link pela própria Ficha**; a tela mostra a URL
   nova uma única vez. Reemitir é o caminho de produção, não um contorno.

2. **O seed encosta em `produtos.hotmart_produto_id` por alguns milissegundos.**
   O pagamento de demonstração passa pela mesma função do webhook da Hotmart, e ela acha
   o produto por esse campo. Como ele está vazio hoje, o seed grava um marcador
   `DEMO-SICHF-FAMILIAS-PROD-…` só durante a chamada e o devolve a `NULL` logo depois —
   inclusive se der erro. **Só sobra marcador se o processo for morto no meio**
   (fechar o terminal, Ctrl-Break, queda de rede). Para conferir/limpar: Admin →
   Produtos → o produto cujo id da Hotmart começa por `DEMO-SICHF-FAMILIAS-PROD` →
   apagar o conteúdo do campo. Se o id verdadeiro da Hotmart já estiver preenchido, o
   seed não escreve nele.

3. **A régua dispara de verdade e é desarmada na hora.**
   Pagamento, agendamento e sessão realizada enfileiram e-mail no banco — a mesma régua
   do cliente real. O seed cancela a fila imediatamente após cada um desses fatos (não só
   no fim), e no encerramento **conta** quantas mensagens de demonstração saíram. É por
   isso que a tela de Mensagens mostra tudo `cancelada` com o motivo escrito.
