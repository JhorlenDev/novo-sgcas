"use client";

import { FormEvent, useState } from "react";
import { FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button, Field, Input, SecondaryButton } from "@/components/ui";
import { TermoLGPD } from "@/components/shared/termo-lgpd";
import { api } from "@/lib/api";
import type { Cidadao } from "@/types/sgcas";

function RodapeDaPagina({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col-reverse gap-2 border-t border-meta-divider pt-4 sm:flex-row sm:justify-end">{children}</div>;
}

/**
 * O cadastro de um cidadão, com o termo de consentimento (LGPD).
 *
 * É um só para a janela de "Novo cadastro" e para a página `/cidadaos/novo`: as duas
 * pedem os mesmos dados e a mesma confirmação do termo, e duas cópias divergem na
 * primeira mudança de regra.
 */
export function FormularioDeCadastro({
  onSalvo,
  onCancelar,
  naPagina = false,
}: {
  onSalvo: (cidadao: Cidadao) => void;
  onCancelar?: () => void;
  /** Fora de uma janela os botões ficam numa linha comum; dentro dela, na barra fixa da janela. */
  naPagina?: boolean;
}) {
  const Rodape = naPagina ? RodapeDaPagina : DialogFooter;
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [mostrarTermo, setMostrarTermo] = useState(false);
  const [termoLido, setTermoLido] = useState(false);
  const [criarAcesso, setCriarAcesso] = useState(true);

  async function salvar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErro("");
    setSalvando(true);

    const corpo = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const cidadao = await api<Cidadao>("/citizens/novo", {
        method: "POST",
        body: JSON.stringify({ ...corpo, consentimento: termoLido, criar_acesso_tefe_cidadao: criarAcesso }),
      });
      onSalvo(cidadao);
    } catch {
      setErro("Não foi possível salvar. Confira os dados e o consentimento.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <form className="grid gap-4" onSubmit={salvar}>
        <Field label="Nome">
          <Input name="nome" placeholder="Nome e sobrenome" autoComplete="off" required />
        </Field>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="E-mail">
            <Input name="email" type="email" placeholder="cidadao@email.com" autoComplete="off" required />
          </Field>
          <Field label="CPF">
            <Input name="cpf" placeholder="000.000.000-00" inputMode="numeric" autoComplete="off" />
          </Field>
          <Field label="NIS">
            <Input name="nis" inputMode="numeric" autoComplete="off" />
          </Field>
          <Field label="Telefone">
            <Input name="telefone" type="tel" placeholder="(92) 99999-9999" autoComplete="off" />
          </Field>
          <Field label="Data de nascimento">
            <Input name="nascimento" type="date" />
          </Field>
          <Field label="Bairro">
            <Input name="bairro" autoComplete="off" />
          </Field>
          <Field label="Cidade">
            <Input name="cidade" defaultValue="Tefé" />
          </Field>
          <Field label="UF">
            <Input name="uf" defaultValue="AM" maxLength={2} />
          </Field>
        </div>

        <Field label="Endereço">
          <Input name="endereco" autoComplete="off" />
        </Field>

        <fieldset className="grid gap-3 rounded-lg border border-meta-divider bg-meta-warm-gray p-4">
          <legend className="px-1 text-sm font-semibold text-meta-charcoal">Termos de uso e privacidade (LGPD)</legend>

          <button
            type="button"
            onClick={() => setMostrarTermo(true)}
            className="inline-flex min-h-10 w-fit items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
          >
            <FileText size={14} aria-hidden="true" />
            Ler o termo completo
          </button>

          <label className="flex items-start gap-2.5 text-sm text-meta-charcoal">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              checked={criarAcesso}
              onChange={(e) => setCriarAcesso(e.target.checked)}
            />
            Criar acesso no Tefé Cidadão
          </label>

          <label className="flex items-start gap-2.5 text-sm text-meta-charcoal">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              checked={termoLido}
              onChange={(e) => setTermoLido(e.target.checked)}
            />
            Confirmo que li o termo acima para o cidadão e que ele consente
          </label>

          {criarAcesso && !termoLido && (
            <p className="text-xs font-medium text-amber-800">
              Para criar o acesso, confirme que o termo foi lido para o cidadão.
            </p>
          )}
        </fieldset>

        {erro && (
          <div className="notice" role="alert">
            {erro}
          </div>
        )}

        <Rodape>
          {onCancelar && (
            <SecondaryButton type="button" onClick={onCancelar} disabled={salvando}>
              Cancelar
            </SecondaryButton>
          )}
          <Button disabled={salvando || (criarAcesso && !termoLido)}>{salvando ? "Salvando..." : "Salvar cadastro"}</Button>
        </Rodape>
      </form>

      <Dialog open={mostrarTermo} onOpenChange={setMostrarTermo}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Termo de Consentimento LGPD</DialogTitle>
            <DialogDescription>Leia com atenção antes de prosseguir com o cadastro.</DialogDescription>
          </DialogHeader>

          <TermoLGPD />

          <DialogFooter>
            <SecondaryButton type="button" onClick={() => setMostrarTermo(false)}>
              Fechar
            </SecondaryButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
