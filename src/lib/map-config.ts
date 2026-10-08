/**
 * Configuração dos tiles do mapa (somente variáveis públicas; nenhum segredo).
 *
 * Padrão: OpenFreeMap (https://openfreemap.org), estilo claro "positron" — tiles vetoriais do
 * OpenStreetMap sem chave, sem cadastro e sem limite de visualizações, com uso comercial permitido.
 * Não há SLA (projeto mantido por doações); se ficar fora do ar, o mapa mostra erro com nova
 * tentativa e a lista do dia continua funcionando.
 *
 * - NEXT_PUBLIC_MAP_STYLE_URL: URL de outro estilo MapLibre (ex.: tiles próprios em PMTiles).
 *   Use "off" para desativar o mapa (o painel mostra indisponibilidade explícita).
 *
 * As atribuições exigidas (© OpenMapTiles, © OpenStreetMap) vêm no style.json e o MapLibre as exibe.
 */
export interface MapConfig {
  styleUrl: string;
}

export const DEFAULT_MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

export function getMapConfig(): MapConfig | null {
  // Referência literal: o Next só embute no bundle variáveis NEXT_PUBLIC_ escritas assim.
  const configured = process.env.NEXT_PUBLIC_MAP_STYLE_URL?.trim();
  if (configured?.toLowerCase() === "off") return null;
  return { styleUrl: configured || DEFAULT_MAP_STYLE_URL };
}
