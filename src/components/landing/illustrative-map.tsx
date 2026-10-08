import { MapPinned } from "lucide-react";
import { categories } from "@/lib/categories";
import type { ActivityContent as Activity } from "@/lib/types";
import { cn } from "@/lib/utils";

interface IllustrativeMapProps {
  activities: Activity[];
  rio: boolean;
  highlightId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
}

/**
 * Mapa ilustrativo da landing page, desenhado em SVG, para o roteiro de EXEMPLO.
 * Não usa API de mapas nem coordenadas: o app usa o mapa real (components/map/day-map).
 */
export function IllustrativeMap({ activities, rio, highlightId, onSelect, className }: IllustrativeMapProps) {
  // Pontos no mesmo lugar ganham um pequeno deslocamento para os números não se sobreporem
  const seen = new Map<string, number>();
  const points = activities.map((a, i) => {
    const pos = mapPosition(a, rio);
    const key = `${pos.x},${pos.y}`;
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    const angle = (count * Math.PI) / 2.5;
    const offset = count === 0 ? 0 : 5;
    return { a, n: i + 1, x: pos.x + Math.cos(angle) * offset, y: pos.y - Math.sin(angle) * offset * 0.9 };
  });

  return (
    <div
      className={cn("relative overflow-hidden rounded-2xl border border-line bg-[#cfe3e3]", className)}
      role="img"
      aria-label={`Mapa ilustrativo com ${points.length} ponto${points.length === 1 ? "" : "s"} numerado${points.length === 1 ? "" : "s"}`}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
        {rio ? <RioShapes /> : <GenericShapes />}
        {points.length > 1 && (
          <polyline
            points={points.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="#183F36"
            strokeWidth="2"
            strokeDasharray="5 5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            opacity="0.55"
          />
        )}
      </svg>

      {rio && <RioLabels />}

      {points.map((p) => {
        const active = highlightId === p.a.id;
        const color = categories[p.a.category].color;
        const Tag = onSelect ? "button" : "span";
        return (
          <Tag
            key={p.a.id}
            {...(onSelect ? { type: "button" as const, onClick: () => onSelect(p.a.id) } : {})}
            aria-label={onSelect ? `${p.n}. ${p.a.title}` : undefined}
            title={`${p.n}. ${p.a.title}`}
            className={cn(
              "absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full font-bold text-white shadow-[0_2px_6px_rgba(0,0,0,0.25)] ring-2 ring-white transition-transform",
              active ? "z-10 size-9 scale-110 text-sm ring-4 ring-coral" : "size-7 text-xs hover:scale-110",
            )}
            style={{ left: `${p.x}%`, top: `${p.y}%`, backgroundColor: color }}
          >
            {p.n}
          </Tag>
        );
      })}

      {points.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
          <MapPinned aria-hidden className="size-7 text-forest/70" />
          <p className="max-w-[220px] text-sm font-medium text-forest">
            Os pontos aparecem aqui quando você adiciona atividades ao dia.
          </p>
        </div>
      )}

      <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-forest shadow-soft">
        Mapa ilustrativo
      </span>
    </div>
  );
}

function RioShapes() {
  return (
    <>
      <rect width="100" height="100" fill="#cfe3e3" />
      {/* Terra firme, do Leblon ao Centro */}
      <path
        d="M0 0 L82 0 L84 8 L87 14 L84 22 L81 32 L80 38 L76 42 L73 45 L77 48 L84 47 L88 44 L92 46 L96 50 L93 54 L88 55 L84 58 L78 66 L70 74 L62 78 L57 84 L50 86 L30 86 L0 85 Z"
        fill="#f3ede1"
      />
      {/* Floresta da Tijuca e morros */}
      <path d="M8 18 C18 6, 44 8, 58 24 C64 32, 60 44, 50 46 C38 48, 30 40, 22 42 C12 44, 4 32, 8 18 Z" fill="#cfe0cf" />
      <ellipse cx="66" cy="58" rx="6" ry="4" fill="#d8e6d4" />
      <ellipse cx="93" cy="50" rx="3" ry="3.5" fill="#cfe0cf" />
      {/* Lagoa Rodrigo de Freitas */}
      <ellipse cx="47" cy="66" rx="7" ry="5" fill="#bcd8da" />
      {/* Ruas principais estilizadas */}
      <path d="M74 12 C70 26, 74 36, 70 48 C66 58, 64 66, 58 76" stroke="#e2d8c6" strokeWidth="1.4" fill="none" vectorEffect="non-scaling-stroke" />
      <path d="M20 80 C34 76, 48 74, 60 70" stroke="#e2d8c6" strokeWidth="1.4" fill="none" vectorEffect="non-scaling-stroke" />
    </>
  );
}

