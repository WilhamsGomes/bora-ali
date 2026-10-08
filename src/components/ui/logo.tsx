import Link from "next/link";
import { cn } from "@/lib/utils";

/** Logo tipográfico: "Bora" + "Ali" com o pingo do i virando um ponto de destino. */
export function Logo({
  tone = "dark",
  className,
  href = "/",
}: {
  tone?: "dark" | "light";
  className?: string;
  href?: string;
}) {
  return (
    <Link
      href={href}
      aria-label="BoraAli — página inicial"
      className={cn(
        "group inline-flex items-baseline font-display text-2xl font-extrabold tracking-[-0.04em]",
        tone === "dark" ? "text-forest" : "text-cream",
        className,
      )}
    >
      <span>Bora</span>
      <span className="relative">
        Al
        <span className="relative inline-block">
          ı
          <span
            aria-hidden
            className="absolute left-1/2 top-[0.12em] size-[0.26em] -translate-x-1/2 rounded-full bg-coral ring-2 ring-coral/25 transition-transform group-hover:-translate-y-0.5"
          />
        </span>
      </span>
    </Link>
  );
}
