import { CircleHelp, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useProjectSelection } from '@/app/project-selection';
import {
  COMPARISON_PATH,
  NETWORK_PATH,
  OUTAGES_PATH,
  PROJECTS_PATH,
  RESULT_PATH,
  sectionHref,
} from '@/app/sections';

type Area = Readonly<{ x: number; y: number; width: number; height: number }>;
type Section = 'projects' | 'network' | 'outages' | 'comparison' | 'result';

interface TourStep {
  readonly title: string;
  readonly description: string;
  readonly highlight: Area;
  readonly tooltip: Pick<Area, 'x' | 'y'>;
  readonly section: Section;
}

/**
 * Coordinates reproduce the ten frames from the Figma page «05 · Онбординг»
 * on the shared 1920×1080 application canvas.
 */
const STEPS: readonly TourStep[] = [
  {
    title: 'Загрузите сценарий',
    description: 'Перетащите свой JSON или выберите один из примеров — сразу видно, что файл понят.',
    highlight: { x: 18, y: 237, width: 1131, height: 798 },
    tooltip: { x: 1181, y: 245 },
    section: 'projects',
  },
  {
    title: 'Проверьте сводку',
    description: 'Число спутников, плоскостей и наземных пунктов — если всё сходится, открывайте проект.',
    highlight: { x: 1162, y: 444, width: 737, height: 616 },
    tooltip: { x: 730, y: 452 },
    section: 'projects',
  },
  {
    title: 'Настройте конфигурацию',
    description: 'Этап запуска, ориентация и фаза каждой плоскости — карта обновляется сразу.',
    highlight: { x: 17, y: 126, width: 440, height: 738 },
    tooltip: { x: 489, y: 134 },
    section: 'network',
  },
  {
    title: 'Запустите расчёт',
    description: 'Кнопка считает сутки работы группировки. Пока идёт расчёт — видны этап и прогресс.',
    highlight: { x: 25, y: 764, width: 424, height: 92 },
    tooltip: { x: 489, y: 700 },
    section: 'network',
  },
  {
    title: 'Сеть на карте',
    description: 'Спутники, плоскости и маршрут выбранного клиента до шлюза. Справа — переключатель 2D/3D.',
    highlight: { x: 383.6, y: 79, width: 1082.8, height: 778 },
    tooltip: { x: 1498, y: 300 },
    section: 'network',
  },
  {
    title: 'Карточка клиента',
    description: 'Доступность за сутки и статус на текущий момент. Если связи нет — здесь же причина.',
    highlight: { x: 1395, y: 126, width: 507, height: 738 },
    tooltip: { x: 963, y: 134 },
    section: 'network',
  },
  {
    title: 'Шкала суток',
    description: 'Зелёное — связь есть, красное — нет. Нажмите на шкалу или запустите проигрывание.',
    highlight: { x: 18, y: 864, width: 1884, height: 216 },
    tooltip: { x: 760, y: 602 },
    section: 'network',
  },
  {
    title: 'Отказ и сравнение',
    description: 'Задайте отказ спутника или шлюза и переключите «До/После», чтобы увидеть, что изменилось.',
    highlight: { x: 17, y: 112, width: 1882, height: 734 },
    tooltip: { x: 760, y: 842 },
    section: 'outages',
  },
  {
    title: 'Сравнение вариантов',
    description: 'Дельты по каждому клиенту и рекомендация: какой вариант лучше и почему.',
    highlight: { x: 18, y: 258, width: 1884, height: 602 },
    tooltip: { x: 760, y: 20 },
    section: 'comparison',
  },
  {
    title: 'Выгрузка результата',
    description: 'Скачайте результат расчёта и сценарий — тем же файлом можно повторить расчёт.',
    highlight: { x: 1365, y: 104, width: 524, height: 516 },
    tooltip: { x: 933, y: 112 },
    section: 'result',
  },
];

function routeFor(step: TourStep, selection: ReturnType<typeof useProjectSelection>['selection']): string | null {
  switch (step.section) {
    case 'projects':
      return PROJECTS_PATH;
    case 'network':
      return selection.projectId === null ? null : sectionHref(NETWORK_PATH, selection.projectId);
    case 'outages':
      return selection.projectId === null ? null : sectionHref(OUTAGES_PATH, selection.projectId);
    case 'comparison':
      return selection.projectId === null ? null : sectionHref(COMPARISON_PATH, selection.projectId);
    case 'result':
      return selection.runId === null ? null : `${RESULT_PATH}/${encodeURIComponent(selection.runId)}`;
  }
}

