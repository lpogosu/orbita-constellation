import { Check, ChevronDown } from 'lucide-react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import { cx } from '@/lib/cx';

export interface SelectOption {
  readonly value: string;
  readonly title: string;
  /** Правая колонка пункта: чем варианты различаются, когда заголовки похожи. */
  readonly meta?: string;
}

interface SelectProps {
  /** Подпись для чтения с экрана; видимая подпись поля живёт рядом, в разметке экрана. */
  readonly label: string;
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  /** Текст в поле, когда список пуст или значение не из списка. */
  readonly placeholder?: string;
  readonly icon?: ReactNode;
  /** Класс и стиль обёртки: ими поле ставится на координаты макета. */
  readonly className?: string;
  readonly style?: CSSProperties;
  /** Полная замена оформления поля: высота, радиус, рамка, фон и типографика. */
  readonly triggerClassName?: string;
  /** Панель шире поля: к какому краю она прижата и какой она ширины. */
  readonly menuAlign?: 'start' | 'end';
  readonly menuWidth?: number;
}

const GAP = 6;
const MIN_HEIGHT = 132;
const MAX_HEIGHT = 260;

const TRIGGER =
  'flex min-w-0 items-center gap-[8px] overflow-hidden text-left transition-colors duration-150 ' +
  'disabled:cursor-not-allowed disabled:opacity-45';

/**
 * Оформление поля по умолчанию. Экран, которому нужна другая высота или типографика,
 * передаёт `triggerClassName` целиком вместо этой строки: так утилиты Tailwind не спорят
 * друг с другом за одно и то же свойство.
 */
const TRIGGER_SHAPE =
  'h-[48px] w-full rounded-sm border border-line bg-surface-input pl-[14px] pr-[10px] ' +
  'text-small font-medium text-ink-primary hover:border-line-strong';

/**
 * Выпадающий список приложения — тот же, что у переключателя проекта в шапке: тёмная
 * панель, скруглённые пункты, галочка у выбранного. Нативный `<select>` показывает
 * системный белый список поверх тёмного интерфейса, поэтому в разметке его нет.
 */
export function Select({
  label,
  value,
  options,
  onChange,
  disabled = false,
  placeholder,
  icon,
  className,
  style,
  triggerClassName,
  menuAlign = 'start',
  menuWidth,
}: SelectProps) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [drop, setDrop] = useState({ up: false, maxHeight: MAX_HEIGHT });

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex < 0 ? undefined : options[selectedIndex];

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) {
      trigger.current?.focus();
    }
  }, []);

  const toggle = useCallback(() => {
    if (open) {
      close(false);
      return;
    }
    setActive(selectedIndex < 0 ? 0 : selectedIndex);
    setOpen(true);
  }, [close, open, selectedIndex]);

  const pick = useCallback(
    (index: number) => {
      const option = options[index];
      if (option === undefined) {
        return;
      }
      onChange(option.value);
      close(true);
    },
    [close, onChange, options],
  );

  // Панель раскрывается вниз, пока внизу есть место: карточки макета обрезают содержимое
  // по своему краю, и список, ушедший под него, читатель просто не увидит.
  useLayoutEffect(() => {
    const node = trigger.current;
    if (!open || node === null) {
      return;
    }
    const box = node.getBoundingClientRect();
    // Полотно ужато под окно, поэтому экранные пиксели переводятся в макетные.
    const scale = node.offsetHeight === 0 ? 1 : box.height / node.offsetHeight;
    const bounds = clipBounds(node);
    const below = (bounds.bottom - box.bottom) / scale - GAP;
    const above = (box.top - bounds.top) / scale - GAP;
    const up = below < MIN_HEIGHT && above > below;
    setDrop({
      up,
      maxHeight: Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, up ? above : below)),
    });
  }, [open]);

  useEffect(() => {
    if (open) {
      list.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && root.current?.contains(target) !== true) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const last = options.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((index) => Math.min(index + 1, last));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive((index) => Math.max(index - 1, 0));
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(last);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        pick(active);
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        close(false);
        break;
      default:
        break;
    }
  };

  return (
    <div ref={root} className={cx('relative', className)} style={style}>
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            toggle();
          }
        }}
        className={cx(TRIGGER, triggerClassName ?? TRIGGER_SHAPE, open && 'ring-1 ring-accent-blue')}
      >
        {icon}
        <span
          className={cx('min-w-0 flex-1 overflow-hidden truncate whitespace-nowrap', selected === undefined && 'text-ink-muted')}
          title={selected?.title ?? placeholder}
        >
          {selected?.title ?? placeholder ?? '—'}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cx(
            'size-[16px] shrink-0 text-ink-muted transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div
          ref={list}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={options.length === 0 ? undefined : `${listId}-${active}`}
          onKeyDown={onListKeyDown}
          className={cx(
            'scroll-area absolute z-40 space-y-[4px] rounded-md border border-line',
            'bg-surface-raised p-[6px] shadow-card outline-none',
          )}
          style={{
            ...(drop.up
              ? { bottom: `calc(100% + ${GAP}px)` }
              : { top: `calc(100% + ${GAP}px)` }),
            ...(menuAlign === 'end' ? { right: 0 } : { left: 0 }),
            width: menuWidth ?? '100%',
            maxHeight: drop.maxHeight,
          }}
        >
          {options.length === 0 && (
            <p className="px-[10px] py-[8px] text-caption text-ink-muted">
              {placeholder ?? 'Список пуст'}
            </p>
          )}
          {options.map((option, index) => (
            <div
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              data-index={index}
              aria-selected={option.value === value}
              onPointerEnter={() => {
                setActive(index);
              }}
              onClick={() => {
                pick(index);
              }}
              className={cx(
                'flex min-h-[34px] w-full cursor-pointer items-center gap-[8px] rounded-sm px-[10px] py-[6px]',
                'text-left text-small transition-colors duration-150',
                option.value === value
                  ? 'bg-surface-rowActive font-semibold text-ink-primary'
                  : 'text-ink-secondary',
                index === active && option.value !== value && 'bg-surface-rowActive text-ink-primary',
              )}
            >
              <span className="min-w-0 flex-1 truncate" title={option.title}>
                {option.title}
              </span>
              {option.meta !== undefined && (
                <span className="shrink-0 text-caption text-ink-muted" data-numeric>
                  {option.meta}
                </span>
              )}
              {option.value === value && (
                <Check aria-hidden="true" className="size-[15px] shrink-0 text-accent-blue" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Края ближайших предков, которые обрезают содержимое: карточки макета и модал. */
function clipBounds(element: HTMLElement): { top: number; bottom: number } {
  let node = element.parentElement;
  let top = 0;
  let bottom = window.innerHeight;
  while (node !== null) {
    const style = getComputedStyle(node);
    if (style.overflowY !== 'visible' || style.overflowX !== 'visible') {
      const box = node.getBoundingClientRect();
      top = Math.max(top, box.top);
      bottom = Math.min(bottom, box.bottom);
    }
    node = node.parentElement;
  }
  return { top, bottom };
}
