import type { ReactNode } from 'react';

/**
 * Rotulo, campo e mensagem de erro de um formulario.
 *
 * ## Por que o <label> envolve o campo
 *
 * A versao anterior — copiada em seis telas — desenhava o rotulo como *irmao*
 * do controle, sem `htmlFor`:
 *
 * ```tsx
 * <div><Label>{label}</Label>{children}</div>
 * ```
 *
 * Visualmente identico, e sem ligacao nenhuma entre os dois. Para quem usa
 * leitor de tela isso significa ouvir "campo de texto, em branco" e mais nada:
 * o rotulo nao e anunciado, porque o navegador nao tem como saber que aquele
 * texto descreve aquele campo.
 *
 * Envolver resolve sem precisar inventar um `id` unico para cada campo — o que
 * exigiria clonar o filho so para injeta-lo. Como efeito colateral util, clicar
 * no rotulo passa a focar o campo, incluindo os selects.
 *
 * ## Por que o erro fica de fora
 *
 * `<label>` aceita apenas conteudo de frase; um `<p>` la dentro e HTML
 * invalido. Ele fica como irmao do rotulo, nao dentro dele.
 */
export function FormField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block space-y-1.5">
        <span className="block text-[13px] font-semibold leading-5 text-meta-charcoal">{label}</span>
        {children}
      </label>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
