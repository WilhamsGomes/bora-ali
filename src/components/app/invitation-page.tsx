"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CircleCheck, Clock, LoaderCircle, MailWarning, MapPin, TriangleAlert, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ApiError, errorMessage, isApiError } from "@/api/client";
import { invitationsApi } from "@/api/endpoints";
import { Button, buttonClasses } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { dateRange } from "@/lib/dates";
import { roleLabels } from "@/lib/plans";
import { useSession } from "@/state/providers";
import { keys } from "@/state/queries";

/** Tela do link enviado por e-mail: /convites/<token> */
export function InvitationPage({ token }: { token: string }) {
  const preview = useQuery({
    queryKey: ["invitation-preview", token],
    queryFn: () => invitationsApi.preview(token),
    retry: (count, e) => !(e instanceof ApiError) && count < 1,
    gcTime: 0,
  });

  return (
    <>
      <header className="border-b border-line bg-cream">
        <div className="mx-auto flex h-16 max-w-4xl items-center px-4 sm:px-6">
          <Logo href="/" />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-6 py-16">
        {preview.isPending && (
          <p role="status" className="flex items-center justify-center gap-2 text-ink-soft">
            <LoaderCircle aria-hidden className="size-5 animate-spin text-forest" /> Abrindo convite…
          </p>
        )}
        {preview.isError && (
          <Notice icon={XCircle} title={isApiError(preview.error, "INVITATION_INVALID") ? "Convite inválido" : "Não foi possível abrir o convite"}>
            {isApiError(preview.error, "INVITATION_INVALID")
              ? "Este link de convite não existe ou foi substituído por um convite mais novo. Peça um novo convite para quem organizou a viagem."
              : errorMessage(preview.error)}
            {!(preview.error instanceof ApiError) && (
              <Button variant="secondary" className="mt-4" onClick={() => void preview.refetch()}>
                Tentar novamente
              </Button>
            )}
          </Notice>
        )}
        {preview.data && <InvitationCard token={token} preview={preview.data} />}
      </main>
    </>
  );
}

type Preview = Awaited<ReturnType<typeof invitationsApi.preview>>;

