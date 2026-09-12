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
  Settings,
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

/** Высота прокручиваемой середины карточки: от «Параметров сценария» до нижнего разделителя. */
const BODY_HEIGHT = 348;
/** Строка с ошибкой создания проекта забирает высоту у середины, а не у ряда кнопок. */
const BODY_HEIGHT_WITH_ERROR = 316;

interface ScenarioCardProps {
  review: ScenarioReview;
  creating: boolean;
  createError: string | null;
  onOpenProject: () => void;
  onRecheck: () => void;
  onShowProblems: () => void;
}

/** Card / Сценарий: 721×600 на (1170, 452), обзор загруженного файла и вход в проект. */
export function ScenarioCard({
  review,
  creating,
  createError,
  onOpenProject,
  onRecheck,
  onShowProblems,
}: ScenarioCardProps) {
  return (
    <Card
      sceneX={1170}
      sceneY={452}
      className="absolute left-[1170px] top-[452px] h-[600px] w-[721px]"
    >
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
    </Card>
  );
}

function CheckingState({ name }: { name: string }) {
  return (
    <LoadingBlock label={`Проверяем сценарий ${name}`}>
      <Skeleton className="absolute left-[19px] top-[19px] h-[96px] w-[681px] rounded-[20px]" />
      <div className="absolute left-[27px] top-[151px] grid w-[665px] grid-cols-4 gap-x-[8px] gap-y-[18px]">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-[26px] w-[160px]" />
        ))}
      </div>
      <p className="absolute left-[27px] top-[297px] text-base text-ink-secondary">
        Проверяем сценарий…
      </p>
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
    <>
      <FileHeader
        name={name}
        origin={origin}
        badge={
          <Badge tone="danger" icon={<AlertTriangle aria-hidden="true" className="size-[14px]" />}>
            Файл отклонён
          </Badge>
        }
      />
      <Divider top={135} />
      <p className="absolute left-[27px] top-[151px] w-[665px] text-base text-ink-secondary">
        {formatCount(count, 'ошибка', 'ошибки', 'ошибок')} во входных данных. Сервис перечисляет
        все сразу, чтобы файл правился за один проход.
      </p>
      <Button variant="secondary" className="absolute left-[27px] top-[523px]" onClick={onShowProblems}>
        Показать ошибки
      </Button>
    </>
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
    <>
      <FileHeader
        name={name}
        origin={origin}
        badge={
          <Badge tone="success" icon={<Check aria-hidden="true" className="size-[14px]" />}>
            Файл корректен
          </Badge>
        }
      />
      <Divider top={135} />

      {/* Шапка файла и ряд кнопок закреплены: «Открыть проект» не уезжает, когда
          раскрывают таблицы. Прокручивается только середина. */}
      <div
        className="scroll-area absolute left-[27px] top-[151px] w-[671px] pr-[6px]"
        style={{ height: createError === null ? BODY_HEIGHT : BODY_HEIGHT_WITH_ERROR }}
      >
        <h3 className="h-[22px] text-[18px] font-semibold leading-[22px] text-ink-primary">
          Параметры сценария
        </h3>

        <dl className="mt-[16px] grid grid-cols-4 gap-x-[8px] gap-y-[18px]">
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
          <Param icon={<Settings aria-hidden="true" className="size-[22px]" />} term="Шаг сетки">
            шаг {environment.step_s} с
          </Param>
          <Param icon={<Link2 aria-hidden="true" className="size-[22px]" />} term="Дальность ISL">
            ISL {environment.isl_range_km} км
          </Param>
          <Param icon={<LayoutGrid aria-hidden="true" className="size-[22px]" />} term="Отсчёты">
            {formatCount(summary.total_ticks, 'отсчёт', 'отсчёта', 'отсчётов')}
          </Param>
        </dl>

        <hr className="mt-[22px] border-0 border-t border-line-divider" />

        {/* Обе секции свёрнуты: кнопка «Открыть проект» должна быть видна сразу. */}
        <Collapsible className="mt-[15px]" title="Плоскости" count={design.planes.length}>
          <PlanesTable planes={design.planes} />
        </Collapsible>

        <Collapsible className="mt-[18px]" title="Наземные станции" count={groundSites.length}>
          <GroundSitesTable sites={groundSites} />
        </Collapsible>

        <p className="mt-[18px] flex items-center gap-x-[20px] text-caption text-ink-muted">
          <span data-numeric>
            Активных аппаратов: {summary.active_satellite_count} из {summary.satellite_count} ·
            очередей запущено {design.launch_stage}
          </span>
          <span className="inline-flex items-center gap-[6px]" title={summary.config_hash}>
            <Hash aria-hidden="true" className="size-[14px]" />
            <span className="font-mono">{shortHash(summary.config_hash)}</span>
          </span>
        </p>
      </div>

      {createError !== null && (
        <p
          role="alert"
          className="absolute left-[27px] top-[479px] flex w-[665px] items-start gap-2 text-small text-status-danger"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {createError}
        </p>
      )}

      <Divider top={507} />

      <Button
        className="absolute left-[27px] top-[523px] w-[385px]"
        disabled={creating}
        onClick={onOpenProject}
        iconAfter={<ChevronRight aria-hidden="true" className="size-[22px]" />}
      >
        {creating ? 'Создаём проект…' : 'Открыть проект'}
      </Button>
      <Button
        variant="secondary"
        className="absolute left-[432px] top-[523px] w-[260px]"
        disabled
        title="Доступно, когда открыт проект: файл станет его новым вариантом"
      >
        Добавить как вариант
      </Button>
    </>
  );
}

