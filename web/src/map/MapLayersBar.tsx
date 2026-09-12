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
  readonly planeIds: readonly string[];
  readonly planeColors: readonly string[];
  readonly hemisphere: Hemisphere;
  readonly onHemisphere: (hemisphere: Hemisphere) => void;
}

/** Слои и легенда карты (`14_SCREENS.md` §2.2), узел макета «Map / Слои и легенда». */
export function MapLayersBar({
  width,
  layers,
  onChange,
  planeIds,
  planeColors,
  hemisphere,
  onHemisphere,
}: MapLayersBarProps) {
  return (
    <div
      className="flex h-[41px] items-center gap-[10px] rounded-sm border border-line-subtle bg-surface-sunken px-[16px]"
      style={{ width }}
    >
      <span className="text-micro font-semibold uppercase tracking-[0.8px] text-ink-muted">Слои</span>

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
              'flex h-[25px] items-center gap-[7px] rounded-[8px] px-[9px] text-caption font-medium transition-colors duration-150',
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

      <span aria-hidden="true" className="h-[22px] w-px bg-line-divider" />

      <ul className="flex items-center gap-[12px]">
        {planeIds.map((planeId, index) => (
          <LegendItem
            key={planeId}
            label={planeId}
            color={planeColors[index % planeColors.length] ?? 'currentColor'}
          />
        ))}
        <LegendItem label="ISL" color="var(--map-isl)" />
        <LegendItem label="Шлюз" color="var(--map-gateway)" />
        <LegendItem label="Маршрут" color="var(--map-route)" />
        <LegendItem label="Резерв" color="var(--map-backup)" dashed />
        <LegendItem label="Отказ" color="var(--map-failed)" cross />
      </ul>

      <button
        type="button"
        onClick={() => {
          onHemisphere(hemisphere === 'north' ? 'south' : 'north');
        }}
        title="Центр проекции: полюс, вокруг которого строится карта"
        className="ml-auto h-[25px] shrink-0 rounded-[8px] bg-surface-chip px-[10px] text-caption font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-rowActive"
      >
        {hemisphere === 'north' ? 'Центр: север' : 'Центр: юг'}
      </button>
    </div>
  );
}

function LegendItem({
  label,
  color,
  dashed = false,
  cross = false,
}: {
  label: string;
  color: string;
  dashed?: boolean;
  cross?: boolean;
}) {
  return (
    <li className="flex items-center gap-[6px] whitespace-nowrap text-caption font-medium text-ink-secondary">
      {cross ? (
        <X aria-hidden="true" className="size-[11px]" style={{ color }} />
      ) : dashed ? (
        <span
          aria-hidden="true"
          className="h-0 w-[14px] border-t-2 border-dashed"
          style={{ borderColor: color }}
        />
      ) : (
        <span aria-hidden="true" className="size-[8px] rounded-pill" style={{ background: color }} />
      )}
      {label}
    </li>
  );
}
