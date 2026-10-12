"use client";

import { History, LoaderCircle, MapPin, MapPinned, Search, TriangleAlert, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { errorMessage, isApiError } from "@/api/client";
import type { PlaceSuggestionDto } from "@/api/contracts";
import { placesApi } from "@/api/endpoints";
import { inputClasses } from "@/components/ui/field";
import type { ActivityPlace } from "@/lib/types";
import { cn } from "@/lib/utils";

const MIN_CHARS = 3;
const DEBOUNCE_MS = 350;
const MAX_LOCAL = 5;

/** Lugar escolhido: nome para o campo de texto + ponto no mapa. */
export interface PlaceChoice {
  name: string;
  place: ActivityPlace;
}

/** Lugar já usado na viagem: sugerido sem chamar a API (nenhum crédito consumido). */
export interface LocalPlace extends PlaceChoice {
  key: string;
}

type SearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "results"; results: PlaceSuggestionDto[]; attribution: string }
  | { kind: "error"; message: string; unavailable: boolean };

type Option = { source: "trip"; local: LocalPlace } | { source: "search"; s: PlaceSuggestionDto };

const normalize = (t: string) =>
  t
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();

const fromSuggestion = (s: PlaceSuggestionDto): PlaceChoice => ({
  name: s.name,
  place: {
    latitude: s.latitude,
    longitude: s.longitude,
    formattedAddress: s.formattedAddress,
    placeId: s.placeId,
    provider: s.provider,
  },
});

interface PlaceAutocompleteProps {
  tripId: string;
  kind: "place" | "destination";
  /** Props de acessibilidade vindas do Field (id, aria-describedby...) */
  fieldProps: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean };
  text: string;
  /** Digitação da pessoa. Quem usa limpa o lugar selecionado quando o texto muda. */
  onTextChange: (text: string) => void;
  onSelect: (choice: PlaceChoice) => void;
  /** Lugares já usados na viagem, mostrados em "Nesta viagem" antes da busca externa */
  localPlaces?: LocalPlace[];
  placeholder?: string;
  maxLength?: number;
  /** Busca uma vez ao montar (ação explícita "Definir no mapa"), sem escolher nada automaticamente */
  searchOnMount?: boolean;
  /** Recebe o foco inicial do modal (atributo data-autofocus) */
  initialFocus?: boolean;
}

/**
 * Campo de local com sugestões (padrão combobox da WAI-ARIA).
 * - Debounce e mínimo de caracteres; cancela buscas antigas e ignora respostas atrasadas.
 * - Nunca escolhe uma sugestão sozinho: a pessoa confirma com clique ou Enter.
 * - "Nesta viagem": lugares já escolhidos pelo grupo aparecem primeiro, sem custo de API.
 * - Falhas não bloqueiam: o texto livre continua valendo.
 */
