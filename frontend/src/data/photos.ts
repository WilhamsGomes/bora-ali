/**
 * Fotografias reais de destinos, hospedadas no Unsplash (licença gratuita).
 * Use `photo(id, largura)` para montar a URL com o tamanho desejado.
 */
const base = "https://images.unsplash.com/photo-";

export function photo(id: string, width = 1600) {
  return `${base}${id}?auto=format&fit=crop&w=${width}&q=75`;
}

export const photos = {
  rioAerial: {
    id: "1483729558449-99ef09a8c325",
    alt: "Vista aérea do Pão de Açúcar e da enseada de Botafogo, no Rio de Janeiro",
  },
  botafogoBay: {
    id: "1543958871-ccfa180a0c39",
    alt: "Enseada de Botafogo com o Pão de Açúcar ao fundo",
  },
  copacabanaSidewalk: {
    id: "1643400813604-b3877e0c4db9",
    alt: "Calçadão ondulado de Copacabana visto de cima, com palmeiras",
  },
  ipanemaSunset: {
    id: "1668194645738-ef8dbb426086",
    alt: "Amigos jogando bola na praia de Ipanema ao pôr do sol",
  },
  sugarloafSunset: {
    id: "1589137846286-b70355bb0d07",
    alt: "Silhueta do Pão de Açúcar ao pôr do sol",
  },
  sugarloafDay: {
    id: "1758358042850-b5422ce2b661",
    alt: "Pão de Açúcar visto da Urca em um dia de céu azul",
  },
  cableCar: {
    id: "1544989164-31dc3c645987",
    alt: "Bondinho do Pão de Açúcar sobre a cidade do Rio de Janeiro",
  },
  ipanemaBeach: {
    id: "1507125524815-d9d6dccda1dc",
    alt: "Praia de Ipanema com o morro Dois Irmãos ao fundo",
  },
  rioHaze: {
    id: "1781041004326-708f2f3cf62b",
    alt: "Praias e montanhas do Rio de Janeiro ao entardecer",
  },
  paraty: {
    id: "1660076327655-a43e7cadf86d",
    alt: "Coqueiros e casario de Paraty ao entardecer",
  },
  lisboa: {
    id: "1585208798174-6cedd86e019a",
    alt: "Elétrico amarelo em uma rua histórica de Lisboa",
  },
  salvador: {
    id: "1640884216864-b26b780ff102",
    alt: "Casarões coloridos do Pelourinho, em Salvador",
  },
  florianopolis: {
    id: "1778332642782-90c3fcf235b0",
    alt: "Praia com barcos e ilha em Florianópolis",
  },
} as const;

export type PhotoKey = keyof typeof photos;

/** Escolhe uma capa a partir do nome do destino digitado pelo usuário. */
export function coverForDestination(destination: string): { url: string; alt: string } {
  const d = destination
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const match: [string, PhotoKey][] = [
    ["rio", "botafogoBay"],
    ["paraty", "paraty"],
    ["lisboa", "lisboa"],
    ["portugal", "lisboa"],
    ["salvador", "salvador"],
    ["bahia", "salvador"],
    ["floripa", "florianopolis"],
    ["florianopolis", "florianopolis"],
  ];
  const key = match.find(([k]) => d.includes(k))?.[1] ?? "rioHaze";
  return { url: photo(photos[key].id), alt: photos[key].alt };
}

export const isUnsplash = (url: string) => url.startsWith(base);

/** Capa de uma viagem da API: a URL salva ou, sem ela, uma foto escolhida pelo destino. */
export function coverOf(trip: { coverUrl: string | null; destination: string }): { url: string; alt: string } {
  if (!trip.coverUrl) return coverForDestination(trip.destination);
  const known = coverOptions.find((o) => photo(photos[o.key].id) === trip.coverUrl);
  return { url: trip.coverUrl, alt: known ? photos[known.key].alt : `Foto de capa da viagem para ${trip.destination}` };
}

/** Capas disponíveis para escolher ao editar uma viagem. */
export const coverOptions: { key: PhotoKey; label: string }[] = [
  { key: "botafogoBay", label: "Enseada de Botafogo" },
  { key: "rioAerial", label: "Rio visto de cima" },
  { key: "ipanemaBeach", label: "Praia de Ipanema" },
  { key: "sugarloafSunset", label: "Pôr do sol no Rio" },
  { key: "paraty", label: "Paraty" },
  { key: "salvador", label: "Salvador" },
  { key: "florianopolis", label: "Florianópolis" },
  { key: "lisboa", label: "Lisboa" },
];
