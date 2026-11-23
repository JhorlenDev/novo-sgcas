import type { NextConfig } from "next";

// O modo de desenvolvimento do React usa `eval` (mapas de origem, recarga a quente); a
// versão de produção não. Permitir `eval` onde não é preciso só enfraquece a política:
// com ele, um script injetado ganharia um jeito a mais de rodar texto como código.
const emDesenvolvimento = process.env.NODE_ENV !== "production";
const politicaDeConteudo = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${emDesenvolvimento ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // Não anuncia o framework (e a versão) em toda resposta.
  poweredByHeader: false,
  // Em desenvolvimento, o Next só atende os próprios recursos para `localhost`. Para abrir o
  // front de outra máquina da rede, liste o nome ou IP dela, sem `http://` nem porta:
  //   SGCAS_DEV_ORIGINS=192.168.0.10 npm run dev
  // (as escritas também precisam dessa origem em CSRF_TRUSTED_ORIGINS_EXTRAS, no .env da API).
  allowedDevOrigins: (process.env.SGCAS_DEV_ORIGINS ?? "").split(",").map((origem) => origem.trim()).filter(Boolean),
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  turbopack: {
    root: __dirname,
  },
  experimental: {
    // O Next copia em memória o corpo das requisições que encaminha à API e,
    // acima do limite (padrão 10 MB), passa adiante só o começo, sem erro — o
    // que derruba a conexão com a API. Os anexos do prontuário aceitam até
    // 25 MB (api-sgcas/apps/cidadaos/anexos.py); 26 MB acompanha o
    // client_max_body_size do nginx (deploy/nginx/sgcas.conf).
    proxyClientMaxBodySize: "26mb",
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Content-Security-Policy", value: politicaDeConteudo },
        ],
      },
    ];
  },
  async rewrites() {
    // 127.0.0.1, e não "localhost": no Windows, "localhost" tenta antes o IPv6, e a API
    // (runserver ou a porta do Docker) só escuta no IPv4. O ALLOWED_HOSTS da API já aceita os dois.
    const apiUrl = process.env.SGCAS_API_URL ?? "http://127.0.0.1:8000";
    return [
      ...[
        "access-requests",
        "cases",
        "citizens",
        "institutional/coordinations",
        "institutional/demands",
        "institutional/units",
        "institutional/services",
        "itinerant-actions",
        "notices",
        "queues",
        "users",
      ].map((path) => ({
        source: `/api/${path}/`,
        destination: `${apiUrl}/api/${path}/`,
      })),
      ...[
        "itinerant-actions/resumo",
      ].map((path) => ({
        source: `/api/${path}`,
        destination: `${apiUrl}/api/${path}`,
      })),
      {
        source: "/api/itinerant-actions/:id/:action",
        destination: `${apiUrl}/api/itinerant-actions/:id/:action`,
      },
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
