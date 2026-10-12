import { Download, Palette, Printer } from "lucide-react";
import Image from "next/image";
import { ExportPreview } from "@/components/trip/export-preview";
import { photo, photos } from "@/data/photos";
import { seedTrips } from "@/data/mock-trips";

const rio = seedTrips[0];

export function ExportSection() {
  return (
    <section className="relative overflow-hidden px-5 py-24 sm:px-8 sm:py-32">
      <div id="exportar" className="scroll-mt-28 mx-auto grid max-w-6xl items-center gap-16 lg:grid-cols-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-coral-700">Exportação</p>
          <h2 className="mt-3 font-display text-4xl font-extrabold leading-[1] tracking-[-0.03em] text-forest sm:text-6xl">
            O dia inteiro numa imagem.
          </h2>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-ink-soft">
            Gere uma versão vertical do roteiro do dia, no tamanho certo para o celular. Escolha um estilo, baixe em PNG
            ou imprima como PDF.
          </p>
          <ul className="mt-8 space-y-4">
            {[
              { icon: Palette, title: "Três estilos", text: "Minimalista, Diário de viagem e Colorido." },
              { icon: Download, title: "PNG para o celular", text: "Para consultar sem precisar abrir nada." },
              { icon: Printer, title: "Impressão e PDF", text: "Uma página limpa, pronta para a geladeira." },
            ].map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-forest text-cream">
                  <Icon aria-hidden className="size-5" />
                </span>
                <span>
                  <span className="block font-semibold text-ink">{title}</span>
                  <span className="block text-ink-soft">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mx-auto h-[600px] w-full max-w-[480px] sm:h-[660px]" aria-hidden>
          <div className="absolute -right-24 top-10 hidden h-[520px] w-[380px] overflow-hidden rounded-[40px] opacity-90 sm:block">
            <Image src={photo(photos.ipanemaBeach.id, 900)} alt="" fill sizes="380px" className="object-cover" />
          </div>
          <div className="absolute left-0 top-16 origin-top-left -rotate-6 scale-[0.72] rounded-[28px] shadow-lift sm:left-2 sm:scale-[0.8]">
            <ExportPreview trip={rio} day={rio.days[0]} dayNumber={1} variant="diario" className="rounded-[28px]" />
          </div>
          <div className="absolute right-0 top-0 origin-top-right rotate-3 scale-[0.78] rounded-[28px] shadow-lift sm:scale-[0.88]">
            <ExportPreview trip={rio} day={rio.days[1]} dayNumber={2} variant="colorido" className="rounded-[28px]" />
          </div>
        </div>
      </div>
    </section>
  );
}
