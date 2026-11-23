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
import { Button, Field, Input, SecondaryButton, Select } from "@/components/ui";
import { CamposDeClassificacao, type Classificacao } from "@/components/institucional/classificacao";
import { TIPOS_DE_UNIDADE } from "@/components/institucional/tabelas";
import type { Coordenacao, Demanda, Servico, Unidade } from "@/types/sgcas";

export function JanelaNovaUnidade({
  aberta,
  onAbertaChange,
  coordenacoes,
  erro,
  salvando,
  onSalvar,
}: {
  aberta: boolean;
  onAbertaChange: (aberta: boolean) => void;
  coordenacoes: Coordenacao[];
  erro: string;
  salvando: boolean;
  onSalvar: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={aberta} onOpenChange={onAbertaChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova unidade</DialogTitle>
          <DialogDescription>Cadastre uma unidade da rede para receber operadores, serviços e atendimentos.</DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={onSalvar}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nome">
              <Input name="nome" placeholder="CRAS Centro" required />
            </Field>
            <Field label="Sigla">
              <Input name="sigla" placeholder="CRAS-CENTRO" required />
            </Field>
            <Field label="Tipo">
              <Select name="tipo" defaultValue="CRAS" required>
                {TIPOS_DE_UNIDADE.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            </Field>
            {coordenacoes.length > 0 ? (
              <Field label="Coordenação (opcional)">
                <Select name="coordenacao_id">
                  <option value="">Sem coordenação</option>
                  {coordenacoes.map((coordenacao) => (
                    <option key={coordenacao.id} value={coordenacao.id}>{coordenacao.nome}</option>
                  ))}
                </Select>
              </Field>
            ) : (
              <input name="coordenacao_id" type="hidden" value="" />
            )}
            <Field label="Telefone">
              <Input name="telefone" placeholder="(92) 99999-9999" />
            </Field>
            <Field label="Endereço">
              <Input name="endereco" />
            </Field>
          </div>

          {coordenacoes.length === 0 && (
            <div className="rounded-lg bg-meta-soft-gray px-4 py-3 text-sm leading-6 text-meta-slate">
              Coordenação é opcional. Como não há coordenações cadastradas, a unidade será criada sem vínculo.
            </div>
          )}

          {erro && <div className="notice" role="alert">{erro}</div>}

          <DialogFooter>
            <SecondaryButton type="button" onClick={() => onAbertaChange(false)} disabled={salvando}>
              Cancelar
            </SecondaryButton>
            <Button disabled={salvando}>{salvando ? "Salvando..." : "Cadastrar unidade"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function JanelaNovoServico({
  aberta,
  onAbertaChange,
  unidades,
  demandas,
  classificacao,
  onClassificacao,
  erro,
  salvando,
  onSalvar,
}: {
  aberta: boolean;
  onAbertaChange: (aberta: boolean) => void;
  unidades: Unidade[];
  demandas: Demanda[];
  classificacao: Classificacao;
  onClassificacao: (classificacao: Classificacao) => void;
  erro: string;
  salvando: boolean;
  onSalvar: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={aberta} onOpenChange={onAbertaChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo serviço</DialogTitle>
          <DialogDescription>Cadastre um serviço ofertado por uma unidade. Ele aparecerá na recepção.</DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={onSalvar}>
          <Field label="Nome do serviço">
            <Input name="nome" placeholder="Ex.: Cesta básica" required />
          </Field>
          <Field label="Unidade">
            <Select name="unidade_id" required>
              <option value="">Selecione</option>
              {unidades.map((unidade) => (
                <option key={unidade.id} value={unidade.id}>{unidade.nome}</option>
              ))}
            </Select>
          </Field>
          <CamposDeClassificacao demandas={demandas} valor={classificacao} onChange={onClassificacao} />
          <Field label="Descrição">
            <textarea className="input" name="descricao" placeholder="Descrição curta do serviço" />
          </Field>

          {erro && <div className="notice" role="alert">{erro}</div>}

          <DialogFooter>
            <SecondaryButton type="button" onClick={() => onAbertaChange(false)} disabled={salvando}>
              Cancelar
            </SecondaryButton>
            <Button disabled={salvando}>{salvando ? "Salvando..." : "Cadastrar serviço"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function JanelaClassificar({
  servico,
  onFechar,
  demandas,
  valor,
  onChange,
  erro,
  salvando,
  onSalvar,
}: {
  /** O serviço sendo classificado; `null` com a janela fechada. */
  servico: Servico | null;
  onFechar: () => void;
  demandas: Demanda[];
  valor: Classificacao;
  onChange: (classificacao: Classificacao) => void;
  erro: string;
  salvando: boolean;
  onSalvar: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={servico !== null} onOpenChange={(aberto) => { if (!aberto) onFechar(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Classificar serviço</DialogTitle>
          <DialogDescription>
            {servico ? `${servico.nome} — ${servico.unidade_nome}. ` : ""}
            A categoria liga o serviço ao controle de repetição de auxílio.
          </DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={onSalvar}>
          {erro && <div className="notice" role="alert">{erro}</div>}
          <CamposDeClassificacao demandas={demandas} valor={valor} onChange={onChange} />

          <DialogFooter>
            <SecondaryButton type="button" onClick={onFechar} disabled={salvando}>
              Cancelar
            </SecondaryButton>
            <Button disabled={salvando}>{salvando ? "Salvando..." : "Salvar classificação"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
