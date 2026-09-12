import type { ReactNode } from 'react';

import { Select } from '@/components/ui/Select';
import { cx } from '@/lib/cx';

/** Поля формы постановки эксперимента: одна высота 42, один радиус 11, одна рамка. */
const FIELD_CLASS = cx(
  'h-[42px] w-full rounded-[11px] border border-line bg-surface-input px-[13px]',
  'text-[13px] font-medium text-ink-primary',
  'transition-colors duration-150 focus:border-line-strong',
  'disabled:cursor-not-allowed disabled:opacity-60',
);

export function FieldLabel({
  children,
  left,
  top,
}: {
  children: ReactNode;
  left: number;
  top: number;
}) {
  return (
    <span
      className="absolute text-[10px] font-semibold tracking-[0.8px] text-ink-muted"
      style={{ left, top }}
    >
      {children}
    </span>
  );
}

export function SelectField({
  label,
  value,
  options,
  disabled,
  onChange,
  left,
  top,
  width,
}: {
  label: string;
  value: string;
  options: readonly { readonly value: string; readonly title: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
  left: number;
  top: number;
  width: number;
}) {
  return (
    <Select
      label={label}
      value={value}
      disabled={disabled ?? false}
      onChange={onChange}
      options={options}
      className="absolute"
      style={{ left, top, width }}
      triggerClassName={FIELD_CLASS}
    />
  );
}

export function NumberField({
  label,
  value,
  invalid,
  disabled,
  onChange,
  left,
  top,
  width,
}: {
  label: string;
  value: string;
  invalid?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  left: number;
  top: number;
  width: number;
}) {
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid ?? false}
      value={value}
      disabled={disabled ?? false}
      onChange={(event) => { onChange(event.target.value); }}
      className={cx(FIELD_CLASS, 'absolute', invalid === true && 'border-status-danger')}
      style={{ left, top, width }}
      data-numeric
    />
  );
}

/** Поле только для чтения: значение пришло из сценария и правке здесь не подлежит. */
export function StaticField({
  label,
  value,
  left,
  top,
  width,
}: {
  label: string;
  value: string;
  left: number;
  top: number;
  width: number;
}) {
  return (
    <p
      aria-label={label}
      className={cx(FIELD_CLASS, 'absolute flex items-center text-ink-secondary')}
      style={{ left, top, width }}
    >
      {value}
    </p>
  );
}
