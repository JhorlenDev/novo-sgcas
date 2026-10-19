import { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-8">
      <div className="space-y-2">
        <h1 className="text-[32px] md:text-[36px] font-medium tracking-tight text-meta-charcoal leading-[1.15]">
          {title}
        </h1>
        {description && (
          <p className="text-[15px] text-meta-slate leading-relaxed max-w-2xl">{description}</p>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}
