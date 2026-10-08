import type { Metadata } from "next";
import { Suspense } from "react";
import { PublicTrip } from "@/components/trip/public-trip";

export const metadata: Metadata = {
  title: "Roteiro compartilhado · BoraAli",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** Link público somente leitura: acessível sem login. */
export default function PublicTripPage({ params }: PageProps<"/r/[token]">) {
  return (
    <Suspense>
      {params.then(({ token }) => (
        <PublicTrip token={decodeURIComponent(token)} />
      ))}
    </Suspense>
  );
}