function InvitationCard({ token, preview }: { token: string; preview: Preview }) {
  const { state, logout, retry } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; text: string; mismatch?: boolean } | null>(null);
  const lock = useRef(false);
  const here = `/convites/${encodeURIComponent(token)}`;

  async function accept() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await invitationsApi.accept(token);
      await qc.invalidateQueries({ queryKey: keys.trips });
      router.replace(`/app/viagens/${result.tripId}`);
      return;
    } catch (e) {
      if (isApiError(e, "INVITATION_EMAIL_MISMATCH")) {
        setError({
          title: "Este convite é para outro e-mail",
          text: `Ele foi enviado para ${String(e.details.emailHint ?? preview.emailHint)}. Entre com a conta desse e-mail para aceitar.`,
          mismatch: true,
        });
      } else if (isApiError(e, "INVITATION_INVALID")) {
        setError({ title: "Convite indisponível", text: "Este convite expirou, foi revogado ou já foi usado." });
      } else if (isApiError(e, "TRIP_UPGRADE_REQUIRED")) {
        setError({
          title: "Colaboração indisponível nesta viagem",
          text: `O plano atual da viagem não inclui convidados. Fale com ${preview.inviterName}.`,
        });
      } else {
        setError({ title: "Não foi possível aceitar", text: errorMessage(e) });
      }
    }
    lock.current = false;
    setBusy(false);
  }

  const status = preview.status;
  return (
    <div className="rounded-[28px] border border-line bg-white p-6 shadow-soft sm:p-8">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-coral-700">Convite de viagem</p>
      <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-forest wrap-anywhere">{preview.tripName}</h1>
      <p className="mt-2 text-ink-soft">
        {preview.inviterName} convidou você para participar como <strong className="font-semibold text-ink">{roleLabels[preview.role].toLowerCase()}</strong>.
      </p>
      <ul className="mt-4 space-y-1.5 text-sm text-ink">
        <li className="flex items-center gap-2">
          <MapPin aria-hidden className="size-4 text-coral-700" /> <span className="wrap-anywhere">{preview.destination}</span>
        </li>
        <li className="flex items-center gap-2">
          <CalendarDays aria-hidden className="size-4 text-ink-soft" /> {dateRange(preview.startDate, preview.endDate)}
        </li>
        <li className="flex items-center gap-2 text-ink-soft">
          <MailWarning aria-hidden className="size-4" /> Enviado para {preview.emailHint}
        </li>
      </ul>

      <div className="mt-6">
        {status === "ACCEPTED" ? (
          <InlineNotice icon={CircleCheck} title="Convite já aceito">
            Se foi você, a viagem já aparece em{" "}
            <Link href="/app" className="font-semibold underline">
              Minhas viagens
            </Link>
            .
          </InlineNotice>
        ) : status === "EXPIRED" ? (
          <InlineNotice icon={Clock} title="Convite expirado">
            Peça a {preview.inviterName} um novo convite.
          </InlineNotice>
        ) : status === "REVOKED" ? (
          <InlineNotice icon={XCircle} title="Convite revogado">
            Este convite foi cancelado por quem organizou a viagem.
          </InlineNotice>
        ) : state.status === "loading" ? (
          <LoaderCircle aria-label="Verificando sua sessão" className="size-5 animate-spin text-forest" />
        ) : state.status === "unavailable" ? (
          <div role="alert" className="space-y-3 text-sm text-ink-soft">
            <p>{state.message}</p>
            <Button variant="secondary" size="sm" onClick={retry}>
              Tentar novamente
            </Button>
          </div>
        ) : state.status === "anonymous" ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-soft">Entre ou crie uma conta com o e-mail convidado para aceitar. O convite fica guardado.</p>
            <div className="flex flex-wrap gap-2">
              <Link href={`/entrar?${new URLSearchParams({ next: here })}`} className={buttonClasses("primary", "md")}>
                Entrar para aceitar
              </Link>
              <Link href={`/cadastro?${new URLSearchParams({ next: here })}`} className={buttonClasses("secondary", "md")}>
                Criar conta
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {error && (
              <div role="alert" className="rounded-2xl bg-[#fbf2df] p-4 text-sm text-[#5c430c]">
                <p className="flex items-center gap-2 font-semibold">
                  <TriangleAlert aria-hidden className="size-4" /> {error.title}
                </p>
                <p className="mt-1">{error.text}</p>
                {error.mismatch && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-3"
                    onClick={async () => {
                      await logout().catch(() => undefined);
                      router.push(`/entrar?${new URLSearchParams({ next: here })}`);
                    }}
                  >
                    Entrar com outra conta
                  </Button>
                )}
              </div>
            )}
            <p className="text-sm text-ink-soft">
              Você está como <strong className="font-semibold text-ink">{state.user.email}</strong>.
            </p>
            <Button className="w-full" onClick={() => void accept()} disabled={busy}>
              {busy && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
              {busy ? "Aceitando…" : "Aceitar convite"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function InlineNotice({ icon: Icon, title, children }: { icon: typeof Clock; title: string; children: React.ReactNode }) {
  return (
    <div role="status" className="rounded-2xl bg-cream-200/70 p-4 text-sm text-ink">
      <p className="flex items-center gap-2 font-semibold text-forest">
        <Icon aria-hidden className="size-4" /> {title}
      </p>
      <p className="mt-1 text-ink-soft">{children}</p>
    </div>
  );
}

function Notice({ icon: Icon, title, children }: { icon: typeof Clock; title: string; children: React.ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-center text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-forest-100 text-forest">
        <Icon aria-hidden className="size-7" />
      </span>
      <h1 className="mt-4 font-display text-3xl font-bold text-forest">{title}</h1>
      <div className="mt-2 text-ink-soft">{children}</div>
    </div>
  );
}
