"use client";

import { RefreshCw } from "lucide-react";
import { Badge, Card, EmptyState, SecondaryButton, SectionHeading } from "@/components/ui";
import { rotuloPrioridade, rotuloSituacao, tomDaPrioridade, tomDoCaso } from "@/lib/casos";
import { formatarDataCurta } from "@/lib/datas";
import type { Caso, Senha } from "@/types/sgcas";

/** Quem aguarda na unidade, na ordem em que será chamado. */
export function FilaDaUnidade({
  fila,
  unidadeNome,
  podeAtualizar,
  onAtualizar,
}: {
  fila: Senha[];
  unidadeNome?: string;
  podeAtualizar: boolean;
  onAtualizar: () => void;
}) {
  return (
    <Card>
      <SectionHeading
        title="Fila"
        count={fila.length}
        action={
          <SecondaryButton size="sm" onClick={onAtualizar} disabled={!podeAtualizar}>
            <RefreshCw size={14} aria-hidden="true" />
            Atualizar fila
          </SecondaryButton>
        }
      />
      {unidadeNome && <p className="-mt-1 mb-3 text-sm text-meta-slate">{unidadeNome}</p>}
      {fila.length === 0 ? (
        <EmptyState title="Fila vazia" text="A recepção ainda não encaminhou atendimentos." />
      ) : (
        <ul>
          {fila.map((senha) => (
            <li className="line-row flex flex-wrap items-center gap-x-3 gap-y-2" key={senha.id}>
              <span className="flex h-10 min-w-14 shrink-0 items-center justify-center rounded-lg bg-primary px-2.5 text-[15px] font-bold tabular-nums text-primary-foreground">
                {senha.senha}
              </span>
              <span className="min-w-0 flex-1 basis-40">
                <span className="block text-sm font-semibold text-meta-charcoal">{senha.cidadao_nome}</span>
                <small className="block">{senha.servico}</small>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={tomDaPrioridade(senha.prioridade)}>{rotuloPrioridade(senha.prioridade)}</Badge>
                <small className="tabular-nums">{formatarDataCurta(senha.criado_em)}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Os casos mais recentes assumidos pelo atendente. */
export function UltimosAtendimentos({ casos }: { casos: Caso[] }) {
  return (
    <Card className="mt-4">
      <SectionHeading title="Últimos atendimentos" count={casos.length} />
      <p className="-mt-1 mb-3 text-sm text-meta-slate">Casos mais recentes assumidos por você.</p>

      {!casos.length ? (
        <EmptyState title="Sem atendimentos recentes" text="Quando você iniciar ou concluir casos, eles aparecem aqui." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {casos.map((caso) => (
            <article className="rounded-lg border border-meta-divider bg-white p-4" key={caso.id}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <strong className="text-meta-charcoal">{caso.cidadao_nome}</strong>
                <Badge tone={tomDoCaso(caso.situacao)}>{rotuloSituacao(caso.situacao)}</Badge>
              </div>
              <p className="text-sm font-medium text-meta-charcoal">{caso.servico_nome || caso.protocolo}</p>
              <p className="mt-1 line-clamp-3 text-sm leading-6 text-meta-slate">{caso.descricao || "Sem relato registrado."}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone={tomDaPrioridade(caso.prioridade)}>{rotuloPrioridade(caso.prioridade)}</Badge>
                <small className="tabular-nums">{formatarDataCurta(caso.aberto_em)}</small>
              </div>
            </article>
          ))}
        </div>
      )}
    </Card>
  );
}
