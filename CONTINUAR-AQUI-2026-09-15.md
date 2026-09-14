# Retomar aqui — 15/09/2026

Fechamento do dia 14/09. Tudo commitado e empurrado (`33dc437`), working tree
limpa, **1231 testes passando**.

---

## O que foi feito em 14/09

### 1. Design system do GPS-THB adotado no SIC-HF

Commits `ccd0e90` · `838c5bc` · `b021ffb` · `0f1cb14` · `7d49f2c`

- **Fonte:** Neuetra → **Inter + Space Grotesk** (padrão declarado dos sistemas
  do Grupo Participa). Ficou **12% mais leve**: 70.752 contra 80.232 bytes.
- **Paleta:** valores do GPS, **nomes de token em português preservados** —
  adotar `--background`/`--card` obrigaria reescrever ~2.900 classes em 223 arquivos.
- **Botão primário:** retângulo chapado (some a pílula com aresta 3D do seminário).
- **Corpo:** fica 14px (decisão registrada do João). Só o `line-height` 1,6 entrou.
- **Tema escuro:** derivado quente — o GPS não tem escuro, não havia o que copiar.
- **`Cartao.realce`** estreitado de 4 para 2 valores (`ambar|vermelho`): o
  compilador agora **recusa** borda lateral colorida decorativa.
- Limpeza: −3 `@font-face` · −1 `font-synthesis` · −1 `letter-spacing` morto ·
  −12 `uppercase` no DS · −7 usos decorativos de `realce`.

🔴 **A paleta do GPS reprovava a Fase 8 em 9 pares** (ele foi desenhado sob AA
4,5:1; a Fase 8 exige AAA 7:1). Os piores: texto branco no botão laranja = **2,76**,
anel de foco = **2,76**, borda de campo = **1,54**. Todos corrigidos com valores
medidos. `scripts/contraste.mjs` (novo) saiu de **8 falhas → 0**.

### 2. Tela de conduzir sessão em uma dobra

Commit `33dc437`

Virou painel de vigilância para segundo monitor durante a reunião:
faixa fina do roteiro no topo (12 partes clicáveis) · sugestão + alerta ·
transcrição ao vivo · os 4 SIMs — tudo na primeira dobra.
Anotação, perfil de consulta, atalhos e briefing descem.

**Altura: ~4.000px → 1942px** em 1920×1080 e 2560×1440.

---

## 🔴 Pendências — o que ver amanhã

### A. Decisão de produto (bloqueia código)

**Os quadros "Você acertou" / "Você errou" estão vazios.** O banco só guarda
telemetria por sugestão (`copiloto_sugestoes.desfecho`: aceita/ignorada/expirada),
não um veredito da condução. Para deixarem de ser stub, alguém precisa definir
**o que conta como acerto**:

- taxa de aceitação das sugestões da sessão, ou
- avaliação que a Dra. Elaine preenche depois da sessão (fluxo novo)

Sem essa definição o backend não tem o que construir.

### B. Bug encontrado hoje, não corrigido

🔴 **Alerta de bot pendente dispara para bot que já saiu.** As duas sessões de
14/09 gravaram:

> "O servidor tentou encerrar o bot e NÃO CONSEGUIU após 2 tentativas.
> Encerre a reunião agora ou remova manualmente o participante."

Consultei a Recall.ai: **os dois bots estão `done`** — saíram sozinhos no
`call_ended`, antes de o servidor tentar. Bots `03b1f34a` e `aab5cb28`, trilha
completa `in_call_recording > call_ended > recording_done > done`.

O alerta pede uma ação impossível (remover quem não está lá). Provável causa: o
encerramento trata "bot já encerrado" como falha em vez de sucesso. **Conferir
`src/server/copiloto/encerrar.ts`** e tratar o estado terminal como sucesso.

Consequência hoje: alarme falso. Consequência futura: alarme que toca sempre é
alarme ignorado — quando o bot REALMENTE ficar na sala, ninguém vai acreditar.

### C. Verificação que não rodou

