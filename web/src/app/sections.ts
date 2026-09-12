/** Пять разделов основной навигации (14_SCREENS.md §0.1) в порядке макета. */
export interface Section {
  readonly path: string;
  readonly title: string;
  /** Чем раздел занят: объяснение для экрана выбора проекта. */
  readonly purpose: string;
}

export const PROJECTS_PATH = '/projects';
export const NETWORK_PATH = '/network';
export const EXPERIMENTS_PATH = '/experiments';
export const OUTAGES_PATH = '/outages';
export const COMPARISON_PATH = '/comparison';

/** Результат расчёта пунктом меню не открывают: он адресуется прогоном, а не проектом. */
export const RESULT_PATH = '/result';

export const NAV_SECTIONS: readonly Section[] = [
  {
    path: PROJECTS_PATH,
    title: 'Проекты',
    purpose: 'Загрузка сценария, обзор параметров и недавние проекты.',
  },
  {
    path: NETWORK_PATH,
    title: 'Сеть',
    purpose:
      'Конфигурация варианта, карта группировки на выбранном отсчёте, маршруты клиентов и таймлайн суток.',
  },
  {
    path: OUTAGES_PATH,
    title: 'Отказы',
    purpose:
      'Расследование отказа аппарата: сравнение сети до и после, затронутые клиенты и причины разрывов.',
  },
  {
    path: EXPERIMENTS_PATH,
    title: 'Исследования',
    purpose:
      'Перебор параметров с бюджетом, тепловая карта доступности худшего клиента и выбор точки как варианта.',
  },
  {
    path: COMPARISON_PATH,
    title: 'Сравнение',
    purpose:
      'Метрики вариантов рядом, дельты по клиентам и доказательная рекомендация с ограничениями.',
  },
];

export function sectionByPath(path: string): Section {
  const section = NAV_SECTIONS.find((item) => item.path === path);
  if (section === undefined) {
    throw new Error(`Раздел ${path} отсутствует в навигации`);
  }
  return section;
}

/**
 * Адрес раздела для конкретного проекта. Четыре раздела из пяти показывают ровно один
 * проект, и без него открывать нечего. «Сравнение» держит проект в запросе — рядом с ним
 * живут выбранные прогоны, — остальные разделы получают его сегментом пути.
 */
export function sectionHref(basePath: string, projectId: string | null): string {
  if (projectId === null) {
    return basePath;
  }
  const id = encodeURIComponent(projectId);
  if (basePath === COMPARISON_PATH) {
    return `${COMPARISON_PATH}?project=${id}`;
  }
  return `${basePath}/${id}`;
}

/**
 * Пункт меню подсвечен на всех экранах раздела, а не только на его «голом» пути: адрес
 * открытого проекта — это тот же раздел, и меню обязано это показывать.
 */
export function isSectionActive(basePath: string, pathname: string): boolean {
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

/** Раздел, которому принадлежит адрес; `null` — экран вне разделов, например результат. */
export function sectionOfPath(pathname: string): Section | null {
  return NAV_SECTIONS.find((section) => isSectionActive(section.path, pathname)) ?? null;
}
