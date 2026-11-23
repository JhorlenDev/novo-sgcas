"use client";

import { Search } from "lucide-react";
import { Badge, Card, EmptyState, Field, Input, SecondaryButton, SectionHeading, Select } from "@/components/ui";
import { CATEGORIA_DE_BENEFICIO } from "@/lib/auxilios";
import type { Servico, Unidade } from "@/types/sgcas";

export const TIPOS_DE_UNIDADE = [
  ["CRAS", "CRAS"],
  ["CREAS", "CREAS"],
  ["CENTRO_POP", "Centro POP"],
  ["ABRIGO", "Acolhimento institucional"],
  ["SEDE", "Sede"],
  ["OUTRO", "Outro"],
] as const;

// Existe para lotar os devs (SEDECTI), criada pelo catálogo: não é opção ao cadastrar unidade nova.
const TIPO_MANUTENCAO = "MANUTENCAO";

function rotuloDoTipoDeUnidade(tipo?: string | null) {
  if (tipo === TIPO_MANUTENCAO) return "Manutenção do sistema";
  return TIPOS_DE_UNIDADE.find(([valor]) => valor === tipo)?.[1] ?? tipo ?? "—";
}

export function TabelaDeUnidades({ unidades }: { unidades: Unidade[] }) {
  return (
    <Card>
      <SectionHeading title="Unidades" count={unidades.length} />

      {unidades.length === 0 ? (
        <EmptyState title="Nenhuma unidade" text="Cadastre a primeira unidade para vincular serviços e operadores." />
      ) : (
        <div className="table-wrap">
          <table className="table table-stack">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Tipo</th>
                <th>Sigla</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {unidades.map((unidade) => (
                <tr key={unidade.id}>
                  <td data-label="Nome">
                    <strong>{unidade.nome}</strong>
                    {unidade.coordenacao && <small className="block text-meta-slate">{unidade.coordenacao}</small>}
                  </td>
                  <td data-label="Tipo">{rotuloDoTipoDeUnidade(unidade.tipo)}</td>
                  <td data-label="Sigla">{unidade.sigla ?? "—"}</td>
                  <td data-label="Situação">
                    <Badge tone={unidade.ativa === false ? "bad" : "good"}>
                      {unidade.ativa === false ? "Inativa" : "Ativa"}
                    </Badge>
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

/** Os serviços da rede, com filtro por unidade e por nome (são dezenas). */
export function TabelaDeServicos({
  servicos,
  visiveis,
  unidades,
  filtroDeUnidade,
  onFiltroDeUnidade,
  busca,
  onBusca,
  podeClassificar,
  onClassificar,
}: {
  servicos: Servico[];
  visiveis: Servico[];
  unidades: Unidade[];
  filtroDeUnidade: string;
  onFiltroDeUnidade: (unidadeId: string) => void;
  busca: string;
  onBusca: (termo: string) => void;
  podeClassificar: (servico: Servico) => boolean;
  onClassificar: (servico: Servico) => void;
}) {
  return (
    <Card>
      <SectionHeading
        title="Serviços"
        count={visiveis.length === servicos.length ? `${servicos.length} ativos` : `${visiveis.length} de ${servicos.length}`}
      />

      {servicos.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
          <Field label="Unidade">
            <Select value={filtroDeUnidade} onChange={(event) => onFiltroDeUnidade(event.target.value)}>
              <option value="">Todas as unidades</option>
              {unidades.map((unidade) => (
                <option key={unidade.id} value={unidade.id}>{unidade.nome}</option>
              ))}
            </Select>
          </Field>
          <Field label="Buscar serviço">
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-meta-slate" aria-hidden="true" />
              <Input className="pl-9" type="search" value={busca} onChange={(event) => onBusca(event.target.value)} placeholder="Nome do serviço" />
            </span>
          </Field>
        </div>
      )}

      {servicos.length === 0 ? (
        <EmptyState title="Nenhum serviço" text="Cadastre os serviços que aparecem na recepção e no encaminhamento." />
      ) : visiveis.length === 0 ? (
        <EmptyState title="Nenhum serviço encontrado" text="Mude a unidade ou o termo da busca." />
      ) : (
        <div className="table-wrap">
          <table className="table table-stack">
            <thead>
              <tr>
                <th>Serviço</th>
                <th>Unidade</th>
                <th>Categoria</th>
                <th><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((servico) => (
                <tr key={servico.id}>
                  <td data-label="Serviço">
                    <strong>{servico.nome}</strong>
                    {servico.descricao && <small className="mt-0.5 block text-meta-slate">{servico.descricao}</small>}
                  </td>
                  <td data-label="Unidade">{servico.unidade_nome}</td>
                  <td data-label="Categoria">
                    {servico.demanda_nome ?? <span className="text-meta-slate">Sem categoria</span>}
                    {servico.demanda_nome === CATEGORIA_DE_BENEFICIO && (
                      <small className="block text-meta-slate">
                        {servico.tipo_de_beneficio_rotulo ?? "Tipo de auxílio não informado"}
                      </small>
                    )}
                  </td>
                  <td className="md:w-px md:whitespace-nowrap md:text-right">
                    {podeClassificar(servico) && (
                      <SecondaryButton type="button" size="sm" onClick={() => onClassificar(servico)}>
                        Classificar
                      </SecondaryButton>
                    )}
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
