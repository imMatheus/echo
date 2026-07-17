import type { ReactNode } from 'react';

/** Page header: title + optional subtitle on the left, actions on the right. */
export function PageHeader({
  title,
  titleExtra,
  subtitle,
  actions,
  backLink,
}: {
  title: ReactNode;
  titleExtra?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  backLink?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start gap-3 max-sm:flex-col">
      <div className="min-w-0">
        {backLink && <div className="mb-1.5">{backLink}</div>}
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <h1 className="min-w-0 font-heading text-xl font-semibold tracking-tight [overflow-wrap:anywhere]">
            {title}
          </h1>
          {titleExtra}
        </div>
        {subtitle && <p className="mt-1 text-xs/relaxed text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && (
        <div className="ml-auto flex shrink-0 items-center gap-2 pt-0.5 max-sm:ml-0 max-sm:max-w-full max-sm:flex-wrap">
          {actions}
        </div>
      )}
    </div>
  );
}
