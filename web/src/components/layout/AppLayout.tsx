import { Outlet } from 'react-router-dom';

import { TopBar } from './TopBar';

/** Общий каркас всех экранов: ночная сцена макета, шапка и место под страницу. */
export function AppLayout() {
  return (
    <div className="app-scenery flex min-h-screen flex-col">
      <TopBar />
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
