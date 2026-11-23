"use client";

import Link from "next/link";
import { ArrowLeftRight, ArrowRight, IdCard, MapPin, Search, UserPlus, UserRoundCheck } from "lucide-react";
import { Card, Input, SecondaryButton } from "@/components/ui";
import { formatCPF } from "@/lib/utils";
import type { CidadaoLista } from "@/types/sgcas";

/** "Quem você vai atender?": a busca, os resultados e o cidadão escolhido. */
export function BuscaDeCidadao({
  busca,
  onBusca,
  resultados,
  cidadao,
  onSelecionar,
  onTrocar,
}: {
  busca: string;
  onBusca: (termo: string) => void;
  resultados: CidadaoLista[];
  cidadao: CidadaoLista | null;
  onSelecionar: (cidadao: CidadaoLista) => void;
  onTrocar: () => void;
}) {
  return (
    <Card>
      <h2 className="!mb-1">Quem você vai atender?</h2>
      <p className="mb-4 text-sm text-meta-slate">Primeiro, encontre o cidadão. Depois, confira o histórico e escolha como registrar a recepção.</p>
      <label htmlFor="busca-cidadao-recepcao" className="mb-1.5 block text-[13px] font-semibold text-meta-charcoal">Buscar por nome, CPF, NIS ou e-mail</label>
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-meta-slate" aria-hidden="true" />
        <Input
          id="busca-cidadao-recepcao"
          className="pl-10"
          value={busca}
          onChange={(event) => onBusca(event.target.value)}
          placeholder="Nome, CPF, NIS ou e-mail"
          autoComplete="off"
        />
      </div>

      {!cidadao && busca.trim().length < 2 && (
        <p className="mb-4 text-sm text-meta-slate">Digite pelo menos 2 caracteres e selecione o cidadão nos resultados.</p>
      )}

      {!cidadao && resultados.length > 0 && (
        <ul className="grid gap-2.5">
          {resultados.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="group flex w-full flex-col gap-2 rounded-lg border border-meta-divider bg-white p-3.5 text-left transition-colors hover:border-primary/40 hover:bg-meta-warm-gray sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                onClick={() => onSelecionar(item)}
                aria-label={`Selecionar ${item.nome}`}
              >
                <span className="min-w-0">
                  <strong className="block text-[15px] font-semibold text-meta-charcoal">{item.nome}</strong>
                  <DadosCidadao cidadao={item} />
                </span>
                <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-primary">
                  Selecionar <ArrowRight size={16} aria-hidden="true" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!cidadao && (
        <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-meta-divider pt-4 text-sm text-meta-slate">
          Não encontrou o cidadão?
          <Link href="/cidadaos/novo" className="inline-flex min-h-10 items-center gap-1.5 font-semibold text-primary underline-offset-4 hover:underline">
            <UserPlus size={16} aria-hidden="true" /> Cadastrar cidadão
          </Link>
        </p>
      )}

      {cidadao && <CidadaoSelecionado cidadao={cidadao} onTrocar={onTrocar} />}
    </Card>
  );
}

function DadosCidadao({ cidadao }: { cidadao: CidadaoLista }) {
  const local = [cidadao.bairro, cidadao.cidade].filter(Boolean).join(" · ");
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-meta-slate">
      <span className="inline-flex items-center gap-1.5 tabular-nums">
        <IdCard size={14} className="shrink-0" aria-hidden="true" />
        {cidadao.cpf ? `CPF ${formatCPF(cidadao.cpf)}` : "CPF não informado"}
      </span>
      {local && <span className="inline-flex items-center gap-1.5"><MapPin size={14} className="shrink-0" aria-hidden="true" />{local}</span>}
    </span>
  );
}

function CidadaoSelecionado({ cidadao, onTrocar }: { cidadao: CidadaoLista; onTrocar: () => void }) {
  return (
    <div className="rounded-lg border border-primary/30 bg-accent p-3.5 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-primary">
            <UserRoundCheck size={15} aria-hidden="true" />
            Cidadão selecionado
          </p>
          <h3 className="mt-0.5 text-base font-semibold text-meta-charcoal">{cidadao.nome}</h3>
          <DadosCidadao cidadao={cidadao} />
        </div>
        <SecondaryButton type="button" size="sm" className="shrink-0 self-start sm:self-center" onClick={onTrocar}>
          <ArrowLeftRight size={14} aria-hidden="true" />
          Trocar cidadão
        </SecondaryButton>
      </div>
    </div>
  );
}
