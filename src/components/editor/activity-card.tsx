import { ArrowDown, ArrowUp, Clock, MapPin, Pencil, Trash2, TriangleAlert } from "lucide-react";
import { endTime } from "@/lib/activities";
import { categories } from "@/lib/categories";
import { formatDuration } from "@/lib/dates";
import type { LiveCardState } from "@/lib/live";
import type { ActivityContent as Activity } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ActivityCardProps {
  activity: Activity;
  /** Atividade com a qual esta se sobrepõe, se houver */
  overlap?: Activity | null;
  live?: LiveCardState | null;
  highlighted?: boolean;
  readOnly?: boolean;
  /** Reordenar só é possível entre atividades com o mesmo horário */
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onMove?: (direction: -1 | 1) => void;
  /** Só para atividades com ponto no mapa */
  onFocusPoint?: () => void;
  /** Editores: atividade com local só em texto pode ganhar um ponto no mapa */
  onSetLocation?: () => void;
  /** Desabilita as ações enquanto uma alteração está sendo salva */
  busy?: boolean;
}

/** Botão com área de toque de 44px e aparência compacta. */
function CardAction({
  label,
  onClick,
  children,
  danger,
  disabled,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "relative inline-flex size-11 items-center justify-center rounded-full text-ink-soft transition disabled:pointer-events-none disabled:opacity-40",
        danger ? "hover:bg-[#fbe4df] hover:text-[#9b2c1a]" : "hover:bg-forest/5 hover:text-forest",
      )}
    >
      {children}
    </button>
  );
}

export function ActivityCard({
  activity: a,
  overlap,
  live,
  highlighted,
  readOnly,
  canMoveUp,
  canMoveDown,
  onEdit,
  onDelete,
  onMove,
  onFocusPoint,
  onSetLocation,
  busy,
}: ActivityCardProps) {
  const cat = categories[a.category];
  const Icon = cat.icon;
  const end = endTime(a);

  return (
    <li
      id={`atividade-${a.id}`}
      className={cn(
        "relative grid scroll-mt-40 grid-cols-[56px_1fr] gap-3 sm:grid-cols-[64px_1fr] sm:gap-4",
        live === "past" && "opacity-60",
      )}
    >
      {/* Coluna de horário + ponto no trilho da linha do tempo */}
      <div className="relative flex flex-col items-end pr-1.5 pt-3">
        <span className="font-display text-[15px] font-bold leading-none tabular-nums text-forest sm:text-base">{a.time}</span>
        {end && <span className="mt-1 text-[11px] tabular-nums text-ink-soft">{end}</span>}
        <span
          className="absolute -right-3 top-3.5 z-10 size-3 rounded-full ring-4 ring-cream sm:-right-3.5"
          style={{ backgroundColor: cat.color }}
          aria-hidden
        />
      </div>

      <article
        aria-label={`${a.time}, ${a.title}`}
        className={cn(
          "min-w-0 rounded-2xl border bg-white py-2.5 pl-3.5 pr-1.5 shadow-soft transition sm:pl-4",
          live === "now"
            ? "border-coral ring-2 ring-coral/40"
            : live === "next"
              ? "border-forest/40"
              : highlighted
                ? "border-forest/50 ring-2 ring-forest/15"
                : "border-line",
        )}
      >
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 py-0.5">
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold", cat.chip)}>
              <Icon aria-hidden className="size-3" />
              {cat.label}
            </span>
            {live === "now" && <span className="rounded-full bg-coral px-2 py-0.5 text-[11px] font-bold text-ink">Agora</span>}
            {live === "next" && (
              <span className="rounded-full bg-forest px-2 py-0.5 text-[11px] font-bold text-cream">A seguir</span>
            )}
          </div>
          {!readOnly && (
            <div className="-my-2 flex shrink-0 items-center" role="group" aria-label={`Ações de “${a.title}”`}>
              <CardAction disabled={busy} label={`Editar “${a.title}”`} onClick={onEdit}>
                <Pencil aria-hidden className="size-4" />
              </CardAction>
              <CardAction disabled={busy} label={`Excluir “${a.title}”`} onClick={onDelete} danger>
                <Trash2 aria-hidden className="size-4" />
              </CardAction>
            </div>
          )}
        </div>

        <div className="pr-2">
          <h3 className="mt-1 text-[15px] font-semibold leading-snug text-ink wrap-anywhere sm:text-base">{a.title}</h3>
          {(a.location || a.durationMin) && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-ink-soft">
              {a.location && (
                <span className="inline-flex min-w-0 items-start gap-1">
                  <MapPin aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  {onFocusPoint ? (
                    <button
                      type="button"
                      onClick={onFocusPoint}
                      className="text-left underline decoration-line decoration-dotted underline-offset-4 wrap-anywhere hover:text-forest"
                      title="Destacar no mapa"
                    >
                      {a.location}
                    </button>
                  ) : (
                    <span className="wrap-anywhere">{a.location}</span>
                  )}
                  {onSetLocation && (
                    <button
                      type="button"
                      onClick={onSetLocation}
                      disabled={busy}
                      className="ml-1 shrink-0 whitespace-nowrap text-xs font-semibold text-forest underline-offset-2 hover:underline disabled:opacity-40"
                    >
                      Definir no mapa
                    </button>
                  )}
                </span>
              )}
              {a.durationMin ? (
                <span className="inline-flex items-center gap-1">
                  <Clock aria-hidden className="size-3.5" />
                  {formatDuration(a.durationMin)}
                </span>
              ) : null}
            </p>
          )}
          {a.notes && (
            <p className="mt-1.5 rounded-lg bg-cream px-2.5 py-1.5 text-sm text-ink wrap-anywhere">{a.notes}</p>
          )}
          {overlap && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-[#7a5200]">
              <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
              <span>
                Sobrepõe “{overlap.title}” ({overlap.time})
              </span>
            </p>
          )}
        </div>

        {!readOnly && (canMoveUp || canMoveDown) && (
          <div className="mt-1 flex items-center gap-1 border-t border-line/70 pt-1 text-xs text-ink-soft">
            <span className="mr-auto">Mesmo horário: ordem</span>
            {canMoveUp && (
              <CardAction disabled={busy} label={`Mover “${a.title}” antes`} onClick={() => onMove?.(-1)}>
                <ArrowUp aria-hidden className="size-4" />
              </CardAction>
            )}
            {canMoveDown && (
              <CardAction disabled={busy} label={`Mover “${a.title}” depois`} onClick={() => onMove?.(1)}>
                <ArrowDown aria-hidden className="size-4" />
              </CardAction>
            )}
          </div>
        )}
      </article>
    </li>
  );
}

/** Lista com trilho vertical à esquerda. */
export function TimelineList({ children }: { children: React.ReactNode }) {
  return (
    <ol className="relative space-y-2.5 before:absolute before:bottom-4 before:left-[61px] before:top-4 before:w-0.5 before:rounded-full before:bg-line sm:space-y-3 sm:before:left-[71px]">
      {children}
    </ol>
  );
}
