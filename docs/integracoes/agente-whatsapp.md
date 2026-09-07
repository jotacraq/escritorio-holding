# Agente de WhatsApp — onboarding

Fase 9. Migrations `0088`–`0090`. Roteiro de prova: `scripts/verificacao-0088-0090.sql`
(11 asserções, com rollback). Simulador: `scripts/simular-chatwoot.ts` (11 roteiros).

**O agente nasce DESLIGADO** (`agente_whatsapp.ativo = false`) e o prompt nasce
inativo. Com ele desligado o webhook continua gravando a mensagem recebida e
**não responde nada** — nem "não entendi".

## 1. O que ele atende

O onboarding do cliente que **já contratou** a Sessão de Viabilidade: mandar o
link do formulário, o link dos documentos, o link de confirmação de presença e
dizer o que falta. Nada além disso.

O agente **não decide** o que falta. Quem decide é `derivarProximoPasso()`
(`src/lib/pasta/proximo-passo.ts`), a mesma função que a Esteira, o Painel e a
Ficha 360 usam. O agente é uma casca de linguagem sobre ela — por isso o que o
robô diz no WhatsApp não pode divergir do que a equipe vê na tela.

## 2. O que ele NÃO faz

| Nunca | Por quê |
|---|---|
| Fala de preço, honorário, desconto ou parcelamento | A oferta é pessoal da Dra. Elaine (B61). Devolve a pergunta e abre tarefa. |
| Dá orientação jurídica ou tributária | ITCMD, inventário, doação, herança, partilha → esquiva determinística **antes** da IA. |
| Recebe documento por anexo | O arquivo tem de entrar pelo `/p/d`, que casa com o item pedido, respeita o limite e guarda em lugar privado. Anexo no WhatsApp deixaria PII pesada no disco do Chatwoot. |
| Confirma presença sozinho | Manda o link `/p/c`. "Sim" pode ser resposta a outra coisa; confirmação é ato auditável (B58). |
| Inicia conversa | Iniciar é da régua, com template. O agente **só responde** (D23). |
| Responde a número desconhecido | Silêncio. Qualquer texto confirmaria que existe um sistema atrás do número. Vira pendência `numero_desconhecido`. |
| Responde a demonstração | `origem_dado` é conferido na pessoa **e** na jornada. |

## 3. As travas, na ordem (o porteiro)

`src/server/agente-whatsapp/porteiro.ts`. Nenhuma delas conta o motivo ao
cliente — quem lê o motivo é a equipe, na tarefa ou na pendência.

1. token do webhook, `message_created`, `incoming`, não privada
2. dedupe por `unique (provedor, mensagem_externa_id)`
3. **grava sempre**, inclusive de desconhecido
4. `agente_whatsapp.ativo = true` (chave ausente = desligado)
5. `conversation.inbox_id == CHATWOOT_INBOX_ID` (sem a env, cala)
6. o telefone casa com **exatamente uma** pessoa (0 → pendência; 2+ → silêncio)
7. pessoa **e** jornada `origem_dado = 'real'`
8. processo com `desfecho = 'aberta'`
9. `nivel_pago_vigente >= 1` — o onboarding começa no pago
10. consentimento `comunicacao_whatsapp` vigente
11. nenhum humano respondeu nos últimos `silencio_humano_minutos`
12. a conversa não está pausada ("Assumir conversa")
13. teto de `teto_respostas_hora` respostas por jornada por hora
14. **claim atômica** em `agente_whatsapp_respostas` — o `unique` é a trava
    anti-resposta-dupla, garantida pelo banco
15. **a conversa é de quem o payload diz** — o servidor pergunta ao Chatwoot
    (`GET /conversations/{id}`) de quem é a conversa e compara com o telefone
    casado. Divergiu, ou não deu para confirmar: não responde, grava o motivo e
    abre tarefa. Sem isto, quem tivesse o `CHATWOOT_WEBHOOK_SECRET` mandaria o
    onboarding de um cliente real para uma conversa que ele mesmo controla.

Sem `tratamento_ia` o agente responde **só com texto fixo** e nenhuma palavra do
cliente sai para o modelo (B56).

## 4. Fluxo por etapa

