"use client";

import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import type { Tom } from "@/lib/tom";
import { cn } from "@/lib/utils";

type BotaoProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** `sm` para ações dentro de listas e linhas de tabela. */
  size?: "sm";
};

export function Button({ className, size, ...rest }: BotaoProps) {
  return <button className={cn("button", size, className)} {...rest} />;
}

export function SecondaryButton({ className, size, ...rest }: BotaoProps) {
  return <button className={cn("button secondary", size, className)} {...rest} />;
}

export function DangerButton({ className, size, ...rest }: BotaoProps) {
  return <button className={cn("button danger", size, className)} {...rest} />;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return <input className={`input ${className}`} {...rest} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", ...rest } = props;
  return <select className={`input ${className}`} {...rest} />;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: Tom;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

/** Rótulo, campo, ajuda e erro. O rótulo envolve o campo: clicar nele foca o controle e o leitor de tela o anuncia. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && !error && <span className="field-hint !font-normal">{hint}</span>}
      {error && <span className="field-error !font-medium" role="alert">{error}</span>}
    </label>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div className="min-w-0">
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="page-action">{action}</div>}
    </div>
  );
}

/** Título de uma seção dentro de um cartão: ícone discreto, título, contagem e ação à direita. */
export function SectionHeading({
  icon: Icon,
  title,
  count,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  count?: number | string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="flex min-w-0 items-center gap-2">
        {Icon && <Icon aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-meta-slate" />}
        <h2 className="!mb-0 min-w-0 !text-base">{title}</h2>
        {count !== undefined && <Badge tone="neutral">{count}</Badge>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * Indicador: o número em destaque, com o rótulo acima e uma linha de apoio.
 * Com `onClick` vira um botão que abre os registros por trás do número.
 */
export function Stat({
  label,
  value,
  hint,
  icon: Icon,
  highlight = false,
  vertical = false,
  onClick,
  children,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  highlight?: boolean;
  /** Mantém o rótulo em cima e o número embaixo também no celular (para indicadores lado a lado). */
  vertical?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const corpo = (
    <>
      <div className="stat-head">
        <span>{label}</span>
        {Icon && (
          <span className="stat-icon">
            <Icon aria-hidden="true" />
          </span>
        )}
      </div>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
      {onClick && <span className="text-[13px] font-semibold text-primary">Ver registros</span>}
      {children}
    </>
  );
  const classe = cn("card stat", highlight && "hero-stat", vertical && "stat-v");

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`Ver ${label.toLowerCase()}`}
        className={cn(classe, "w-full text-left transition-colors hover:border-primary/40 hover:bg-meta-warm-gray")}
      >
        {corpo}
      </button>
    );
  }
  return <div className={classe}>{corpo}</div>;
}

/** Pares rótulo/valor: dados de uma pessoa, de um caso. Em duas colunas quando há largura. */
export function DadosEmLista({
  itens,
  className,
}: {
  itens: Array<{ rotulo: string; valor: ReactNode }>;
  className?: string;
}) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 sm:grid-cols-2", className)}>
      {itens.map((item) => (
        <div key={item.rotulo} className="min-w-0">
          <dt className="text-[13px] font-medium text-meta-slate">{item.rotulo}</dt>
          <dd className="mt-0.5 text-sm font-medium text-meta-charcoal">{item.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Abas de uma tela. A linha de baixo corta a largura toda e a aba ativa a sobrepõe;
 * em tela estreita as abas rolam na horizontal em vez de quebrar em duas linhas.
 * `lateral` é o que fica do lado direito da linha (um filtro, por exemplo).
 */
export function Abas({
  rotulo,
  lateral,
  children,
}: {
  rotulo: string;
  lateral?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 border-b border-meta-divider md:flex-row md:items-end md:justify-between">
      <div className="-mb-px flex gap-1 overflow-x-auto" role="tablist" aria-label={rotulo}>
        {children}
      </div>
      {lateral}
    </div>
  );
}

export function Aba({ ativa, onClick, children }: { ativa: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={ativa}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition-colors",
        ativa ? "border-primary text-primary" : "border-transparent text-meta-slate hover:text-meta-charcoal",
      )}
    >
      {children}
    </button>
  );
}
