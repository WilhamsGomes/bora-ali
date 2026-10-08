"use client";

import { ChevronLeft, LoaderCircle, LogOut, Plane } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatars";
import { Logo } from "@/components/ui/logo";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/state/providers";

/** Navegação compacta do app com marca, usuário atual e saída. */
export function AppNav({ back }: { back?: { href: string; label: string } }) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const router = useRouter();
  const { state, logout } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const firstName = user?.name.split(/\s+/)[0] ?? "";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    setLeaving(true);
    try {
      await logout();
    } catch {
      toast.show("Você saiu neste aparelho, mas o servidor não confirmou. Em computador compartilhado, feche o navegador.", {
        tone: "info",
      });
    }
    router.replace("/entrar");
  }

  const item = "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-cream disabled:opacity-60";

  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-cream/90 backdrop-blur-md print:hidden">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
        {back ? (
          <Link
            href={back.href}
            className="-ml-2 inline-flex items-center gap-1 rounded-full py-2 pl-2 pr-3 text-sm font-semibold text-forest hover:bg-forest/5"
          >
            <ChevronLeft aria-hidden className="size-4" />
            {back.label}
          </Link>
        ) : (
          <Logo href="/app" className="text-[22px]" />
        )}
        {back && <Logo href="/app" className="mx-auto text-xl sm:mx-0 sm:ml-2" />}

        {user && (
          <div ref={menuRef} className="relative ml-auto">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-haspopup="menu"
              aria-label="Abrir menu do perfil"
              className="flex items-center gap-2 rounded-full p-1 pr-1 transition hover:bg-forest/5 sm:pr-3"
            >
              <Avatar name={user.name} color="#F4775B" />
              <span className="hidden max-w-[12ch] truncate text-sm font-semibold text-ink sm:block">{firstName}</span>
            </button>
            {open && (
              <div
                role="menu"
                className="absolute right-0 top-12 w-64 rounded-2xl border border-line bg-white p-2 shadow-lift animate-pop"
              >
                <div className="px-3 py-2">
                  <p className="truncate text-sm font-semibold">{user.name}</p>
                  <p className="truncate text-xs text-ink-soft">{user.email}</p>
                </div>
                <hr className="my-1 border-line" />
                <Link role="menuitem" href="/app" onClick={() => setOpen(false)} className={item}>
                  <Plane aria-hidden className="size-4 text-ink-soft" />
                  Minhas viagens
                </Link>
                <button role="menuitem" type="button" disabled={leaving} onClick={() => void signOut()} className={item}>
                  {leaving ? (
                    <LoaderCircle aria-hidden className="size-4 animate-spin text-ink-soft" />
                  ) : (
                    <LogOut aria-hidden className="size-4 text-ink-soft" />
                  )}
                  Sair da conta
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
