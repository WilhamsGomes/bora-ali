import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gera .next/standalone (server.js + só as dependências usadas), base da imagem Docker.
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    // Fotografias reais de destinos servidas pelo Unsplash (licença gratuita).
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/photo-*",
      },
    ],
  },
};

export default nextConfig;
