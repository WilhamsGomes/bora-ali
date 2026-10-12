"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/** Pilha de modais abertos: Escape e o foco só valem para o do topo. */
const stack: symbol[] = [];
let scrollLocks = 0;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** center: diálogo central (vira folha inferior no celular). drawer: painel lateral. */
  variant?: "center" | "drawer";
  size?: "sm" | "md" | "lg" | "xl";
  /** Marca o modal como área de impressão (usado na exportação). */
  printRoot?: boolean;
  bodyClassName?: string;
}

const sizes = { sm: "sm:max-w-md", md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-5xl" };

export function Modal(props: ModalProps) {
  if (!props.open) return null;
  return createPortal(<ModalInner {...props} />, document.body);
}

function ModalInner({
  onClose,
  title,
  description,
  children,
  footer,
  variant = "center",
  size = "md",
  printRoot,
  bodyClassName,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const token = Symbol("modal");
    stack.push(token);
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;

    // Foco inicial: campo com data-autofocus, senão o primeiro elemento focável
    const target =
      panel?.querySelector<HTMLElement>("[data-autofocus]") ??
      panel?.querySelector<HTMLElement>(FOCUSABLE) ??
      panel;
    target?.focus();

    if (scrollLocks++ === 0) document.documentElement.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (stack[stack.length - 1] !== token) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && panel) {
        const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.offsetParent !== null || el === document.activeElement,
        );
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        } else if (!panel.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      stack.splice(stack.indexOf(token), 1);
      if (--scrollLocks === 0) document.documentElement.style.overflow = "";
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);

  const isDrawer = variant === "drawer";

  return (
    <div className={cn("fixed inset-0 z-[60] print-reset", printRoot && "print-root")}>
      <div
        className="absolute inset-0 bg-ink/45 backdrop-blur-[2px] animate-fade-in print-hide"
        onClick={() => onClose()}
        aria-hidden
      />
      <div
        className={cn(
          "pointer-events-none absolute inset-0 flex print-reset",
          isDrawer ? "items-end sm:items-stretch sm:justify-end" : "items-end justify-center sm:items-center sm:p-6",
        )}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descId : undefined}
          tabIndex={-1}
          className={cn(
            "pointer-events-auto flex max-h-[92svh] w-full flex-col bg-cream shadow-lift outline-none print-reset",
            isDrawer
              ? "rounded-t-3xl animate-sheet-up sm:h-full sm:max-h-none sm:max-w-md sm:rounded-none sm:rounded-l-3xl sm:animate-slide-left"
              : cn("rounded-t-3xl animate-sheet-up sm:rounded-3xl sm:animate-pop", sizes[size]),
          )}
        >
          <div className="flex items-start gap-4 border-b border-line px-5 pb-4 pt-5 sm:px-6 print-hide">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="font-display text-xl font-bold leading-tight text-forest">
                {title}
              </h2>
              {description && (
                <p id={descId} className="mt-1 text-sm text-ink-soft">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="-mr-1 rounded-full p-2 text-ink-soft transition hover:bg-sand/60 hover:text-ink"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
          <div className={cn("flex-1 overflow-y-auto px-5 py-5 sm:px-6 print-reset", bodyClassName)}>{children}</div>
          {footer && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-4 sm:px-6 print-hide pb-[max(1rem,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
