"use client";

import { FileText } from "lucide-react";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button, Card, Field, Input, PageHeader, SecondaryButton } from "@/components/ui";
import { TermoLGPD } from "@/components/shared/termo-lgpd";
import { api } from "@/lib/api";
import type { Cidadao } from "@/types/sgcas";

export default function NovoCidadaoPage() {
  const router = useRouter();
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [mostrarTermo, setMostrarTermo] = useState(false);
  const [termoLido, setTermoLido] = useState(false);
  const [criarAcesso, setCriarAcesso] = useState(true);

  async function salvar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErro("");
    setSalvando(true);

    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());

    try {
      const cidadao = await api<Cidadao>("/citizens/novo", {
        method: "POST",
        body: JSON.stringify({
          ...body,
          consentimento: termoLido,
          criar_acesso_tefe_cidadao: criarAcesso,
        }),
      });
      router.replace(`/cidadaos/${cidadao.id}`);
    } catch {
      setErro("Nao foi possivel salvar. Confira os dados e o consentimento.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <AppShell>
      <PageHeader title="Novo cidadão" description="Cadastro completo pode ser refinado depois no atendimento." />

      <Card>
        <form className="grid two" onSubmit={salvar}>
          <Field label="Nome">
            <Input name="nome" required />
          </Field>
          <Field label="E-mail">
            <Input name="email" type="email" required />
          </Field>
          <Field label="CPF">
            <Input name="cpf" />
          </Field>
          <Field label="NIS">
            <Input name="nis" />
          </Field>
          <Field label="Telefone">
            <Input name="telefone" />
          </Field>
          <Field label="Nascimento">
            <Input name="nascimento" type="date" />
          </Field>
          <Field label="Bairro">
            <Input name="bairro" />
          </Field>
          <Field label="Cidade">
            <Input name="cidade" defaultValue="Tefe" />
          </Field>
          <Field label="UF">
            <Input name="uf" defaultValue="AM" />
          </Field>
          <Field label="Endereco">
            <Input name="endereco" />
          </Field>

          <div className="col-span-full grid gap-3 rounded-lg bg-meta-soft-gray p-4">
            <h4 className="text-sm font-semibold text-meta-near-black">Termos de Uso e Privacidade (LGPD)</h4>

            <button
              type="button"
              onClick={() => setMostrarTermo(true)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              <FileText size={14} />
              Ler termo completo
            </button>

            <label className="row text-sm text-meta-charcoal">
              <input
                type="checkbox"
                checked={criarAcesso}
                onChange={(e) => setCriarAcesso(e.target.checked)}
              />
              Criar acesso no Tefé Cidadão
            </label>

            <label className="row text-sm text-meta-charcoal">
              <input
                type="checkbox"
                checked={termoLido}
                onChange={(e) => setTermoLido(e.target.checked)}
              />
              Confirmo que li o termo acima para o cidadão e este consente
            </label>

            {criarAcesso && !termoLido && (
              <p className="text-xs text-amber-600">
                Para criar acesso, confirme que o termo foi lido para o cidadão
              </p>
            )}
          </div>

          {erro && <div className="notice">{erro}</div>}
          <div>
            <Button disabled={salvando || (criarAcesso && !termoLido)}>
              {salvando ? "Salvando..." : "Salvar cadastro"}
            </Button>
          </div>
        </form>
      </Card>

      <Dialog open={mostrarTermo} onOpenChange={setMostrarTermo}>
        <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Termo de Consentimento LGPD</DialogTitle>
            <DialogDescription>
              Leia atentamente antes de prosseguir com o cadastro.
            </DialogDescription>
          </DialogHeader>

          <TermoLGPD />

          <DialogFooter>
            <SecondaryButton onClick={() => setMostrarTermo(false)}>
              Fechar
            </SecondaryButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