export function PlaceAutocomplete({
  tripId,
  kind,
  fieldProps,
  text,
  onTextChange,
  onSelect,
  localPlaces = [],
  placeholder,
  maxLength = 300,
  searchOnMount,
  initialFocus,
}: PlaceAutocompleteProps) {
  const listId = useId();
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const timer = useRef<number | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  const seq = useRef(0);

  const cancelPending = () => {
    window.clearTimeout(timer.current);
    controller.current?.abort();
    controller.current = null;
  };

  async function run(query: string) {
    cancelPending();
    const id = ++seq.current;
    const ctrl = new AbortController();
    controller.current = ctrl;
    setState({ kind: "loading" });
    setOpen(true);
    setActive(-1);
    try {
      const res = await placesApi.search(tripId, query, kind, ctrl.signal);
      if (id !== seq.current) return; // resposta desatualizada
      setState({ kind: "results", results: res.results, attribution: res.attribution });
    } catch (e) {
      if (id !== seq.current || (e instanceof DOMException && e.name === "AbortError")) return;
      setState({
        kind: "error",
        unavailable: isApiError(e, "LOCATION_SEARCH_UNAVAILABLE"),
        message: isApiError(e, "LOCATION_SEARCH_UNAVAILABLE")
          ? "A busca de locais não está disponível. O texto digitado será salvo sem ponto no mapa."
          : isApiError(e, "RATE_LIMITED")
            ? "Muitas buscas seguidas. Aguarde alguns segundos e tente de novo."
            : errorMessage(e, "Não foi possível buscar locais agora."),
      });
    } finally {
      if (controller.current === ctrl) controller.current = null;
    }
  }

  function schedule(value: string) {
    cancelPending();
    seq.current++; // invalida respostas de buscas anteriores
    setActive(-1);
    setOpen(true);
    if (value.trim().length < MIN_CHARS) {
      // Com poucas letras, a lista mostra só os lugares da viagem (se houver)
      setState({ kind: "idle" });
      return;
    }
    setState({ kind: "loading" });
    timer.current = window.setTimeout(() => void run(value.trim()), DEBOUNCE_MS);
  }

  // Busca inicial pedida explicitamente ("Definir no mapa") e limpeza ao desmontar
  const initialText = useRef(text);
  useEffect(() => {
    const t = initialText.current.trim();
    if (searchOnMount && t.length >= MIN_CHARS) {
      const id = window.setTimeout(() => void run(t));
      return () => {
        window.clearTimeout(id);
        cancelPending();
      };
    }
    return cancelPending;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só na montagem
  }, []);

  // Lugares da viagem que combinam com o texto (todos, com o campo vazio)
  const q = normalize(text);
  const locals = localPlaces
    .filter((l) => !q || normalize(`${l.name} ${l.place.formattedAddress ?? ""}`).includes(q))
    .slice(0, MAX_LOCAL);
  const localIds = new Set(locals.map((l) => l.place.placeId).filter(Boolean));
  const results = state.kind === "results" ? state.results.filter((r) => !localIds.has(r.placeId)) : [];
  const options: Option[] = [
    ...locals.map((local) => ({ source: "trip" as const, local })),
    ...results.map((s) => ({ source: "search" as const, s })),
  ];
  const showList = open && (state.kind !== "idle" || locals.length > 0);

  function choose(option: Option) {
    cancelPending();
    seq.current++;
    setOpen(false);
    setActive(-1);
    onSelect(option.source === "trip" ? { name: option.local.name, place: option.local.place } : fromSuggestion(option.s));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!options.length) return;
      e.preventDefault();
      setOpen(true);
      setActive((i) => {
        const n = options.length;
        if (e.key === "ArrowDown") return i < 0 ? 0 : (i + 1) % n;
        return i <= 0 ? n - 1 : i - 1;
      });
    } else if (e.key === "Enter") {
      // Enter só seleciona com uma sugestão destacada; senão o formulário segue normalmente
      if (showList && active >= 0 && options[active]) {
        e.preventDefault();
        choose(options[active]);
      }
    } else if (e.key === "Escape") {
      if (showList) {
        // Fecha só a lista, não o modal
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setActive(-1);
      }
    }
  }

  const optionId = (i: number) => `${listId}-opcao-${i}`;

  return (
    <div className="relative">
      <div className="relative">
        <input
          {...fieldProps}
          data-autofocus={initialFocus || undefined}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          spellCheck={false}
          className={cn(inputClasses, "pr-10")}
          value={text}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => {
            onTextChange(e.target.value);
            schedule(e.target.value);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={(e) => {
            const input = e.currentTarget;
            // Fecha só se o foco saiu de vez (o modal pode devolver o foco ao campo logo em seguida)
            window.setTimeout(() => {
              if (document.activeElement !== input) setOpen(false);
            }, 120);
          }}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-ink-soft">
          {state.kind === "loading" ? (
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
          ) : (
            <Search aria-hidden className="size-4" />
          )}
        </span>
      </div>

      {showList && (
        <div
          className="absolute inset-x-0 top-full z-20 mt-1.5 overflow-hidden rounded-2xl border border-line bg-white shadow-lift"
          // Mantém o foco no campo ao clicar nas opções
          onMouseDown={(e) => e.preventDefault()}
        >
          <ul id={listId} role="listbox" aria-label="Sugestões de locais" className="max-h-72 overflow-y-auto py-1">
            {locals.length > 0 && <GroupLabel>Nesta viagem</GroupLabel>}
            {options.map((o, i) =>
              o.source === "trip" ? (
                <OptionRow
                  key={`viagem-${o.local.key}`}
                  id={optionId(i)}
                  active={i === active}
                  onChoose={() => choose(o)}
                  onHover={() => setActive(i)}
                  icon={<History aria-hidden className="mt-0.5 size-4 shrink-0 text-coral-700" />}
                  title={o.local.name}
                  secondary={o.local.place.formattedAddress}
                />
              ) : (
                <OptionRow
                  key={o.s.placeId}
                  id={optionId(i)}
                  active={i === active}
                  onChoose={() => choose(o)}
                  onHover={() => setActive(i)}
                  icon={<MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-forest" />}
                  title={o.s.name}
                  secondary={o.s.secondary}
                  where={[o.s.city, o.s.state, o.s.country].filter(Boolean).join(", ")}
                  heading={i === locals.length && locals.length > 0 ? "Busca" : undefined}
                />
              ),
            )}
            {state.kind === "loading" && (
              <li role="presentation" className="flex items-center gap-2 px-3.5 py-3 text-sm text-ink-soft">
                <LoaderCircle aria-hidden className="size-4 animate-spin" /> Buscando locais…
              </li>
            )}
            {state.kind === "results" && results.length === 0 && (
              <li role="presentation" className="px-3.5 py-3 text-sm text-ink-soft">
                {locals.length > 0
                  ? "Nenhum outro local encontrado na busca."
                  : "Nenhum local encontrado. Tente incluir o bairro ou a cidade — ou mantenha o texto livre."}
              </li>
            )}
            {state.kind === "error" && (
              <li role="presentation" className="flex items-start gap-2 px-3.5 py-3 text-sm text-[#7a2a1a]">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span className="flex-1">
                  {state.message}{" "}
                  {!state.unavailable && text.trim().length >= MIN_CHARS && (
                    <button type="button" className="font-semibold underline" onClick={() => void run(text.trim())}>
                      Tentar de novo
                    </button>
                  )}
                </span>
              </li>
            )}
          </ul>
          {state.kind === "results" && results.length > 0 && (
            <p className="border-t border-line px-3.5 py-1.5 text-[11px] text-ink-soft">
              {state.attribution || "© OpenStreetMap contributors"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function GroupLabel({ children, divider }: { children: React.ReactNode; divider?: boolean }) {
  return (
    <li
      role="presentation"
      className={cn(
        "px-3.5 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider",
        divider ? "border-t border-line text-ink-soft" : "text-coral-700",
      )}
    >
      {children}
    </li>
  );
}

function OptionRow({
  id,
  active,
  onChoose,
  onHover,
  icon,
  title,
  secondary,
  where,
  heading,
}: {
  id: string;
  active: boolean;
  onChoose: () => void;
  onHover: () => void;
  icon: React.ReactNode;
  title: string;
  secondary?: string | null;
  where?: string;
  heading?: string;
}) {
  return (
    <>
      {heading && <GroupLabel divider>{heading}</GroupLabel>}
      <li
        id={id}
        role="option"
        aria-selected={active}
        onClick={onChoose}
        onMouseEnter={onHover}
        className={cn(
          "flex cursor-pointer items-start gap-2.5 px-3.5 py-2.5 text-sm",
          active ? "bg-forest-100" : "hover:bg-cream-200",
        )}
      >
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-ink wrap-anywhere">{title}</span>
          {secondary && <span className="block text-xs text-ink-soft wrap-anywhere">{secondary}</span>}
          {where && <span className="block text-xs font-medium text-forest">{where}</span>}
        </span>
      </li>
    </>
  );
}

/** Lugares com ponto no mapa já usados nas atividades, sem repetição, dos mais usados para os menos. */
export function tripLocalPlaces(activities: { location?: string; title: string; place?: ActivityPlace }[]): LocalPlace[] {
  const byKey = new Map<string, LocalPlace & { uses: number }>();
  for (const a of activities) {
    if (!a.place) continue;
    const key = a.place.placeId ?? `${a.place.latitude.toFixed(5)},${a.place.longitude.toFixed(5)}`;
    const found = byKey.get(key);
    if (found) found.uses++;
    else byKey.set(key, { key, name: a.location || a.title, place: a.place, uses: 1 });
  }
  return [...byKey.values()].sort((x, y) => y.uses - x.uses).map(({ key, name, place }) => ({ key, name, place }));
}

/** Situação do local em relação ao mapa, exibida abaixo do campo. */
export function PlaceStatus({
  address,
  hasText,
  onClear,
}: {
  address: string | null;
  hasText: boolean;
  onClear?: () => void;
}) {
  if (address !== null) {
    return (
      <p className="flex items-start gap-1.5 text-xs text-forest">
        <MapPinned aria-hidden className="mt-px size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 wrap-anywhere">
          No mapa: <span className="font-medium">{address}</span>
        </span>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-ink-soft underline-offset-2 hover:text-forest hover:underline"
          >
            <X aria-hidden className="size-3" /> Tirar do mapa
          </button>
        )}
      </p>
    );
  }
  if (!hasText) return <p className="text-xs text-ink-soft">Digite ao menos {MIN_CHARS} letras para ver sugestões.</p>;
  return (
    <p className="text-xs text-ink-soft">
      Localização não definida no mapa. Escolha uma sugestão para marcar o ponto, ou continue com o texto livre.
    </p>
  );
}
