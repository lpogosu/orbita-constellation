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

export const ScenarioExampleCards = forwardRef<HTMLElement, ScenarioExampleCardsProps>(
  function ScenarioExampleCards({ examples, error, onRetry, onPick, selectedName }, ref) {
    return (
      <section ref={ref} aria-labelledby="examples-title" className="mt-[30px]">
        <h2 id="examples-title" className="text-title-l font-semibold text-ink-primary">
          Примеры сценариев
        </h2>

        {error !== null ? (
          <Card className="mt-4">
            <ErrorBlock
              title="Примеры не загрузились"
              message={error}
              onRetry={onRetry}
              retryLabel="Загрузить снова"
            />
          </Card>
        ) : (
          <ul className="mt-4 grid grid-cols-4 gap-[19px]">
            {examples === null
              ? COVERS.map((cover) => (
                  <li key={cover}>
                    <Skeleton className="h-[227px] w-full" />
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
        'flex h-[227px] w-full flex-col overflow-hidden rounded-xl border-2 bg-surface-sunken text-left transition-[border-color,box-shadow] duration-150',
        selected
          ? 'border-line-strong shadow-glow-blue'
          : 'border-transparent hover:border-line',
      )}
    >
      <img src={cover} alt="" className="h-[161px] w-full object-cover" />
      <span className="flex h-[66px] flex-col items-center justify-center gap-0.5 bg-surface-raised px-2 text-center">
        <span className="truncate text-title-m font-semibold text-ink-primary">
          {example.title === '' ? example.name : example.title}
        </span>
        <span className="truncate font-mono text-[10px] text-ink-muted">{example.name}</span>
      </span>
    </button>
  );
}
