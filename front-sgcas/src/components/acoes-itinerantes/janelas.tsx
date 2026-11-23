"use client";

import type { FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button, DadosEmLista, Field, Input, SecondaryButton, Stat } from "@/components/ui";
import { formatarDataCompleta } from "@/components/acoes-itinerantes/listas";
import type { AcaoItinerante, BalancoAcaoItinerante } from "@/types/sgcas";

/** Os números que a ação declara ao ser concluída, como digitados. */
export type ResultadosDaAcao = { cidadaos: string; participantes: string; beneficios: string; casos: string };
export const RESULTADOS_VAZIOS: ResultadosDaAcao = { cidadaos: "", participantes: "", beneficios: "", casos: "" };

export function JanelaNovaAcao({
  aberta,
  onAbertaChange,
  erro,
  salvando,
  onSalvar,
}: {
  aberta: boolean;
  onAbertaChange: (aberta: boolean) => void;
  erro: string;
  salvando: boolean;
  onSalvar: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={aberta} onOpenChange={onAbertaChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova ação itinerante</DialogTitle>
          <DialogDescription>
            Registre uma ação fora da sede. O responsável e a unidade são preenchidos automaticamente.
          </DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={onSalvar}>
          <Field label="Título">
            <Input name="titulo" placeholder="Ex.: Mutirão Caiambé" required />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Local">
              <Input name="local" placeholder="Ex.: Comunidade Caiambé" required />
            </Field>
            <Field label="Data e hora">
              <Input name="data" type="datetime-local" required />
            </Field>
          </div>

          <Field label="Descrição (opcional)">
            <Input name="descricao" placeholder="Objetivo da ação" />
          </Field>

          <Field label="Observações (opcional)">
            <Input name="observacoes" placeholder="Informações adicionais" />
          </Field>

          {erro && <div className="notice" role="alert">{erro}</div>}

          <DialogFooter>
            <SecondaryButton type="button" onClick={() => onAbertaChange(false)} disabled={salvando}>
              Cancelar
            </SecondaryButton>
            <Button disabled={salvando}>{salvando ? "Salvando..." : "Salvar ação"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function JanelaConcluirAcao({
  aberta,
  onAbertaChange,
  acao,
  resultados,
  onResultados,
  erro,
  salvando,
  onConcluir,
}: {
  aberta: boolean;
  onAbertaChange: (aberta: boolean) => void;
  acao: AcaoItinerante | null;
  resultados: ResultadosDaAcao;
  onResultados: (resultados: ResultadosDaAcao) => void;
  erro: string;
  salvando: boolean;
  onConcluir: () => void;
}) {
  function mudar(campo: keyof ResultadosDaAcao, valor: string) {
    onResultados({ ...resultados, [campo]: valor });
  }

  return (
    <Dialog open={aberta} onOpenChange={onAbertaChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Concluir ação</DialogTitle>
          <DialogDescription>
            Registre os resultados da ação <strong>{acao?.titulo}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Field label="Cidadãos atendidos">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="Quantas pessoas foram atendidas?"
              value={resultados.cidadaos}
              onChange={(e) => mudar("cidadaos", e.target.value)}
              required
            />
          </Field>

          <Field label="Participantes" hint="Servidores públicos que integraram esta ação.">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={resultados.participantes}
              onChange={(e) => mudar("participantes", e.target.value)}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Benefícios concedidos">
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={resultados.beneficios}
                onChange={(e) => mudar("beneficios", e.target.value)}
              />
            </Field>

            <Field label="Casos abertos">
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={resultados.casos}
                onChange={(e) => mudar("casos", e.target.value)}
              />
            </Field>
          </div>

          {erro && <div className="notice" role="alert">{erro}</div>}

          <DialogFooter>
            <SecondaryButton type="button" onClick={() => onAbertaChange(false)} disabled={salvando}>
              Cancelar
            </SecondaryButton>
            <Button type="button" disabled={salvando || !resultados.cidadaos} onClick={onConcluir}>
              {salvando ? "Salvando..." : "Concluir ação"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function JanelaBalanco({
  aberta,
  onAbertaChange,
  carregando,
  balanco,
}: {
  aberta: boolean;
  onAbertaChange: (aberta: boolean) => void;
  carregando: boolean;
  balanco: BalancoAcaoItinerante | null;
}) {
  return (
    <Dialog open={aberta} onOpenChange={onAbertaChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Balanço da ação</DialogTitle>
          <DialogDescription>
            {balanco ? `${balanco.titulo} — ${balanco.local}` : "Resultados registrados ao concluir a ação."}
          </DialogDescription>
        </DialogHeader>

        {carregando && <p className="text-sm text-meta-slate" role="status">Carregando...</p>}

        {!carregando && !balanco && (
          <div className="notice" role="alert">Não foi possível carregar o balanço desta ação.</div>
        )}

        {balanco && !carregando && (
          <div className="grid gap-5">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Cidadãos atendidos" vertical value={balanco.balanco.cidadaos_atendidos} />
              <Stat label="Participantes" vertical value={balanco.balanco.participantes} />
              <Stat label="Benefícios" vertical value={balanco.balanco.beneficios_concedidos} />
              <Stat label="Casos abertos" vertical value={balanco.balanco.casos_abertos} />
            </div>

            <DadosEmLista
              itens={[
                { rotulo: "Data", valor: formatarDataCompleta(balanco.data) },
                { rotulo: "Responsável", valor: balanco.responsavel_nome },
                { rotulo: "Unidade", valor: balanco.unidade_nome },
                ...(balanco.descricao ? [{ rotulo: "Descrição", valor: balanco.descricao }] : []),
                ...(balanco.observacoes ? [{ rotulo: "Observações", valor: balanco.observacoes }] : []),
              ]}
            />
          </div>
        )}

        <DialogFooter>
          <SecondaryButton type="button" onClick={() => onAbertaChange(false)}>
            Fechar
          </SecondaryButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
