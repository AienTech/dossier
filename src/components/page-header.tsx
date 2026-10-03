import type { ReactNode } from "react";

export type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Buttons or status shown on the right, e.g. "Saved just now" and a primary action. */
  actions?: ReactNode;
};

/** The title block at the top of every signed-in screen. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-6 px-14 pt-12 pb-8">
      <div className="flex max-w-[620px] flex-col gap-2">
        <h1 className="font-serif text-title text-pretty">{title}</h1>
        {description && <p className="text-lead text-pretty text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-4">{actions}</div>}
    </header>
  );
}
