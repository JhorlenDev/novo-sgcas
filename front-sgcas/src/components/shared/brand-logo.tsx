import Image from "next/image";
import { cn } from "@/lib/utils";

export function BrandLogo({ className }: { className?: string }) {
  return (
    <Image
      src="/logo-semasc-new.png"
      alt="SEMASC"
      width={60}
      height={40}
      className={cn("h-10 w-[60px] shrink-0 object-contain", className)}
    />
  );
}
