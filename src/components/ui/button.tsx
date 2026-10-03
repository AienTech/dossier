import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "text"
  | "danger-text"
  | "danger-outline"
  | "danger";
export type ButtonSize = "lg" | "md" | "sm";

const base =
  "inline-flex items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap motion-safe:transition-colors disabled:cursor-not-allowed aria-disabled:cursor-not-allowed";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-on-primary hover:bg-primary-hover disabled:bg-faint aria-disabled:bg-faint",
  secondary:
    "border border-line-control text-ink hover:border-ink disabled:border-line-field disabled:text-muted aria-disabled:text-muted",
  // Text buttons have no horizontal padding so they line up with the text around them.
  text: "px-0! text-muted hover:text-ink disabled:text-faint aria-disabled:text-faint",
  "danger-text": "px-0! font-normal text-danger hover:text-error-strong disabled:text-faint",
  "danger-outline":
    "border border-danger-control bg-input text-error-strong hover:border-error-strong disabled:text-faint",
  danger:
    "bg-error text-white hover:bg-error-strong disabled:bg-danger-disabled aria-disabled:bg-danger-disabled",
};

const sizes: Record<ButtonSize, string> = {
  lg: "px-4 py-3 text-field",
  md: "px-4 py-2.5 text-sm",
  sm: "px-3.5 py-[9px] text-control",
};

/** Button styles, for links that look like buttons: `<Link className={buttonClassName()}>`. */
export function buttonClassName(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(base, variants[variant], sizes[size], className);
}

export type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

/**
 * A button in one of the prototype's styles. Defaults to `type="button"`, so
 * it only submits a form when asked to. For a button that should look
 * disabled but still explain why when clicked (PRD NEW-1), use
 * `aria-disabled` instead of `disabled`.
 */
export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClassName(variant, size, className)}
      {...props}
    />
  );
}
