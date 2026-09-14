import type { ReactNode } from 'react';

import { Select } from '@/components/ui/Select';
import { cx } from '@/lib/cx';
import { bottomAnchoredTop } from '@/styles/readable-text';

/** Высота строки подписи в макете: 10px при унаследованном интерлиньяже 1.5. */
const LABEL_LINE_HEIGHT = 15;

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
  className,
}: {
  children: ReactNode;
  left?: number;
  top?: number;
  className?: string;
}) {
  const positioned = left !== undefined || top !== undefined;
  // Подпись стоит над своим полем: подросший на ноутбуке кегль уводит её вверх, а не на поле.
  const style = positioned
    ? { left, ...(top === undefined ? {} : { top: bottomAnchoredTop(top, LABEL_LINE_HEIGHT) }) }
    : undefined;

  return (
    <span
      className={cx(
        positioned && 'absolute',
        'text-[10px] font-semibold tracking-[0.8px] text-ink-muted',
        className,
      )}
      style={style}
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
  className,
}: {
  label: string;
  value: string;
  options: readonly { readonly value: string; readonly title: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
  left?: number;
  top?: number;
  width?: number;
  className?: string;
}) {
  const positioned = left !== undefined || top !== undefined;
  const style = {
    ...(left === undefined ? {} : { left }),
    ...(top === undefined ? {} : { top }),
    ...(width === undefined ? {} : { width }),
  };
  const hasStyle = positioned || width !== undefined;

  return (
    <Select
      label={label}
      value={value}
      disabled={disabled ?? false}
      onChange={onChange}
      options={options}
      className={cx(positioned && 'absolute', className)}
      {...(hasStyle ? { style } : {})}
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
  className,
}: {
  label: string;
  value: string;
  invalid?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  left?: number;
  top?: number;
  width?: number;
  className?: string;
}) {
  const positioned = left !== undefined || top !== undefined;

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid ?? false}
      value={value}
      disabled={disabled ?? false}
      onChange={(event) => { onChange(event.target.value); }}
      className={cx(
        FIELD_CLASS,
        positioned && 'absolute',
        invalid === true && 'border-status-danger',
        className,
      )}
      style={positioned ? { left, top, width } : width === undefined ? undefined : { width }}
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
  className,
}: {
  label: string;
  value: string;
  left?: number;
  top?: number;
  width?: number;
  className?: string;
}) {
  const positioned = left !== undefined || top !== undefined;

  return (
    <p
      aria-label={label}
      className={cx(
        FIELD_CLASS,
        positioned && 'absolute',
        'flex items-center text-ink-secondary',
        className,
      )}
      style={positioned ? { left, top, width } : width === undefined ? undefined : { width }}
    >
      {value}
    </p>
  );
}
