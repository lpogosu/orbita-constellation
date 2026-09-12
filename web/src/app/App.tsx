import type { ReactElement } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AppLayout } from '@/components/layout/AppLayout';
import { ComparePage } from '@/features/compare/ComparePage';
import { ExperimentsPage } from '@/features/experiments/ExperimentsPage';
import { ProjectPage } from '@/features/project/ProjectPage';
import { ProjectsPage } from '@/features/projects/ProjectsPage';
import { ResultPage } from '@/features/result/ResultPage';
import { SectionUnderConstruction } from '@/pages/SectionUnderConstruction';
import {
  COMPARISON_PATH,
  EXPERIMENTS_PATH,
  NAV_SECTIONS,
  NETWORK_PATH,
  PROJECTS_PATH,
  sectionByPath,
} from './sections';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to={PROJECTS_PATH} replace />} />
          {NAV_SECTIONS.map((section) => (
            <Route
              key={section.path}
              path={section.path}
              element={sectionPage(section.path) ?? <SectionUnderConstruction section={section} />}
            />
          ))}
          {/* Созданный проект открывается на «Сети»: маршрут уже есть, экран появится позже. */}
          <Route
            path={`${NETWORK_PATH}/:projectId`}
            element={<SectionUnderConstruction section={sectionByPath(NETWORK_PATH)} />}
          />
          <Route path={`${PROJECTS_PATH}/:projectId`} element={<ProjectPage />} />
          <Route path="/result/:runId" element={<ResultPage />} />
          <Route path={`${EXPERIMENTS_PATH}/:projectId`} element={<ExperimentsPage />} />
          <Route path="*" element={<Navigate to={PROJECTS_PATH} replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

/**
 * Разделы навигации, у которых уже есть экран. Соседние карточки дописывают сюда по строке,
 * а не переставляют маршруты: пункт меню и его страница объявлены в одном месте.
 */
function sectionPage(path: string): ReactElement | null {
  if (path === PROJECTS_PATH) {
    return <ProjectsPage />;
  }
  if (path === COMPARISON_PATH) {
    return <ComparePage />;
  }
  if (path === EXPERIMENTS_PATH) {
    return <ExperimentsPage />;
  }
  return null;
}
