import { CalendarDays, Link2, Plus } from "lucide-react";
import Image from "next/image";
import { photo, photos } from "@/data/photos";

/** Três passos em composição editorial, com imagens de tamanhos diferentes. */
export function StepsSection() {
  return (
    <section className="px-5 py-24 sm:px-8 sm:py-32">
      <div id="como-funciona" className="scroll-mt-28 mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-coral-700">Como funciona</p>
          <h2 className="mt-3 font-display text-4xl font-extrabold leading-[1] tracking-[-0.03em] text-forest sm:text-6xl">
            Do primeiro plano ao próximo destino
          </h2>
          <p className="mt-5 text-lg text-ink-soft">
            Três passos simples. Sem planilha, sem grupo de mensagens perdido, sem print de print.
          </p>
        </div>

        {/* Passo 1: imagem grande à esquerda */}
        <div className="mt-16 grid items-center gap-8 md:grid-cols-12 md:gap-12">
          <div className="relative aspect-[4/3] overflow-hidden rounded-[28px] md:col-span-7 md:aspect-[5/4]">
            <Image
              src={photo(photos.copacabanaSidewalk.id, 1400)}
              alt={photos.copacabanaSidewalk.alt}
              fill
              sizes="(min-width: 768px) 58vw, 100vw"
              className="object-cover"
            />
          </div>
          <div className="md:col-span-5">
            <StepNumber n="01" />
            <h3 className="mt-3 font-display text-3xl font-bold tracking-tight text-forest">Crie a viagem</h3>
            <p className="mt-3 text-lg leading-relaxed text-ink-soft">
              Dê um nome, escolha o destino e as datas. O BoraAli monta os dias da viagem para você começar a preencher.
            </p>
            <div className="mt-6 inline-flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 shadow-soft">
              <span className="flex size-9 items-center justify-center rounded-xl bg-coral text-ink">
                <Plus aria-hidden className="size-5" />
              </span>
              <span>
                <span className="block text-sm font-semibold">Nosso Rio ❤️</span>
                <span className="block text-xs text-ink-soft">Rio de Janeiro · 4 dias</span>
              </span>
            </div>
          </div>
        </div>

        {/* Passo 2: texto à esquerda, cartão de interface à direita */}
        <div className="mt-24 grid items-center gap-8 md:grid-cols-12 md:gap-12">
          <div className="order-2 md:order-1 md:col-span-5">
            <StepNumber n="02" />
            <h3 className="mt-3 font-display text-3xl font-bold tracking-tight text-forest">Organize os dias</h3>
            <p className="mt-3 text-lg leading-relaxed text-ink-soft">
              Adicione passeios, refeições, deslocamentos e pausas com horário. Reordene quando os planos mudarem e veja
              tudo numa linha do tempo.
            </p>
          </div>
          <div className="order-1 md:order-2 md:col-span-7">
            <div className="relative rounded-[28px] bg-forest p-6 sm:p-10">
              <div className="flex gap-2" aria-hidden>
                {["sex 16", "sáb 17", "dom 18", "seg 19"].map((d, i) => (
                  <span
                    key={d}
                    className={
                      i === 1
                        ? "rounded-full bg-coral px-4 py-2 text-sm font-bold text-ink"
                        : "rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-cream/80"
                    }
                  >
                    {d}
                  </span>
                ))}
              </div>
              <ul className="mt-6 space-y-3">
                {[
                  ["10:00", "Praia de Ipanema", "3h"],
                  ["13:30", "Almoço perto da praia", "1h15"],
                  ["17:00", "Pôr do sol no Arpoador", "1h15"],
                ].map(([time, title, dur]) => (
                  <li key={time} className="flex items-center gap-4 rounded-2xl bg-cream px-4 py-3">
                    <span className="font-display text-base font-bold text-forest">{time}</span>
                    <span className="flex-1 text-sm font-semibold text-ink sm:text-base">{title}</span>
                    <span className="text-xs text-ink-soft">{dur}</span>
                  </li>
                ))}
              </ul>
              <span className="absolute -bottom-5 right-6 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-forest shadow-lift">
                <CalendarDays aria-hidden className="size-4 text-coral-700" /> Dia 2 de 4
              </span>
            </div>
          </div>
        </div>

        {/* Passo 3: imagem vertical estreita + texto largo */}
        <div className="mt-24 grid items-end gap-8 md:grid-cols-12 md:gap-12">
          <div className="relative aspect-[4/5] overflow-hidden rounded-[28px] md:col-span-4">
            <Image
              src={photo(photos.ipanemaSunset.id, 900)}
              alt={photos.ipanemaSunset.alt}
              fill
              sizes="(min-width: 768px) 33vw, 100vw"
              className="object-cover"
            />
          </div>
          <div className="md:col-span-7 md:col-start-6 md:pb-8">
            <StepNumber n="03" />
            <h3 className="mt-3 font-display text-3xl font-bold tracking-tight text-forest sm:text-5xl sm:leading-[1.02]">
              Compartilhe com quem vai junto
            </h3>
            <p className="mt-4 max-w-lg text-lg leading-relaxed text-ink-soft">
              Envie um link de visualização para a turma, ou exporte o dia como imagem para salvar no celular e consultar
              durante o passeio.
            </p>
            <p className="mt-6 inline-flex items-center gap-2 rounded-full bg-forest-100 px-4 py-2 text-sm font-medium text-forest">
              <Link2 aria-hidden className="size-4" /> Visualização somente leitura
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function StepNumber({ n }: { n: string }) {
  return (
    <span className="font-display text-6xl font-extrabold leading-none tracking-tighter text-coral" aria-hidden>
      {n}
    </span>
  );
}
