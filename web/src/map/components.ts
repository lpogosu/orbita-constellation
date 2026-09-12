import type { GroundSite, Snapshot } from '@/api/types';
import type { ComponentSplit } from './model';

/**
 * Компоненты связности аппаратов на отсчёте: та, из которой клиент вообще видит сеть, и
 * та, в которой стоит шлюз. Считается обходом графа по рёбрам снимка — это разметка для
 * карты, а не метрика: ни одно число отсюда на экран не попадает и в отчёт не уходит.
 *
 * Возвращает `null`, когда клиенту не видно ни одного аппарата: показывать в этом случае
 * нечего, и экран говорит об этом словами вместо ссылки.
 */
export function splitComponents(
  snapshot: Snapshot,
  sites: readonly GroundSite[],
  clientId: string,
): ComponentSplit | null {
  const clientSeeds = visibleSatellites(snapshot, clientId);
  if (clientSeeds.length === 0) {
    return null;
  }

  const links = islNeighbours(snapshot);
  const clientSide = reach(links, clientSeeds);

  const gatewaySiteIds = sites.filter((site) => site.role === 'gateway').map((site) => site.id);
  const gatewaySeeds = gatewaySiteIds
    .flatMap((gatewayId) => visibleSatellites(snapshot, gatewayId))
    .filter((id) => !clientSide.has(id));
  const gatewaySide = reach(links, gatewaySeeds);

  return {
    clientSide: [...clientSide],
    // Аппарат, до которого дотянулись обе стороны, принадлежит компоненте клиента:
    // разрыва между ними тогда нет, и раскрашивать его дважды нечестно.
    gatewaySide: [...gatewaySide].filter((id) => !clientSide.has(id)),
    clientSiteId: clientId,
    gatewaySiteIds,
  };
}

/** Аппараты, видимые наземному пункту на этом отсчёте: рёбра «земля — аппарат». */
function visibleSatellites(snapshot: Snapshot, siteId: string): string[] {
  const found: string[] = [];
  for (const edge of snapshot.edges) {
    if (edge.kind !== 'ground') {
      continue;
    }
    if (edge.a === siteId) {
      found.push(edge.b);
    } else if (edge.b === siteId) {
      found.push(edge.a);
    }
  }
  return found;
}

function islNeighbours(snapshot: Snapshot): ReadonlyMap<string, string[]> {
  const links = new Map<string, string[]>();
  const add = (from: string, to: string): void => {
    const list = links.get(from);
    if (list === undefined) {
      links.set(from, [to]);
    } else {
      list.push(to);
    }
  };
  for (const edge of snapshot.edges) {
    if (edge.kind === 'isl') {
      add(edge.a, edge.b);
      add(edge.b, edge.a);
    }
  }
  return links;
}

/** Обход в ширину от засеянных аппаратов: вся компонента, а не только соседи. */
function reach(links: ReadonlyMap<string, string[]>, seeds: readonly string[]): Set<string> {
  const seen = new Set<string>(seeds);
  const queue = [...seeds];
  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) {
      continue;
    }
    for (const next of links.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}
