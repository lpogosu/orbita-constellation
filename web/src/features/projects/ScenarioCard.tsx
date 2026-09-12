import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Check,
  Clock,
  FileText,
  Hash,
  LayoutGrid,
  Layers,
  Link2,
  Radio,
  Rocket,
  Timer,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useId, useState } from 'react';

import type { GroundSite, Plane, Scenario, ScenarioValidationResult } from '@/api/types';
import { EmptyState, ErrorBlock, LoadingBlock, Skeleton } from '@/components/state/States';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { cx } from '@/lib/cx';
import { formatCount, formatDuration, shortHash } from '@/lib/format';
import { sourceName, sourceOrigin } from './scenario-source';
import type { ScenarioReview } from './use-scenario-review';

interface ScenarioCardProps {
  review: ScenarioReview;
  creating: boolean;
  createError: string | null;
  onOpenProject: () => void;
  onRecheck: () => void;
  onShowProblems: () => void;
}

/** Card / Сценарий: обзор загруженного файла и переход в проект. */
export function ScenarioCard({
  review,
  creating,
  createError,
  onOpenProject,
  onRecheck,
  onShowProblems,
}: ScenarioCardProps) {
  return (
    <Card className="min-h-[600px]">
      <div className="flex h-full flex-col p-[19px]">
        {review.kind === 'idle' && (
          <EmptyState
            icon={<FileText aria-hidden="true" className="size-6" />}
            title="Сценарий не выбран"
            hint="Перетащите файл или выберите пример — здесь появится обзор сценария: состав группировки, сетка времени и отпечаток конфигурации."
          />
        )}

        {review.kind === 'checking' && <CheckingState name={sourceName(review.source)} />}

        {review.kind === 'unavailable' && (
          <ErrorBlock
            title="Проверка не выполнена"
            message={review.message}
            onRetry={onRecheck}
            retryLabel="Повторить проверку"
          />
        )}

        {review.kind === 'rejected' && (
          <RejectedState
            name={sourceName(review.source)}
            origin={sourceOrigin(review.source)}
            count={review.problems.length}
            onShowProblems={onShowProblems}
          />
        )}

        {review.kind === 'accepted' && (
          <AcceptedState
            name={sourceName(review.source)}
            origin={sourceOrigin(review.source)}
            summary={review.summary}
            scenario={review.parsed.document as Scenario}
            creating={creating}
            createError={createError}
            onOpenProject={onOpenProject}
          />
        )}
      </div>
    </Card>
  );
}

function CheckingState({ name }: { name: string }) {
  return (
    <LoadingBlock label={`Проверяем сценарий ${name}`}>
      <div className="space-y-4">
        <Skeleton className="h-[96px] w-full rounded-xl" />
        <p className="text-base text-ink-secondary">Проверяем сценарий…</p>
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-[26px]" />
          ))}
        </div>
        <Skeleton className="h-[118px] w-full" />
      </div>
    </LoadingBlock>
  );
}

function RejectedState({
  name,
  origin,
  count,
  onShowProblems,
}: {
  name: string;
  origin: string;
  count: number;
  onShowProblems: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <FileHeader
        name={name}
        origin={origin}
        badge={
          <Badge tone="danger" icon={<AlertTriangle aria-hidden="true" className="size-3.5" />}>
            Файл отклонён
          </Badge>
        }
      />
      <p className="text-base text-ink-secondary">
        {formatCount(count, 'ошибка', 'ошибки', 'ошибок')} во входных данных. Сервис перечисляет
        все сразу, чтобы файл правился за один проход.
      </p>
      <Button variant="secondary" className="self-start" onClick={onShowProblems}>
        Показать ошибки
      </Button>
    </div>
  );
}

function AcceptedState({
  name,
  origin,
  summary,
  scenario,
  creating,
  createError,
  onOpenProject,
}: {
  name: string;
  origin: string;
  summary: ScenarioValidationResult;
  scenario: Scenario;
  creating: boolean;
  createError: string | null;
  onOpenProject: () => void;
}) {
  const { environment, design, ground_sites: groundSites } = scenario;

  return (
    <div className="flex h-full flex-col gap-4">
      <FileHeader
        name={name}
        origin={origin}
        badge={
          <Badge tone="success" icon={<Check aria-hidden="true" className="size-3.5" />}>
            Файл корректен
          </Badge>
        }
      />

      <Divider />

      <section className="px-2">
        <h3 className="text-[18px] font-semibold text-ink-primary">Параметры сценария</h3>
        <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-[18px] 2xl:grid-cols-4">
          <Param icon={<Rocket aria-hidden="true" className="size-[22px]" />} term="Аппараты">
            {formatCount(summary.satellite_count, 'спутник', 'спутника', 'спутников')}
          </Param>
          <Param icon={<Layers aria-hidden="true" className="size-[22px]" />} term="Плоскости">
            {formatCount(summary.plane_count, 'плоскость', 'плоскости', 'плоскостей')}
          </Param>
          <Param icon={<Users aria-hidden="true" className="size-[22px]" />} term="Клиенты">
            {formatCount(summary.client_count, 'клиент', 'клиента', 'клиентов')}
          </Param>
          <Param icon={<Radio aria-hidden="true" className="size-[22px]" />} term="Шлюзы">
            {formatCount(summary.gateway_count, 'шлюз', 'шлюза', 'шлюзов')}
          </Param>
          <Param icon={<Clock aria-hidden="true" className="size-[22px]" />} term="Горизонт">
            {formatDuration(environment.horizon_s)}
          </Param>
          <Param icon={<Timer aria-hidden="true" className="size-[22px]" />} term="Шаг сетки">
            шаг {environment.step_s} с
          </Param>
          <Param icon={<Link2 aria-hidden="true" className="size-[22px]" />} term="Дальность ISL">
            ISL {environment.isl_range_km} км
          </Param>
          <Param icon={<LayoutGrid aria-hidden="true" className="size-[22px]" />} term="Отсчёты">
            {formatCount(summary.total_ticks, 'отсчёт', 'отсчёта', 'отсчётов')}
          </Param>
        </dl>

        <p className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-caption text-ink-muted">
          <span data-numeric>
            Активных аппаратов: {summary.active_satellite_count} из {summary.satellite_count} ·
            очередей запущено {design.launch_stage}
          </span>
          <span className="inline-flex items-center gap-1.5" title={summary.config_hash}>
            <Hash aria-hidden="true" className="size-3.5" />
            <span className="font-mono">{shortHash(summary.config_hash)}</span>
          </span>
        </p>
      </section>

      <Divider />

      <Collapsible title="Плоскости" count={design.planes.length} defaultOpen>
        <PlanesTable planes={design.planes} />
      </Collapsible>

      <Collapsible title="Наземные станции" count={groundSites.length}>
        <GroundSitesTable sites={groundSites} />
      </Collapsible>

      <div className="mt-auto pt-4">
        {createError !== null && (
          <p role="alert" className="mb-3 flex items-start gap-2 text-small text-status-danger">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {createError}
          </p>
        )}
        <Divider />
        <div className="mt-4 flex flex-wrap gap-5">
          <Button
            className="min-w-[240px] flex-1 2xl:max-w-[385px]"
            disabled={creating}
            onClick={onOpenProject}
            iconAfter={<ChevronRight aria-hidden="true" className="size-[22px]" />}
          >
            {creating ? 'Создаём проект…' : 'Открыть проект'}
          </Button>
          <Button
            variant="secondary"
            className="min-w-[220px] flex-1 2xl:max-w-[260px]"
            disabled
            title="Доступно, когда открыт проект: файл станет его новым вариантом"
          >
            Добавить как вариант
          </Button>
        </div>
      </div>
    </div>
  );
}

