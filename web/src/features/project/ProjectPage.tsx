import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, Check, FileText, Layers, Package, Plus } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ReactNode } from 'react';

import { getProjectBoard, variantExportPath } from '@/api/projects';
import type { ProjectBoard } from '@/api/projects';
import { createRun, runEvidencePackPath } from '@/api/runs';
import type { Run, Variant } from '@/api/types';
import { COMPARISON_PATH, NETWORK_PATH } from '@/app/sections';
import { useProjectSelection } from '@/app/project-selection';
import { ErrorBlock, LoadingBlock, Skeleton } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import { cx } from '@/lib/cx';
import { downloadFile, exportFileName } from '@/lib/download';
import { formatDate, policyLabel, variantLabel, variantLetter } from '@/lib/run-format';
import { describe, useResource } from '@/lib/use-resource';
import { LineageCard } from './LineageCard';
import { RunsCard } from './RunsCard';
import type { RunRowView } from './RunsCard';
import { VariantsCard } from './VariantsCard';
import type { VariantRowView } from './VariantsCard';

/** Политика по умолчанию `POST /api/runs`: ею считается запуск из шапки экрана. */
const DEFAULT_POLICY = 'bfs_shortest';

/** Столько последних запусков отдаёт `GET /api/projects/{id}` (`RECENT_RUNS_LIMIT` сервиса). */
const RECENT_RUNS_LIMIT = 20;

/**
 * Экран «08 · Проект» (узел Figma 147:1143) на полотне 1920×1080: варианты, происхождение
 * и прогоны проекта. Сюда пользователь возвращается к варианту (`01_SPEC.md` §1 п. 8).
 */
export function ProjectPage() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { select } = useProjectSelection();

  const load = useCallback(() => getProjectBoard(projectId), [projectId]);
  const board = useResource<ProjectBoard>(load);

  const [actionError, setActionError] = useState<string | null>(null);
  const [runningVariantId, setRunningVariantId] = useState<string | null>(null);

  useEffect(() => {
    select({ projectId, variantId: null, runId: null });
  }, [select, projectId]);

  const view = useMemo(() => (board.data === null ? null : buildView(board.data)), [board.data]);

  const startRun = useCallback(
    (variant: Variant, policy: Run['routing_policy']) => {
      setActionError(null);
      setRunningVariantId(variant.id);
      void createRun({ variant_id: variant.id, routing_policy: policy }).then(
        (run) => {
          navigate(`/result/${run.id}`);
        },
        (error: unknown) => {
          setRunningVariantId(null);
          setActionError(describe(error));
        },
      );
    },
    [navigate],
  );

  const save = useCallback((path: string, fileName: string) => {
    setActionError(null);
    void downloadFile(path, fileName).catch((error: unknown) => {
      setActionError(describe(error));
    });
  }, []);

  if (board.error !== null) {
    return (
      <Card
        sceneX={25}
        sceneY={214}
        className="absolute left-[25px] top-[214px] h-[410px] w-[1250px]"
      >
        <ErrorBlock title="Проект не загрузился" message={board.error} onRetry={board.reload} />
      </Card>
    );
  }

  if (view === null) {
    return (
      <LoadingBlock label="Загружаем проект">
        <Skeleton className="absolute left-[36px] top-[110px] h-[80px] w-[760px] rounded-2xl" />
        <Skeleton className="absolute left-[25px] top-[214px] h-[410px] w-[1250px] rounded-2xl" />
        <Skeleton className="absolute left-[1299px] top-[214px] h-[410px] w-[596px] rounded-2xl" />
        <Skeleton className="absolute left-[25px] top-[640px] h-[416px] w-[1870px] rounded-2xl" />
      </LoadingBlock>
    );
  }

  const { project, variantRows, runRows, activeRow, latestSucceeded, scenarioId } = view;

  return (
    <>
      <h1 className="absolute left-[36px] top-[110px] w-[1400px] truncate font-display text-[36px] font-bold leading-[46px] text-ink-primary">
        {project.title}
      </h1>

      <div className="absolute left-[36px] top-[162px] flex gap-[10px]">
        <Chip icon={<FileText aria-hidden="true" className="size-[14px]" />}>
          сценарий {scenarioId ?? '—'}
        </Chip>
        <Chip icon={<Calendar aria-hidden="true" className="size-[14px]" />}>
          создан {formatDate(project.created_at)}
        </Chip>
        <Chip icon={<Layers aria-hidden="true" className="size-[14px]" />}>
          {variantRows.length} вариантов · {runRows.length} прогонов
        </Chip>
        <Chip icon={<Check aria-hidden="true" className="size-[14px]" />}>
          активный вариант — {activeRow === null ? '—' : variantLetter(activeRow.index)}
        </Chip>
      </div>

      <button
        type="button"
        disabled={activeRow === null || runningVariantId !== null}
        onClick={() => {
          if (activeRow !== null) {
            startRun(activeRow.variant, DEFAULT_POLICY);
          }
        }}
        title={`Запустить расчёт активного варианта с политикой «${policyLabel(DEFAULT_POLICY)}»`}
        className={cx(
          'absolute left-[1466px] top-[122px] flex h-[46px] w-[190px] items-center justify-center gap-[8px] rounded-md',
          'bg-accent-violet text-[13px] font-semibold text-ink-onAccent shadow-glow-violet',
          'transition-[filter] duration-150 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45',
        )}
      >
        <Plus aria-hidden="true" className="size-[16px]" />
        Новый расчёт
      </button>

      <button
        type="button"
        disabled={latestSucceeded === null}
        onClick={() => {
          if (latestSucceeded !== null) {
            save(
              runEvidencePackPath(latestSucceeded.run.id),
              exportFileName([project.title, latestSucceeded.variantLabel], 'zip'),
            );
          }
        }}
        title="Архив по последнему успешному расчёту проекта"
        className={cx(
          'absolute left-[1676px] top-[122px] flex h-[46px] w-[205px] items-center justify-center gap-[8px] rounded-md',
          'border border-line bg-surface-raised text-[13px] font-semibold text-ink-primary',
          'transition-colors duration-150 hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-45',
        )}
      >
        <Package aria-hidden="true" className="size-[16px]" />
        Evidence Pack
      </button>

      {actionError !== null && (
        <p
          role="alert"
          className="absolute left-[1300px] top-[178px] w-[581px] text-right text-caption text-status-danger"
        >
          {actionError}
        </p>
      )}

      <VariantsCard
        rows={variantRows}
        runningVariantId={runningVariantId}
        onOpenNetwork={(row) => {
          navigate(`${NETWORK_PATH}/${projectId}?variant=${row.variant.id}`);
        }}
        onRun={(row) => {
          startRun(row.variant, row.latestRun?.routing_policy ?? DEFAULT_POLICY);
        }}
        onCompare={(row) => {
          if (row.latestRun !== null) {
            navigate(`${COMPARISON_PATH}?runs=${row.latestRun.id}`);
          }
        }}
        onExport={(row) => {
          save(
            variantExportPath(row.variant.id),
            exportFileName([project.title, row.variant.title, 'scenario'], 'json'),
          );
        }}
      />

      <LineageCard lineage={view.lineage} labelOf={view.labelOf} />

      <RunsCard
        rows={runRows}
        limit={RECENT_RUNS_LIMIT}
        repeatDisabled={runningVariantId !== null}
        onOpen={(row) => {
          navigate(`/result/${row.run.id}`);
        }}
        onEvidencePack={(row) => {
          save(
            runEvidencePackPath(row.run.id),
            exportFileName([project.title, row.variantLabel], 'zip'),
          );
        }}
        onCompare={(row) => {
          navigate(`${COMPARISON_PATH}?runs=${row.run.id}`);
        }}
        onRepeat={(row) => {
          const variant = view.variantById.get(row.run.variant_id);
          if (variant !== undefined) {
            startRun(variant, row.run.routing_policy);
          }
        }}
      />
    </>
  );
}

