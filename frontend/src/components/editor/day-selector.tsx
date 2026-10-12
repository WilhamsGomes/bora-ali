"use client";

import { useEffect, useRef } from "react";
import { dayOfMonth, weekdayShort } from "@/lib/dates";
import type { TripDay } from "@/lib/types";
import { cn } from "@/lib/utils";

interface DaySelectorProps {
  days: TripDay[];
  selectedId: string;
  onSelect: (id: string) => void;
  panelId: string;
  /** Dia que está acontecendo agora (modo "Durante a viagem") */
  liveDayId?: string | null;
}

/** Seletor horizontal de dias, compacto para ficar fixo no topo (padrão de abas). */
export function DaySelector({ days, selectedId, onSelect, panelId, liveDayId }: DaySelectorProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Mantém o dia selecionado visível na faixa, rolando só na horizontal
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-day="${selectedId}"]`);
    if (!list || !el) return;
    const left = el.offsetLeft - list.offsetLeft;
    const margin = 16;
    if (left - margin < list.scrollLeft) list.scrollTo({ left: left - margin });
    else if (left + el.offsetWidth + margin > list.scrollLeft + list.clientWidth) {
      list.scrollTo({ left: left + el.offsetWidth + margin - list.clientWidth });
    }
  }, [selectedId]);

  function onKeyDown(e: React.KeyboardEvent) {
    const index = days.findIndex((d) => d.id === selectedId);
    let next = index;
    if (e.key === "ArrowRight") next = Math.min(days.length - 1, index + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, index - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = days.length - 1;
    else return;
    e.preventDefault();
    onSelect(days[next].id);
    listRef.current?.querySelector<HTMLElement>(`[data-day="${days[next].id}"]`)?.focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Dias da viagem"
      onKeyDown={onKeyDown}
      className="no-scrollbar relative flex min-w-0 flex-1 snap-x gap-1.5 overflow-x-auto py-1"
    >
      {days.map((d, i) => {
        const selected = d.id === selectedId;
        const count = d.activities.length;
        return (
          <button
            key={d.id}
            type="button"
            role="tab"
            data-day={d.id}
            id={`aba-${d.id}`}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(d.id)}
            className={cn(
              "relative flex min-h-11 min-w-17 shrink-0 snap-start flex-col items-center justify-center rounded-xl border px-2.5 py-1 text-center transition",
              selected ? "border-forest bg-forest text-cream" : "border-line bg-white text-ink hover:border-forest/40",
            )}
          >
            <span className={cn("text-[10px] font-bold uppercase tracking-wide", selected ? "text-coral" : "text-ink-soft")}>
              Dia {i + 1}
            </span>
            <span className="text-sm font-bold leading-tight">
              <span className="font-normal">{weekdayShort(d.date)}</span> {dayOfMonth(d.date)}
            </span>
            {liveDayId === d.id && (
              <span className="absolute -right-1 -top-1 size-2.5 rounded-full bg-coral ring-2 ring-cream" aria-hidden />
            )}
            <span className="sr-only">
              {count === 0 ? ", sem atividades" : count === 1 ? ", 1 atividade" : `, ${count} atividades`}
              {liveDayId === d.id ? ", hoje" : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}
