import { useLayoutEffect } from 'react';
import { Outlet } from 'react-router-dom';

import { ProjectSelectionProvider } from '@/app/ProjectSelectionProvider';
import { useCanvasScale } from '@/app/use-canvas-scale';
import { useViewportState } from '@/app/use-viewport';
import { ViewportContext } from '@/app/viewport-mode';
import { OnboardingTour } from '@/components/onboarding/OnboardingTour';
import { TopBar } from './TopBar';

/**
 * Каркас всех экранов.
 *
 * Интерфейс собран на полотне 1920×1080 — ровно как в макете, — и под окно подгоняется
 * масштабом целиком: координаты блоков совпадают с координатами Figma, прокрутки нет.
 * Это основной режим, и он не изменился.
 *
 * Там, где полотно пришлось бы ужать до нечитаемого (телефон, узкое или низкое окно),
 * включается поток: блоки идут сверху вниз по ширине окна. Решение принимает
 * `useViewportState`, а раскладку каждого блока — `Slot`, поэтому экраны описывают
 * себя одними макетными координатами в обоих режимах.
 */
export function AppLayout() {
  useCanvasScale();
  const viewport = useViewportState();
  const stacked = viewport.mode === 'stacked';

  // Режим виден и корню документа: запрет прокрутки `body` действует только на полотне.
  useLayoutEffect(() => {
    document.documentElement.dataset['layout'] = viewport.mode;
  }, [viewport.mode]);

  return (
    <ViewportContext.Provider value={viewport}>
      <ProjectSelectionProvider>
        <div className={stacked ? 'app-frame app-frame--stacked' : 'app-frame'}>
          <div className={stacked ? 'app-canvas app-canvas--stacked' : 'app-canvas'}>
            <TopBar />
            {/* На полотне страница занимает его целиком, а шапка лежит выше по слою и
                забирает нажатия в своей полосе. В потоке шапка обычная, и содержимое
                идёт под ней. */}
            <main className={stacked ? undefined : 'absolute inset-0'}>
              <Outlet />
            </main>
            <OnboardingTour />
          </div>
        </div>
      </ProjectSelectionProvider>
    </ViewportContext.Provider>
  );
}
