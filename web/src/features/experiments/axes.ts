import type { ExperimentAxis, Scenario } from '@/api/types';

/**
 * Параметр, который можно перебрать (`14_SCREENS.md` §5.1: RAAN плоскости, фаза плоскости,
 * этап запуска). Список строится по самому сценарию базового варианта, а не зашит в код:
 * плоскостей может быть три, а может пять, и их идентификаторы — из файла.
 */
export interface AxisOption {
  readonly path: string;
  readonly title: string;
  /** Границы значения по схеме `cosmo-A-1.0`: вне них сервис ответит 400. */
  readonly min: number;
  readonly max: number;
  readonly current: number;
  readonly suggestedStep: number;
}

export const NO_AXIS = '';

export function axisOptions(scenario: Scenario): AxisOption[] {
  const options: AxisOption[] = [];

  scenario.design.planes.forEach((plane, index) => {
    options.push({
      path: `design.planes[${index}].raan_deg`,
      title: `RAAN плоскости ${plane.id}`,
      min: 0,
      max: 359.9,
      current: plane.raan_deg,
      suggestedStep: 10,
    });
    options.push({
      path: `design.planes[${index}].phase_deg`,
      title: `Фаза плоскости ${plane.id}`,
      min: 0,
      max: 359.9,
      current: plane.phase_deg,
      suggestedStep: 5,
    });
  });

  options.push({
    path: 'design.launch_stage',
    title: 'Этап запуска',
    min: 1,
    max: 3,
    current: scenario.design.launch_stage,
    suggestedStep: 1,
  });

  return options;
}

/** Что пользователь набрал в трёх полях оси: строки, потому что поле бывает пустым. */
export interface AxisDraft {
  readonly path: string;
  readonly from: string;
  readonly to: string;
  readonly step: string;
}

/**
 * Черновик оси с границами выбранного параметра. Диапазон RAAN и диапазон этапа запуска
 * не имеют между собой ничего общего, поэтому при смене параметра поля заполняются его
 * собственными числами, а не остаются от предыдущего.
 */
export function draftFor(option: AxisOption): AxisDraft {
  return {
    path: option.path,
    from: String(option.min),
    to: String(option.max),
    step: String(option.suggestedStep),
  };
}

export interface AxisCheck {
  /** Ось, готовая уйти в `POST /api/experiments`; `null`, если в полях есть ошибка. */
  readonly axis: ExperimentAxis | null;
  readonly points: number;
  readonly problems: readonly string[];
}

/**
 * Проверка полей оси — это проверка формы, а не расчёт: сервис всё равно проверит вход
 * сам, но отправлять заведомо неверный шаг и ждать 400, чтобы узнать про опечатку, — не
 * работа интерфейса.
 */
export function checkAxis(draft: AxisDraft, option: AxisOption | undefined): AxisCheck {
  if (draft.path === NO_AXIS || option === undefined) {
    return { axis: null, points: 1, problems: [] };
  }

  const problems: string[] = [];
  const from = toNumber(draft.from);
  const to = toNumber(draft.to);
  const step = toNumber(draft.step);

  if (from === null || to === null || step === null) {
    problems.push('заполните «от», «до» и «шаг» числами');
    return { axis: null, points: 0, problems };
  }
  if (step <= 0) {
    problems.push('шаг должен быть больше нуля');
  }
  if (from >= to) {
    problems.push('«от» должно быть меньше «до»');
  }
  if (from < option.min || to > option.max) {
    problems.push(`значения допустимы в диапазоне ${option.min}…${option.max}`);
  }

  if (problems.length > 0) {
    return { axis: null, points: 0, problems };
  }

  return {
    axis: { path: option.path, from, to, step },
    points: Math.floor((to - from) / step) + 1,
    problems,
  };
}

function toNumber(raw: string): number | null {
  const trimmed = raw.trim().replace(',', '.');
  if (trimmed === '') {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function parsePositiveInteger(raw: string): number | null {
  const value = Number(raw.trim());
  return Number.isInteger(value) && value > 0 ? value : null;
}
