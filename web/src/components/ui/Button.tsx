import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cx } from '@/lib/cx';

/** Варианты и размеры компонента Button из макета (Primary | Magenta | Secondary, L | M). */
type Variant = 'primary' | 'magenta' | 'secondary';
type Size = 'l' | 'm';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  iconAfter?: ReactNode;
}

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent-violet text-ink-onAccent shadow-glow-violet',
  magenta: 'bg-accent-magenta text-ink-onAccent shadow-glow-magenta',
  secondary: 'bg-surface-raised text-ink-primary border border-line',
};

const SIZE: Record<Size, string> = {
  l: 'h-[72px] rounded-lg px-[34px] text-[22px]',
  m: 'h-[60px] rounded-md px-[28px] text-body',
};

export function Button({
  variant = 'primary',
  size = 'm',
  icon,
  iconAfter,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-3 whitespace-nowrap font-semibold leading-[1.3]',
        'transition-[filter,opacity] duration-150 hover:brightness-110',
        'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:brightness-100',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
      {iconAfter}
    </button>
  );
}