/** A replayable Figma-matched walkthrough, deliberately independent from feature state. */
export function OnboardingTour() {
  const navigate = useNavigate();
  const { selection } = useProjectSelection();
  const [isOpen, setIsOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const nextButton = useRef<HTMLButtonElement>(null);
  const step = STEPS[stepIndex];

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    nextButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, stepIndex]);

  const open = (): void => {
    setStepIndex(0);
    navigate(PROJECTS_PATH);
    setIsOpen(true);
  };

  const moveTo = (nextIndex: number): void => {
    const nextStep = STEPS[nextIndex];
    if (nextStep === undefined) {
      return;
    }
    const route = routeFor(nextStep, selection);
    if (route !== null) {
      navigate(route);
    }
    setStepIndex(nextIndex);
  };

  if (step === undefined) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="absolute left-[1852px] top-[30px] z-20 flex size-[32px] items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-surface-raised hover:text-ink-primary"
        aria-label="Открыть онбординг"
      >
        <CircleHelp aria-hidden="true" className="size-[28px]" strokeWidth={1.75} />
      </button>

      {isOpen && (
        <div className="absolute inset-0 z-30" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
          <Scrim area={step.highlight} />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute rounded-[20px] border-2 border-[#7c5cff] shadow-[0_0_14px_rgba(124,92,255,0.45)]"
            style={step.highlight}
          />

          <section
            className="absolute h-[238px] w-[400px] rounded-[20px] border border-[#29437d] bg-[#172653] px-[24px] pb-[20px] pt-[20px] shadow-[0_18px_48px_rgba(0,11,34,0.48)]"
            style={step.tooltip}
            aria-describedby="onboarding-description"
          >
            <div className="flex items-start justify-between text-[13px] font-medium leading-[18px] text-[#b6c1e6]">
              <span>Шаг {stepIndex + 1} из {STEPS.length}</span>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                }}
                className="-mr-[6px] -mt-[4px] inline-flex items-center gap-[3px] rounded px-[6px] py-[4px] transition-colors hover:bg-white/10 hover:text-white"
              >
                Пропустить
                <X aria-hidden="true" className="size-[14px]" />
              </button>
            </div>

            <h2 id="onboarding-title" className="mt-[16px] text-[20px] font-semibold leading-[28px] text-[#f5f7ff]">
              {step.title}
            </h2>
            <p id="onboarding-description" className="mt-[4px] min-h-[64px] text-[14px] leading-[20px] text-[#b6c1e6]">
              {step.description}
            </p>

            <div className="mt-[14px] flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  moveTo(stepIndex - 1);
                }}
                disabled={stepIndex === 0}
                className="h-[44px] w-[100px] rounded-[12px] border border-[#29437d] bg-[#172653] text-[15px] font-semibold text-[#f5f7ff] transition-colors hover:bg-[#20356e] disabled:cursor-not-allowed disabled:opacity-35"
              >
                Назад
              </button>
              <button
                ref={nextButton}
                type="button"
                onClick={() => {
                  if (stepIndex === STEPS.length - 1) {
                    setIsOpen(false);
                    return;
                  }
                  moveTo(stepIndex + 1);
                }}
                className="h-[44px] w-[140px] rounded-[12px] bg-[#7c5cff] text-[15px] font-semibold text-[#f5f7ff] shadow-[0_8px_14px_rgba(124,92,255,0.36)] transition-[filter,transform] hover:brightness-110 active:translate-y-px"
              >
                {stepIndex === STEPS.length - 1 ? 'Готово' : 'Далее'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function Scrim({ area }: { area: Area }) {
  const color = 'rgba(7, 20, 49, 0.82)';
  const right = area.x + area.width;
  const bottom = area.y + area.height;
  const panels: readonly Area[] = [
    { x: 0, y: 0, width: 1920, height: area.y },
    { x: 0, y: bottom, width: 1920, height: 1080 - bottom },
    { x: 0, y: area.y, width: area.x, height: area.height },
    { x: right, y: area.y, width: 1920 - right, height: area.height },
  ];

  return (
    <>
      {panels.map((panel, index) => (
        <div key={index} aria-hidden="true" className="absolute" style={{ ...panel, backgroundColor: color }} />
      ))}
    </>
  );
}