/** Header Block макета: 681×96 на (19, 19) внутри карточки. */
function FileHeader({ name, origin, badge }: { name: string; origin: string; badge: ReactNode }) {
  return (
    <div className="absolute left-[19px] top-[19px] h-[96px] w-[681px] rounded-xl bg-surface-raised">
      <FileText
        aria-hidden="true"
        className="absolute left-[24px] top-[31px] size-[34px] text-accent-blue"
      />
      <p className="absolute left-[72px] top-[26px] w-[424px] truncate text-base font-semibold leading-[21px] text-ink-primary">
        {name}
      </p>
      <p className="absolute left-[72px] top-[54px] w-[424px] truncate text-caption leading-[16px] text-ink-muted">
        {origin}
      </p>
      <div className="absolute right-[28px] top-[33px]">{badge}</div>
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
        'inline-flex shrink-0 items-center gap-[7px] rounded-pill border py-[7px] pl-[12px] pr-[14px] text-[13px] font-semibold',
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

/** Param макета: иконка 22 и подпись 14 в ячейке 160×26. */
function Param({ icon, term, children }: { icon: ReactNode; term: string; children: ReactNode }) {
  return (
    <div className="flex h-[26px] w-[160px] items-center gap-[8px]">
      <span className="shrink-0 text-accent-blue">{icon}</span>
      <dt className="sr-only">{term}</dt>
      <dd className="truncate text-small font-medium leading-[26px] text-ink-secondary" data-numeric>
        {children}
      </dd>
    </div>
  );
}

function Divider({ top }: { top: number }) {
  return (
    <hr
      className="absolute left-[27px] w-[665px] border-0 border-t border-line-divider"
      style={{ top }}
    />
  );
}

function Collapsible({
  className,
  title,
  count,
  children,
}: {
  className: string;
  title: string;
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  return (
    <section className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => {
          setOpen((current) => !current);
        }}
        className="flex h-[30px] w-full items-center gap-[8px] text-left"
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
      <div id={bodyId} hidden={!open} className="mt-[6px]">
        {children}
      </div>
    </section>
  );
}

/**
 * Цвет точки — опознавательный знак плоскости, тот же, которым она будет нарисована на
 * карте. Состояние им не кодируется: колонки «статус» здесь нет, потому что источника
 * для неё в API нет. Колонки «спутников» нет по той же причине: `validate` не возвращает
 * состав по плоскостям, а считать его в браузере нельзя.
 */
const PLANE_COLORS = ['bg-status-success', 'bg-accent-violet-light', 'bg-accent-blue'];

function PlanesTable({ planes }: { planes: readonly Plane[] }) {
  return (
    <table className="w-full table-fixed text-small [&_tr:first-child_td]:pt-[12px]">
      <colgroup>
        <col className="w-[172px]" />
        <col className="w-[130px]" />
        <col />
      </colgroup>
      <thead>
        <tr className="border-b border-line-divider">
          <Th>Плоскость</Th>
          <Th>RAAN</Th>
          <Th>Фаза</Th>
        </tr>
      </thead>
      <tbody>
        {planes.map((plane, index) => (
          <tr key={plane.id}>
            <Td className="font-semibold text-ink-primary">
              <span className="flex items-center gap-[7px]">
                <span
                  aria-hidden="true"
                  className={cx(
                    'size-[9px] shrink-0 rounded-full',
                    PLANE_COLORS[index % PLANE_COLORS.length],
                  )}
                />
                {plane.id}
              </span>
            </Td>
            <Td>{plane.raan_deg}°</Td>
            <Td>{plane.phase_deg}°</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GroundSitesTable({ sites }: { sites: readonly GroundSite[] }) {
  return (
    <table className="w-full table-fixed text-small [&_tr:first-child_td]:pt-[12px]">
      <colgroup>
        <col className="w-[110px]" />
        <col />
        <col className="w-[100px]" />
        <col className="w-[100px]" />
        <col className="w-[100px]" />
      </colgroup>
      <thead>
        <tr className="border-b border-line-divider">
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
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th
      scope="col"
      className="h-[22px] pr-[12px] text-left align-top text-micro font-semibold uppercase text-ink-muted"
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <td className={cx('h-[28px] pr-[12px] align-middle text-ink-secondary', className)}>
      {children}
    </td>
  );
}
