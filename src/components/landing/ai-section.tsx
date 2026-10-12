"use client";

import { Check, Plus, Sparkles } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { photo, photos } from "@/data/photos";
import { rioSuggestions } from "@/data/ai-suggestions";
import { categories } from "@/lib/categories";
import { formatDuration } from "@/lib/dates";
import { cn } from "@/lib/utils";

const exampleIds = ["sug-rio-cafe-botafogo", "sug-rio-praia-vermelha", "sug-rio-sesta", "sug-rio-dona-marta"];
const example = exampleIds.map((id) => rioSuggestions.find((s) => s.id === id)!);

export function AiSection() {
  const [added, setAdded] = useState<string[]>([]);

  return (
    <section className="on-dark bg-forest px-5 py-24 text-cream sm:px-8 sm:py-32">
      <div id="ia" className="scroll-mt-28 mx-auto grid max-w-6xl gap-14 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-5">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-coral">Assistente de IA</p>
          <h2 className="mt-3 font-display text-4xl font-extrabold leading-[1] tracking-[-0.03em] sm:text-6xl">
            Travou no planejamento? Diz “me ajuda”.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-cream/80">
            Conte seus interesses, o ritmo e o orçamento. O assistente propõe uma programação para o dia, e você decide o
            que entra no roteiro, sem perder o que já planejou.
          </p>
          <div className="relative mt-10 hidden aspect-[4/3] overflow-hidden rounded-[28px] lg:block">
            <Image
              src={photo(photos.cableCar.id, 1000)}
              alt={photos.cableCar.alt}
              fill
              sizes="40vw"
              className="object-cover"
            />
          </div>
        </div>

        <div className="lg:col-span-7">
          {/* Pedido do usuário */}
          <div className="ml-auto max-w-md rounded-3xl rounded-br-md bg-cream px-5 py-4 text-ink shadow-lift">
            <p className="text-[15px] leading-relaxed">
              Quero um sábado tranquilo saindo de Botafogo: praia de manhã, um descanso depois do almoço e um lugar bonito
              para ver o pôr do sol.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {["Praia", "Mirantes e pôr do sol", "Ritmo tranquilo", "Orçamento moderado"].map((t) => (
                <span key={t} className="rounded-full bg-forest-100 px-2.5 py-1 text-xs font-semibold text-forest">
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* Resposta simulada */}
          <div className="mt-6 rounded-3xl rounded-bl-md border border-white/10 bg-white/[0.06] p-5 sm:p-6">
            <p className="flex items-center gap-2 text-sm font-semibold text-coral">
              <Sparkles aria-hidden className="size-4" /> Sugestão de programação
            </p>
            <ul className="mt-4 space-y-2.5">
              {example.map((s) => {
                const isAdded = added.includes(s.id);
                const cat = categories[s.category];
                return (
                  <li key={s.id} className="flex items-center gap-3 rounded-2xl bg-forest-700/70 p-3 sm:gap-4 sm:p-4">
                    <span className="hidden w-12 shrink-0 font-display text-base font-bold text-cream sm:block">{s.time}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-sm font-bold text-coral sm:hidden">{s.time}</span>
                      <span className="block font-semibold leading-snug">{s.title}</span>
                      <span className="block text-xs text-cream/65">
                        {cat.label} · {s.location} · {formatDuration(s.durationMin)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setAdded((list) => (isAdded ? list.filter((id) => id !== s.id) : [...list, s.id]))
                      }
                      aria-pressed={isAdded}
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold transition",
                        isAdded ? "bg-[#9fd8c4] text-forest" : "bg-coral text-ink hover:bg-coral-600",
                      )}
                    >
                      {isAdded ? <Check aria-hidden className="size-3.5" /> : <Plus aria-hidden className="size-3.5" />}
                      <span className="hidden min-[400px]:inline">{isAdded ? "No roteiro" : "Adicionar"}</span>
                      <span className="sr-only min-[400px]:hidden">{isAdded ? "No roteiro" : "Adicionar"}</span>
                      <span className="sr-only"> {s.title}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-xs text-cream/60">
              Exemplo ilustrativo: estas sugestões são fictícias. No app, a IA propõe sugestões que você revisa antes de entrar no roteiro.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
