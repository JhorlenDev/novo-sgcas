"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, ArrowLeftRight, ConciergeBell, FolderOpen, Loader2 } from "lucide-react";
import { loginWithTefeCidadao } from "@/lib/api";
import { defaultRouteForRole, useAuth } from "@/lib/auth";

const errors: Record<string, { title: string; text: string }> = {
  "sem-acesso": {
    title: "Acesso ainda não liberado",
    text: "Sua conta entrou pelo Tefé Cidadão, mas ainda não tem perfil aprovado no SGCAS.",
  },
  "estado-invalido": {
    title: "Sessão expirada",
    text: "Comece o acesso novamente para proteger sua sessão.",
  },
  "sem-codigo": {
    title: "Retorno incompleto",
    text: "O Tefé Cidadão não devolveu o código de acesso. Tente entrar outra vez.",
  },
  "conta-em-conflito": {
    title: "E-mail já vinculado a outra conta",
    text: "O e-mail desta conta já está associado a outro usuário do SGCAS. Procure o administrador para resolver a duplicidade.",
  },
  "email-nao-confirmado": {
    title: "E-mail ainda não confirmado",
    text: "Confirme o e-mail da sua conta no Tefé Cidadão e tente entrar outra vez. Se continuar, procure o administrador.",
  },
  "muitas-tentativas": {
    title: "Muitas tentativas seguidas",
    text: "Aguarde cerca de um minuto e tente entrar outra vez.",
  },
};

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-meta-warm-gray p-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary motion-reduce:animate-none" role="status" aria-label="Carregando" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [entering, setEntering] = useState(false);

  const loginError = useMemo(() => {
    const error = params.get("erro");
    return error ? errors[error] : undefined;
  }, [params]);

  useEffect(() => {
    if (!loading && user) {
      router.replace(defaultRouteForRole(user.papel));
    }
  }, [loading, router, user]);

  function handleLogin() {
    setEntering(true);
    loginWithTefeCidadao();
  }

  return (
    <main className="min-h-screen bg-meta-warm-gray text-meta-charcoal">
      <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Apresentação: só no computador. No celular a página começa direto no acesso. */}
        <section className="hidden grid-rows-[1fr_auto_1fr] gap-8 bg-primary px-12 py-10 text-white lg:grid xl:px-16 [@media(max-height:760px)]:gap-4 [@media(max-height:760px)]:py-6">
          <div className="flex items-center gap-3 self-start">
            <span className="flex h-16 w-14 shrink-0 items-center justify-center rounded-lg bg-white p-1.5">
              <Image src="/brasao-tefe-logo.png" alt="Brasão de Tefé" width={146} height={192} className="h-full w-full object-contain" priority />
            </span>
            <div>
              <p className="text-lg font-bold leading-tight">SGCAS</p>
              <p className="text-xs text-white/75">Prefeitura de Tefé · SEDECTI</p>
            </div>
          </div>

          <div className="mx-auto w-full max-w-2xl text-center">
            <h1 className="!text-white text-4xl leading-[1.1] xl:text-5xl 2xl:text-6xl">
              Sistema de Gestão de Casos da Assistência Social
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-lg leading-8 text-white/85 xl:text-xl xl:leading-9">
              O atendimento da rede socioassistencial do município, da recepção ao encaminhamento, num só cadastro.
            </p>

            <ul className="mt-10 space-y-6">
              {[
                [ConciergeBell, "Recepção e fila", "Registro da chegada, senha e chamada para o atendimento."],
                [FolderOpen, "Prontuário e acompanhamento", "Histórico de cada pessoa e de cada caso, por unidade."],
                [ArrowLeftRight, "Encaminhamentos entre unidades", "Quem encaminha, quem recebe e o que já foi feito."],
              ].map(([Icone, titulo, texto]) => {
                const Icon = Icone as typeof ConciergeBell;
                return (
                  <li key={titulo as string} className="flex flex-col items-center gap-1">
                    <p className="flex items-center gap-2.5 text-base font-semibold xl:text-lg">
                      <Icon className="h-5 w-5 shrink-0 text-white/85 xl:h-6 xl:w-6" aria-hidden="true" />
                      {titulo as string}
                    </p>
                    <p className="max-w-md text-[15px] leading-6 text-white/85 xl:text-base">{texto as string}</p>
                  </li>
                );
              })}
            </ul>
          </div>

          <p className="self-end text-center text-xs text-white/80">Acesso restrito a servidores autorizados.</p>
        </section>

        <section className="flex items-center justify-center px-4 py-8 sm:px-8">
          <div className="w-full max-w-[26rem]">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <span className="flex h-16 w-14 shrink-0 items-center justify-center rounded-lg border border-meta-divider bg-white p-1.5">
                <Image src="/brasao-tefe-logo.png" alt="Brasão de Tefé" width={146} height={192} className="h-full w-full object-contain" priority />
              </span>
              <div>
                <p className="text-lg font-bold leading-tight">SGCAS</p>
                <p className="text-xs text-meta-slate">Gestão de Casos da Assistência Social</p>
              </div>
            </div>

            <div className="rounded-card border border-meta-divider bg-white p-6 sm:p-8">
              <h2 className="text-2xl">Entrar no SGCAS</h2>
              <p className="mt-2 text-sm leading-6 text-meta-slate">
                Use a sua conta do Tefé Cidadão para acessar o sistema.
              </p>

              {loginError && (
                <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="alert">
                  <p className="font-semibold">{loginError.title}</p>
                  <p className="mt-1 leading-5">{loginError.text}</p>
                </div>
              )}

              <button
                type="button"
                className="button mt-6 w-full justify-between !min-h-12"
                onClick={handleLogin}
                disabled={entering || loading}
              >
                <span className="inline-flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white">
                    <Image src="/tefe-cidadao-mark.svg" alt="" width={20} height={20} className="object-contain" />
                  </span>
                  {entering ? "Abrindo o Tefé Cidadão..." : "Entrar com Tefé Cidadão"}
                </span>
                {entering ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
              </button>

              <p className="mt-5 border-t border-meta-divider pt-4 text-[13px] leading-5 text-meta-slate">
                O SGCAS não tem senha própria. Quem ainda não tem perfil entra na fila de aprovação do administrador.
              </p>
            </div>

            <p className="mt-6 text-center text-xs text-meta-slate">SEDECTI · Prefeitura de Tefé</p>
          </div>
        </section>
      </div>
    </main>
  );
}