interface ProjectView {
  readonly project: ProjectBoard['detail']['project'];
  readonly lineage: ProjectBoard['lineage'];
  readonly variantRows: readonly VariantRowView[];
  readonly runRows: readonly RunRowView[];
  readonly variantById: ReadonlyMap<string, Variant>;
  readonly activeRow: VariantRowView | null;
  readonly latestSucceeded: RunRowView | null;
  readonly labelOf: (variantId: string) => string | null;
  /** `meta.id` сценария активного варианта: чип с именем файла в макете. */
  readonly scenarioId: string | null;
}

function buildView(board: ProjectBoard): ProjectView {
  const { detail, lineage, metricsByRun } = board;
  const variantById = new Map(detail.variants.map((variant) => [variant.id, variant]));
  const indexById = new Map(detail.variants.map((variant, index) => [variant.id, index]));

  const labelOf = (variantId: string): string | null => {
    const variant = variantById.get(variantId);
    const index = indexById.get(variantId);
    return variant === undefined || index === undefined ? null : variantLabel(index, variant.title);
  };

  // `recent_runs` приходят по убыванию даты, поэтому первый запуск варианта в списке и
  // есть последний по времени.
  const latestRunByVariant = new Map<string, Run>();
  for (const run of detail.recent_runs) {
    if (!latestRunByVariant.has(run.variant_id)) {
      latestRunByVariant.set(run.variant_id, run);
    }
  }

  const availabilityOf = (run: Run | null): number | null =>
    run === null ? null : (metricsByRun.get(run.id)?.config.min_client_availability ?? null);

  const variantRows: VariantRowView[] = detail.variants.map((variant, index) => {
    const parentId = variant.parent_variant_id;
    const latestRun = latestRunByVariant.get(variant.id) ?? null;
    return {
      variant,
      index,
      parentTitle: parentId == null ? null : (labelOf(parentId) ?? null),
      latestRun,
      minAvailability: availabilityOf(latestRun),
      active: detail.project.active_variant_id === variant.id,
    };
  });

  const runRows: RunRowView[] = detail.recent_runs.map((run) => ({
    run,
    variantLabel: labelOf(run.variant_id) ?? run.variant_id,
    minAvailability: availabilityOf(run),
  }));

  const activeRow = variantRows.find((row) => row.active) ?? variantRows[0] ?? null;
  const latestSucceeded = runRows.find((row) => row.run.status === 'succeeded') ?? null;

  return {
    project: detail.project,
    lineage,
    variantRows,
    runRows,
    variantById,
    activeRow,
    latestSucceeded,
    labelOf,
    scenarioId: activeRow?.variant.scenario.meta.id ?? null,
  };
}

function Chip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex h-[27px] items-center gap-[7px] rounded-[8px] border border-line bg-surface-sunken pl-[11px] pr-[13px] text-[12px] font-medium leading-[15px] text-ink-secondary">
      <span className="text-ink-muted">{icon}</span>
      {children}
    </span>
  );
}
