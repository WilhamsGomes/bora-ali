"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Clock, LoaderCircle, LogOut, MailX, Send, TriangleAlert, UserMinus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage, isApiError } from "@/api/client";
import type { InvitationDto, MemberDto, Role } from "@/api/contracts";
import { invitationsApi, membersApi } from "@/api/endpoints";
import { Avatar } from "@/components/ui/avatars";
import { Button } from "@/components/ui/button";
import { Field, inputClasses } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { roleLabels } from "@/lib/roles";
import type { Trip } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/state/providers";
import { keys, useInvitations, useMembers } from "@/state/queries";
import { participantPalette } from "./trip-cover";

type GuestRole = Exclude<Role, "OWNER">;

interface ParticipantsModalProps {
  open: boolean;
  onClose: () => void;
  trip: Trip;
}

export function ParticipantsModal({ open, onClose, trip }: ParticipantsModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Participantes" description="Quem pode ver e editar este roteiro.">
      <ParticipantsBody trip={trip} onClose={onClose} />
    </Modal>
  );
}

const dateTime = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

function ParticipantsBody({ trip, onClose }: Omit<ParticipantsModalProps, "open">) {
  const { state } = useAuth();
  const me = state.status === "authenticated" ? state.user.id : null;
  const isOwner = trip.role === "OWNER";
  const members = useMembers(trip.id);
  const invitations = useInvitations(trip.id, isOwner);
  const owner = members.data?.find((m) => m.role === "OWNER");

  return (
    <div className="space-y-6">
      <section aria-labelledby="titulo-membros">
        <h3 id="titulo-membros" className="text-sm font-semibold text-ink">
          Na viagem
        </h3>
        {members.isPending && <LoaderCircle aria-label="Carregando participantes" className="mt-3 size-5 animate-spin text-forest" />}
        {members.isError && (
          <p role="alert" className="mt-2 text-sm text-[#9b2c1a]">
            {errorMessage(members.error)}{" "}
            <button type="button" className="font-semibold underline" onClick={() => void members.refetch()}>
              Tentar novamente
            </button>
          </p>
        )}
        {members.data && (
          <ul className="mt-2 divide-y divide-line">
            {members.data.map((m, i) => (
              <MemberRow
                key={m.userId}
                trip={trip}
                member={m}
                color={participantPalette[i % participantPalette.length]}
                isMe={m.userId === me}
                canManage={isOwner}
                onLeft={onClose}
              />
            ))}
          </ul>
        )}
      </section>


      {isOwner && (
        <>
          <InviteForm tripId={trip.id} />
          <section aria-labelledby="titulo-convites">
            <h3 id="titulo-convites" className="text-sm font-semibold text-ink">
              Convites pendentes
            </h3>
            {invitations.isPending && <LoaderCircle aria-label="Carregando convites" className="mt-3 size-5 animate-spin text-forest" />}
            {invitations.isError && (
              <p role="alert" className="mt-2 text-sm text-[#9b2c1a]">
                {errorMessage(invitations.error)}
              </p>
            )}
            {invitations.data?.length === 0 && <p className="mt-2 text-sm text-ink-soft">Nenhum convite aguardando resposta.</p>}
            {invitations.data && invitations.data.length > 0 && (
              <ul className="mt-2 space-y-2">
                {invitations.data.map((inv) => (
                  <InvitationRow key={inv.id} tripId={trip.id} invitation={inv} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {!isOwner && (
        <p className="rounded-2xl bg-cream-200/70 px-4 py-3 text-sm text-ink-soft">
          Convites e papéis são gerenciados por {owner?.name ?? "quem criou a viagem"}.
        </p>
      )}
    </div>
  );
}

function MemberRow({
  trip,
  member,
  color,
  isMe,
  canManage,
  onLeft,
}: {
  trip: Trip;
  member: MemberDto;
  color: string;
  isMe: boolean;
  canManage: boolean;
  onLeft: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const guest = member.role !== "OWNER";

  async function changeRole(role: GuestRole) {
    setBusy(true);
    try {
      await membersApi.updateRole(trip.id, member.userId, role);
      await qc.invalidateQueries({ queryKey: keys.members(trip.id) });
      toast.show(`${member.name} agora ${role === "EDITOR" ? "pode editar" : "pode só ver"}`);
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    }
    setBusy(false);
  }

  async function remove() {
    setBusy(true);
    try {
      await membersApi.remove(trip.id, member.userId);
      if (isMe) {
        toast.show("Você saiu da viagem");
        qc.removeQueries({ queryKey: keys.trip(trip.id) });
        await qc.invalidateQueries({ queryKey: keys.trips });
        onLeft();
        router.replace("/app");
        return;
      }
      await qc.invalidateQueries({ queryKey: keys.members(trip.id) });
      toast.show(`${member.name} foi removido da viagem`);
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={member.name} color={color} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {member.name}
            {isMe && <span className="font-normal text-ink-soft"> (você)</span>}
          </p>
          <p className="truncate text-xs text-ink-soft">{member.email}</p>
        </div>
        {canManage && guest ? (
          <label className="sr-only" htmlFor={`papel-${member.userId}`}>
            Papel de {member.name}
          </label>
        ) : null}
        {canManage && guest ? (
          <select
            id={`papel-${member.userId}`}
            disabled={busy}
            value={member.role}
            onChange={(e) => void changeRole(e.target.value as GuestRole)}
            className="min-h-10 rounded-xl border border-line bg-white px-2.5 py-1.5 text-sm text-ink focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/20"
          >
            <option value="EDITOR">{roleLabels.EDITOR}</option>
            <option value="VIEWER">{roleLabels.VIEWER}</option>
          </select>
        ) : (
          <span className="text-xs font-medium text-ink-soft">{roleLabels[member.role]}</span>
        )}
        {guest && (canManage || isMe) && !confirm && (
          <button
            type="button"
            onClick={() => setConfirm(true)}
            disabled={busy}
            aria-label={isMe ? "Sair da viagem" : `Remover ${member.name}`}
            title={isMe ? "Sair da viagem" : `Remover ${member.name}`}
            className="inline-flex size-10 items-center justify-center rounded-full text-ink-soft hover:bg-[#fbe4df] hover:text-[#9b2c1a]"
          >
            {isMe ? <LogOut aria-hidden className="size-4" /> : <UserMinus aria-hidden className="size-4" />}
          </button>
        )}
      </div>
      {confirm && (
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-[#fbe4df] px-3 py-2 text-sm text-[#7a2a1a]">
          <span className="flex-1">
            {isMe ? "Sair desta viagem? Você perde o acesso até receber um novo convite." : `Remover ${member.name} da viagem?`}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button size="sm" variant="danger" onClick={() => void remove()} disabled={busy}>
            {busy && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
            {isMe ? "Sair" : "Remover"}
          </Button>
        </div>
      )}
    </li>
  );
}

function InviteForm({ tripId }: { tripId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<GuestRole>("EDITOR");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy) return;
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Informe um e-mail válido.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const inv = await invitationsApi.create(tripId, { email: email.trim(), role });
      setEmail("");
      await qc.invalidateQueries({ queryKey: keys.invitations(tripId) });
      if (inv.delivery.status === "FAILED") {
        setNotice(`O convite para ${inv.email} foi criado, mas o e-mail não foi enviado. Use “Reenviar” na lista abaixo.`);
      } else if (inv.delivery.status === "PROVIDER_ACCEPTED") {
        toast.show(`Convite enviado para ${inv.email}`);
      } else {
        toast.show(`Convite criado; o envio para ${inv.email} está em andamento`, { tone: "info" });
      }
    } catch (e) {
      if (isApiError(e, "EMAIL_DELIVERY_UNAVAILABLE")) {
        setError("O envio de e-mails não está disponível agora, então o convite não foi criado. Tente mais tarde.");
      } else if (isApiError(e, "ALREADY_MEMBER")) {
        setError("Esta pessoa já participa da viagem.");
      } else if (isApiError(e, "RATE_LIMITED")) {
        setError("Muitos convites em pouco tempo. Aguarde um pouco e tente de novo.");
      } else {
        setError(errorMessage(e, "Não foi possível criar o convite."));
      }
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-2xl border border-line bg-white p-4" aria-busy={busy}>
      <p className="text-sm font-semibold text-ink">Convidar por e-mail</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
        <Field label="E-mail" required error={error ?? undefined}>
          {(p) => (
            <input
              {...p}
              type="email"
              inputMode="email"
              autoComplete="off"
              className={inputClasses}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nome@exemplo.com"
              maxLength={254}
            />
          )}
        </Field>
        <Field label="Papel" required>
          {(p) => (
            <select {...p} className={inputClasses} value={role} onChange={(e) => setRole(e.target.value as GuestRole)}>
              <option value="EDITOR">{roleLabels.EDITOR}</option>
              <option value="VIEWER">{roleLabels.VIEWER}</option>
            </select>
          )}
        </Field>
      </div>
      {notice && (
        <p role="status" className="flex items-start gap-2 rounded-xl bg-[#fbf2df] px-3 py-2 text-sm text-[#5c430c]">
          <MailX aria-hidden className="mt-0.5 size-4 shrink-0" />
          {notice}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Send aria-hidden className="size-4" />}
        {busy ? "Enviando…" : "Enviar convite"}
      </Button>
      <p className="text-xs text-ink-soft">O convite vale por alguns dias e só pode ser aceito pelo e-mail convidado.</p>
    </form>
  );
}

function deliveryInfo(inv: InvitationDto) {
  switch (inv.delivery.status) {
    case "PROVIDER_ACCEPTED":
      return {
        icon: CircleCheck,
        tone: "text-forest",
        text: `Enviado${inv.delivery.providerAcceptedAt ? ` em ${dateTime(inv.delivery.providerAcceptedAt)}` : ""}`,
      };
    case "FAILED":
      return { icon: MailX, tone: "text-[#9b2c1a]", text: "O e-mail não foi enviado" };
    default:
      return { icon: Clock, tone: "text-ink-soft", text: "Envio em andamento" };
  }
}

function InvitationRow({ tripId, invitation }: { tripId: string; invitation: InvitationDto }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<"resend" | "revoke" | null>(null);
  const info = deliveryInfo(invitation);
  const Icon = info.icon;

  async function resend() {
    setBusy("resend");
    try {
      const inv = await invitationsApi.resend(tripId, invitation.id);
      toast.show(inv.delivery.status === "FAILED" ? "O reenvio também falhou. Tente mais tarde." : "Convite reenviado", {
        tone: inv.delivery.status === "FAILED" ? "error" : "success",
      });
    } catch (e) {
      if (isApiError(e, "INVITATION_RESEND_LIMITED")) {
        const wait = Number(e.details.retryAfterSeconds);
        toast.show(wait > 0 ? `Aguarde ${Math.ceil(wait)} s para reenviar este convite.` : e.message, { tone: "info" });
      } else if (isApiError(e, "INVITATION_DELIVERY_IN_PROGRESS")) {
        toast.show("O envio deste convite já está em andamento.", { tone: "info" });
      } else if (isApiError(e, "EMAIL_DELIVERY_UNAVAILABLE")) {
        toast.show("O envio de e-mails não está disponível agora. O convite continua válido.", { tone: "error" });
      } else {
        toast.show(errorMessage(e), { tone: "error" });
      }
    }
    await qc.invalidateQueries({ queryKey: keys.invitations(tripId) });
    setBusy(null);
  }

  async function revoke() {
    setBusy("revoke");
    try {
      await invitationsApi.revoke(tripId, invitation.id);
      toast.show("Convite revogado; o link deixou de funcionar");
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    }
    await qc.invalidateQueries({ queryKey: keys.invitations(tripId) });
    setBusy(null);
  }

  return (
    <li className="rounded-2xl border border-line bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{invitation.email}</p>
          <p className={cn("flex items-center gap-1 text-xs", info.tone)}>
            <Icon aria-hidden className="size-3.5" /> {info.text} · {roleLabels[invitation.role]} · vale até{" "}
            {dateTime(invitation.expiresAt)}
          </p>
        </div>
        <Button size="sm" variant={invitation.delivery.status === "FAILED" ? "primary" : "secondary"} disabled={busy !== null} onClick={() => void resend()}>
          {busy === "resend" ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Send aria-hidden className="size-3.5" />}
          Reenviar<span className="sr-only"> convite para {invitation.email}</span>
        </Button>
        <button
          type="button"
          onClick={() => void revoke()}
          disabled={busy !== null}
          aria-label={`Revogar convite para ${invitation.email}`}
          title="Revogar convite"
          className="inline-flex size-10 items-center justify-center rounded-full text-ink-soft hover:bg-[#fbe4df] hover:text-[#9b2c1a] disabled:opacity-50"
        >
          {busy === "revoke" ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <X aria-hidden className="size-4" />}
        </button>
      </div>
      {invitation.delivery.status === "FAILED" && (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-[#9b2c1a]">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />O convite continua válido; o e-mail é que não
          saiu. Reenvie quando quiser.
        </p>
      )}
    </li>
  );
}
