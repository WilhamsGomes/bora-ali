// Copia o worker do MapLibre GL (v6, ESM) para public/, servido pela mesma origem do app.
// O MapLibre resolve o worker em tempo de execução (new URL(..., import.meta.url)), caminho
// que o bundler não acompanha; por isso o arquivo é publicado e configurado com setWorkerUrl.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = join(root, "node_modules", "maplibre-gl");
const { version } = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));
const target = join(root, "public", "vendor", "maplibre-gl-worker.mjs");
mkdirSync(dirname(target), { recursive: true });
copyFileSync(join(pkg, "dist", "maplibre-gl-worker.mjs"), target);
console.log(`maplibre-gl-worker ${version} → public/vendor/maplibre-gl-worker.mjs`);
