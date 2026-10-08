import type { ActivityContent, ActivityPlace } from "./types";

/** Atividade numerada pela ordem no dia (a numeração inclui as que não têm localização). */
export interface NumberedActivity<A extends ActivityContent = ActivityContent> {
  activity: A;
  number: number;
}

/** Atividades que compartilham as mesmas coordenadas viram um único marcador. */
export interface MapCluster<A extends ActivityContent = ActivityContent> {
  key: string;
  latitude: number;
  longitude: number;
  items: NumberedActivity<A>[];
}

export interface DayMapPoints<A extends ActivityContent = ActivityContent> {
  numbered: NumberedActivity<A>[];
  clusters: MapCluster<A>[];
  /** Atividades sem coordenadas: continuam na lista, sem marcador */
  unlocated: NumberedActivity<A>[];
}

/** ~1 m: pontos "iguais" na prática (mesmo lugar escolhido duas vezes). */
const coordKey = (p: ActivityPlace) => `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`;

export function dayMapPoints<A extends ActivityContent>(activities: A[]): DayMapPoints<A> {
  const numbered = activities.map((activity, i) => ({ activity, number: i + 1 }));
  const byKey = new Map<string, MapCluster<A>>();
  const unlocated: NumberedActivity<A>[] = [];
  for (const item of numbered) {
    const place = item.activity.place;
    if (!place) {
      unlocated.push(item);
      continue;
    }
    const key = coordKey(place);
    const cluster = byKey.get(key);
    if (cluster) cluster.items.push(item);
    else byKey.set(key, { key, latitude: place.latitude, longitude: place.longitude, items: [item] });
  }
  return { numbered, clusters: [...byKey.values()], unlocated };
}

/** Assinatura das posições: muda só quando algum ponto entra, sai ou se move. */
export function pointsSignature(clusters: MapCluster[]) {
  return clusters
    .map((c) => `${c.key}:${c.items.map((i) => i.activity.id).join("+")}`)
    .sort()
    .join("|");
}

/** Link oficial de busca do Google Maps (Maps URLs) para as coordenadas. */
export function googleMapsUrl(place: Pick<ActivityPlace, "latitude" | "longitude">) {
  return `https://www.google.com/maps/search/?api=1&query=${place.latitude},${place.longitude}`;
}