function RioLabels() {
  const labels: [string, number, number, string?][] = [
    ["Centro", 66, 10],
    ["Santa Teresa", 54, 30],
    ["Flamengo", 69, 34],
    ["Botafogo", 62, 49],
    ["Urca", 85, 40],
    ["Copacabana", 63, 63],
    ["Lagoa", 41, 72],
    ["Ipanema", 38, 89, "water"],
    ["Baía de Guanabara", 90, 20, "water"],
    ["Oceano Atlântico", 74, 92, "water"],
  ];
  return (
    <>
      {labels.map(([text, x, y, kind]) => (
        <span
          key={text}
          aria-hidden
          className={cn(
            "pointer-events-none absolute -translate-x-1/2 text-[10px] font-semibold uppercase tracking-wider",
            kind === "water" ? "w-20 text-center leading-tight italic text-[#46797a]" : "whitespace-nowrap text-forest/45",
          )}
          style={{ left: `${x}%`, top: `${y}%` }}
        >
          {text}
        </span>
      ))}
    </>
  );
}

function GenericShapes() {
  return (
    <>
      <rect width="100" height="100" fill="#f3ede1" />
      <path d="M0 70 C20 62, 34 78, 52 70 C70 62, 82 74, 100 66 L100 100 L0 100 Z" fill="#cfe3e3" />
      <path d="M10 10 C26 4, 40 14, 36 28 C32 40, 14 38, 10 28 Z" fill="#cfe0cf" />
      <path d="M64 18 C76 12, 92 20, 88 32 C84 42, 68 40, 64 30 Z" fill="#d8e6d4" />
      <path d="M0 48 C30 44, 60 52, 100 44" stroke="#e2d8c6" strokeWidth="1.6" fill="none" vectorEffect="non-scaling-stroke" />
      <path d="M46 0 C50 20, 44 40, 52 66" stroke="#e2d8c6" strokeWidth="1.6" fill="none" vectorEffect="non-scaling-stroke" />
    </>
  );
}

/* Posições ilustrativas (0–100) para o exemplo do Rio. Não são coordenadas reais. */

const rioPlaces: [RegExp, { x: number; y: number }][] = [
  [/santos dumont/i, { x: 82, y: 14 }],
  [/gale[aã]o/i, { x: 70, y: 4 }],
  [/pra[cç]a mau[aá]|museu do amanh[aã]/i, { x: 78, y: 7 }],
  [/cinel[aâ]ndia|centro/i, { x: 74, y: 15 }],
  [/selar[oó]n|lapa/i, { x: 70, y: 22 }],
  [/santa teresa|guimar[aã]es/i, { x: 63, y: 26 }],
  [/flamengo|catete/i, { x: 76, y: 32 }],
  [/dona marta/i, { x: 63, y: 42 }],
  [/corcovado|cristo/i, { x: 54, y: 38 }],
  [/humait[aá]|cobal/i, { x: 60, y: 51 }],
  [/pista cl[aá]udio|praia vermelha|p[aã]o de a[cç][uú]car|bondinho/i, { x: 92, y: 50 }],
  [/urca|mureta/i, { x: 86, y: 49 }],
  [/enseada|voluntários|nelson mandela|botafogo|hospedagem/i, { x: 70, y: 50 }],
  [/leme/i, { x: 79, y: 62 }],
  [/copacabana/i, { x: 71, y: 70 }],
  [/jardim bot[aâ]nico/i, { x: 35, y: 52 }],
  [/lagoa/i, { x: 47, y: 62 }],
  [/arpoador/i, { x: 55, y: 81 }],
  [/ipanema|posto 9/i, { x: 44, y: 82 }],
  [/leblon/i, { x: 31, y: 82 }],
];

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mapPosition(activity: { title: string; location?: string }, rio: boolean) {
  const text = `${activity.location ?? ""} ${activity.title}`;
  if (rio) {
    // Busca primeiro pelo local, depois pelo título
    for (const source of [activity.location ?? "", activity.title]) {
      const found = rioPlaces.find(([re]) => re.test(source));
      if (found) return found[1];
    }
  }
  const h = hash(text.trim().toLowerCase() || "local");
  return { x: 14 + (h % 72), y: 14 + ((h >>> 8) % 66) };
}
