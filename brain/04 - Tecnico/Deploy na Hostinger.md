# Deploy na Hostinger — SIC-HF

**Domínio:** `escritorio.grupoparticipa.app.br` · conta `u542688653` · order `1008727188`.
**Repositório:** `https://github.com/jotacraq/escritorio-holding` (privado — foi criado público e fechado em 03/09 antes do primeiro push; o repo carrega o método proprietário da Dra. Elaine).

## Como o deploy funciona aqui

Não é upload de build pronto: manda-se um **archive do código-fonte** e o servidor roda `npm install` + `npm run build` + `next start`.

```
git archive HEAD | tar -x -C pkg     # só o que está versionado
cp env.producao pkg/.env.production  # variáveis do deploy
rm -f pkg/.gitignore                 # ver armadilha 1
zip -r sichf-<timestamp>.zip pkg     # ver armadilha 2
→ hosting_deployJsApplication
```

## Armadilhas já pagas (03/09/2026)

1. **O deploy respeita o `.gitignore` do pacote.** Como o `.gitignore` tem `.env*`, o `.env.production` era descartado no envio. Remova o `.gitignore` do pacote.
2. **Nome de arquivo repetido parece ser reaproveitado.** Enviar sempre `sichf.zip` fazia builds sucessivos sem efeito visível. Use nome único por deploy.
3. **`output: 'standalone'` não serve aqui.** O `server.js` do standalone não carrega `.env.production`, e o deploy da Hostinger builda no servidor e sobe com `next start`. Removido do `next.config.ts`.
4. **Subdomínio ≠ website addon.** `createWebsiteSubdomainV1` cria a raiz *dentro* do `public_html` do domínio pai, e o hPanel leva ao pai — sem painel de Node.js App próprio. Todos os outros sistemas da conta (`diamantes.`, `equipe.`, `ativacao.`) são **website addon**. Use `createWebsiteV1`.
5. **O proxy do Next não lê `.env` em execução.** Depender de `process.env.NEXT_PUBLIC_SUPABASE_URL` dentro do middleware derrubava o site inteiro com 503, inclusive em arquivo estático, **com o build verde**. Agora as chaves públicas são constante em `src/lib/config-publica.ts`. Ver [[feedback_build_verde_nao_prova_sistema_de_pe]].
6. **Node 20 no servidor, 24 no local.** O `@supabase/supabase-js` avisa que 20 está depreciado. Não quebrou, mas é dívida.

## PENDÊNCIA ABERTA — processo preso no servidor (03/09/2026)

**Sintoma:** `https://escritorio.grupoparticipa.app.br` responde, em qualquer rota (inclusive `/versao.txt`, arquivo estático):

```json
{"erro":"config_ausente","mensagem":"Configuração do Supabase ausente no servidor."}
```

**Por que isso é impossível pelo código atual:** essa string **não existe mais** no middleware — foi removida no commit `2bdc3d3`, e o pacote enviado depois disso não a contém. O build do servidor compila o código novo (o log lista `/api/diagnostico`, rota criada nessa leva). Ou seja: **o processo que atende o hostname não é o build que está sendo enviado.**

**O que já foi tentado, sem efeito:**
- 6 deploys, cada um com pacote de nome único e build `completed`.
- `restartNode_jsApplicationV1` três vezes.
- Apagar o site inteiro, esperar a remoção assíncrona terminar de verdade (confirmado por falha de TLS), recriar do zero e redeployar.
- Cache-buster por query string — não é cache (nenhum header de cache na resposta).
- Reprodução local do build de produção **sem `.env.local`**: `/versao.txt` e `/login` respondem **200**. O código está certo; o ambiente é que não o executa.

**Hipótese mais provável:** processo Node órfão do primeiro deploy — feito quando o host ainda era subdomínio do site pai, com raiz em `.../grupoparticipa.app.br/public_html/escritorio` — continua vivo e amarrado ao hostname. A API de hospedagem não expõe nada que mate um processo assim.

**Como resolver (precisa de mão humana, 1 clique):**
1. hPanel → `grupoparticipa.app.br` → **Node.js App**: procurar uma aplicação órfã apontando para `.../public_html/escritorio` e **parar/remover**.
2. Se não aparecer, abrir chamado no suporte da Hostinger: *"processo Node preso servindo escritorio.grupoparticipa.app.br; o site foi recriado e os deploys novos não assumem o hostname"*.
3. Depois disso, redeployar — o pacote e o processo já estão prontos e testados.

> O site principal **`grupoparticipa.app.br` está intacto** e serve o Grupo Participa normalmente. Foi conferido: os dois são apps distintos (o principal roda por git e Node 24; o SIC-HF por archive e Node 20).

## Variáveis de ambiente

Vão em `.env.production` dentro do pacote (e/ou no painel do Node App). As públicas também têm piso em `src/lib/config-publica.ts`, então o site sobe mesmo sem elas.

| Variável | Sem ela |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | upload, webhook, cron, IA e convite em 503 |
| `ANTHROPIC_API_KEY` | as duas IAs em 503 (ou modo demonstração, se ligado) |
| `LINK_PUBLICO_PEPPER` | `/api/publico/*` em 503 |
| `CRON_SECRET` | `/api/cron/regua` e `/api/diagnostico` em 503 |
| `HOTMART_WEBHOOK_SECRET` | webhook em 503 — fail-closed proposital |
| `RESEND_API_KEY`, `EMAIL_FROM` | mensagem fica na fila, nunca "enviada" |

`GET /api/diagnostico` (header `x-cron-secret`) responde **presença e tamanho** de cada variável — nunca o valor. Sem o segredo, 404.
