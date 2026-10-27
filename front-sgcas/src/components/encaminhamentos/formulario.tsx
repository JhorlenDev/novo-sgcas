"use client";

import { Info } from "lucide-react";
import { FormField } from "@/components/shared/form-field";
import { Input, Select } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { CATEGORIAS, URGENCIAS, hojeNoFormatoDoInput } from "@/lib/encaminhamentos";
import type { Unidade } from "@/types/sgcas";

/**
 * A ficha que o técnico preenche ao encaminhar.
 *
 * Existe nas duas telas que encaminham (atendimento e prontuário) e é uma só
 * porque a API exige a mesma ficha nas duas: duas cópias divergiriam na primeira
 * mudança de regra.
 */
export type FormularioDeEncaminhamento = {
  unidade_destino_id: string;
  destino_externo: string;
  categoria_do_motivo: string;
  urgencia: string;
  motivo: string;
  resumo_da_situacao: string;
  documentos_entregues: string;
  contato_para_retorno: string;
  prazo: string;
  observacoes: string;
};

export type ErrosDoEncaminhamento = Partial<Record<keyof FormularioDeEncaminhamento, string>>;

export const FORMULARIO_VAZIO: FormularioDeEncaminhamento = {
  unidade_destino_id: "",
  destino_externo: "",
  categoria_do_motivo: "",
  urgencia: "NORMAL",
  motivo: "",
  resumo_da_situacao: "",
  documentos_entregues: "",
  contato_para_retorno: "",
  prazo: "",
  observacoes: "",
};

/** Os campos da ficha no formato da API: vazio vira `null`, não texto em branco. */
export function corpoDoEncaminhamento(f: FormularioDeEncaminhamento) {
  const ouNulo = (texto: string) => texto.trim() || null;
  return {
    unidade_destino_id: f.unidade_destino_id || null,
    destino_externo: f.unidade_destino_id ? null : ouNulo(f.destino_externo),
    categoria_do_motivo: f.categoria_do_motivo,
    urgencia: f.urgencia,
    motivo: f.motivo.trim(),
    resumo_da_situacao: f.resumo_da_situacao.trim(),
    documentos_entregues: ouNulo(f.documentos_entregues),
    contato_para_retorno: ouNulo(f.contato_para_retorno),
    prazo: f.prazo || null,
    observacoes: ouNulo(f.observacoes),
  };
}

/** As mesmas regras que a API aplica, para o erro aparecer no campo antes de enviar. */
export function validarEncaminhamento(f: FormularioDeEncaminhamento): ErrosDoEncaminhamento {
  const erros: ErrosDoEncaminhamento = {};
  if (!f.unidade_destino_id && !f.destino_externo.trim()) {
    erros.destino_externo = "Escolha a unidade de destino ou informe o destino externo.";
  }
  if (!f.categoria_do_motivo) erros.categoria_do_motivo = "Escolha a categoria do motivo.";
  if (!f.motivo.trim()) erros.motivo = "Informe o motivo do encaminhamento.";
  if (!f.resumo_da_situacao.trim()) erros.resumo_da_situacao = "Resuma a situação para quem vai atender.";
  if (f.prazo && f.prazo < hojeNoFormatoDoInput()) erros.prazo = "O prazo não pode estar no passado.";
  return erros;
}

const CAMPOS_DE_TEXTO = "input min-h-24";

