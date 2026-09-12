import { Download, FileText } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { comparisonEvidencePackPath, compareRuns } from '@/api/comparisons';
import { getProject } from '@/api/projects';
import { createRun } from '@/api/runs';
import type { ComparisonResult, ProjectDetail, RoutingPolicy } from '@/api/types';
import { useProjectSelection } from '@/app/project-selection';
import { NETWORK_PATH } from '@/app/sections';
import { EmptyState, ErrorBlock, LoadingBlock, Skeleton } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import { cx } from '@/lib/cx';
import { downloadFile, saveText } from '@/lib/download';
import { describe, useResource } from '@/lib/use-resource';
import { AvailabilityCard } from './AvailabilityCard';
import { ChangedParametersCard } from './ChangedParametersCard';
import { comparisonCsv } from './csv';
import { MetricsCard } from './MetricsCard';
import { RecommendationCard } from './RecommendationCard';
import { defaultRunIds, groupRuns, policyRuns, variantOfRun } from './runs';
import { TimelineCard } from './TimelineCard';
import { VariantRow } from './VariantRow';
import type { CompareMode } from './VariantRow';

/** Сравнению нужны минимум два запуска: с одним сравнивать не с чем (`05_API.md` §1). */
const MIN_RUNS = 2;

type ComparisonState = ComparisonResult | 'incomplete';

/**
 * Экран «05 · Сравнение вариантов» (узел Figma `45:440`). Блоки расставлены по координатам
 * макета внутри полотна 1920×1080: строка вариантов на y = 166, метрики 1160×288 на
 * (26, 266), изменённые параметры 692×288 на (1202, 266), график доступности на (26, 564),
 * рекомендация на (1202, 564) и шкалы 1868×206 на (26, 862).
 */
