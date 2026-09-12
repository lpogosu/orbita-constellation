import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AppLayout } from '@/components/layout/AppLayout';
import { ProjectsPage } from '@/features/projects/ProjectsPage';
import { SectionUnderConstruction } from '@/pages/SectionUnderConstruction';
import { NAV_SECTIONS, NETWORK_PATH, PROJECTS_PATH, sectionByPath } from './sections';

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
              element={
                section.path === PROJECTS_PATH ? (
                  <ProjectsPage />
                ) : (
                  <SectionUnderConstruction section={section} />
                )
              }
            />
          ))}
          {/* Созданный проект открывается на «Сети»: маршрут уже есть, экран появится позже. */}
          <Route
            path={`${NETWORK_PATH}/:projectId`}
            element={<SectionUnderConstruction section={sectionByPath(NETWORK_PATH)} />}
          />
          <Route path="*" element={<Navigate to={PROJECTS_PATH} replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
