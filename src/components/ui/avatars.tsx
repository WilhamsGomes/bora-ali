import type { Participant } from "@/lib/types";
import { cn, initials } from "@/lib/utils";

export function Avatar({ name, color, className }: { name: string; color: string; className?: string }) {
  return (
    <span
      title={name}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-full text-xs font-bold text-white ring-2 ring-cream",
        className,
      )}
      style={{ backgroundColor: color }}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarStack({
  people,
  max = 4,
  className,
  size = "size-8",
}: {
  people: Participant[];
  max?: number;
  className?: string;
  size?: string;
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className={cn("flex -space-x-2", className)} aria-label={people.map((p) => p.name).join(", ")} role="img">
      {shown.map((p) => (
        <Avatar key={p.name} name={p.name} color={p.color} className={size} />
      ))}
      {extra > 0 && (
        <span className={cn("inline-flex items-center justify-center rounded-full bg-sand text-xs font-bold text-forest ring-2 ring-cream", size)}>
          +{extra}
        </span>
      )}
    </span>
  );
}

export function participantsLabel(people: Participant[]) {
  if (people.length === 1) return "Só você";
  return `${people.length} participantes`;
}
