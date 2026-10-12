import type { Metadata } from "next";
import { Suspense } from "react";
import { RegisterForm } from "@/components/auth/auth-forms";
import { AuthShell } from "@/components/auth/auth-shell";

export const metadata: Metadata = { title: "Criar conta · BoraAli" };

export default function CadastroPage() {
  return (
    <AuthShell>
      <Suspense>
        <RegisterForm />
      </Suspense>
    </AuthShell>
  );
}
