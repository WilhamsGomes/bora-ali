import Image from "next/image";
import { Logo } from "@/components/ui/logo";
import { photo, photos } from "@/data/photos";

/** Moldura das telas de conta: foto à esquerda no desktop, formulário à direita. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid flex-1 lg:grid-cols-2">
      <div className="relative hidden lg:block">
        <Image
          src={photo(photos.ipanemaBeach.id, 1400)}
          alt={photos.ipanemaBeach.alt}
          fill
          preload
          sizes="50vw"
          className="object-cover"
        />
      </div>
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">{children}</div>
      </div>
    </main>
  );
}
