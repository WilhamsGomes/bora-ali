import Link from "next/link";
import { Logo } from "@/components/ui/logo";

export function SiteFooter() {
  return (
    <footer className="px-5 pb-10 pt-14 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 md:flex-row md:items-start md:justify-between">
        <div className="max-w-xs">
          <Logo />
          <p className="mt-3 text-sm text-ink-soft">Roteiros de viagem do seu jeito, à mão ou com uma ajudinha da IA.</p>
        </div>
        <nav aria-label="Rodapé" className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm">
          <a href="#como-funciona" className="text-ink-soft hover:text-forest">Como funciona</a>
          <Link href="/app" className="text-ink-soft hover:text-forest">Minhas viagens</Link>
          <a href="#ia" className="text-ink-soft hover:text-forest">Assistente IA</a>
          <Link href="/entrar" className="text-ink-soft hover:text-forest">Entrar</Link>
          <a href="#exportar" className="text-ink-soft hover:text-forest">Exportar</a>
        </nav>
      </div>
      <div className="mx-auto mt-10 flex max-w-6xl flex-col gap-2 border-t border-line pt-6 text-xs text-ink-soft sm:flex-row sm:justify-between">
        <p>© 2026 BoraAli · Os roteiros mostrados nesta página são exemplos ilustrativos.</p>
        <p>Fotos: Unsplash.</p>
      </div>
    </footer>
  );
}
