import { Compass } from "lucide-react";
import { LinkButton } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-forest-100 text-forest">
        <Compass aria-hidden className="size-7" />
      </span>
      <h1 className="mt-4 font-display text-3xl font-bold text-forest">Esse caminho não existe</h1>
      <p className="mt-2 text-ink-soft">A página que você procurou não está no mapa.</p>
      <LinkButton href="/" className="mt-6">
        Voltar para o início
      </LinkButton>
    </main>
  );
}