| Passo derivado (dono = cliente) | O agente | Link |
|---|---|---|
| Responder o formulário | diz o que falta | `/p/f` |
| Confirmar presença | manda o link | `/p/c` |
| Enviar documentos | lista os documentos que faltam, em rótulo | `/p/d` |
| Aguardando a compra / o croqui / a decisão | devolve ao passo, sem link | — |

**Um link por tipo a cada `intervalo_link_horas` (6).** Emitir revoga o anterior
(o banco guarda só o hash do token): sem esse teto, o cliente que pede duas
vezes derruba o próprio link e o que a equipe mandou por e-mail. Dentro da
janela, o agente aponta para a mensagem anterior.

Fora do tema: uma frase que devolve ao passo. Na **2ª** vez, encaminha para a
equipe e abre tarefa (B57). A frase de encaminhamento respeita `ligacao_ia.janela`
(seg–sex 9h–19h): fora dela promete o próximo dia útil, nunca "já te chamam".

## 5. IA

Só quando nenhuma regra determinística bateu **e** há `tratamento_ia`. Prompt
`agente_whatsapp_onboarding` em `prompts_versoes`. Vai para o modelo apenas: o
texto da última mensagem (≤ 500 caracteres), o passo em rótulo e o que falta em
rótulo. Nunca patrimônio, valor, nome de familiar ou histórico da conversa.

Confiança < 0,6, intenção inválida, resposta vazia — ou resposta que fala de
**valor ou de imposto** — → **não envia** e abre tarefa. A varredura de termos
proibidos roda também na SAÍDA do modelo: a lista de entrada só pega a pergunta
quando o cliente usa uma das palavras, e reformular é fácil. O modelo redige; o banco decide: `acao: "enviar_link"` só é obedecida
quando o passo derivado já previa aquele link.

Orçamento **próprio** (`teto_ia_jornada_dia`, `teto_ia_dia`), contado em
`execucoes_ia`. O agente não passa por `verificar_cooldown_ia`: aquele cooldown
é de 600 s por jornada e o calaria na 2ª mensagem do cliente.

## 6. Como ligar

1. Criar o inbox de WhatsApp (Cloud API da Meta) no Chatwoot e anotar o id.
2. Na Hostinger, as 5 variáveis: `CHATWOOT_URL`, `CHATWOOT_ACCOUNT_ID`,
   `CHATWOOT_API_TOKEN`, `CHATWOOT_INBOX_ID`, `CHATWOOT_WEBHOOK_SECRET`.
   Nenhuma variável nova foi criada nesta fase.
3. No Chatwoot, o webhook `message_created` apontando para
   `https://<dominio>/api/webhooks/chatwoot?token=<CHATWOOT_WEBHOOK_SECRET>`.
4. Admin → Agente de WhatsApp: ligar `agente_whatsapp.ativo`.
5. Para o agente usar IA: ativar o prompt `agente_whatsapp_onboarding` **depois**
   de `POST /api/admin/sonda-schema` e da bancada de custo. Sem isso ele
   funciona só com texto fixo — que já cobre a maioria das intenções.

**Hoje, zero pessoas são elegíveis** (medido em 07/09/2026): a única
`origem_dado='real'` do banco não tem consentimento nem pagamento. O agente sobe
correto e mudo, e é assim que tem de ser.

## 7. Como testar

```bash
# 1. dev server com o Chatwoot apontando para o dublê do simulador
CHATWOOT_WEBHOOK_SECRET=cw-local CHATWOOT_URL=http://127.0.0.1:3999 \
CHATWOOT_ACCOUNT_ID=1 CHATWOOT_API_TOKEN=local CHATWOOT_INBOX_ID=1 npx next dev

# 2. os 11 roteiros (cria fixtures, confere no banco e limpa tudo)
CHATWOOT_WEBHOOK_SECRET=cw-local npx tsx scripts/simular-chatwoot.ts
npx tsx scripts/simular-chatwoot.ts --roteiro=documento --manter
```

O simulador **recusa** qualquer host que não seja local: ele cria pessoa,
processo e pagamento. Liga o agente e devolve o valor anterior no fim, sempre.

Lógica pura: `npx vitest run src/server/agente-whatsapp` (porteiro, tradução do
passo, parser da saída da IA, orçamento). Banco: `scripts/verificacao-0088-0090.sql`.
