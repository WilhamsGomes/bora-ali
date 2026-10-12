"use client";

import { Eye, EyeOff, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { errorMessage, isApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Field, inputClasses } from "@/components/ui/field";
import { safeNext, useSession } from "@/state/providers";
import { cn } from "@/lib/utils";

function useNext() {
  const params = useSearchParams();
  return safeNext(params.get("next"));
}

/** Leva para o destino quando já há sessão (ex.: abriu /entrar logado). */
function useRedirectWhenAuthenticated(next: string) {
  const { state } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (state.status === "authenticated") router.replace(next);
  }, [state.status, next, router]);
}

function withNext(path: string, next: string) {
  return next === "/app" ? path : `${path}?${new URLSearchParams({ next })}`;
}

function FormAlert({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-2xl bg-[#fbe4df] px-3.5 py-3 text-sm text-[#7a2a1a]">
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={visible ? "text" : "password"} className={cn(inputClasses, "pr-12")} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
        aria-pressed={visible}
        className="absolute right-1 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-ink-soft hover:bg-forest/5 hover:text-forest"
      >
        {visible ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
      </button>
    </div>
  );
}

export function LoginForm() {
  const { state, login } = useSession();
  const params = useSearchParams();
  const next = useNext();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useRedirectWhenAuthenticated(next);

  const expired = params.get("motivo") === "sessao" || (state.status === "anonymous" && state.expired);
  const fromInvite = next.startsWith("/convites/");

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy) return;
    if (!email.trim() || !password) {
      setError("Informe e-mail e senha.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      router.replace(next);
    } catch (e) {
      setError(
        isApiError(e, "INVALID_CREDENTIALS")
          ? "E-mail ou senha incorretos."
          : isApiError(e, "RATE_LIMITED")
            ? "Muitas tentativas seguidas. Aguarde um minuto e tente de novo."
            : errorMessage(e),
      );
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] text-forest">Que bom te ver por aqui</h1>
      <p className="mt-3 text-ink-soft">
        {fromInvite ? "Entre para aceitar o convite da viagem." : "Entre para continuar planejando suas viagens."}
      </p>

      {expired && (
        <p role="status" className="mt-6 flex items-start gap-2 rounded-2xl bg-[#fbf2df] px-3.5 py-3 text-sm text-[#5c430c]">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          Sua sessão expirou. Entre novamente para continuar de onde parou.
        </p>
      )}

      <form onSubmit={submit} noValidate className="mt-8 space-y-4" aria-busy={busy}>
        {error && <FormAlert>{error}</FormAlert>}
        <Field label="E-mail" required>
          {(p) => (
            <input
              {...p}
              type="email"
              autoComplete="email"
              inputMode="email"
              data-autofocus
              autoFocus
              className={inputClasses}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
            />
          )}
        </Field>
        <Field label="Senha" required>
          {(p) => (
            <PasswordInput
              {...p}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={128}
            />
          )}
        </Field>
        <Button type="submit" className="w-full" disabled={busy || state.status === "loading"}>
          {busy && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
          {busy ? "Entrando…" : "Entrar"}
        </Button>
      </form>

      <p className="mt-6 text-sm text-ink-soft">
        Ainda não tem conta?{" "}
        <Link href={withNext("/cadastro", next)} className="font-semibold text-forest underline underline-offset-4">
          Criar conta
        </Link>
      </p>
    </>
  );
}

interface RegisterErrors {
  name?: string;
  email?: string;
  password?: string;
}

export function RegisterForm() {
  const { state, register } = useSession();
  const next = useNext();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<RegisterErrors>({});
  const [error, setError] = useState<string | null>(null);
  useRedirectWhenAuthenticated(next);

  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (busy) return;
    const form = ev.currentTarget;
    const e: RegisterErrors = {};
    if (!name.trim()) e.name = "Como podemos te chamar?";
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) e.email = "Informe um e-mail válido.";
    if (password.length < 8) e.password = "Use pelo menos 8 caracteres.";
    setErrors(e);
    setError(null);
    if (Object.keys(e).length) {
      window.setTimeout(() => form.querySelector<HTMLElement>("[aria-invalid=true]")?.focus());
      return;
    }
    setBusy(true);
    try {
      await register(name.trim(), email.trim(), password);
      router.replace(next);
    } catch (err) {
      if (isApiError(err, "EMAIL_ALREADY_REGISTERED")) {
        setErrors({ email: "Este e-mail já tem conta. Entre com ele ou use outro." });
      } else if (isApiError(err, "VALIDATION_ERROR")) {
        const fields = (err.details.fields as { field: string; messages: string[] }[] | undefined) ?? [];
        const map: RegisterErrors = {};
        for (const f of fields) {
          if (f.field === "name") map.name = "Confira o nome.";
          if (f.field === "email") map.email = "Informe um e-mail válido.";
          if (f.field === "password") map.password = "A senha precisa ter de 8 a 128 caracteres.";
        }
        setErrors(map);
        if (!Object.keys(map).length) setError(err.message);
      } else {
        setError(
          isApiError(err, "RATE_LIMITED") ? "Muitas tentativas seguidas. Aguarde um minuto e tente de novo." : errorMessage(err),
        );
      }
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] text-forest">Bora criar sua conta</h1>
      <p className="mt-3 text-ink-soft">Leva menos de um minuto. Depois é só montar o roteiro.</p>

      <form onSubmit={submit} noValidate className="mt-8 space-y-4" aria-busy={busy}>
        {error && <FormAlert>{error}</FormAlert>}
        <Field label="Nome" required error={errors.name}>
          {(p) => (
            <input
              {...p}
              autoComplete="name"
              autoFocus
              className={inputClasses}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          )}
        </Field>
        <Field label="E-mail" required error={errors.email}>
          {(p) => (
            <input
              {...p}
              type="email"
              autoComplete="email"
              inputMode="email"
              className={inputClasses}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
            />
          )}
        </Field>
        <Field label="Senha" required error={errors.password} hint="Pelo menos 8 caracteres.">
          {(p) => (
            <PasswordInput
              {...p}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={128}
            />
          )}
        </Field>
        <Button type="submit" className="w-full" disabled={busy || state.status === "loading"}>
          {busy && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
          {busy ? "Criando conta…" : "Criar conta"}
        </Button>
      </form>

      <p className="mt-6 text-sm text-ink-soft">
        Já tem conta?{" "}
        <Link href={withNext("/entrar", next)} className="font-semibold text-forest underline underline-offset-4">
          Entrar
        </Link>
      </p>
    </>
  );
}
