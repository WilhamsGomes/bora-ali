import { ArrowDown, ArrowRight } from "lucide-react";
import Image from "next/image";
import { LinkButton } from "@/components/ui/button";
import { photo, photos } from "@/data/photos";
import { ProductPreview } from "./product-preview";

export function Hero() {
  return (
    <section className="relative">
      <div className="on-dark relative isolate flex min-h-[min(94svh,980px)] flex-col overflow-hidden text-cream">
        <Image
          src={photo(photos.rioAerial.id, 2400)}
          alt={photos.rioAerial.alt}
          fill
          preload
          sizes="100vw"
          className="-z-10 object-cover object-[center_40%]"
        />
        <div className="absolute inset-0 -z-10 bg-linear-to-b from-[#0f2a24]/70 via-[#0f2a24]/25 to-[#0f2a24]/75" />

        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-5 pb-40 pt-28 sm:px-8 sm:pb-48">
          <p className="animate-fade-up text-xs font-bold uppercase tracking-[0.24em] text-coral">
            Planeje · Organize · Compartilhe
          </p>
          <h1 className="mt-4 max-w-4xl animate-fade-up font-display text-[2.75rem] font-extrabold leading-[0.95] tracking-[-0.035em] [animation-delay:80ms] sm:text-7xl lg:text-[5.5rem]">
            Sua próxima viagem começa com um BoraAli.
          </h1>
          <p className="mt-6 max-w-xl animate-fade-up text-lg leading-relaxed text-cream/90 [animation-delay:160ms] sm:text-xl">
            Monte o roteiro dia a dia do seu jeito: organize tudo à mão ou peça sugestões para a IA. Depois é só
            compartilhar com quem vai junto.
          </p>
          <div className="mt-9 flex animate-fade-up flex-wrap items-center gap-3 [animation-delay:240ms]">
            <LinkButton href="/cadastro" variant="coral" size="lg">
              Criar meu roteiro
              <ArrowRight aria-hidden className="size-5" />
            </LinkButton>
            <a
              href="#como-funciona"
              className="inline-flex h-13 items-center gap-2 rounded-full px-5 font-semibold text-cream ring-1 ring-cream/40 transition hover:bg-white/10"
            >
              Ver como funciona
              <ArrowDown aria-hidden className="size-4" />
            </a>
          </div>
        </div>
      </div>

      {/* Prévia do produto encostada no hero */}
      <div className="relative z-10 mx-auto -mt-36 max-w-6xl px-4 sm:-mt-44 sm:px-8">
        <ProductPreview />
      </div>
    </section>
  );
}
