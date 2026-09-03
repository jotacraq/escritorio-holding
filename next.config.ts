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
