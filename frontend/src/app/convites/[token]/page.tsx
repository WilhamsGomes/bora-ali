import type { Metadata } from "next";
import { Suspense } from "react";
import { InvitationPage } from "@/components/app/invitation-page";

export const metadata: Metadata = {
  title: "Convite de viagem · BoraAli",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ConvitePage({ params }: PageProps<"/convites/[token]">) {
  return (
    <Suspense>
      {params.then(({ token }) => (
        <InvitationPage token={decodeURIComponent(token)} />
      ))}
    </Suspense>
  );
}
