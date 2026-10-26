"use client";

import { useRef, useState, type FormEvent } from "react";
import { Download, ExternalLink, FileArchive, FileText, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, SecondaryButton, Select } from "@/components/ui";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Anexo, TipoDeAnexo } from "@/types/sgcas";

// Os mesmos 25 MB da API (api-sgcas/apps/cidadaos/anexos.py): conferir aqui evita
// subir um arquivo inteiro só para ouvir que passou do limite.
const TAMANHO_MAXIMO = 25 * 1024 * 1024;
const FORMATOS_ACEITOS = ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";
// Quem pode remover documento do prontuário; a API confere de novo.
const PODEM_REMOVER = ["ADMIN", "COORDENADOR"];

type Props = {
  cidadaoId: string;
  anexos: Anexo[];
  tipos: TipoDeAnexo[];
  onChanged: () => Promise<void>;
};

export function AnexosPanel({ cidadaoId, anexos, tipos, onChanged }: Props) {
  const { user } = useAuth();
  const podeRemover = Boolean(user && PODEM_REMOVER.includes(user.papel));
  const rotulos = new Map(tipos.map((tipo) => [tipo.valor, tipo.rotulo]));

  const arquivoRef = useRef<HTMLInputElement>(null);
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [aRemover, setARemover] = useState<Anexo | null>(null);
  const [removendo, setRemovendo] = useState(false);

  function fechar() {
    setAberto(false);
    setTipo("");
    setErro("");
  }

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAviso("");
    const arquivo = arquivoRef.current?.files?.[0];
    if (!tipo) return setErro("Escolha o tipo do documento.");
    if (!arquivo) return setErro("Escolha um arquivo para enviar.");
    if (arquivo.size > TAMANHO_MAXIMO) return setErro("O arquivo tem mais de 25 MB.");

    const dados = new FormData();
    dados.append("file", arquivo);
    dados.append("tipo_documento", tipo);

    setErro("");
    setEnviando(true);
    try {
      await api<Anexo>(`/citizens/${cidadaoId}/anexos`, { method: "POST", body: dados });
      fechar();
      setAviso("Documento enviado ao prontuário.");
      await onChanged();
    } catch (error) {
      setErro(mensagemDoErro(error));
    } finally {
      setEnviando(false);
    }
  }

  async function remover() {
    if (!aRemover) return;
    setRemovendo(true);
    setAviso("");
    try {
      await api(`/citizens/${cidadaoId}/anexos/${aRemover.id}/remover`, { method: "DELETE" });
      setARemover(null);
      setAviso("Documento removido do prontuário.");
      await onChanged();
    } catch (error) {
      setARemover(null);
      setErro(mensagemDoErro(error));
    } finally {
      setRemovendo(false);
    }
  }

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="row !justify-start">
          <span className="flex h-9 w-9 items-center justify-center rounded-pill bg-primary/10 text-primary"><FileArchive size={17} /></span>
          <h2 className="!mb-0 !text-lg">Documentos anexados</h2>
          <Badge tone="neutral">{anexos.length}</Badge>
        </div>
        <SecondaryButton type="button" className="h-9 px-3 text-xs" onClick={() => (aberto ? fechar() : setAberto(true))} aria-expanded={aberto}>
          <Plus size={14} />
          Enviar documento
        </SecondaryButton>
      </div>

      {aberto && (
        <form className="mb-4 rounded-card border border-primary/15 bg-primary/5 p-3" onSubmit={enviar}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo de documento">
              <Select value={tipo} onChange={(event) => setTipo(event.target.value)} required>
                <option value="" disabled>Escolha o tipo…</option>
                {tipos.map((item) => <option key={item.valor} value={item.valor}>{item.rotulo}</option>)}
              </Select>
            </Field>
            <Field label="Arquivo">
              <input ref={arquivoRef} className="input" type="file" accept={FORMATOS_ACEITOS} required />
            </Field>
          </div>
          <p className="mt-2 text-xs leading-5 text-meta-slate">
            PDF, JPG, PNG ou WEBP, até 25 MB. As fotos são reduzidas e perdem os dados de localização.
          </p>
          {erro && <p className="mt-2 text-xs font-semibold text-danger" role="alert">{erro}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <SecondaryButton type="button" className="h-9 px-3 text-xs" onClick={fechar} disabled={enviando}>Cancelar</SecondaryButton>
            <Button type="submit" className="h-9 px-3 text-xs" disabled={enviando}>{enviando ? "Enviando..." : "Enviar"}</Button>
          </div>
        </form>
      )}

      {!aberto && erro && <p className="mb-3 text-xs font-semibold text-danger" role="alert">{erro}</p>}
      {aviso && <p className="mb-3 text-xs font-semibold text-success" role="status">{aviso}</p>}

      {anexos.length === 0 ? (
        <EmptyState title="Sem registros" text="Documentos enviados ao prontuário aparecem aqui." />
      ) : (
        <ul className="grid gap-2" aria-label="Documentos anexados">
          {anexos.map((anexo) => {
            const rotulo = rotulos.get(anexo.tipo_documento) ?? anexo.tipo_documento;
            const url = `/api/citizens/${cidadaoId}/anexos/${anexo.id}`;
            return (
              <li key={anexo.id} className="flex items-center gap-3 rounded-card border border-meta-divider bg-meta-warm-gray p-3">
                <Miniatura url={url} imagem={anexo.mime.startsWith("image/")} descricao={rotulo} />
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-sm text-meta-charcoal">{rotulo}</strong>
                  <p className="mt-0.5 text-xs leading-5 text-meta-slate">
                    {[anexo.mime === "application/pdf" ? "PDF" : "Imagem", formatarTamanho(anexo.tamanho), anexo.enviado_em ? formatarDataHora(anexo.enviado_em) : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <a className="button secondary h-9 px-2.5 text-xs" href={url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${rotulo}`} title="Abrir">
                    <ExternalLink size={14} />
                  </a>
                  <a className="button secondary h-9 px-2.5 text-xs" href={url} download aria-label={`Baixar ${rotulo}`} title="Baixar">
                    <Download size={14} />
                  </a>
                  {podeRemover && (
                    <button type="button" className="button danger h-9 px-2.5 text-xs" onClick={() => setARemover(anexo)} aria-label={`Remover ${rotulo}`} title="Remover">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={aRemover !== null}
        onOpenChange={(aberta) => { if (!aberta && !removendo) setARemover(null); }}
        title="Remover documento"
        description={`O documento "${aRemover ? rotulos.get(aRemover.tipo_documento) ?? aRemover.tipo_documento : ""}" será apagado do prontuário e do armazenamento. Esta ação não pode ser desfeita.`}
        confirmLabel="Remover"
        variant="destructive"
        onConfirm={() => void remover()}
        isLoading={removendo}
      />
    </Card>
  );
}

function Miniatura({ url, imagem, descricao }: { url: string; imagem: boolean; descricao: string }) {
  // Anexos antigos podem não ter miniatura; sem ela, cai no ícone.
  const [falhou, setFalhou] = useState(false);
  if (imagem && !falhou) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a miniatura vem da API, sob sessão; o otimizador do Next não a alcança
      <img
        src={`${url}?miniatura=true`}
        alt={`Miniatura: ${descricao}`}
        loading="lazy"
        className="h-14 w-14 shrink-0 rounded-card border border-meta-divider bg-white object-cover"
        onError={() => setFalhou(true)}
      />
    );
  }
  return (
    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-card border border-meta-divider bg-white text-meta-slate" aria-hidden="true">
      <FileText size={22} />
    </span>
  );
}

function mensagemDoErro(error: unknown): string {
  if (error instanceof ApiError) {
    // O nginx barra o corpo grande antes da API, com uma página HTML.
    if (error.status === 413) return "O arquivo é grande demais. O limite é de 25 MB.";
    if (error.status === 403) return "Você não tem permissão para esta ação.";
    // Erros de validação da API: { campo: "mensagem" } ou { campo: ["mensagem"] }.
    if (error.data && typeof error.data === "object") {
      for (const valor of Object.values(error.data as Record<string, unknown>)) {
        const texto = Array.isArray(valor) ? valor[0] : valor;
        if (typeof texto === "string" && texto) return texto;
      }
    }
    if (error.message) return error.message;
  }
  return "Não foi possível concluir. Tente novamente.";
}

function formatarTamanho(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024).toLocaleString("pt-BR")} KB`;
  return `${bytes} B`;
}

function formatarDataHora(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
