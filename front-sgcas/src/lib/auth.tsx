"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { api, isMarkedLoggedOut, markLoggedOut } from "@/lib/api";
import type { Operador } from "@/types/sgcas";

type AuthContextValue = {
  user: Operador | null;
  loading: boolean;
  authenticated: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const publicRoutes = new Set(["/login", "/waiting-approval"]);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<Operador | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (isMarkedLoggedOut()) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const currentUser = await api<Operador>("/auth/me", { skipAuthRedirect: true });
      setUser(currentUser);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let timer: number;

    if (publicRoutes.has(pathname)) {
      timer = window.setTimeout(() => {
        setLoading(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }

    timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname, refresh]);

  const logout = useCallback(async () => {
    let logoutUrl = "/login";

    try {
      const response = await api<{ urlDeLogout?: string; logoutUrl?: string }>("/auth/logout", {
        method: "POST",
        skipAuthRedirect: true,
      });
      logoutUrl = response.urlDeLogout ?? response.logoutUrl ?? logoutUrl;
    } finally {
      markLoggedOut();
      setUser(null);
      window.location.href = logoutUrl;
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, authenticated: Boolean(user), refresh, logout }),
    [loading, logout, refresh, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth precisa estar dentro de AuthProvider");
  }
  return context;
}

export function defaultRouteForRole(role?: string) {
  if (role === "RECEPCIONISTA") return "/recepcao";
  if (role === "VISUALIZADOR") return "/cidadaos";
  if (role === "ADMIN") return "/admin";
  return "/dashboard";
}
