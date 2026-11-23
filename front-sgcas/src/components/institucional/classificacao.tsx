"use client";

import { Field, Select } from "@/components/ui";
import { CATEGORIA_DE_BENEFICIO, TIPOS_DE_AUXILIO } from "@/lib/auxilios";
import type { Demanda } from "@/types/sgcas";

export type Classificacao = { demandaId: string; tipo: string };

export const SEM_CLASSIFICACAO: Classificacao = { demandaId: "", tipo: "" };

/** O que vai à API: o tipo de auxílio só existe em serviço da categoria "Benefício Eventual". */
export function corpoDaClassificacao(classificacao: Classificacao, demandas: Demanda[]) {
  const ehBeneficio = demandas.find((d) => d.id === classificacao.demandaId)?.nome === CATEGORIA_DE_BENEFICIO;
  return {
    demanda_id: classificacao.demandaId || null,
    tipo_de_beneficio: ehBeneficio ? classificacao.tipo || null : null,
  };
}

/**
 * Onde o serviço se classifica: a categoria municipal e, nos auxílios, o tipo.
 * É a mesma escolha ao cadastrar e ao corrigir um serviço, por isso é um componente só.
 */
export function CamposDeClassificacao({
  demandas,
  valor,
  onChange,
}: {
  demandas: Demanda[];
  valor: Classificacao;
  onChange: (proximo: Classificacao) => void;
}) {
  const ehBeneficio = demandas.find((d) => d.id === valor.demandaId)?.nome === CATEGORIA_DE_BENEFICIO;

  return (
    <>
      <Field label="Categoria municipal">
        <Select value={valor.demandaId} onChange={(event) => onChange({ demandaId: event.target.value, tipo: "" })}>
          <option value="">Sem categoria</option>
          {demandas.map((demanda) => (
            <option key={demanda.id} value={demanda.id}>{demanda.nome}</option>
          ))}
        </Select>
      </Field>
      {ehBeneficio && (
        <>
          <Field label="Tipo de auxílio">
            <Select value={valor.tipo} onChange={(event) => onChange({ ...valor, tipo: event.target.value })}>
              <option value="">Não informado</option>
              {TIPOS_DE_AUXILIO.map((tipo) => (
                <option key={tipo.valor} value={tipo.valor}>{tipo.rotulo}</option>
              ))}
            </Select>
          </Field>
          <p className="-mt-2 text-xs leading-5 text-meta-slate">
            Informe o tipo para o sistema avisar quando a mesma pessoa pedir o mesmo auxílio de novo. O auxílio de
            nascimento (o auxílio maternidade) só pode ser concedido uma vez a cada 12 meses; os demais tipos, uma vez
            por mês. Sem o tipo, o aviso na recepção só considera o mês.
          </p>
        </>
      )}
    </>
  );
}
