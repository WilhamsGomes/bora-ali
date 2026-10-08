import { AiSection } from "@/components/landing/ai-section";
import { ExportSection } from "@/components/landing/export-section";
import { FinalCta } from "@/components/landing/final-cta";
import { Hero } from "@/components/landing/hero";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { StepsSection } from "@/components/landing/steps-section";
//

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <StepsSection />
        <AiSection />
        <ExportSection />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
