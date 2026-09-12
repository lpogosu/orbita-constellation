import { Outlet } from 'react-router-dom';

import { ProjectSelectionProvider } from '@/app/ProjectSelectionProvider';
import { useCanvasScale } from '@/app/use-canvas-scale';
import { OnboardingTour } from '@/components/onboarding/OnboardingTour';
import { TopBar } from './TopBar';

/**
 * Каркас всех экранов. Интерфейс собран на полотне 1920×1080 — ровно как в макете, — а
 * под окно подгоняется масштабом целиком. Поэтому координаты блоков внутри страницы
 * совпадают с координатами Figma, а прокрутки страницы нет ни при каком размере окна.
 */
export function AppLayout() {
  useCanvasScale();

  return (
    <ProjectSelectionProvider>
      <div className="app-frame">
        <div className="app-canvas">
          <TopBar />
          {/* Страница занимает всё полотно: блоки расставлены по макетным координатам, а
              шапка лежит выше по слою и забирает нажатия в своей полосе. */}
          <main className="absolute inset-0">
            <Outlet />
          </main>
          <OnboardingTour />
        </div>
      </div>
    </ProjectSelectionProvider>
  );
}
