"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, Clock3, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { loginWithTefeCidadao } from "@/lib/api";
import { defaultRouteForRole, useAuth } from "@/lib/auth";

// A tela de entrada usa a paleta do seu desenho (índigo #2c37e2 e os cinzas originais) com
// valores fixos, e não as cores do tema: assim ela não muda quando o tema do sistema mudar.

// Avise quem mantém o servidor: a conta está certa, o defeito é de configuração ou de rede.
const AVISE = "Sua conta não tem problema. Avise quem mantém o servidor e informe o código abaixo.";

const errors: Record<string, { title: string; text: string }> = {
  // Versões anteriores da API mandavam isto para qualquer falha com o Tefé Cidadão.
  "sem-acesso": {
    title: "Não foi possível concluir a entrada",
    text: "O SGCAS não conseguiu confirmar seu acesso com o Tefé Cidadão. Tente de novo; se continuar, avise quem mantém o servidor.",
  },
  "sso-segredo": {
    title: "Servidor com o segredo do Tefé Cidadão errado",
    text: `O Tefé Cidadão recusou as credenciais do SGCAS: o KEYCLOAK_CLIENT_SECRET do servidor não confere com o do client. ${AVISE}`,
  },
  "sso-retorno": {
    title: "Endereço de retorno não confere",
    text: `O endereço de retorno do servidor (KEYCLOAK_REDIRECT_URI) não é o cadastrado no Tefé Cidadão. ${AVISE}`,
  },
  "sso-codigo": {
    title: "Código de acesso recusado",
    text: "O código devolvido pelo Tefé Cidadão venceu ou já foi usado, por exemplo ao voltar ou recarregar a página. Entre outra vez.",
  },
  "sso-recusado": {
    title: "O Tefé Cidadão recusou a conexão do servidor",
    text: `A conexão do servidor do SGCAS com o Tefé Cidadão foi recusada (firewall, proxy ou client desativado). ${AVISE}`,
  },
  "sso-indisponivel": {
    title: "Tefé Cidadão fora de alcance",
    text: "O servidor do SGCAS não conseguiu falar com o Tefé Cidadão: ele está fora do ar ou a rede do servidor está bloqueada. Tente em alguns minutos; se continuar, avise quem mantém o servidor.",
  },
  "sso-chaves": {
    title: "Não foi possível conferir a entrada",
    text: `O servidor do SGCAS não conseguiu baixar as chaves do Tefé Cidadão para conferir o login (rede do servidor até o SSO). ${AVISE}`,
  },
  "sso-relogio": {
    title: "Relógio do servidor errado",
    text: `A entrada foi recusada porque o relógio do servidor do SGCAS está adiantado ou atrasado. ${AVISE}`,
  },
  "sso-emissor": {
    title: "Endereço do Tefé Cidadão diferente do configurado",
    text: `O login veio de um endereço diferente do KEYCLOAK_URL do servidor. ${AVISE}`,
  },
  "sso-audiencia": {
    title: "Login sem a audiência esperada",
    text: "O Tefé Cidadão emitiu o login sem a audiência account que o SGCAS exige. Peça a quem administra o Tefé Cidadão para manter na sua conta os papéis padrão do realm.",
  },
  "sso-token": {
    title: "Login do Tefé Cidadão inválido",
    text: "O servidor do SGCAS recusou o token devolvido pelo Tefé Cidadão. Tente de novo; se continuar, avise quem mantém o servidor e informe o código abaixo.",
  },
  "sso-falha": {
    title: "Não foi possível concluir a entrada",
    text: "Houve uma falha na conversa com o Tefé Cidadão. Tente de novo; se continuar, avise quem mantém o servidor e informe o código abaixo.",
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
        <div className="flex min-h-screen items-center justify-center bg-[#F7F8FA] p-4">
          <Loader2 className="h-8 w-8 animate-spin text-[#2c37e2] motion-reduce:animate-none" role="status" aria-label="Carregando" />
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
    if (!error || !errors[error]) return undefined;
    // O detalhe técnico vem da URL: só aparece no formato que a API gera, para um link
    // forjado não conseguir escrever um texto qualquer dentro da caixa de erro.
    const ref = params.get("ref");
    const detail = ref && /^[A-Za-z0-9_.-]{1,60}$/.test(ref) ? ref : null;
    return { ...errors[error], code: detail ? `${error} · ${detail}` : error };
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
    <main className="min-h-screen bg-[#F7F8FA] text-[#1C2B33]">
      <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative hidden overflow-hidden bg-[#0e1e51] px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between xl:px-16">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(96,165,250,0.26),transparent_28%),radial-gradient(circle_at_84%_72%,rgba(147,197,253,0.18),transparent_30%),linear-gradient(135deg,#0e1e51_0%,#1e2993_60%,#2238ae_100%)]" />
          <div className="absolute inset-x-12 bottom-24 h-px bg-white/10" />

          <div className="relative flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/12 ring-1 ring-white/15">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-lg font-semibold leading-tight">SGCAS</p>
              <p className="text-xs text-white/65">Sistema de Gestão de Casos</p>
            </div>
          </div>

          <div className="relative max-w-xl space-y-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-100/70">
              SGCAS · Tefé
            </p>
            <h1 className="!text-white text-4xl font-medium leading-[1.08] tracking-[-0.01em] [text-wrap:wrap] xl:text-5xl">
              Gestão simples para cada atendimento.
            </h1>
            <p className="max-w-md text-sm leading-6 text-white/72 [text-wrap:wrap]">
              Recepção, fila e acompanhamentos em um fluxo único, seguro e organizado por perfil.
            </p>
          </div>

          <div className="relative grid max-w-2xl grid-cols-3 gap-2.5">
            {[
              ["Entrar com SSO", LockKeyhole],
              ["Aprovação do admin", CheckCircle2],
              ["Recepção e fila", Clock3],
            ].map(([label, Icon]) => (
              <div key={label as string} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.07] px-3 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10">
                  <Icon className="h-4 w-4 text-blue-100" aria-hidden="true" />
                </span>
                <p className="text-xs font-semibold text-white/88">{label as string}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="flex items-center justify-center px-5 py-8 sm:px-8">
          <div className="w-full max-w-[430px]">
            <div className="mb-10 flex items-center gap-3 lg:hidden">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#2c37e2] text-white">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-lg font-semibold leading-tight">SGCAS</p>
                <p className="text-xs text-[#5D6C7B]">Sistema de Gestão de Casos</p>
              </div>
            </div>

            <div className="rounded-lg border border-[#DEE3E9] bg-white p-6 shadow-[0_24px_60px_-38px_rgba(30,38,160,0.34)] sm:p-8">
              <div className="mb-8 space-y-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-[#2c37e2]/10 text-[#2c37e2]">
                  <ShieldCheck className="h-7 w-7" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-3xl font-medium leading-tight tracking-[-0.01em] text-[#1C2B33]">Entrar no SGCAS</h2>
                  <p className="mt-2 text-sm leading-6 text-[#5D6C7B] [text-wrap:wrap]">
                    Use sua conta institucional do Tefé Cidadão para acessar o sistema.
                  </p>
                </div>
              </div>

              {loginError && (
                <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="alert">
                  <p className="font-medium">{loginError.title}</p>
                  <p className="mt-1 leading-5 text-amber-900/80">{loginError.text}</p>
                  <p className="mt-2 break-all font-mono text-xs text-amber-900/70">Código: {loginError.code}</p>
                </div>
              )}

              <button
                type="button"
                className="inline-flex h-12 w-full items-center justify-between whitespace-nowrap rounded-full bg-[#2c37e2] px-4 text-sm font-semibold tracking-tight text-white shadow-[0_16px_32px_-22px_rgba(30,38,170,0.9)] transition-all duration-200 hover:bg-[#2430c4] active:scale-[0.97] disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-[#DEE3E9] disabled:text-[#5D6C7B]/60 motion-reduce:transition-none motion-reduce:active:scale-100"
                onClick={handleLogin}
                disabled={entering || loading}
              >
                <span className="inline-flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white">
                    <Image src="/tefe-cidadao-mark.svg" alt="" width={20} height={20} className="object-contain" />
                  </span>
                  {entering ? "Abrindo Tefé Cidadão..." : "Entrar com Tefé Cidadão"}
                </span>
                {entering ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
              </button>

              <div className="mt-6 rounded-lg bg-[#F1F4F7] px-4 py-3 text-xs leading-5 text-[#5D6C7B]">
                O SGCAS não usa senha própria. Quem ainda não tem perfil entra na fila de aprovação do administrador.
              </div>
            </div>

            <p className="mt-6 text-center text-xs text-[#5D6C7B]">SEDECTI · Prefeitura de Tefé</p>
          </div>
        </section>
      </div>
    </main>
  );
}
