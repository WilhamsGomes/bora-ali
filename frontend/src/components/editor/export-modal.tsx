"use client";

import { Download, LoaderCircle, Printer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ExportPreview, exportStyles, type ExportStyle, type ExportTrip } from "@/components/trip/export-preview";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { coverForDestination, coverOf, isUnsplash } from "@/data/photos";
import { longDate } from "@/lib/dates";
import { plural } from "@/lib/format";
import type { Trip } from "@/lib/types";
import { cn, slugify } from "@/lib/utils";

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  trip: Trip;
  initialDayId: string;
}

export function ExportModal({ open, onClose, trip, initialDayId }: ExportModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      printRoot
      title="Exportar roteiro do dia"
      description="Escolha um estilo. A prévia é exatamente o que vai para o arquivo."
    >
      <ExportBody trip={trip} initialDayId={initialDayId} />
    </Modal>
  );
}

const PREVIEW_W = 360;

/** Espera fontes e imagens da prévia carregarem antes de gerar o arquivo. */
async function waitForAssets(node: HTMLElement) {
  await document.fonts.ready;
  const images = Array.from(node.querySelectorAll("img"));
  await Promise.all(
    images.map(async (img) => {
      if (!img.complete || img.naturalWidth === 0) {
        await new Promise<void>((resolve, reject) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => reject(new Error("Imagem não carregou")), { once: true });
        });
      }
      await img.decode().catch(() => undefined);
    }),
  );
}

function ExportBody({ trip, initialDayId }: { trip: Trip; initialDayId: string }) {
  const toast = useToast();
  const [variant, setVariant] = useState<ExportStyle>("colorido");
  const [dayId, setDayId] = useState(initialDayId);
  const [busy, setBusy] = useState<null | "png" | "pdf">(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [previewHeight, setPreviewHeight] = useState(640);

  // A arte usa o roteiro salvo; capas externas são trocadas por uma foto servida pelo próprio app (sem CORS no PNG)
  const cover = coverOf(trip).url;
  const art: ExportTrip = {
    name: trip.name,
    destination: trip.destination,
    coverUrl: isUnsplash(cover) ? cover : coverForDestination(trip.destination).url,
  };
  const dayIndex = Math.max(0, trip.days.findIndex((d) => d.id === dayId));
  const day = trip.days[dayIndex];

  // Reduz a prévia em telas estreitas e acompanha a altura real do conteúdo
  useEffect(() => {
    const frame = frameRef.current;
    const preview = previewRef.current;
    if (!frame || !preview) return;
    const ro = new ResizeObserver(() => {
      setScale(Math.min(1, frame.clientWidth / PREVIEW_W));
      setPreviewHeight(preview.offsetHeight);
    });
    ro.observe(frame);
    ro.observe(preview);
    return () => ro.disconnect();
  }, []);

  // Limpa o modo de impressão se o modal fechar no meio
  useEffect(() => () => document.body.classList.remove("printing-export"), []);

  async function downloadPng() {
    const node = previewRef.current;
    if (!node) return;
    setBusy("png");
    try {
      await waitForAssets(node);
      const { toPng } = await import("html-to-image");
      const width = node.offsetWidth;
      const height = node.offsetHeight;
      // Dias longos geram imagens altas: limita a resolução para não estourar o canvas
      const pixelRatio = Math.max(1, Math.min(3, 8000 / height));
      const dataUrl = await toPng(node, { width, height, pixelRatio, cacheBust: false });
      const link = document.createElement("a");
      link.download = `boraali-${slugify(trip.name) || "roteiro"}-dia-${dayIndex + 1}-${variant}.png`;
      link.href = dataUrl;
      link.click();
      toast.show("PNG gerado e enviado para seus downloads");
    } catch {
      toast.show("Não foi possível gerar o PNG neste navegador. Tente a impressão em PDF.", { tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function print() {
    const node = previewRef.current;
    if (!node) return;
    setBusy("pdf");
    try {
      await waitForAssets(node);
    } catch {
      // Segue mesmo sem a foto: o texto do roteiro é o essencial
    }
    setBusy(null);
    const cleanup = () => {
      document.body.classList.remove("printing-export");
      window.removeEventListener("afterprint", cleanup);
    };
    document.body.classList.add("printing-export");
    window.addEventListener("afterprint", cleanup);
    window.print();
  }

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_300px] md:gap-8 print-reset">
      <div className="flex min-w-0 justify-center rounded-3xl bg-sand/50 p-4 sm:p-6 print-reset">
        <div ref={frameRef} className="w-full min-w-0 max-w-[360px] print-reset">
          <div style={{ height: previewHeight * scale }} className="print-reset">
            <div
              className="print-area origin-top-left"
              style={{ transform: scale < 1 ? `scale(${scale})` : undefined, width: PREVIEW_W }}
            >
              <ExportPreview
                ref={previewRef}
                trip={art}
                day={day}
                dayNumber={dayIndex + 1}
                variant={variant}
                className="rounded-[20px] shadow-lift"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6 print-hide">
        <fieldset>
          <legend className="text-sm font-semibold text-ink">Estilo</legend>
          <div className="mt-2 space-y-2">
            {exportStyles.map((s) => (
              <label
                key={s.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-2xl border p-3 transition has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-forest",
                  variant === s.id ? "border-forest bg-white shadow-soft" : "border-line hover:border-forest/40",
                )}
              >
                <input
                  type="radio"
                  name="estilo"
                  value={s.id}
                  checked={variant === s.id}
                  onChange={() => setVariant(s.id)}
                  className="size-4 accent-forest"
                />
                <StyleSwatch id={s.id} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{s.label}</span>
                  <span className="block text-xs text-ink-soft">{s.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="dia-exportar" className="text-sm font-semibold text-ink">
            Dia
          </label>
          <select id="dia-exportar" className={inputClasses} value={day.id} onChange={(e) => setDayId(e.target.value)}>
            {trip.days.map((d, i) => (
              <option key={d.id} value={d.id}>
                Dia {i + 1} · {longDate(d.date)} ({plural(d.activities.length, "atividade", "atividades")})
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Button className="w-full" onClick={downloadPng} disabled={busy !== null}>
            {busy === "png" ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Download aria-hidden className="size-4" />}
            {busy === "png" ? "Gerando PNG…" : "Baixar PNG"}
          </Button>
          <Button variant="secondary" className="w-full" onClick={print} disabled={busy !== null}>
            {busy === "pdf" ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Printer aria-hidden className="size-4" />}
            {busy === "pdf" ? "Preparando…" : "Imprimir ou salvar PDF"}
          </Button>
          <p className="text-xs text-ink-soft">
            O PNG é gerado no seu navegador e acompanha a altura do dia. Para PDF, escolha “Salvar como PDF” na janela de
            impressão; dias longos ocupam mais de uma página, sem cortar atividades.
          </p>
        </div>
      </div>
    </div>
  );
}

function StyleSwatch({ id }: { id: ExportStyle }) {
  const styles: Record<ExportStyle, string> = {
    minimalista: "bg-white ring-1 ring-line",
    diario: "bg-[#f6efe2] ring-1 ring-[#e3d6bd]",
    colorido: "bg-forest",
  };
  return (
    <span aria-hidden className={cn("flex h-11 w-8 shrink-0 flex-col justify-end gap-0.5 rounded-md p-1", styles[id])}>
      <span className={cn("h-1 rounded-full", id === "colorido" ? "bg-coral" : "bg-forest/60")} />
      <span className={cn("h-1 w-2/3 rounded-full", id === "colorido" ? "bg-cream/60" : "bg-ink/20")} />
    </span>
  );
}
