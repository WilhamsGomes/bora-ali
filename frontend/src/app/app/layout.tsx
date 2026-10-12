import { RequireAuth } from "@/components/app/require-auth";

/**
 * A sessão vive só no navegador (access token em memória, refresh em cookie httpOnly da API),
 * então a área privada aguarda a restauração no cliente antes de renderizar: não é instantânea.
 */
export const instant = false;

/** Tudo em /app exige sessão; o destino é preservado para depois do login. */
export default function PrivateLayout({ children }: LayoutProps<"/app">) {
  return <RequireAuth>{children}</RequireAuth>;
}
