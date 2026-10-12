"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LinkButton } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";

const links = [
  { href: "#como-funciona", label: "Como funciona" },
  { href: "#ia", label: "Assistente IA" },
  { href: "#exportar", label: "Exportar" },
];

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const solid = scrolled || open;

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4">
      <div
        className={cn(
          "mx-auto flex max-w-6xl items-center gap-3 rounded-full px-4 py-2 transition-all duration-300 sm:px-5",
          solid ? "bg-cream/92 shadow-soft backdrop-blur-md" : "on-dark bg-transparent",
        )}
      >
        <Logo tone={solid ? "dark" : "light"} />
        <nav aria-label="Seções" className="ml-6 hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={cn(
                "rounded-full px-3.5 py-2 text-sm font-medium transition",
                solid ? "text-ink hover:bg-forest/5" : "text-cream/90 hover:bg-white/10 hover:text-cream",
              )}
            >
              {l.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <Link
            href="/entrar"
            className={cn(
              "hidden rounded-full px-4 py-2 text-sm font-semibold transition sm:inline-flex",
              solid ? "text-forest hover:bg-forest/5" : "text-cream hover:bg-white/10",
            )}
          >
            Entrar
          </Link>
          <LinkButton href="/cadastro" variant="coral" size="sm" className="h-10 px-4">
            Criar meu roteiro
          </LinkButton>
          <button
            type="button"
            className={cn(
              "inline-flex size-10 items-center justify-center rounded-full md:hidden",
              solid ? "text-forest hover:bg-forest/5" : "text-cream hover:bg-white/10",
            )}
            aria-expanded={open}
            aria-controls="menu-mobile"
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
          </button>
        </div>
      </div>

      {open && (
        <nav
          id="menu-mobile"
          aria-label="Menu"
          className="mx-auto mt-2 max-w-6xl rounded-3xl bg-cream p-3 shadow-lift animate-pop md:hidden"
        >
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block rounded-2xl px-4 py-3 font-medium text-ink hover:bg-forest/5"
            >
              {l.label}
            </a>
          ))}
          <Link href="/entrar" className="block rounded-2xl px-4 py-3 font-semibold text-forest hover:bg-forest/5">
            Entrar
          </Link>
        </nav>
      )}
    </header>
  );
}
