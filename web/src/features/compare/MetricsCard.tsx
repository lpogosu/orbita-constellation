import type { ComparisonEntry } from '@/api/types';
import { Card } from '@/components/ui/Card';
import { useStacked } from '@/app/viewport-mode';
import { cx } from '@/lib/cx';
import { metricSections } from './metrics';
import type { Cell } from './metrics';
import { variantLetter } from '@/lib/run-format';

const LEFT = 26;
const TOP = 266;
const NAME_WIDTH = 388;
/** В потоке таблица прокручивается вбок, и широкая колонка названий только удлиняла путь. */
const STACKED_NAME_WIDTH = 196;
const BASE_WIDTH = 160;
const VALUE_WIDTH = 140;
const DELTA_WIDTH = 160;

const TONE_CLASS: Record<Cell['tone'], string> = {
  good: 'text-status-success',
  bad: 'text-status-danger',
  flat: 'text-ink-muted',
};

/**
 * Таблица «Метрики и отклонения от базы» (узел Figma `137:1078`). Проигранные показатели
 * не прячутся: колонка дельты стоит у каждого варианта, а цвет говорит о пользе, а не о
 * знаке числа (`09_DEMO_ECONOMICS.md`) — рост перерыва растёт и вредит одновременно.
 */
export function MetricsCard({ entries }: { entries: readonly ComparisonEntry[] }) {
  const stacked = useStacked();
  const base = entries[0];
  if (base === undefined) {
    return null;
  }

  const candidates = entries.slice(1);
  const columns = [
    `${stacked ? STACKED_NAME_WIDTH : NAME_WIDTH}px`,
    `${BASE_WIDTH}px`,
    ...candidates.map(() => `${VALUE_WIDTH}px ${DELTA_WIDTH}px`),
  ].join(' ');

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className={stacked ? 'order-1 p-[16px] md:col-span-2' : 'absolute h-[288px] w-[1160px]'}
      style={stacked ? undefined : { left: LEFT, top: TOP }}
    >
      <h2
        className={cx(
          'text-title-m font-semibold text-ink-primary',
          !stacked && 'absolute left-[31px] top-[17px]',
        )}
      >
        Метрики и отклонения от базы
      </h2>

      {/* Четыре варианта в столбцах шире карточки, поэтому таблица прокручивается вбок
          внутри своей области, а не ужимает колонки до нечитаемых. */}
      <div
        className={cx(
          'overflow-x-auto',
          stacked ? 'mt-[12px] [scrollbar-width:thin]' : 'absolute left-[23px] top-[55px] h-[218px] w-[1114px]',
        )}
      >
        <div className="min-w-max">
          <div
            className="grid items-end pb-[6px] pl-[8px] text-[10px] font-semibold tracking-[0.7px] text-ink-muted"
            style={{ gridTemplateColumns: columns }}
          >
            <span>МЕТРИКА</span>
            <span>ВАРИАНТ {variantLetter(0)} · БАЗА</span>
            {candidates.map((entry, index) => (
              <HeadPair key={entry.run_id} letter={variantLetter(index + 1)} />
            ))}
          </div>
          <div className="h-px w-full bg-line-divider" />

          <div className={stacked ? undefined : 'scroll-area max-h-[190px] pr-[6px]'}>
            {metricSections(base).map((section) => (
              <section key={section.title}>
                <h3 className="px-[8px] pb-[2px] pt-[10px] text-[10px] font-semibold tracking-[0.7px] text-ink-muted">
                  {section.title}
                </h3>
                {section.rows.map((row, rowIndex) => (
                  <div
                    key={row.id}
                    className={cx(
                      'grid h-[30px] items-center rounded-sm pl-[8px]',
                      rowIndex % 2 === 1 && 'bg-surface-chip',
                    )}
                    style={{ gridTemplateColumns: columns }}
                  >
                    <span className="truncate pr-[12px] text-[13px] font-medium text-ink-secondary">
                      {row.title}
                    </span>
                    <MetricValue cell={row.cell(base, base)} />
                    {candidates.map((entry) => (
                      <ValuePair key={entry.run_id} cell={row.cell(entry, base)} />
                    ))}
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function HeadPair({ letter }: { letter: string }) {
  return (
    <>
      <span>ВАРИАНТ {letter}</span>
      <span>Δ {letter}</span>
    </>
  );
}

function ValuePair({ cell }: { cell: Cell }) {
  return (
    <>
      <MetricValue cell={cell} />
      <span className={cx('text-[13px] font-semibold', TONE_CLASS[cell.tone])} data-numeric>
        {cell.delta ?? '—'}
      </span>
    </>
  );
}

function MetricValue({ cell }: { cell: Cell }) {
  return (
    <span className="text-[14px] font-semibold text-ink-primary" data-numeric>
      {cell.value}
    </span>
  );
}
