import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AppLayout } from '@/components/layout/AppLayout';
import { NetworkPage } from '@/features/network/NetworkPage';
import { OutagesPage } from '@/features/outages/OutagesPage';
import { ProjectsPage } from '@/features/projects/ProjectsPage';
import { SectionUnderConstruction } from '@/pages/SectionUnderConstruction';
import { ProjectContextProvider } from './ProjectContextProvider';
import { NAV_SECTIONS, OUTAGES_PATH, NETWORK_PATH, PROJECTS_PATH } from './sections';

export function App() {
  return (
    <BrowserRouter>
      <ProjectContextProvider>
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
          <Route path={`${NETWORK_PATH}/:projectId`} element={<NetworkPage />} />
          <Route path={`${OUTAGES_PATH}/:projectId`} element={<OutagesPage />} />
          <Route path="*" element={<Navigate to={PROJECTS_PATH} replace />} />
        </Route>
        </Routes>
      </ProjectContextProvider>
    </BrowserRouter>
  );
}
