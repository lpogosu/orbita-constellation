import type { RoutingPolicy } from '@/api/types';

/** Названия политик маршрутизации из `03_GLOSSARY.md` §2. */
const TITLES: Record<RoutingPolicy, string> = {
  bfs_shortest: 'BFS, минимум переходов',
  persistent: 'Удержание маршрута',
  dijkstra_distance: 'Dijkstra по длине',
};

export const ROUTING_POLICIES: readonly RoutingPolicy[] = [
  'bfs_shortest',
  'persistent',
  'dijkstra_distance',
];

export function policyTitle(policy: RoutingPolicy): string {
  return TITLES[policy];
}
