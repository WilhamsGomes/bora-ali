import { Field, inputClasses } from "@/components/ui/field";
import { timeZoneOptions } from "@/lib/time-zones";

/** Fuso do destino: horários das atividades são sempre locais a este fuso. */
export function TimeZoneField({ value, onChange }: { value: string; onChange: (tz: string) => void }) {
  const options = timeZoneOptions.some((o) => o.value === value)
    ? timeZoneOptions
    : [{ value, label: value }, ...timeZoneOptions];
  return (
    <Field label="Fuso horário do destino" required hint="Os horários das atividades seguem este fuso, sem conversão.">
      {(p) => (
        <select {...p} className={inputClasses} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}
