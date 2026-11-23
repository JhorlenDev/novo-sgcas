"use client";

import { Field, Input, Select } from "@/components/ui";

/** O que o técnico marca ao conferir e ao evoluir o atendimento. */
export type RegistroDoAtendimento = {
  situacaoIdentificada: string;
  providencia: string;
  retornoNecessario: string;
  dataRetorno: string;
  observacao: string;
};

export const REGISTRO_VAZIO: RegistroDoAtendimento = {
  situacaoIdentificada: "",
  providencia: "",
  retornoNecessario: "",
  dataRetorno: "",
  observacao: "",
};

/** O registro como texto do histórico do caso, uma linha por item preenchido. */
export function textoDoRegistro(registro: RegistroDoAtendimento): string {
  const { situacaoIdentificada, providencia, retornoNecessario, dataRetorno, observacao } = registro;
  const partes = [
    situacaoIdentificada ? `Situação identificada: ${situacaoIdentificada}.` : null,
    providencia ? `Providência tomada: ${providencia}.` : null,
    retornoNecessario === "SIM"
      ? `Retorno necessário: sim${dataRetorno ? `, previsto para ${formatarDataSimples(dataRetorno)}` : ""}.`
      : retornoNecessario === "NAO"
        ? "Retorno necessário: não."
        : null,
    observacao.trim() ? `Observação: ${observacao.trim()}` : null,
  ].filter(Boolean);

  return partes.join("\n");
}

function formatarDataSimples(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

export function RegistroGuiado({
  valor,
  onChange,
  compacto = false,
}: {
  valor: RegistroDoAtendimento;
  onChange: (proximo: RegistroDoAtendimento) => void;
  compacto?: boolean;
}) {
  function mudar(campo: keyof RegistroDoAtendimento, novo: string) {
    onChange({ ...valor, [campo]: novo });
  }

  return (
    <div className="grid gap-4 rounded-lg border border-meta-divider bg-meta-warm-gray p-3.5 sm:p-4">
      <div>
        <h3 className="!text-base">Registro do atendimento</h3>
        <p className="mt-1 text-[13px] leading-5 text-meta-slate">
          Preencha só o que fizer sentido. O sistema organiza isso no histórico do caso.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Situação identificada">
          <Select value={valor.situacaoIdentificada} onChange={(event) => mudar("situacaoIdentificada", event.target.value)}>
            <option value="">Selecione, se aplicável</option>
            <option value="Atualização cadastral ou orientação simples">Atualização/orientação</option>
            <option value="Vulnerabilidade social relatada">Vulnerabilidade social</option>
            <option value="Solicitação de benefício eventual">Benefício eventual</option>
            <option value="Acompanhamento familiar em andamento">Acompanhamento familiar</option>
            <option value="Violação de direitos ou risco social">Risco/violação de direitos</option>
            <option value="Encaminhamento solicitado por outro órgão">Encaminhamento de outro órgão</option>
          </Select>
        </Field>

        <Field label="Providência">
          <Select value={valor.providencia} onChange={(event) => mudar("providencia", event.target.value)}>
            <option value="">Selecione, se aplicável</option>
            <option value="Orientação registrada">Orientação registrada</option>
            <option value="Documentos conferidos">Documentos conferidos</option>
            <option value="Benefício avaliado ou solicitado">Benefício avaliado/solicitado</option>
            <option value="Encaminhamento preparado">Encaminhamento preparado</option>
            <option value="Retorno combinado com o cidadão">Retorno combinado</option>
            <option value="Atendimento concluído no setor">Concluído no setor</option>
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Retorno necessário?">
          <Select value={valor.retornoNecessario} onChange={(event) => mudar("retornoNecessario", event.target.value)}>
            <option value="">Definir depois</option>
            <option value="NAO">Não</option>
            <option value="SIM">Sim</option>
          </Select>
        </Field>

        {valor.retornoNecessario === "SIM" && (
          <Field label="Data prevista">
            <Input type="date" value={valor.dataRetorno} onChange={(event) => mudar("dataRetorno", event.target.value)} />
          </Field>
        )}
      </div>

      <Field label={compacto ? "Observação inicial" : "Observação/evolução"}>
        <textarea
          className="input"
          value={valor.observacao}
          onChange={(event) => mudar("observacao", event.target.value)}
          placeholder="Ex.: cidadão trouxe documentos, orientação dada, pendência, combinado de retorno..."
        />
      </Field>
    </div>
  );
}
