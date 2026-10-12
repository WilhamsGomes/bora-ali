import type { Metadata } from "next";
import { AppNav } from "@/components/app/app-nav";
import { TripsPage } from "@/components/app/trips-page";

export const metadata: Metadata = { title: "Minhas viagens · BoraAli" };

/** Renderizada só depois de restaurar a sessão no cliente (ver app/app/layout.tsx). */
export const instant = false;

export default function MinhasViagens() {
  return (
    <>
      <AppNav />
      <TripsPage />
    </>
  );
}
