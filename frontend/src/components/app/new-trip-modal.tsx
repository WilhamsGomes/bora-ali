"use client";

import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage, isApiError } from "@/api/client";
import { tripsApi } from "@/api/endpoints";
import { toTrip } from "@/api/mappers";
import { Button } from "@/components/ui/button";
import { Field, inputClasses } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { coverForDestination } from "@/data/photos";
import { daysBetween } from "@/lib/dates";
import { timeZoneForDestination } from "@/lib/time-zones";
import { keys } from "@/state/queries";
import { TimeZoneField } from "./time-zone-field";

interface Errors {
  name?: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
}

export function NewTripModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nova viagem"
      description="Comece pelo básico. Você pode adicionar atividades depois."
    >
      <NewTripForm onClose={onClose} />
    </Modal>
  );
}

function NewTripForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [timeZone, setTimeZone] = useState(timeZoneForDestination(""));
  const [zoneTouched, setZoneTouched] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): Errors {
    const e: Errors = {};
    if (!name.trim()) e.name = "Dê um nome para a viagem.";
    if (!destination.trim()) e.destination = "Informe o destino.";
    if (!startDate) e.startDate = "Escolha a data de ida.";
    if (!endDate) e.endDate = "Escolha a data de volta.";
    else if (startDate && daysBetween(startDate, endDate) < 0) e.endDate = "A volta precisa ser no mesmo dia ou depois da ida.";
    return e;
  }

  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (busy) return;
    const form = ev.currentTarget;
    const e = validate();
    setErrors(e);
    setError(null);
    if (Object.keys(e).length > 0) {
      // Leva o foco ao primeiro campo com erro depois que a mensagem aparecer
      window.setTimeout(() => form.querySelector<HTMLElement>("[aria-invalid=true]")?.focus());
      return;
    }
    setBusy(true);
    try {
      const created = await tripsApi.create({
        name: name.trim(),
        destination: destination.trim(),
        startDate,
        endDate,
        timeZone,
        coverUrl: coverForDestination(destination).url,
      });
      qc.setQueryData(keys.trip(created.id), toTrip(created));
      void qc.invalidateQueries({ queryKey: keys.trips });
      toast.show("Viagem criada");
      onClose();
      router.push(`/app/viagens/${created.id}`);
    } catch (err) {
      setBusy(false);
      if (isApiError(err, "TRIP_TOO_LONG")) {
        setErrors({ endDate: `Uma viagem pode ter no máximo ${err.details.maxDays ?? 60} dias.` });
      } else if (isApiError(err, "INVALID_DATE_RANGE")) {
        setErrors({ endDate: "A volta precisa ser no mesmo dia ou depois da ida." });
      } else if (isApiError(err, "INVALID_TIME_ZONE")) {
        setError("O fuso horário escolhido não é válido. Escolha outro.");
      } else {
        setError(errorMessage(err, "Não foi possível criar a viagem. Tente novamente."));
      }
    }
  }

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
          <input
            {...p}
            data-autofocus
            className={inputClasses}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Férias em Salvador"
            maxLength={120}
          />
        )}
      </Field>
      <Field label="Destino" required error={errors.destination} hint="A capa é escolhida a partir do destino.">
        {(p) => (
          <input
            {...p}
            className={inputClasses}
            value={destination}
            onChange={(e) => {
              setDestination(e.target.value);
              if (!zoneTouched) setTimeZone(timeZoneForDestination(e.target.value));
            }}
            placeholder="Ex.: Salvador, BA"
            maxLength={160}
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ida" required error={errors.startDate}>
          {(p) => (
            <input
              {...p}
              type="date"
              className={inputClasses}
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (!endDate || e.target.value > endDate) setEndDate(e.target.value);
              }}
            />
          )}
        </Field>
        <Field label="Volta" required error={errors.endDate}>
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
      <TimeZoneField
        value={timeZone}
        onChange={(tz) => {
          setZoneTouched(true);
          setTimeZone(tz);
        }}
      />
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
          {busy ? "Criando…" : "Criar viagem"}
        </Button>
      </div>
    </form>
  );
}
