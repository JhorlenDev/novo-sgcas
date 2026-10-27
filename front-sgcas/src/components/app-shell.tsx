"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Building2,
  MapPinned,
  Headset,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Shield,
  Sparkles,
  Stethoscope,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { defaultRouteForRole, useAuth } from "@/lib/auth";
import { useResumoDosAvisos } from "@/lib/avisos";
import { SessionLoading } from "@/components/shared/session-loading";

const navItems = [
  { href: "/dashboard", label: "Painel", icon: LayoutDashboard },
  { href: "/cidadaos", label: "Cidadãos", icon: Search },
  { href: "/recepcao", label: "Recepção", icon: Headset },
  { href: "/fila", label: "Atendimento", icon: Stethoscope },
  { href: "/casos", label: "Acompanhamentos", icon: ClipboardList },
  {
    href: "/encaminhamentos",
    label: "Encaminhamentos",
    icon: ArrowLeftRight,
    roles: ["ADMIN", "COORDENADOR", "ASSISTENTE_SOCIAL", "TECNICO", "RECEPCIONISTA", "GESTOR_ACOES_ITINERANTES"],
  },
  { href: "/acoes-itinerantes", label: "Ações itinerantes", icon: MapPinned, roles: ["ADMIN", "GESTOR_ACOES_ITINERANTES"] },
  { href: "/institucional", label: "Institucional", icon: Building2, roles: ["ADMIN", "COORDENADOR"] },
  { href: "/admin", label: "Usuários", icon: Users, roles: ["ADMIN", "COORDENADOR"] },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { resumo } = useResumoDosAvisos(user?.papel);
  // O que pede a atenção da unidade: o que aguarda resposta e o que não foi lido.
  const pendencias = resumo ? resumo.encaminhamentos_pendentes + resumo.avisos_nao_lidos : 0;

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, router, user]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSidebarCollapsed(window.localStorage.getItem("sgcas-sidebar-collapsed") === "true");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("sgcas-sidebar-collapsed", String(next));
      return next;
    });
  }

  if (loading) {
    return <SessionLoading />;
  }

  if (!user) {
    return null;
  }

  const initials =
    user.nome
      ?.split(" ")
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "??";
  const current = navItems.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  const pageTitle = current?.label ?? "SGCAS";

  return (
    <div className="min-h-screen bg-meta-warm-gray">
      <Sidebar
        pathname={pathname}
        homeHref={defaultRouteForRole(user.papel)}
        role={user.papel}
        collapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
        pendencias={pendencias}
      />
      <MobileSidebar
        pathname={pathname}
        homeHref={defaultRouteForRole(user.papel)}
        role={user.papel}
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        pendencias={pendencias}
      />

      <div className={cn("transition-[padding] duration-300", sidebarCollapsed ? "md:pl-20" : "md:pl-64")}>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-meta-divider/70 px-4 frosted-nav md:px-8">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>

          <div className="flex min-w-0 items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
            <span className="truncate text-base font-semibold text-meta-charcoal md:text-lg">{pageTitle}</span>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-4">
            {user.unidade ? (
              <span className="hidden rounded-pill bg-meta-soft-gray px-3 py-1 text-xs font-medium text-meta-slate sm:inline">
                {user.unidade.nome}
              </span>
            ) : (
              <span className="hidden items-center gap-1 rounded-pill bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 sm:inline-flex">
                <Sparkles className="h-3.5 w-3.5" />
                Sem unidade vinculada
              </span>
            )}

            <div className="flex items-center gap-3">
              <Avatar className="h-9 w-9 shadow-lift ring-2 ring-white">
                <AvatarFallback className="bg-primary text-xs font-medium text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="hidden sm:block">
                <p className="text-sm font-medium leading-tight text-meta-charcoal">{user.nome}</p>
                <p className="text-xs tracking-tight text-meta-slate">{user.papel}</p>
              </div>
            </div>

            <Button variant="ghost" size="icon" onClick={() => void logout()} title="Sair">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <main className="mx-auto max-w-[1440px] p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}

function Sidebar({
  pathname,
  homeHref,
  role,
  collapsed,
  onToggle,
  pendencias,
}: {
  pathname: string;
  homeHref: string;
  role: string;
  collapsed: boolean;
  onToggle: () => void;
  pendencias: number;
}) {
  return (
    <aside
      className={cn(
        "hidden transition-[width] duration-300 md:fixed md:inset-y-0 md:z-30 md:flex md:flex-col",
        collapsed ? "md:w-20" : "md:w-64",
      )}
    >
      <div className="flex flex-grow flex-col overflow-y-auto border-r border-meta-divider bg-white pt-6">
        <div className={cn("mb-8 flex items-center", collapsed ? "justify-center px-3" : "justify-between px-6")}>
          <Brand href={homeHref} compact={collapsed} hideText={collapsed} />
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className={cn("h-9 w-9", collapsed && "absolute left-[62px] top-6 rounded-full border border-meta-divider bg-white shadow-lift")}
            title={collapsed ? "Expandir menu" : "Minimizar menu"}
            aria-label={collapsed ? "Expandir menu lateral" : "Minimizar menu lateral"}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>
        <Nav pathname={pathname} role={role} compact={collapsed} pendencias={pendencias} />
        <Footer compact={collapsed} />
      </div>
    </aside>
  );
}

function MobileSidebar({
  pathname,
  homeHref,
  role,
  open,
  onClose,
  pendencias,
}: {
  pathname: string;
  homeHref: string;
  role: string;
  open: boolean;
  onClose: () => void;
  pendencias: number;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-label="Fechar menu" />
      <aside className="relative flex h-full w-72 max-w-[84vw] flex-col overflow-y-auto border-r border-meta-divider bg-white pt-5 shadow-elevated">
        <div className="mb-4 flex items-center justify-between px-5">
          <Brand href={homeHref} compact />
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div onClick={onClose}>
          <Nav pathname={pathname} role={role} pendencias={pendencias} />
        </div>
        <Footer />
      </aside>
    </div>
  );
}

function Brand({ href, compact = false, hideText = false }: { href: string; compact?: boolean; hideText?: boolean }) {
  return (
    <Link
      className={cn("flex flex-shrink-0 items-center", !compact && "mb-8 px-6", compact && "mb-0 px-0")}
      href={href}
      title="SGCAS"
    >
      <div className={cn("flex h-10 w-10 items-center justify-center rounded-pill bg-primary", !hideText && "mr-3")}>
        <Shield className="h-5 w-5 text-primary-foreground" />
      </div>
      <div className={cn(hideText && "sr-only")}>
        <h1 className="text-base font-semibold tracking-tight text-meta-charcoal">SGCAS</h1>
        <p className="text-xs text-meta-slate">Assistência Social</p>
      </div>
    </Link>
  );
}

function Nav({
  pathname,
  role,
  compact = false,
  pendencias = 0,
}: {
  pathname: string;
  role: string;
  compact?: boolean;
  pendencias?: number;
}) {
  const visibleItems = navItems.filter((item) => !item.roles || item.roles.includes(role));

  return (
    <nav className={cn("flex-1 space-y-1", compact ? "px-3" : "px-3")}>
      {visibleItems.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const selo = item.href === "/encaminhamentos" ? pendencias : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            title={selo ? `${item.label} — ${selo} pendente(s)` : item.label}
            className={cn(
              "relative flex items-center rounded-pill px-4 py-2.5 text-[15px] font-medium tracking-tight transition-all duration-200",
              compact && "justify-center px-0",
              isActive ? "bg-primary text-primary-foreground shadow-lift" : "text-meta-charcoal hover:bg-meta-soft-gray",
            )}
          >
            <item.icon className={cn("h-[18px] w-[18px] flex-shrink-0", !compact && "mr-3", isActive ? "" : "text-meta-slate")} />
            <span className={cn(compact && "sr-only")}>{item.label}</span>
            {selo > 0 && (
              <span
                className={cn(
                  "ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-semibold leading-5 text-white",
                  compact && "absolute right-2 top-1 ml-0",
                )}
                aria-label={`${selo} pendente(s)`}
              >
                {selo > 99 ? "99+" : selo}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function Footer({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("relative flex-shrink-0 border-t border-meta-divider", compact ? "p-3" : "p-6")}>
      {compact ? (
        <p className="text-center text-[10px] font-semibold tracking-tight text-meta-slate">v0.1</p>
      ) : (
        <>
          <p className="text-center text-xs tracking-tight text-meta-slate">SGCAS v0.1.0</p>
          <p className="mt-0.5 text-center text-[11px] tracking-tight text-meta-slate/70">Desenvolvido por SEDECTI</p>
        </>
      )}
    </div>
  );
}