export function CamposDeEncaminhamento({
  valor,
  onChange,
  unidades,
  erros = {},
}: {
  valor: FormularioDeEncaminhamento;
  onChange: (proximo: FormularioDeEncaminhamento) => void;
  unidades: Unidade[];
  erros?: ErrosDoEncaminhamento;
}) {
  const { user } = useAuth();
  // Encaminhar para a própria unidade a API recusa: não oferece a opção.
  const destinos = unidades.filter((unidade) => unidade.id !== user?.unidade?.id);

  function mudar<K extends keyof FormularioDeEncaminhamento>(campo: K, novo: FormularioDeEncaminhamento[K]) {
    onChange({ ...valor, [campo]: novo });
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Unidade da rede">
          <Select
            value={valor.unidade_destino_id}
            onChange={(event) =>
              onChange({
                ...valor,
                unidade_destino_id: event.target.value,
                destino_externo: event.target.value ? "" : valor.destino_externo,
              })
            }
          >
            <option value="">Encaminhamento externo</option>
            {destinos.map((unidade) => (
              <option key={unidade.id} value={unidade.id}>
                {unidade.nome_qualificado || unidade.nome}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Destino externo" error={erros.destino_externo}>
          <Input
            value={valor.destino_externo}
            disabled={Boolean(valor.unidade_destino_id)}
            onChange={(event) => mudar("destino_externo", event.target.value)}
            placeholder="Ex.: Conselho Tutelar, UBS, Defensoria"
          />
        </FormField>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Categoria do motivo" error={erros.categoria_do_motivo}>
          <Select value={valor.categoria_do_motivo} onChange={(event) => mudar("categoria_do_motivo", event.target.value)}>
            <option value="">Selecione</option>
            {CATEGORIAS.map((categoria) => (
              <option key={categoria.valor} value={categoria.valor}>{categoria.rotulo}</option>
            ))}
          </Select>
        </FormField>
        <FormField label="Urgência" error={erros.urgencia}>
          <Select value={valor.urgencia} onChange={(event) => mudar("urgencia", event.target.value)}>
            {URGENCIAS.map((urgencia) => (
              <option key={urgencia.valor} value={urgencia.valor}>{urgencia.rotulo}</option>
            ))}
          </Select>
        </FormField>
      </div>

      <div className="flex items-start gap-2 rounded-card border border-meta-divider bg-meta-soft-gray p-3 text-xs leading-5 text-meta-slate">
        <Info size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          A recepção da unidade de destino vê apenas de onde a pessoa veio, quando, a categoria e a urgência.
          O motivo e o resumo abaixo são lidos só pela equipe técnica.
        </span>
      </div>

      <FormField label="Motivo do encaminhamento" error={erros.motivo}>
        <textarea
          className={CAMPOS_DE_TEXTO}
          value={valor.motivo}
          onChange={(event) => mudar("motivo", event.target.value)}
          placeholder="Por que esta pessoa precisa seguir para outro serviço?"
        />
      </FormField>

      <FormField label="Resumo da situação" error={erros.resumo_da_situacao}>
        <textarea
          className={CAMPOS_DE_TEXTO}
          value={valor.resumo_da_situacao}
          onChange={(event) => mudar("resumo_da_situacao", event.target.value)}
          placeholder="O que a equipe de destino precisa saber para atender sem perguntar tudo de novo."
        />
      </FormField>

      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Documentos entregues, opcional">
          <textarea
            className={CAMPOS_DE_TEXTO}
            value={valor.documentos_entregues}
            onChange={(event) => mudar("documentos_entregues", event.target.value)}
            placeholder="Documentos que a pessoa já levou ou que faltam."
          />
        </FormField>
        <FormField label="Observações, opcional">
          <textarea
            className={CAMPOS_DE_TEXTO}
            value={valor.observacoes}
            onChange={(event) => mudar("observacoes", event.target.value)}
            placeholder="Orientações dadas e combinados."
          />
        </FormField>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Contato para retorno, opcional">
          <Input
            value={valor.contato_para_retorno}
            onChange={(event) => mudar("contato_para_retorno", event.target.value)}
            placeholder="Quem, na sua unidade, o destino deve procurar"
          />
        </FormField>
        <FormField label="Prazo, opcional" error={erros.prazo}>
          <Input
            type="date"
            min={hojeNoFormatoDoInput()}
            value={valor.prazo}
            onChange={(event) => mudar("prazo", event.target.value)}
          />
        </FormField>
      </div>

      <p className="text-xs leading-5 text-meta-slate">
        Segue junto, automaticamente: o serviço, o que a pessoa solicitou na recepção, o que já recebeu desta
        unidade e o relato do atendimento até agora.
      </p>
    </div>
  );
}