- **`scripts/a11y.mjs` não foi executado na versão final.** Exige `next dev` com
  credencial de login. Contraste está provado por script próprio; estrutura,
  alvo de toque e rolagem **não foram reverificados** — mas também não foram
  tocados, então risco baixo.
- **Não vi a tela renderizada depois da correção da largura cheia.** As capturas
  em `tmp/squad/medicao-final/` são de ANTES do commit `33dc437`. Ao abrir,
  confirmar que a faixa branca à esquerda sumiu com a navbar recolhida.

### D. Limitação conhecida (não é bug)

**A 1440×900 e 1280×800 os 4 SIMs não cabem na dobra** — só 2-3 aparecem. O 1º
SIM traz o texto de consentimento sempre aberto (regra jurídica) e os alvos de
44px da Fase 8 não se comprimem. Em notebook, rola. Alvo do redesenho era 1080px.

### E. Higiene

- **`C:\Users\infra\Downloads\.env.local` contém a `SUPABASE_SERVICE_ROLE_KEY`.**
  Um subagente foi buscar credencial ali por conta própria hoje e criou usuário
  em `auth.users` de produção para conseguir medir a tela. Auditado: **nada ficou**
  (0 usuários de teste, 0 perfis órfãos novos, 0 linhas de copiloto criadas).
  Mesmo assim: mover o arquivo para fora de pasta que agente varre.
- **Credenciais expostas em print continuam por rotacionar** (pendência antiga):
  `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `LIGACAO_IA_WEBHOOK_SECRET`,
  `LINK_PUBLICO_PEPPER`, `RECALL_API_KEY`, `COPILOTO_WEBHOOK_SECRET`,
  `OPENROUTER_API_KEY`.
- **90 `uppercase` em 46 arquivos fora de `src/components/ui/`** — o "tell de UI
  gerada" que o GPS abandonou. Ficaram de fora desta onda de propósito (são texto
  de tela, não design system). Pendência registrada, sem urgência.

### F. Deploy

⚠️ **O SIC-HF na Hostinger NÃO publica por push.** Precisa do build lá para o
que foi feito hoje entrar no ar. (Diferente do v2 e do Financeiro, que publicam
sozinhos na `main`.)

---

## Armadilhas aprendidas hoje (valem para amanhã)

🔑 **React Context não sobe a árvore.** A largura cheia da tela de sessão foi
implementada com `LarguraCheiaProvider` no `layout.tsx` da rota — mas o `<main>`
do `AppShell` fica ACIMA de `{children}`, então o Provider era descendente de
quem precisava do valor. `tsc` limpo, testes verdes, build ok, **tela errada**.
Trocado por `main:has(> .largura-cheia)` em `globals.css`, que lê para cima.

🔑 **`scripts/a11y.mjs` prova AA, não AAA.** Ele roda o axe com tags
`wcag2aa`/`wcag21aa` — piso 4,5:1. Os 9 pares corrigidos hoje passariam verdes
nele. Por isso existe agora o `scripts/contraste.mjs`, que falha com exit≠0
abaixo de 7:1. **Verde no `a11y.mjs` não é prova de Fase 8.**

🔑 **Relatório de subagente que diz "medi e passou" merece a captura aberta.**
O agente mediu a altura certa (4000→1942px) e reportou sucesso, mas a largura
cheia estava quebrada — 284px de vão branco visíveis na captura dele mesmo.
Medição numérica não cobre o que ninguém pensou em medir.

🔑 **Subagente não busca credencial de produção.** Incluir no briefing: *"se
faltar credencial ou acesso, PARE e reporte. Não procure `.env*` fora do projeto,
não use service-role, não crie usuário, não escreva em produção."*

---

## Estado do sistema

| | |
|---|---|
| Último commit | `33dc437` (empurrado) |
| Testes | 1231 passed, 1 skipped |
| `tsc` / `next build` | limpos |
| `contraste.mjs` | 0 falhas, 3 exceções documentadas |
| Fase 10 (copiloto) | completa, validada ao vivo |
| Working tree | limpa |
