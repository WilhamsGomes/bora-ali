"use client";

import { LoaderCircle } from "lucide-react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import type { DayMapProps } from "./day-map";

/** MapLibre depende de window/WebGL: carregado só no cliente e em um bundle separado. */
export const DayMapLazy = dynamic<DayMapProps>(() => import("./day-map").then((m) => m.DayMap), {
  ssr: false,
  loading: () => <MapPlaceholder />,
});

export function MapPlaceholder({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex size-full items-center justify-center rounded-2xl border border-line bg-[#eef0ec] p-6 text-center",
        className,
      )}
    >
      {children ?? (
        <span role="status">
          <LoaderCircle aria-hidden className="size-6 animate-spin text-forest" />
          <span className="sr-only">Carregando mapa</span>
        </span>
      )}
    </div>
  );
}
