// What the quick search knows of each page: built into /search.json (pages/search.json.ts) and
// read by the search in the browser (components/search/search.ts).
export type SearchKind = 'Page' | 'App' | 'Game' | 'Blog' | 'Project' | 'Timeline';

export interface SearchItem {
  title: string;
  href: string;
  kind: SearchKind;
  /** A square picture, 80px. */
  icon: string;
  /** Description and tags, matched after the title. */
  words: string;
  /** Newest first among equals, for entries. */
  date?: number;
}
