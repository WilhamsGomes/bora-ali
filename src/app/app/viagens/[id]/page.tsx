import type { Metadata } from "next";
import { Suspense } from "react";
import { AppNav } from "@/components/app/app-nav";
import { EditorSkeleton, TripEditor } from "@/components/editor/trip-editor";

export const metadata: Metadata = { title: "Editor de roteiro · BoraAli" };

/** Renderizada só depois de restaurar a sessão no cliente (ver app/app/layout.tsx). */
export const instant = false;

export default function EditorPage({ params }: PageProps<"/app/viagens/[id]">) {
  return (
    <>
      <AppNav back={{ href: "/app", label: "Minhas viagens" }} />
      <Suspense fallback={<EditorSkeleton />}>
        {params.then(({ id }) => (
          <TripEditor tripId={decodeURIComponent(id)} />
        ))}
      </Suspense>
    </>
  );
}
