import { Check, X } from 'lucide-react';

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
 */
export function MapLayersBar({
  width,
  layers,
  onChange,
  hemisphere,
  onHemisphere,
}: MapLayersBarProps) {
  return (
    <div
      className="flex h-[41px] items-center gap-[10px] overflow-hidden rounded-sm border border-line-subtle bg-surface-sunken px-[16px]"
      style={{ width }}
    >
      <span className="shrink-0 text-micro font-semibold uppercase tracking-[0.8px] text-ink-muted">
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
              'flex h-[25px] shrink-0 items-center gap-[7px] whitespace-nowrap rounded-[8px] px-[9px] text-caption font-medium transition-colors duration-150',
              on ? 'bg-surface-chip text-ink-primary' : 'text-ink-muted hover:text-ink-secondary',
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
        title="Центр проекции: полюс, вокруг которого строится карта"
        className="ml-auto h-[25px] shrink-0 whitespace-nowrap rounded-[8px] bg-surface-chip px-[10px] text-caption font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-rowActive"
      >
        {hemisphere === 'north' ? 'Центр: север' : 'Центр: юг'}
      </button>
    </div>
  );
}
