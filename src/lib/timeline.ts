// Shared metadata for timeline event kinds (labels and colors across the timeline board and detail pages).
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
};

export function timelineKindMeta(kind: string): KindMeta {
  return TIMELINE_KINDS[kind] ?? { color: '#8a9497', label: kind.charAt(0).toUpperCase() + kind.slice(1) };
}