function FileHeader({
  name,
  origin,
  badge,
}: {
  name: string;
  origin: string;
  badge: ReactNode;
}) {
  return (
    <div className="flex items-center gap-6 rounded-xl bg-surface-raised px-6 py-[22px]">
      <FileText aria-hidden="true" className="size-[34px] shrink-0 text-accent-blue" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold text-ink-primary">{name}</p>
        <p className="truncate text-caption text-ink-muted">{origin}</p>
      </div>
      {badge}
    </div>
  );
}

function Badge({
  tone,
  icon,
  children,
}: {
  tone: 'success' | 'danger';
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center gap-[7px] rounded-pill border py-[7px] pl-3 pr-3.5 text-[13px] font-semibold',
        tone === 'success'
          ? 'border-status-success bg-[var(--status-success-soft)] text-status-success'
          : 'border-status-danger bg-[var(--status-danger-soft)] text-status-danger',
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function Param({
  icon,
  term,
  children,
}: {
  icon: ReactNode;
  term: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-accent-blue">{icon}</span>
      <dt className="sr-only">{term}</dt>
      <dd className="truncate text-small font-medium text-ink-secondary" data-numeric>
        {children}
      </dd>
    </div>
  );
}

function Divider() {
  return <hr className="border-0 border-t border-line-divider" />;
}

function Collapsible({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section className="px-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => {
          setOpen((current) => !current);
        }}
        className="flex w-full items-center gap-2 text-left"
      >
        {open ? (
          <ChevronDown aria-hidden="true" className="size-[18px] text-ink-secondary" />
        ) : (
          <ChevronRight aria-hidden="true" className="size-[18px] text-ink-secondary" />
        )}
        <span className="text-[16px] font-semibold text-ink-primary">{title}</span>
        <span className="rounded-pill bg-surface-chip px-[9px] py-[3px] text-caption font-semibold text-ink-secondary">
          {count}
        </span>
        <span className="ml-auto text-caption font-medium text-accent-blue">
          {open ? 'Свернуть' : 'Развернуть'}
        </span>
      </button>
      <div id={bodyId} hidden={!open} className="mt-3">
        {children}
      </div>
    </section>
  );
}

function PlanesTable({ planes }: { planes: readonly Plane[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-small">
        <thead>
          <tr className="border-b border-line-divider text-micro uppercase text-ink-muted">
            <Th>Плоскость</Th>
            <Th>RAAN</Th>
            <Th>Фаза</Th>
          </tr>
        </thead>
        <tbody>
          {planes.map((plane) => (
            <tr key={plane.id}>
              <Td className="font-semibold text-ink-primary">{plane.id}</Td>
              <Td>{plane.raan_deg}°</Td>
              <Td>{plane.phase_deg}°</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroundSitesTable({ sites }: { sites: readonly GroundSite[] }) {
  return (
    <div className="max-h-[220px] overflow-auto">
      <table className="w-full text-small">
        <thead>
          <tr className="border-b border-line-divider text-micro uppercase text-ink-muted">
            <Th>Пункт</Th>
            <Th>Название</Th>
            <Th>Роль</Th>
            <Th>Широта</Th>
            <Th>Долгота</Th>
          </tr>
        </thead>
        <tbody>
          {sites.map((site) => (
            <tr key={site.id}>
              <Td className="font-semibold text-ink-primary">{site.id}</Td>
              <Td>{site.name}</Td>
              <Td>{site.role === 'gateway' ? 'шлюз' : 'клиент'}</Td>
              <Td>{site.lat_deg}°</Td>
              <Td>{site.lon_deg}°</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th scope="col" className="py-2 pr-4 text-left font-semibold tracking-[0.66px]">
      {children}
    </th>
  );
}

function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cx('py-2 pr-4 text-ink-secondary', className)}>{children}</td>;
}
