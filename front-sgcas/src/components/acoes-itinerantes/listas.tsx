"use client";

import { CalendarDays, CheckCircle, FileText, Trash2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, SecondaryButton, SectionHeading, Select } from "@/components/ui";
import { formatarData } from "@/lib/datas";
import type { AcaoItinerante } from "@/types/sgcas";

export type Ordenacao = "mais-proximas" | "mais-recentes";

export function formatarDataCompleta(data: string) {
  return new Date(data).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** As três próximas ações agendadas e ainda não concluídas. */
export function ProximasAcoes({ acoes }: { acoes: AcaoItinerante[] }) {
  if (acoes.length === 0) return null;
  return (
    <Card className="mt-4">
      <SectionHeading icon={CalendarDays} title="Próximas ações" count={acoes.length} />
      <ul>
        {acoes.slice(0, 3).map((acao, indice) => (
          <li key={acao.id} className="line-row">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <strong>{acao.titulo}</strong>
              {indice === 0 && <Badge tone="info">Próxima</Badge>}
            </div>
            <small className="mt-0.5 block">
              {formatarDataCompleta(acao.data)} · {acao.local}
            </small>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Todas as ações, com a situação de cada uma e o que dá para fazer com ela. */
export function HistoricoDeAcoes({
  acoes,
  carregando,
  ordenacao,
  onOrdenacao,
  agora,
  onBalanco,
  onConcluir,
  onExcluir,
}: {
  /** Já na ordem escolhida. */
  acoes: AcaoItinerante[];
  carregando: boolean;
  ordenacao: Ordenacao;
  onOrdenacao: (ordenacao: Ordenacao) => void;
  agora: Date;
  onBalanco: (acao: AcaoItinerante) => void;
  onConcluir: (acao: AcaoItinerante) => void;
  onExcluir: (acao: AcaoItinerante) => void;
}) {
  return (
    <Card className="mt-4">
      <SectionHeading
        title="Histórico de ações"
        count={acoes.length}
        action={
          acoes.length > 1 ? (
            <label className="flex items-center gap-2 text-sm text-meta-slate">
              <span className="max-sm:sr-only">Ordem</span>
              <Select className="!w-auto" value={ordenacao} onChange={(e) => onOrdenacao(e.target.value as Ordenacao)}>
                <option value="mais-proximas">Mais próximas primeiro</option>
                <option value="mais-recentes">Mais recentes primeiro</option>
              </Select>
            </label>
          ) : undefined
        }
      />

      {carregando && <p className="text-sm text-meta-slate" role="status">Carregando...</p>}

      {!carregando && acoes.length === 0 && (
        <EmptyState title="Nenhuma ação cadastrada" text="Use “Nova ação” para cadastrar a primeira ação itinerante." />
      )}

      {!carregando && acoes.length > 0 && (
        <div className="table-wrap">
          <table className="table table-stack-lg">
            <thead>
              <tr>
                <th>Título</th>
                <th>Local</th>
                <th>Data</th>
                <th>Responsável</th>
                <th>Unidade</th>
                <th>Situação</th>
                <th><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {acoes.map((acao) => (
                <tr key={acao.id}>
                  <td data-label="Título">
                    <strong>{acao.titulo}</strong>
                  </td>
                  <td data-label="Local">{acao.local}</td>
                  <td data-label="Data" className="lg:whitespace-nowrap">{formatarData(acao.data)}</td>
                  <td data-label="Responsável">{acao.responsavel_nome}</td>
                  <td data-label="Unidade">{acao.unidade_nome}</td>
                  <td data-label="Situação">
                    {acao.concluida ? (
                      <Badge tone="good">Concluída</Badge>
                    ) : new Date(acao.data) < agora ? (
                      <Badge tone="warn">Em andamento</Badge>
                    ) : (
                      <Badge tone="info">Agendada</Badge>
                    )}
                  </td>
                  <td className="lg:w-px lg:whitespace-nowrap">
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      {acao.concluida ? (
                        <SecondaryButton type="button" size="sm" onClick={() => onBalanco(acao)}>
                          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                          Balanço
                        </SecondaryButton>
                      ) : (
                        <Button type="button" size="sm" onClick={() => onConcluir(acao)}>
                          <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
                          Concluir
                        </Button>
                      )}
                      <SecondaryButton
                        type="button"
                        size="sm"
                        className="!px-2.5 text-red-700 hover:!bg-red-50"
                        onClick={() => onExcluir(acao)}
                        aria-label={`Excluir a ação ${acao.titulo}`}
                        title="Excluir"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </SecondaryButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
