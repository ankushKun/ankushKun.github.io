// Shared metadata for timeline event kinds (labels and colors across the timeline board and detail pages).
import type { TimelineItem } from './content';

export interface KindMeta {
  color: string;
  label: string;
}

export const TIMELINE_KINDS: Record<string, KindMeta> = {
  win: { color: '#f2a312', label: 'Win' },
  launch: { color: '#ee4a4f', label: 'Launch' },
  work: { color: '#2380dc', label: 'Work' },
  hackathon: { color: '#7a4fe0', label: 'Hackathon' },
  hardware: { color: '#1f9457', label: 'Hardware' },
  milestone: { color: '#24b3cc', label: 'Milestone' },
  project: { color: '#d6519a', label: 'Project' },
};

/** An item's kinds on the timeline board: an event's own, or `project` for a project listed beside them. */
export const kindsOf = (e: TimelineItem): string[] => (e.collection === 'timeline' ? e.data.kind : ['project']);

export function timelineKindMeta(kind: string): KindMeta {
  return TIMELINE_KINDS[kind] ?? { color: '#8a9497', label: kind.charAt(0).toUpperCase() + kind.slice(1) };
}
