import { forwardRef } from 'react';

import type { ScenarioExample } from '@/api/scenario-files';
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

/** Ряд из четырёх карточек 262×227 на y = 800 с шагом 281, как в макете. */
export const ScenarioExampleCards = forwardRef<HTMLElement, ScenarioExampleCardsProps>(
  function ScenarioExampleCards({ examples, error, onRetry, onPick, selectedName }, ref) {
    return (
      <section
        ref={ref}
        aria-labelledby="examples-title"
        className="absolute left-[26px] top-[800px] h-[227px] w-[1115px]"
      >
        <h2
          id="examples-title"
          className="absolute left-[18px] top-[-43px] text-title-l font-semibold leading-[31px] text-ink-primary"
        >
          Примеры сценариев
        </h2>

        {error !== null ? (
          <Card sceneX={26} sceneY={800} className="h-full w-full">
            <ErrorBlock
              title="Примеры не загрузились"
              message={error}
              onRetry={onRetry}
              retryLabel="Загрузить снова"
            />
          </Card>
        ) : (
          <ul className="flex h-full gap-[19px]">
            {examples === null
              ? COVERS.map((cover) => (
                  <li key={cover}>
                    <Skeleton className="h-[227px] w-[262px] rounded-xl" />
                  </li>
                ))
              : examples.map((example, index) => (
                  <li key={example.name}>
                    <ExampleCard
                      example={example}
                      cover={COVERS[index % COVERS.length] ?? ''}
                      selected={example.name === selectedName}
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
  onPick,
}: {
  example: ScenarioExample;
  cover: string;
  selected: boolean;
  onPick: (example: ScenarioExample) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => {
        onPick(example);
      }}
      className={cx(
        'flex h-[227px] w-[262px] flex-col overflow-hidden rounded-xl border-2 bg-surface-sunken text-left transition-[border-color,box-shadow] duration-150',
        selected ? 'border-line-strong shadow-glow-blue' : 'border-line hover:border-line-strong',
      )}
    >
      <img src={cover} alt="" className="min-h-0 w-full flex-1 object-cover" />
      <span className="flex h-[66px] w-full shrink-0 flex-col items-center justify-center gap-[2px] overflow-hidden bg-surface-raised px-[10px]">
        {/* Название длиннее карточки занимает две строки; подпись файла остаётся видна. */}
        <span className="line-clamp-2 text-center text-title-m font-semibold leading-[1.15] text-ink-primary">
          {example.title === '' ? example.name : example.title}
        </span>
        <span className="w-full truncate text-center font-mono text-[10px] text-ink-muted">
          {example.name}
        </span>
      </span>
    </button>
  );
}
