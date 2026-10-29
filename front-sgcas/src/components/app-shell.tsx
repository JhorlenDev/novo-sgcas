"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  ArrowLeftRight,
  Building2,
  ConciergeBell,
  FolderOpen,
  HeartHandshake,
  Landmark,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  TriangleAlert,
  UserCog,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { defaultRouteForRole, useAuth } from "@/lib/auth";
import { useResumoDosAvisos } from "@/lib/avisos";
import { rotuloDoPapel } from "@/lib/papeis";
import { SessionLoading } from "@/components/shared/session-loading";

type ItemDeMenu = { href: string; label: string; icon: LucideIcon; roles?: string[] };
type SecaoDeMenu = { titulo?: string; itens: ItemDeMenu[] };

const EQUIPE_E_RECEPCAO = ["ADMIN", "COORDENADOR", "ASSISTENTE_SOCIAL", "TECNICO", "RECEPCIONISTA", "GESTOR_ACOES_ITINERANTES"];

// O menu segue o caminho do trabalho: receber, atender, acompanhar e encaminhar;
// depois os cadastros e, por último, a administração.
const secoes: SecaoDeMenu[] = [
  { itens: [{ href: "/dashboard", label: "Painel", icon: LayoutDashboard }] },
  {
    titulo: "Atendimento",
    itens: [
      { href: "/recepcao", label: "Recepção", icon: ConciergeBell },
      { href: "/fila", label: "Atendimento", icon: HeartHandshake },
      { href: "/casos", label: "Acompanhamentos", icon: FolderOpen },
      { href: "/encaminhamentos", label: "Encaminhamentos", icon: ArrowLeftRight, roles: EQUIPE_E_RECEPCAO },
    ],
  },
  {
    titulo: "Cadastros",
    itens: [
      { href: "/cidadaos", label: "Cidadãos", icon: Users },
      { href: "/acoes-itinerantes", label: "Ações itinerantes", icon: MapPinned, roles: ["ADMIN", "GESTOR_ACOES_ITINERANTES"] },
    ],
  },
  {
    titulo: "Administração",
    itens: [
      { href: "/institucional", label: "Institucional", icon: Building2, roles: ["ADMIN", "COORDENADOR"] },
      { href: "/admin", label: "Usuários", icon: UserCog, roles: ["ADMIN", "COORDENADOR"] },
    ],
  },
];

const todosOsItens = secoes.flatMap((secao) => secao.itens);

