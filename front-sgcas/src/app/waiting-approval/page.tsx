"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Clock3, Loader2, Send, ShieldCheck, UserRoundCheck } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Card, SecondaryButton } from "@/components/ui";

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
      setMensagem(resposta.mensagem ?? "Solicitação reenviada. Aguarde aprovação.");
    } catch (error) {
      setMensagem(error instanceof Error ? error.message : "Não foi possível reenviar a solicitação.");
    } finally {
      setReenviando(false);
    }
  }

  return (
    <main className="min-h-screen bg-meta-warm-gray p-5 text-meta-charcoal">
      <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center">
        <Card className="w-full overflow-hidden !p-0">
          <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
            <section className="relative bg-[#061f43] p-8 text-white md:p-10">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(96,165,250,0.26),transparent_34%),linear-gradient(135deg,rgba(6,31,67,0.98),rgba(16,91,190,0.84))]" />
              <div className="relative">
                <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/12 ring-1 ring-white/15">
                  <ShieldCheck className="h-7 w-7" />
                </div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-100/70">Solicitação registrada</p>
                <h1 className="mt-4 text-3xl font-medium leading-tight md:text-4xl">
                  Acesso aguardando liberação.
                </h1>
                <p className="mt-4 max-w-md text-sm leading-7 text-white/72">
                  Seu login foi reconhecido, mas ainda falta um perfil de operador no SGCAS.
                </p>
              </div>
            </section>

            <section className="p-8 md:p-10">
              <div className="mb-8">
                <h2 className="text-2xl font-medium tracking-tight text-meta-charcoal">O que fazer agora?</h2>
                <p className="mt-2 text-sm leading-6 text-meta-slate">
                  Reenvie a solicitação e fale com o coordenador da sua unidade ou com um administrador para aprovar seu perfil e vincular sua unidade.
                </p>
              </div>

              {mensagem && <div className="notice mb-5">{mensagem}</div>}

              <div className="grid gap-3">
                <Step
                  icon={Send}
                  title="1. Reenvie a solicitação"
                  text="Isso confirma seu pedido na fila de aprovação do administrador."
                />
                <Step
                  icon={UserRoundCheck}
                  title="2. Fale com sua unidade"
                  text="Procure o coordenador da unidade ou um administrador do SGCAS."
                />
                <Step
                  icon={Clock3}
                  title="3. Entre novamente"
                  text="Depois da aprovação, faça login de novo para receber o perfil atualizado."
                />
              </div>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button className="w-full sm:w-auto" type="button" onClick={() => void reenviar()} disabled={reenviando}>
                  {reenviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {reenviando ? "Reenviando..." : "Reenviar solicitação"}
                </Button>
                <Link href="/login">
                  <SecondaryButton className="w-full sm:w-auto">Tentar login novamente</SecondaryButton>
                </Link>
              </div>
            </section>
          </div>
        </Card>
      </div>
    </main>
  );
}

function Step({
  icon: Icon,
  title,
  text,
}: {
  icon: React.ElementType;
  title: string;
  text: string;
}) {
  return (
    <div className="flex gap-3 rounded-card border border-meta-divider bg-meta-warm-gray p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-primary/10 text-primary">
        <Icon size={18} />
      </span>
      <div>
        <strong className="block text-sm text-meta-charcoal">{title}</strong>
        <p className="mt-1 text-sm leading-6 text-meta-slate">{text}</p>
      </div>
    </div>
  );
}
