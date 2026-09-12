/** Пять разделов основной навигации (14_SCREENS.md §0.1) в порядке макета. */
export interface Section {
  readonly path: string;
  readonly title: string;
  /** Чем раздел станет: объяснение для страницы, которая ещё не построена. */
  readonly purpose: string;
}

export const PROJECTS_PATH = '/projects';
export const NETWORK_PATH = '/network';

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
    path: '/outages',
    title: 'Отказы',
    purpose:
      'Расследование отказа аппарата: сравнение сети до и после, затронутые клиенты и причины разрывов.',
  },
  {
    path: '/experiments',
    title: 'Исследования',
    purpose:
      'Перебор параметров с бюджетом, тепловая карта доступности худшего клиента и выбор точки как варианта.',
  },
  {
    path: '/comparison',
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
