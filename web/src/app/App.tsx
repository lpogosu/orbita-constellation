import { BrowserRouter, Navigate, Route, Routes, useSearchParams } from 'react-router-dom';

import { AppLayout } from '@/components/layout/AppLayout';
import { ComparePage } from '@/features/compare/ComparePage';
import { ExperimentsPage } from '@/features/experiments/ExperimentsPage';
import { NetworkPage } from '@/features/network/NetworkPage';
import { OutagesPage } from '@/features/outages/OutagesPage';
import { ProjectPage } from '@/features/project/ProjectPage';
import { ProjectsPage } from '@/features/projects/ProjectsPage';
import { ResultPage } from '@/features/result/ResultPage';
import { SectionEntry } from './SectionEntry';
import {
  COMPARISON_PATH,
  EXPERIMENTS_PATH,
  NETWORK_PATH,
  OUTAGES_PATH,
  PROJECTS_PATH,
  sectionByPath,
} from './sections';

/**
 * Обычная сборка живёт в корне origin, демо на GitHub Pages — под именем репозитория.
 * `BASE_URL` оканчивается на `/`, а `basename` роутера ждёт путь без него.
 */
const ROUTER_BASENAME = import.meta.env.BASE_URL.replace(/\/$/, '');

/**
 * Каждый раздел — пара маршрутов: адрес с проектом показывает экран, адрес без проекта
 * приводит к нему (`SectionEntry`). Страниц-заглушек в приложении нет.
 */
export function App() {
  return (
    <BrowserRouter basename={ROUTER_BASENAME}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to={PROJECTS_PATH} replace />} />

          <Route path={PROJECTS_PATH} element={<ProjectsPage />} />
          <Route path={`${PROJECTS_PATH}/:projectId`} element={<ProjectPage />} />

          <Route path={NETWORK_PATH} element={<SectionEntry section={sectionByPath(NETWORK_PATH)} />} />
          <Route path={`${NETWORK_PATH}/:projectId`} element={<NetworkPage />} />

          <Route path={OUTAGES_PATH} element={<SectionEntry section={sectionByPath(OUTAGES_PATH)} />} />
          <Route path={`${OUTAGES_PATH}/:projectId`} element={<OutagesPage />} />

          <Route
            path={EXPERIMENTS_PATH}
            element={<SectionEntry section={sectionByPath(EXPERIMENTS_PATH)} />}
          />
          <Route path={`${EXPERIMENTS_PATH}/:projectId`} element={<ExperimentsPage />} />

          <Route path={COMPARISON_PATH} element={<ComparisonRoute />} />

          <Route path="/result/:runId" element={<ResultPage />} />
          <Route path="*" element={<Navigate to={PROJECTS_PATH} replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

/**
 * Проект «Сравнения» живёт в запросе, а не в пути, поэтому выбирать между экраном и
 * переходом к проекту приходится здесь: маршрут у обоих один и тот же.
 */
function ComparisonRoute() {
  const [params] = useSearchParams();
  return params.get('project') === null ? (
    <SectionEntry section={sectionByPath(COMPARISON_PATH)} />
  ) : (
    <ComparePage />
  );
}
