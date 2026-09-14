/**
 * Демо на GitHub Pages собирается `vite build --mode demo`: интерфейс тот же, а ответы API
 * берутся из записи настоящего расчёта (`scripts/record_demo.py`). Признак вычисляется из
 * режима сборки, поэтому в обычной сборке он константа `false` и ветки демо не исполняются.
 */
export const DEMO_MODE = import.meta.env.MODE === 'demo';

export const REPOSITORY_URL = 'https://github.com/lpogosu/orbita-constellation';