function estaAtivo(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const [gavetaAberta, setGavetaAberta] = useState(false);
  const [recolhido, setRecolhido] = useState(false);
  const { resumo } = useResumoDosAvisos(user?.papel);
  // O que pede a atenção da unidade: o que aguarda resposta e o que não foi lido.
  const pendencias = resumo ? resumo.encaminhamentos_pendentes + resumo.avisos_nao_lidos : 0;

  const atual = todosOsItens.find((item) => estaAtivo(pathname, item.href));
  const tituloDaPagina = atual?.label ?? "SGCAS";

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, router, user]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRecolhido(window.localStorage.getItem("sgcas-sidebar-collapsed") === "true");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Cada tela diz o próprio nome na aba do navegador e no histórico.
  useEffect(() => {
    document.title = `${tituloDaPagina} · SGCAS`;
  }, [tituloDaPagina]);

  // A gaveta é do celular e do tablet: ao ampliar a janela até o menu fixo, ela precisa fechar.
  useEffect(() => {
    const consulta = window.matchMedia("(min-width: 1024px)");
    const aoMudar = (evento: MediaQueryListEvent) => {
      if (evento.matches) setGavetaAberta(false);
    };
    consulta.addEventListener("change", aoMudar);
    return () => consulta.removeEventListener("change", aoMudar);
  }, []);

  function alternarMenu() {
    setRecolhido((atualmente) => {
      const proximo = !atualmente;
      window.localStorage.setItem("sgcas-sidebar-collapsed", String(proximo));
      return proximo;
    });
  }

  if (loading) {
    return <SessionLoading />;
  }

  if (!user) {
    return null;
  }

  const iniciais =
    user.nome
      ?.split(" ")
      .filter(Boolean)
      .map((parte) => parte[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "??";

  return (
    <div className="min-h-screen bg-meta-warm-gray">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary focus:shadow-elevated"
      >
        Ir para o conteúdo
      </a>

      <MenuFixo
        pathname={pathname}
        homeHref={defaultRouteForRole(user.papel)}
        papel={user.papel}
        recolhido={recolhido}
        onAlternar={alternarMenu}
        pendencias={pendencias}
      />

      <Gaveta
        aberta={gavetaAberta}
        onAbertaChange={setGavetaAberta}
        pathname={pathname}
        homeHref={defaultRouteForRole(user.papel)}
        papel={user.papel}
        pendencias={pendencias}
      />

      <div className={cn("transition-[padding] duration-200", recolhido ? "lg:pl-[4.5rem]" : "lg:pl-64")}>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-meta-divider bg-white px-3 sm:gap-3 sm:px-4 lg:px-8">
          <button
            type="button"
            onClick={() => setGavetaAberta(true)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-meta-charcoal transition-colors hover:bg-meta-soft-gray lg:hidden"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>

          {/* Celular e tablet: o título da tela, com a unidade logo abaixo. */}
          <div className="min-w-0 flex-1 lg:hidden">
            <p className="truncate text-[15px] font-semibold leading-tight text-meta-charcoal">{tituloDaPagina}</p>
            {user.unidade && <p className="truncate text-xs leading-tight text-meta-slate">{user.unidade.nome}</p>}
          </div>

          {/* Computador: a unidade onde a pessoa está trabalhando. */}
          <div className="hidden min-w-0 flex-1 lg:block">
            {user.unidade ? (
              <p className="flex items-center gap-2 text-sm font-medium text-meta-charcoal">
                <Building2 className="h-4 w-4 shrink-0 text-meta-slate" aria-hidden="true" />
                <span className="truncate">{user.unidade.nome_qualificado || user.unidade.nome}</span>
              </p>
            ) : (
              <p className="flex items-center gap-2 text-sm font-medium text-amber-800">
                <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                Sem unidade vinculada
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <div className="hidden min-w-0 text-right sm:block">
              <p className="max-w-[14rem] truncate text-sm font-semibold leading-tight text-meta-charcoal">{user.nome}</p>
              <p className="text-xs leading-tight text-meta-slate">{rotuloDoPapel(user.papel)}</p>
            </div>
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-accent text-xs font-semibold text-primary" aria-hidden="true">
                {iniciais}
              </AvatarFallback>
            </Avatar>
            <button
              type="button"
              onClick={() => void logout()}
              className="flex h-11 w-11 items-center justify-center gap-2 rounded-lg text-sm font-medium text-meta-charcoal transition-colors hover:bg-meta-soft-gray sm:w-auto sm:px-3 md:h-10"
              aria-label="Sair do sistema"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </header>

        <main id="conteudo" tabIndex={-1} className="page-content mx-auto w-full max-w-[1440px] px-4 py-5 outline-none sm:px-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function MenuFixo({
  pathname,
  homeHref,
  papel,
  recolhido,
  onAlternar,
  pendencias,
}: {
  pathname: string;
  homeHref: string;
  papel: string;
  recolhido: boolean;
  onAlternar: () => void;
  pendencias: number;
}) {
  return (
    <aside
      className={cn(
        "hidden border-r border-meta-divider bg-white transition-[width] duration-200 lg:fixed lg:inset-y-0 lg:z-40 lg:flex lg:flex-col",
        recolhido ? "lg:w-[4.5rem]" : "lg:w-64",
      )}
    >
      <div className={cn("flex h-14 shrink-0 items-center border-b border-meta-divider", recolhido ? "justify-center" : "px-5")}>
        <Marca href={homeHref} compacta={recolhido} />
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <Navegacao pathname={pathname} papel={papel} compacta={recolhido} pendencias={pendencias} />
      </div>

      <div className="shrink-0 border-t border-meta-divider p-3">
        <button
          type="button"
          onClick={onAlternar}
          className={cn(
            "flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-meta-slate transition-colors hover:bg-meta-soft-gray hover:text-meta-charcoal",
            recolhido && "justify-center px-0",
          )}
          aria-label={recolhido ? "Expandir menu lateral" : "Recolher menu lateral"}
          title={recolhido ? "Expandir menu" : "Recolher menu"}
        >
          {recolhido ? <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden="true" /> : <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden="true" />}
          {!recolhido && <span>Recolher menu</span>}
        </button>
        {!recolhido && <Rodape />}
      </div>
    </aside>
  );
}

function Gaveta({
  aberta,
  onAbertaChange,
  pathname,
  homeHref,
  papel,
  pendencias,
}: {
  aberta: boolean;
  onAbertaChange: (aberta: boolean) => void;
  pathname: string;
  homeHref: string;
  papel: string;
  pendencias: number;
}) {
  // Radix cuida do foco, do Esc e do bloqueio da rolagem de trás: o menu é uma janela de verdade.
  return (
    <DialogPrimitive.Root open={aberta} onOpenChange={onAbertaChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-meta-charcoal/55 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 lg:hidden" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 left-0 z-50 flex w-[19rem] max-w-[calc(100vw-3rem)] flex-col bg-white shadow-elevated focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left lg:hidden"
        >
          <DialogPrimitive.Title className="sr-only">Menu principal</DialogPrimitive.Title>
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-meta-divider pl-5 pr-2">
            <Marca href={homeHref} onNavegar={() => onAbertaChange(false)} />
            <DialogPrimitive.Close
              className="flex h-11 w-11 items-center justify-center rounded-lg text-meta-slate transition-colors hover:bg-meta-soft-gray hover:text-meta-charcoal"
              aria-label="Fechar menu"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-4">
            <Navegacao pathname={pathname} papel={papel} pendencias={pendencias} onNavegar={() => onAbertaChange(false)} />
          </div>
          <div className="shrink-0 border-t border-meta-divider p-4">
            <Rodape />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Marca({ href, compacta = false, onNavegar }: { href: string; compacta?: boolean; onNavegar?: () => void }) {
  return (
    <Link href={href} onClick={onNavegar} className="flex min-w-0 items-center gap-3 rounded-lg" title="SGCAS — início">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Landmark className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <span className={cn("min-w-0", compacta && "sr-only")}>
        <span className="block text-[15px] font-bold leading-tight tracking-tight text-meta-charcoal">SGCAS</span>
        <span className="block truncate text-xs leading-tight text-meta-slate">Assistência Social</span>
      </span>
    </Link>
  );
}

function Navegacao({
  pathname,
  papel,
  compacta = false,
  pendencias = 0,
  onNavegar,
}: {
  pathname: string;
  papel: string;
  compacta?: boolean;
  pendencias?: number;
  onNavegar?: () => void;
}) {
  const visiveis = secoes
    .map((secao) => ({ ...secao, itens: secao.itens.filter((item) => !item.roles || item.roles.includes(papel)) }))
    .filter((secao) => secao.itens.length > 0);

  return (
    <nav aria-label="Menu principal" className="space-y-5">
      {visiveis.map((secao, indice) => (
        <div key={secao.titulo ?? "inicio"}>
          {secao.titulo &&
            (compacta ? (
              indice > 0 && <div className="mx-3 mb-2 border-t border-meta-divider" aria-hidden="true" />
            ) : (
              <p className="mb-1.5 px-3 text-xs font-semibold text-meta-slate">{secao.titulo}</p>
            ))}
          <ul className="space-y-0.5">
            {secao.itens.map((item) => {
              const ativo = estaAtivo(pathname, item.href);
              const selo = item.href === "/encaminhamentos" ? pendencias : 0;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavegar}
                    aria-current={ativo ? "page" : undefined}
                    title={selo ? `${item.label} — ${selo} pendente(s)` : item.label}
                    className={cn(
                      "relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors lg:min-h-10",
                      compacta && "justify-center px-0",
                      ativo ? "bg-accent font-semibold text-primary" : "text-meta-charcoal hover:bg-meta-soft-gray",
                    )}
                  >
                    {ativo && !compacta && <span className="absolute inset-y-2 left-0 w-1 rounded-r bg-primary" aria-hidden="true" />}
                    <item.icon className={cn("h-[18px] w-[18px] shrink-0", ativo ? "text-primary" : "text-meta-slate")} aria-hidden="true" />
                    <span className={cn("min-w-0 flex-1 truncate", compacta && "sr-only")}>{item.label}</span>
                    {selo > 0 && (
                      <span
                        className={cn(
                          "inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-semibold leading-5 text-white",
                          compacta && "absolute right-1.5 top-1 min-w-4 px-1 text-[10px] leading-4",
                        )}
                        aria-label={`${selo} pendente(s)`}
                      >
                        {selo > 99 ? "99+" : selo}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Rodape() {
  return (
    <p className="mt-3 px-3 text-xs leading-5 text-meta-slate first:mt-0">
      SGCAS v0.1.0
      <br />
      Desenvolvido por SEDECTI
    </p>
  );
}
