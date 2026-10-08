import { ArrowRight } from "lucide-react";
import Image from "next/image";
import { LinkButton } from "@/components/ui/button";
import { photo, photos } from "@/data/photos";

export function FinalCta() {
  return (
    <section className="px-3 pb-3 sm:px-5 sm:pb-5">
      <div className="on-dark relative isolate overflow-hidden rounded-[32px] px-6 py-28 text-center text-cream sm:py-40">
        <Image
          src={photo(photos.sugarloafSunset.id, 2000)}
          alt={photos.sugarloafSunset.alt}
          fill
          sizes="100vw"
          className="-z-10 object-cover"
        />
        <div className="absolute inset-0 -z-10 bg-[#1a120c]/45" />
        <h2 className="mx-auto max-w-3xl font-display text-5xl font-extrabold leading-[0.95] tracking-[-0.035em] sm:text-7xl">
          E aí, bora pra onde?
        </h2>
        <p className="mx-auto mt-5 max-w-md text-lg text-cream/90">
          Crie sua primeira viagem em menos de um minuto. O resto a gente organiza junto.
        </p>
        <LinkButton href="/cadastro" variant="coral" size="lg" className="mt-9">
          Criar meu roteiro
          <ArrowRight aria-hidden className="size-5" />
        </LinkButton>
      </div>
    </section>
  );
}
