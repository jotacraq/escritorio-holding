import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hostinger Node.js App: o servidor builda o projeto e roda `next start`.
  // NAO usar output:'standalone' aqui — o server.js do standalone nao carrega
  // .env.production, e as variaveis do deploy chegam por esse arquivo.
  // (medido em 03/09/2026: com standalone, todo request virava config_ausente)
  // As duas publicas entram por `env` para serem EMBUTIDAS no build, em todo
  // runtime (inclusive o do proxy/middleware, que nao le .env em execucao).
  // Nao sao segredo: a URL do projeto e a chave publicavel do Supabase ja vao
  // para o navegador de qualquer forma. Os segredos de verdade (service_role,
  // Anthropic, Hotmart) continuam SO em process.env, lidos em runtime.
  env: {
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://fcfsnqqaphtamhrpuyoh.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "sb_publishable_qxiG66XwJoQw07Khlust7w_RA-I7DXw",
  },
  poweredByHeader: false,
  /**
   * Fase 6 §3.2 — o menu passou de 9 para 5 entradas e quatro telas mudaram de
   * nome. Estes 308 existem para quem tem a rota antiga no favorito, no
   * histórico do navegador ou colada num WhatsApp: ninguém do escritório pode
   * bater num 404 por causa de uma renomeação nossa.
   *
   * **Permanentes (308) de propósito:** as rotas antigas não voltam. O 308
   * preserva o método (um POST não vira GET) e é cacheável — é o que se usa
   * para renomeação definitiva; 307/302 sinalizariam "isto ainda pode mudar".
   *
   * NÃO entram aqui, e é decisão, não esquecimento:
   * - `/jornadas/[id]` e `/jornadas/[id]/diagnostico`, `/croquis/*`,
   *   `/conhecimento/casos/[id]`, `/conhecimento/transcricoes/[id]`,
   *   `/importacoes/nova`, `/importacoes/[id]`, `/sessoes/[id]/conduzir` —
   *   são páginas de DETALHE, não entradas de menu. `source` sem `:path*`
   *   casa a rota exata, então nenhuma delas é capturada pelas linhas abaixo.
   * - `/gaveta-demo` e `/graficos-demo`: foram APAGADAS (eram telas de
   *   desenvolvimento respondendo 200 em produção para quem tem sessão).
   *   Tela apagada tem que dar 404 — redirecioná-la esconderia o rastro.
   * - `/sessoes/[id]/conduzir` continua de pé e NÃO é capturada: `source` sem
   *   `:path*` casa a rota exata. É para lá que o botão "Conduzir" da linha da
   *   Agenda aponta (`agenda/LinhaAgendamento.tsx:174-181`) — a condição que
   *   liberou o redirect de `/sessoes`.
   */
  async redirects() {
    return [
      { source: "/painel", destination: "/hoje", permanent: true },
      { source: "/esteira", destination: "/clientes", permanent: true },
      { source: "/comunicacao", destination: "/mensagens", permanent: true },
      // Os números do funil viram aba de Hoje — mantendo o acesso de hoje
      // (todo papel interno). O hash não trafega para o servidor; ele só
      // instrui o navegador a abrir a aba certa depois do redirect.
      { source: "/indicadores", destination: "/hoje#numeros", permanent: true },
      { source: "/conhecimento", destination: "/admin#repertorio", permanent: true },
      { source: "/importacoes", destination: "/admin#importacoes", permanent: true },
      // `/sessoes` era uma tela que só repetia a lista da Agenda. O que ela
      // tinha a mais — o link "Conduzir" — passou para a linha da sessão, onde
      // a pessoa já está olhando. A tela foi APAGADA junto com este redirect.
      { source: "/sessoes", destination: "/agenda#sessoes", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
