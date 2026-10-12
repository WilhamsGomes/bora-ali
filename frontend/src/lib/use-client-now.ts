"use client";

import { useSyncExternalStore } from "react";

/**
 * Hora atual só no cliente (atualiza a cada minuto). No servidor retorna null,
 * evitando divergência de hidratação e leituras de relógio no prerender.
 */
let now: Date | null = null;
const listeners = new Set<() => void>();
let timer: number | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === undefined) {
    timer = window.setInterval(() => {
      now = new Date();
      listeners.forEach((l) => l());
    }, 60_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
}

function getSnapshot() {
  if (now === null) now = new Date();
  return now;
}

export function useClientNow(): Date | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
