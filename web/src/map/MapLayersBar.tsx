import { Check, X } from 'lucide-react';

import { useStacked } from '@/app/viewport-mode';
import { cx } from '@/lib/cx';
import type { MapLayers } from './model';
import type { Hemisphere } from './projection';

const TOGGLES: readonly { key: keyof MapLayers; label: string; hint: string }[] = [
  { key: 'planes', label: 'Орбиты', hint: 'Дуги через аппараты одной плоскости' },
  { key: 'satellites', label: 'Спутники', hint: 'Аппараты снимка' },
  { key: 'allContacts', label: 'Контакты', hint: 'Все рёбра отсчёта; по умолчанию выключены' },
  { key: 'ground', label: 'Наземные', hint: 'Линии клиент–спутник и шлюз–спутник' },
  { key: 'labels', label: 'Подписи', hint: 'Идентификаторы всех аппаратов' },
  { key: 'backup', label: 'Резерв', hint: 'Второй непересекающийся маршрут клиента' },
];

interface MapLayersBarProps {
  readonly width: number;
  readonly layers: MapLayers;
  readonly onChange: (layers: MapLayers) => void;
  readonly hemisphere: Hemisphere;
  readonly onHemisphere: (hemisphere: Hemisphere) => void;
}

/**
 * Переключатели слоёв под картой (`14_SCREENS.md` §2.2). Легенда живёт отдельно, в углу
 * карты (`MapLegend`): вместе с шестью переключателями и полушарием она не помещалась в
 * ширину карты и уезжала под правую панель, а число плоскостей приходит из данных и
 * фиксированной ширине не подчиняется.
 *
 * В потоке строка переносится: шесть переключателей в ширину телефона не входят, а
 * обрезать их нельзя — скрытый слой было бы не включить.
 */
export function MapLayersBar({
  width,
  layers,
  onChange,
  hemisphere,
  onHemisphere,
}: MapLayersBarProps) {
  const stacked = useStacked();

  return (
    <div
      className={cx(
        'flex items-center rounded-sm border border-line-subtle bg-surface-sunken',
        stacked
          ? 'w-full flex-wrap gap-[8px] p-[8px]'
          : 'h-[41px] gap-[10px] overflow-hidden px-[16px]',
      )}
      style={stacked ? undefined : { width }}
    >
      <span
        className={cx(
          'shrink-0 text-micro font-semibold uppercase tracking-[0.8px] text-ink-muted',
          stacked && 'w-full px-[4px]',
        )}
      >
        Слои
      </span>

      {TOGGLES.map((toggle) => {
        const on = layers[toggle.key];
        return (
          <button
            key={toggle.key}
            type="button"
            aria-pressed={on}
            title={toggle.hint}
            onClick={() => {
              onChange({ ...layers, [toggle.key]: !on });
            }}
            className={cx(
              'flex shrink-0 items-center gap-[7px] whitespace-nowrap text-caption font-medium transition-colors duration-150',
              stacked ? 'h-[40px] rounded-sm px-[12px]' : 'h-[25px] rounded-[8px] px-[9px]',
              on ? 'bg-surface-chip text-ink-primary' : 'text-ink-muted hover:text-ink-secondary',
              stacked && !on && 'border border-line-subtle',
            )}
          >
            {on ? (
              <Check aria-hidden="true" className="size-[12px]" />
            ) : (
              <X aria-hidden="true" className="size-[12px]" />
            )}
            {toggle.label}
          </button>
        );
      })}

      <button
        type="button"
        onClick={() => {
          onHemisphere(hemisphere === 'north' ? 'south' : 'north');
        }}
        title="Полюс вида: в 2D — центр проекции карты, в 3D — точка обзора камеры"
        className={cx(
          'ml-auto shrink-0 whitespace-nowrap bg-surface-chip text-caption font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-rowActive',
          stacked ? 'h-[40px] rounded-sm px-[12px]' : 'h-[25px] rounded-[8px] px-[10px]',
        )}
      >
        {hemisphere === 'north' ? 'Центр: север' : 'Центр: юг'}
      </button>
    </div>
  );
}