export function ComparePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [mode, setMode] = useState<CompareMode>('variants');
  const [busyVariantId, setBusyVariantId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Проект приходит запросом всегда: адрес «/comparison» без него до экрана не доходит —
  // маршрут либо подставляет текущий проект, либо просит его выбрать.
  const { select } = useProjectSelection();
  const projectId = params.get('project') ?? '';
  const runsParam = params.get('runs') ?? '';

  const loadProject = useCallback(() => getProject(projectId), [projectId]);
  const project = useResource<ProjectDetail>(loadProject);

  const groups = useMemo(
    () => (project.data === null ? [] : groupRuns(project.data)),
    [project.data],
  );

  const runIds = useMemo(
    () => (runsParam === '' ? [] : runsParam.split(',')),
    [runsParam],
  );

  const setRunIds = useCallback(
    (next: readonly string[]) => {
      setParams(
        (current) => {
          const updated = new URLSearchParams(current);
          updated.set('runs', next.join(','));
          return updated;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // Экран открывают из списка проектов без выбранных запусков. Пустое сравнение вместо
  // готового заставляло бы собирать его руками при каждом переходе.
  useEffect(() => {
    if (runIds.length === 0 && groups.length > 0) {
      const defaults = defaultRunIds(groups);
      if (defaults.length >= MIN_RUNS) {
        setRunIds(defaults);
      }
    }
  }, [groups, runIds.length, setRunIds]);

  const comparisonKey = runIds.join(',');
  const loadComparison = useCallback(async (): Promise<ComparisonState> => {
    const ids = comparisonKey === '' ? [] : comparisonKey.split(',');
    if (ids.length < MIN_RUNS) {
      return 'incomplete';
    }
    return compareRuns(ids);
  }, [comparisonKey]);
  const comparison = useResource<ComparisonState>(loadComparison);

  const entries =
    comparison.data === null || comparison.data === 'incomplete' ? null : comparison.data.entries;

  // Шапка показывает «Проект › Вариант» из общего выбора, а не из своих запросов.
  useEffect(() => {
    select({
      projectId: projectId === '' ? null : projectId,
      variantId: entries?.[0]?.variant_id ?? null,
      runId: runIds[0] ?? null,
    });
  }, [select, projectId, entries, runIds]);

  const target =
    runIds[0] === undefined
      ? null
      : (variantOfRun(groups, runIds[0])?.scenario.environment.target_availability ?? null);

  const switchMode = useCallback(
    (next: CompareMode) => {
      setMode(next);
      setNotice(null);
      if (next === 'policies') {
        const baseRunId = runIds[0];
        const group =
          baseRunId === undefined
            ? undefined
            : groups.find((item) => item.runs.some((run) => run.id === baseRunId));
        setRunIds(group === undefined ? [] : policyRuns(group).map((run) => run.id));
      } else {
        setRunIds(defaultRunIds(groups));
      }
    },
    [groups, runIds, setRunIds],
  );

  const calculate = useCallback(
    (variantId: string, policy: RoutingPolicy) => {
      setBusyVariantId(variantId);
      setNotice(null);
      void createRun({ variant_id: variantId, routing_policy: policy }).then(
        (run) => {
          setBusyVariantId(null);
          setNotice(
            run.status === 'succeeded'
              ? 'Готовый расчёт нашёлся по хэшу конфигурации — вариант можно добавить в сравнение.'
              : 'Расчёт поставлен в очередь. Он появится в списке, когда завершится.',
          );
          project.reload();
        },
        (error: unknown) => {
          setBusyVariantId(null);
          setNotice(describe(error));
        },
      );
    },
    [project],
  );

  const downloadEvidence = useCallback(() => {
    const [baseRunId, candidateRunId] = runIds;
    if (baseRunId === undefined || candidateRunId === undefined) {
      return;
    }
    setNotice(null);
    void downloadFile(
      comparisonEvidencePackPath(candidateRunId, baseRunId),
      `evidence-pack-${candidateRunId.slice(0, 8)}.zip`,
    ).catch((error: unknown) => { setNotice(describe(error)); });
  }, [runIds]);

  const downloadCsv = useCallback(() => {
    if (entries !== null) {
      saveText(comparisonCsv(entries), 'comparison.csv', 'text/csv');
    }
  }, [entries]);

  if (projectId === '') {
    return (
      <Screen>
        <Card sceneX={26} sceneY={200} className="absolute left-[26px] top-[200px] h-[420px] w-[1868px]">
          <EmptyState
            title="Проект не выбран"
            hint="Откройте сравнение из проекта: адрес экрана содержит его идентификатор — /compare?project=…"
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <div className="absolute left-[1088px] top-[116px] flex h-[44px] w-[350px] items-center rounded-md border border-line bg-surface-input p-[4px]">
        {(['variants', 'policies'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => { switchMode(value); }}
            className={cx(
              'h-[36px] flex-1 rounded-sm text-small font-semibold transition-colors duration-150',
              mode === value
                ? 'bg-accent-violet text-ink-onAccent'
                : 'text-ink-secondary hover:text-ink-primary',
            )}
          >
            {value === 'variants' ? 'Варианты' : 'Политики'}
          </button>
        ))}
      </div>

      <HeaderButton
        left={1460}
        width={200}
        disabled={runIds.length < MIN_RUNS}
        onClick={downloadEvidence}
        icon={<Download aria-hidden="true" className="size-[16px]" />}
      >
        Evidence Pack
      </HeaderButton>
      <HeaderButton
        left={1676}
        width={118}
        disabled={entries === null}
        onClick={downloadCsv}
        icon={<FileText aria-hidden="true" className="size-[16px]" />}
      >
        CSV
      </HeaderButton>

      {notice !== null && (
        <p
          role="status"
          title={notice}
          className="absolute left-[420px] top-[120px] line-clamp-2 w-[640px] text-small text-ink-secondary"
        >
          {notice}
        </p>
      )}

      {project.error !== null && (
        <Card sceneX={26} sceneY={166} className="absolute left-[26px] top-[166px] h-[420px] w-[1868px]">
          <ErrorBlock title="Проект не загрузился" message={project.error} onRetry={project.reload} />
        </Card>
      )}

      {project.data === null && project.error === null && (
        <LoadingBlock label="Загрузка вариантов проекта">
          <div className="absolute left-[26px] top-[166px] flex gap-[16px]">
            <Skeleton className="h-[88px] w-[455px]" />
            <Skeleton className="h-[88px] w-[455px]" />
          </div>
        </LoadingBlock>
      )}

      {project.data !== null && (
        <VariantRow
          mode={mode}
          groups={groups}
          runIds={runIds}
          entries={entries}
          busyVariantId={busyVariantId}
          onChange={setRunIds}
          onCalculate={calculate}
        />
      )}

      {comparison.error !== null && (
        <Card sceneX={26} sceneY={266} className="absolute left-[26px] top-[266px] h-[420px] w-[1868px]">
          <ErrorBlock
            title="Сравнение не построено"
            message={comparison.error}
            onRetry={comparison.reload}
          />
        </Card>
      )}

      {comparison.data === 'incomplete' && project.data !== null && (
        <Card sceneX={26} sceneY={266} className="absolute left-[26px] top-[266px] h-[420px] w-[1868px]">
          <EmptyState
            title={mode === 'variants' ? 'Выбран один вариант' : 'Политика посчитана одна'}
            hint={
              mode === 'variants'
                ? 'Добавьте второй вариант с завершённым расчётом: сравнивать один вариант не с чем.'
                : 'Рассчитайте этот же вариант другой политикой маршрутизации — тогда их можно положить рядом.'
            }
          />
        </Card>
      )}

      {entries !== null && (
        <>
          <MetricsCard entries={entries} />
          <ChangedParametersCard entries={entries} />
          <AvailabilityCard entries={entries} target={target} />
          <RecommendationCard
            entries={entries}
            onApply={(variantId) => {
              // Сделать вариант активным нечем: в `05_API.md` §2 нет endpoint, который
              // меняет `active_variant_id`. Экран открывает вариант на «Сети», а не
              // делает вид, что применил его.
              navigate(`${NETWORK_PATH}/${projectId}?variant=${variantId}`);
            }}
            onSwap={() => {
              const [first, second, ...rest] = runIds;
              if (first !== undefined && second !== undefined) {
                setRunIds([second, first, ...rest]);
              }
            }}
          />
          <TimelineCard
            entries={entries}
            onOpenTick={(variantId, seconds) => {
              navigate(`${NETWORK_PATH}/${projectId}?variant=${variantId}&t=${seconds}`);
            }}
          />
        </>
      )}
    </Screen>
  );
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0">
      <h1 className="absolute left-[36px] top-[110px] text-heading-m font-bold text-ink-primary">
        Сравнение вариантов
      </h1>
      {children}
    </div>
  );
}

function HeaderButton({
  left,
  width,
  disabled,
  onClick,
  icon,
  children,
}: {
  left: number;
  width: number;
  disabled: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{ left, width }}
      className={cx(
        'absolute top-[116px] flex h-[44px] items-center gap-[8px] rounded-md',
        'border border-line bg-surface-input px-[16px] text-small font-semibold text-ink-primary',
        'transition-colors duration-150 hover:border-line-strong',
        'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-line',
      )}
    >
      {icon}
      {children}
    </button>
  );
}
