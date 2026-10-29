"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Clock3, Landmark, Loader2, Send, UserRoundCheck } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui";

const PASSOS = [
  {
    icon: Send,
    titulo: "Reenvie a solicitação",
    texto: "Isso coloca o seu pedido na fila de aprovação do administrador.",
  },
  {
    icon: UserRoundCheck,
    titulo: "Fale com a sua unidade",
    texto: "Procure o coordenador da unidade ou um administrador do SGCAS para aprovar o seu perfil e vincular a sua unidade.",
  },
  {
    icon: Clock3,
    titulo: "Entre novamente",
    texto: "Depois da aprovação, faça o login de novo para receber o perfil atualizado.",
  },
];

export default function WaitingApprovalPage() {
  const [reenviando, setReenviando] = useState(false);
  const [mensagem, setMensagem] = useState("");

  useEffect(() => {
    if (!mensagem) return;
    const timer = window.setTimeout(() => setMensagem(""), 5000);
    return () => window.clearTimeout(timer);
  }, [mensagem]);

  async function reenviar() {
    setReenviando(true);
    setMensagem("");
    try {
      const resposta = await api<{ mensagem?: string }>("/auth/access-request/resend", {
        method: "POST",
        skipAuthRedirect: true,
      });
      setMensagem(resposta.mensagem ?? "Solicitação reenviada. Aguarde a aprovação.");
    } catch (error) {
      setMensagem(error instanceof Error ? error.message : "Não foi possível reenviar a solicitação.");
    } finally {
      setReenviando(false);
    }
  }

  return (
    <main className="center-screen">
      <div className="w-full max-w-xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Landmark className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-lg font-bold leading-tight">SGCAS</p>
            <p className="text-xs text-meta-slate">Gestão de Casos da Assistência Social</p>
          </div>
        </div>

        <div className="card !p-6 sm:!p-8">
          <h1 className="text-2xl">Seu acesso está aguardando aprovação</h1>
          <p className="mt-2 text-sm leading-6 text-meta-slate">
            Seu login foi reconhecido, mas ainda falta um perfil de operador no SGCAS. Veja o que fazer agora:
          </p>

          {mensagem && (
            <div className="notice mt-5" role="status">
              {mensagem}
            </div>
          )}

          <ol className="mt-6 space-y-4">
            {PASSOS.map(({ icon: Icon, titulo, texto }, indice) => (
              <li key={titulo} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-primary" aria-hidden="true">
                  {indice + 1}
                </span>
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold text-meta-charcoal">
                    <Icon className="h-4 w-4 shrink-0 text-meta-slate" aria-hidden="true" />
                    {titulo}
                  </p>
                  <p className="mt-0.5 text-sm leading-6 text-meta-slate">{texto}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-8 flex flex-col gap-3 border-t border-meta-divider pt-5 sm:flex-row">
            <Button className="w-full sm:w-auto" type="button" onClick={() => void reenviar()} disabled={reenviando}>
              {reenviando ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
              {reenviando ? "Reenviando..." : "Reenviar solicitação"}
            </Button>
            <Link href="/login" className="button secondary w-full sm:w-auto">
              Tentar entrar novamente
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
