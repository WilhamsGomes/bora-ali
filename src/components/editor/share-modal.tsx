"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Info, LoaderCircle, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { errorMessage } from "@/api/client";
import type { ShareLinkDto } from "@/api/contracts";
import { sharingApi } from "@/api/endpoints";
import { Button, buttonClasses } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import type { Trip } from "@/lib/types";
import { cn } from "@/lib/utils";
import { keys, useShareLink } from "@/state/queries";

interface ShareModalProps {
  open: boolean;
  onClose: () => void;
  trip: Trip;
}

export function ShareModal({ open, onClose, trip }: ShareModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Link público" description="Quem tiver o link vê o roteiro, sem editar e sem entrar.">
      <ShareBody trip={trip} />
    </Modal>
  );
}

function ShareBody({ trip }: { trip: Trip }) {
  const qc = useQueryClient();
  const toast = useToast();
  const query = useShareLink(trip.id, true);
  const [busy, setBusy] = useState<"toggle" | "notes" | "rotate" | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);

  async function run(kind: NonNullable<typeof busy>, action: () => Promise<ShareLinkDto>, success: string) {
    setBusy(kind);
    try {
      qc.setQueryData(keys.share(trip.id), await action());
      toast.show(success);
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
      void qc.invalidateQueries({ queryKey: keys.share(trip.id) });
    }
    setBusy(null);
    setConfirmRotate(false);
  }

  if (query.isPending) return <LoaderCircle aria-label="Carregando link" className="size-5 animate-spin text-forest" />;
  if (query.isError) {
    return (
      <p role="alert" className="text-sm text-[#9b2c1a]">
        {errorMessage(query.error)}{" "}
        <button type="button" className="font-semibold underline" onClick={() => void query.refetch()}>
          Tentar novamente
        </button>
      </p>
    );
  }

  const link = query.data;

  return (
    <div className="space-y-5">

      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-white p-4">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-forest"
          checked={link.enabled}
          disabled={busy !== null}
          onChange={(e) =>
            void run(
              "toggle",
              () => sharingApi.update(trip.id, { enabled: e.target.checked, showNotes: link.showNotes }),
              e.target.checked ? "Link público ativado" : "Link público desativado",
            )
          }
        />
        <span className="flex-1">
          <span className="block text-sm font-semibold text-ink">Permitir acesso pelo link</span>
          <span className="block text-xs text-ink-soft">
            Desativado, o link para de funcionar na hora. Você pode reativar depois com o mesmo endereço.
          </span>
        </span>
        {busy === "toggle" && <LoaderCircle aria-hidden className="size-4 animate-spin text-forest" />}
      </label>


      {link.enabled && link.url && (
        <>
          <CopyField url={link.url} />
          <div className="flex flex-wrap gap-2">
            <a href={link.url} target="_blank" rel="noopener noreferrer" className={buttonClasses("secondary", "sm")}>
              <ExternalLink aria-hidden className="size-4" /> Abrir visualização pública
              <span className="sr-only"> (abre em nova aba)</span>
            </a>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-white p-4">
            <input
              type="checkbox"
              className="mt-1 size-4 accent-forest"
              checked={link.showNotes}
              disabled={busy !== null}
              onChange={(e) =>
                void run(
                  "notes",
                  () => sharingApi.update(trip.id, { enabled: true, showNotes: e.target.checked }),
                  e.target.checked ? "Observações visíveis no link" : "Observações ocultas no link",
                )
              }
            />
            <span className="flex-1">
              <span className="block text-sm font-semibold text-ink">Mostrar observações das atividades</span>
              <span className="block text-xs text-ink-soft">
                Desmarcado, quem abre o link vê horários, locais e títulos, mas não as observações.
              </span>
            </span>
            {busy === "notes" && <LoaderCircle aria-hidden className="size-4 animate-spin text-forest" />}
          </label>

          <div className="rounded-2xl border border-line p-4">
            <p className="text-sm font-semibold text-ink">Renovar link</p>
            <p className="mt-1 text-xs text-ink-soft">
              Gera um endereço novo. O link anterior deixa de funcionar imediatamente para todo mundo que o recebeu.
            </p>
            {confirmRotate ? (
              <div role="alert" className="mt-3 flex flex-wrap items-center gap-2">
                <span className="flex-1 text-sm text-[#7a2a1a]">Invalidar o link atual e gerar outro?</span>
                <Button size="sm" variant="ghost" onClick={() => setConfirmRotate(false)} disabled={busy !== null}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy !== null}
                  onClick={() => void run("rotate", () => sharingApi.rotate(trip.id), "Novo link gerado; o anterior parou de funcionar")}
                >
                  {busy === "rotate" && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
                  Renovar link
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="secondary" className="mt-3" disabled={busy !== null} onClick={() => setConfirmRotate(true)}>
                <RefreshCw aria-hidden className="size-4" /> Renovar link
              </Button>
            )}
          </div>
        </>
      )}

      <p className="flex items-start gap-1.5 text-xs text-ink-soft">
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        Para quem vai editar junto, use Participantes: o link público é só para visualizar.
      </p>
    </div>
  );
}

function CopyField({ url }: { url: string }) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      // Alternativa para navegadores sem permissão de área de transferência
      inputRef.current?.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      toast.show("Link copiado");
      window.setTimeout(() => setCopied(false), 2500);
    } else {
      inputRef.current?.focus();
      inputRef.current?.select();
      toast.show("Não foi possível copiar automaticamente. O link está selecionado para você copiar.", { tone: "error" });
    }
  }

  return (
    <div>
      <label htmlFor="link-compartilhar" className="text-sm font-semibold text-ink">
        Link de visualização
      </label>
      <div className="mt-1.5 flex gap-2">
        <input
          ref={inputRef}
          id="link-compartilhar"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className={cn(inputClasses, "min-w-0 flex-1 bg-cream-200/60 text-sm")}
        />
        <Button onClick={copy} className="shrink-0" aria-live="polite">
          {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
          {copied ? "Copiado!" : "Copiar"}
        </Button>
      </div>
    </div>
  );
}
