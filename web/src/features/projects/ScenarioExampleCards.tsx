import { forwardRef } from 'react';

import type { ScenarioExample } from '@/api/scenario-files';
import { useStacked } from '@/app/viewport-mode';
import { ErrorBlock, Skeleton } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import { cx } from '@/lib/cx';

/**
 * Обложки лежат в `public/assets` и назначаются по порядку файлов в каталоге: у сценария
 * нет поля с картинкой, а связывать обложку с его идентификатором значило бы зашить
 * идентификаторы кейса в код.
 */
const COVERS = [
  '/assets/scenario-cover-1.png',
  '/assets/scenario-cover-2.png',
  '/assets/scenario-cover-3.png',
  '/assets/scenario-cover-4.png',
];

interface ScenarioExampleCardsProps {
  examples: readonly ScenarioExample[] | null;
  error: string | null;
  onRetry: () => void;
  onPick: (example: ScenarioExample) => void;
  selectedName: string | null;
}

/**
 * Ряд из четырёх карточек 262×227 на y = 800 с шагом 281, как в макете. В потоке —
 * сетка две на две на телефоне и четыре в ряд на планшете; обложка держит пропорцию
 * макетной карточки, а не её пиксели.
 */
export const ScenarioExampleCards = forwardRef<HTMLElement, ScenarioExampleCardsProps>(
  function ScenarioExampleCards({ examples, error, onRetry, onPick, selectedName }, ref) {
    const stacked = useStacked();

    return (
      <section
        ref={ref}
        aria-labelledby="examples-title"
        className={stacked ? 'w-full' : 'absolute left-[26px] top-[800px] h-[227px] w-[1115px]'}
      >
        <h2
          id="examples-title"
          className={cx(
            'font-semibold text-ink-primary',
            stacked
              ? 'mb-[12px] px-[4px] text-title-m'
              : 'absolute left-[18px] top-[-43px] text-title-l leading-[31px]',
          )}
        >
          Примеры сценариев
        </h2>

        {error !== null ? (
          <Card
            sceneX={26}
            sceneY={800}
            className={stacked ? 'min-h-[227px] w-full' : 'h-full w-full'}
          >
            <ErrorBlock
              title="Примеры не загрузились"
              message={error}
              onRetry={onRetry}
              retryLabel="Загрузить снова"
            />
          </Card>
        ) : (
          <ul
            className={
              stacked
                ? 'grid grid-cols-2 gap-[12px] md:grid-cols-4 md:gap-[16px]'
                : 'flex h-full gap-[19px]'
            }
          >
            {examples === null
              ? COVERS.map((cover) => (
                  <li key={cover}>
                    <Skeleton
                      className={
                        stacked
                          ? 'aspect-[262/227] w-full rounded-xl'
                          : 'h-[227px] w-[262px] rounded-xl'
                      }
                    />
                  </li>
                ))
              : examples.map((example, index) => (
                  <li key={example.name}>
                    <ExampleCard
                      example={example}
                      cover={COVERS[index % COVERS.length] ?? ''}
                      selected={example.name === selectedName}
                      stacked={stacked}
                      onPick={onPick}
                    />
                  </li>
                ))}
          </ul>
        )}
      </section>
    );
  },
);

function ExampleCard({
  example,
  cover,
  selected,
  stacked,
  onPick,
}: {
  example: ScenarioExample;
  cover: string;
  selected: boolean;
  stacked: boolean;
  onPick: (example: ScenarioExample) => void;
}) {
  const title = example.title === '' ? example.name : example.title;

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => {
        onPick(example);
      }}
      className={cx(
        'flex flex-col overflow-hidden rounded-xl border-2 bg-surface-sunken text-left transition-[border-color,box-shadow] duration-150',
        stacked ? 'h-full w-full' : 'h-[227px] w-[262px]',
        selected ? 'border-line-strong shadow-glow-blue' : 'border-line hover:border-line-strong',
      )}
    >
      <img
        src={cover}
        alt=""
        className={
          stacked ? 'aspect-[262/161] w-full object-cover' : 'min-h-0 w-full flex-1 object-cover'
        }
      />
      <span
        className={cx(
          'flex w-full shrink-0 flex-col items-center justify-center gap-[2px] overflow-hidden bg-surface-raised px-[10px]',
          stacked ? 'min-h-[66px] flex-1 py-[8px]' : 'h-[66px]',
        )}
      >
        {/* Название длиннее карточки занимает две строки; подпись файла остаётся видна,
            а обрезанное название целиком уходит в подсказку. */}
        <span
          className={cx(
            'line-clamp-2 text-center font-semibold leading-[1.15] text-ink-primary',
            stacked ? 'text-small md:text-base' : 'text-title-m',
          )}
          title={title}
        >
          {title}
        </span>
        <span
          className="w-full truncate text-center font-mono text-[10px] text-ink-muted"
          title={example.name}
        >
          {example.name}
        </span>
      </span>
    </button>
  );
}
