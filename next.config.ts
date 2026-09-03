import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hostinger Node.js App: o servidor builda o projeto e roda `next start`.
  // NAO usar output:'standalone' aqui — o server.js do standalone nao carrega
  // .env.production, e as variaveis do deploy chegam por esse arquivo.
  // (medido em 03/09/2026: com standalone, todo request virava config_ausente)
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
