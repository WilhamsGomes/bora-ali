"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, LoaderCircle, Trash2, TriangleAlert } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage, isApiError } from "@/api/client";
import type { AffectedDayDto, UpdateTripDto } from "@/api/contracts";
import { tripsApi } from "@/api/endpoints";
import { toTrip } from "@/api/mappers";
import { TimeZoneField } from "@/components/app/time-zone-field";
import { Button } from "@/components/ui/button";
import { Field, inputClasses } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { coverOf, coverOptions, isUnsplash, photo, photos } from "@/data/photos";
import { daysBetween, longDateTitle } from "@/lib/dates";
import { plural } from "@/lib/format";
import { timeZoneForDestination } from "@/lib/time-zones";
import type { Trip } from "@/lib/types";
import { cn } from "@/lib/utils";
import { invalidateTrip, keys } from "@/state/queries";

interface EditTripModalProps {
  open: boolean;
  trip: Trip;
  onClose: () => void;
}

export function EditTripModal({ open, trip, onClose }: EditTripModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Editar viagem" description="Nada muda até você confirmar." size="lg">
      <EditTripForm trip={trip} onClose={onClose} />
    </Modal>
  );
}

interface Errors {
  name?: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
}

function EditTripForm({ trip, onClose }: Omit<EditTripModalProps, "open">) {
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const [name, setName] = useState(trip.name);
  const [destination, setDestination] = useState(trip.destination);
  const [timeZone, setTimeZone] = useState(trip.timeZone);
  const [startDate, setStartDate] = useState(trip.startDate);
  const [endDate, setEndDate] = useState(trip.endDate);
  const [stay, setStay] = useState(trip.stay ?? "");
  const current = coverOf(trip);
  const [coverUrl, setCoverUrl] = useState(current.url);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Conflito devolvido pela API: dias com atividades que sairiam do período */
  const [affected, setAffected] = useState<AffectedDayDto[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function send(confirmRemoveDates?: string[]) {
    setBusy(true);
    setError(null);
    const body: UpdateTripDto = {
      name: name.trim(),
      destination: destination.trim(),
      timeZone,
      startDate,
      endDate,
      stay: stay.trim() || null,
      coverUrl,
      ...(confirmRemoveDates ? { confirmRemoveDates } : {}),
    };
    try {
      const updated = await tripsApi.update(trip.id, body);
      qc.setQueryData(keys.trip(trip.id), toTrip(updated));
      void invalidateTrip(qc, trip.id);
      toast.show(confirmRemoveDates ? "Viagem atualizada e dias removidos" : "Viagem atualizada");
      onClose();
    } catch (e) {
      setBusy(false);
      if (isApiError(e, "TRIP_DATE_CHANGE_CONFLICT")) {
        // Atualiza o roteiro para mostrar as atividades atuais dos dias afetados
        await qc.invalidateQueries({ queryKey: keys.trip(trip.id) });
        setAffected((e.details.affectedDays as AffectedDayDto[]) ?? []);
      } else if (isApiError(e, "TRIP_TOO_LONG")) {
        setAffected(null);
        setErrors({ endDate: `Uma viagem pode ter no máximo ${e.details.maxDays ?? 60} dias.` });
      } else if (isApiError(e, "INVALID_DATE_RANGE")) {
        setAffected(null);
        setErrors({ endDate: "O fim precisa ser no mesmo dia ou depois do início." });
      } else {
        setError(errorMessage(e, "Não foi possível salvar a viagem."));
      }
    }
  }

  function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (busy) return;
    const form = ev.currentTarget;
    const e: Errors = {};
    if (!name.trim()) e.name = "Dê um nome para a viagem.";
    if (!destination.trim()) e.destination = "Informe o destino.";
    if (!startDate) e.startDate = "Escolha a data de início.";
    if (!endDate) e.endDate = "Escolha a data de fim.";
    else if (startDate && daysBetween(startDate, endDate) < 0) e.endDate = "O fim precisa ser no mesmo dia ou depois do início.";
    setErrors(e);
    if (Object.keys(e).length > 0) {
      window.setTimeout(() => form.querySelector<HTMLElement>("[aria-invalid=true]")?.focus());
      return;
    }
    void send();
  }

  async function deleteTrip() {
    setBusy(true);
    setError(null);
    try {
      await tripsApi.remove(trip.id);
      qc.removeQueries({ queryKey: keys.trip(trip.id) });
      await qc.invalidateQueries({ queryKey: keys.trips });
      toast.show("Viagem excluída");
      onClose();
      router.replace("/app");
    } catch (e) {
      setBusy(false);
      setConfirmDelete(false);
      setError(
        isApiError(e, "TRIP_HAS_PENDING_PAYMENT")
          ? "Há um pagamento em andamento para esta viagem. Aguarde a conclusão antes de excluí-la."
          : errorMessage(e, "Não foi possível excluir a viagem."),
      );
    }
  }

  if (affected) {
    const days = affected.map((a) => ({ ...a, day: trip.days.find((d) => d.id === a.dayId) }));
    const total = affected.reduce((n, a) => n + a.activityCount, 0);
    return (
      <div className="space-y-5">
        <div role="alert" className="flex gap-3 rounded-2xl bg-[#fbf2df] p-4 text-[#5c430c]">
          <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold">
              {plural(total, "atividade fica", "atividades ficam")} fora do novo período
            </p>
            <p className="mt-1 text-sm">
              Com as novas datas, {plural(affected.length, "dia sai", "dias saem")} da viagem. Para salvar assim, esses dias e
              as atividades deles serão excluídos. Se preferir, volte e ajuste as datas ou mova as atividades antes.
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              {days.map(({ dayId, date, activityCount, day }) => (
                <li key={dayId}>
                  <span className="font-semibold">{longDateTitle(date)}</span>: {plural(activityCount, "atividade", "atividades")}
                  {day && day.activities.length > 0 && (
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                      {day.activities.map((a) => (
                        <li key={a.id} className="wrap-anywhere">
                          {a.time} · {a.title}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
        {error && <p role="alert" className="text-sm text-[#9b2c1a]">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => setAffected(null)}>
            Voltar e ajustar datas
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void send(affected.map((a) => a.date))}>
            {busy && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
            Excluir {plural(affected.length, "dia", "dias")} e salvar
          </Button>
        </div>
      </div>
    );
  }

  const currentIsOption = coverOptions.some((o) => photo(photos[o.key].id) === current.url);

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-busy={busy}>
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-2xl bg-[#fbe4df] px-3.5 py-3 text-sm text-[#7a2a1a]">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
      <Field label="Nome da viagem" required error={errors.name}>
        {(p) => (
          <input {...p} data-autofocus className={inputClasses} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Destino"
          required
          error={errors.destination}
          hint={
            trip.destinationPlace && destination.trim() !== trip.destination.trim()
              ? "A localização confirmada no mapa será removida. Depois, confirme a nova no painel do mapa."
              : undefined
          }
        >
          {(p) => (
            <input
              {...p}
              className={inputClasses}
              value={destination}
              onChange={(e) => {
                setDestination(e.target.value);
                // Só sugere outro fuso se o destino mudou e o fuso ainda é o da viagem
                if (timeZone === trip.timeZone && e.target.value !== trip.destination) {
                  setTimeZone(timeZoneForDestination(e.target.value));
                }
              }}
              maxLength={160}
            />
          )}
        </Field>
        <Field label="Hospedagem">
          {(p) => (
            <input
              {...p}
              className={inputClasses}
              value={stay}
              onChange={(e) => setStay(e.target.value)}
              placeholder="Ex.: Hospedagem em Botafogo"
              maxLength={200}
            />
          )}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Início" required error={errors.startDate}>
          {(p) => (
            <input {...p} type="date" className={inputClasses} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          )}
        </Field>
        <Field label="Fim" required error={errors.endDate}>
          {(p) => (
            <input
              {...p}
              type="date"
              className={inputClasses}
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
            />
          )}
        </Field>
      </div>
      <TimeZoneField value={timeZone} onChange={setTimeZone} />
      {timeZone !== trip.timeZone && (
        <p className="text-xs text-ink-soft">
          Os horários das atividades continuam os mesmos (ex.: 10:00 segue 10:00), agora no novo fuso.
        </p>
      )}

      <fieldset>
        <legend className="text-sm font-semibold text-ink">
          Foto de capa <span className="font-normal text-ink-soft">(opcional)</span>
        </legend>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {!currentIsOption && (
            <CoverOption url={current.url} label="Capa atual" checked={coverUrl === current.url} onChange={() => setCoverUrl(current.url)} />
          )}
          {coverOptions.map((o) => {
            const url = photo(photos[o.key].id);
            return <CoverOption key={o.key} url={url} label={o.label} checked={coverUrl === url} onChange={() => setCoverUrl(url)} />;
          })}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        {confirmDelete ? (
          <div role="alert" className="flex w-full flex-wrap items-center gap-2 rounded-2xl bg-[#fbe4df] p-3 text-sm text-[#7a2a1a]">
            <span className="flex-1">Excluir a viagem apaga todos os dias e atividades. Não dá para desfazer.</span>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>
              Manter viagem
            </Button>
            <Button size="sm" variant="danger" onClick={() => void deleteTrip()} disabled={busy}>
              {busy && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
              Excluir viagem
            </Button>
          </div>
        ) : (
          <Button variant="ghost" className="text-[#9b2c1a]" onClick={() => setConfirmDelete(true)} disabled={busy}>
            <Trash2 aria-hidden className="size-4" /> Excluir viagem
          </Button>
        )}
        {!confirmDelete && (
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
              {busy ? "Salvando…" : "Salvar viagem"}
            </Button>
          </div>
        )}
      </div>
    </form>
  );
}

function CoverOption({ url, label, checked, onChange }: { url: string; label: string; checked: boolean; onChange: () => void }) {
  return (
    <label
      className={cn(
        "group relative block cursor-pointer overflow-hidden rounded-xl border-2 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-forest",
        checked ? "border-forest" : "border-transparent",
      )}
    >
      <input type="radio" name="capa" checked={checked} onChange={onChange} className="sr-only" />
      <span className="relative block aspect-[4/3]">
        <Image src={url} alt="" fill sizes="160px" unoptimized={!isUnsplash(url)} className="object-cover" />
      </span>
      <span className="block truncate bg-white px-2 py-1 text-xs font-medium text-ink">{label}</span>
      {checked && (
        <span className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-forest text-cream">
          <Check aria-hidden className="size-4" />
        </span>
      )}
    </label>
  );
}
