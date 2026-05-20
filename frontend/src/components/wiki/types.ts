export type TreePage = {
  slug: string;
  title: string;
  summary: string | null;
  page_type: string;
  corpus: string | null;
};

export type TreeDomain = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  color: string | null;
  index_slug: string | null;
  page_count: number;
  pages: TreePage[];
};

export type UnassignedPage = {
  slug: string;
  title: string;
  corpus: string | null;
};

export type TreeResponse = {
  domains: TreeDomain[];
  unassigned: UnassignedPage[];
};

export type WikiPage = {
  id: number;
  kind: string;
  slug: string;
  title: string;
  summary: string | null;
  body_md: string;
  page_type: string;
  corpus: string | null;
  domain_id: number | null;
  domain_slug: string | null;
  domain_name: string | null;
  status: string;
  updated_at: string;
  generated_at: string | null;
};

export type Backlink = {
  slug: string;
  title: string;
  summary: string | null;
  page_type: string;
  domain_slug: string | null;
  domain_name: string | null;
};

export type Sibling = {
  slug: string;
  title: string;
  summary: string | null;
};

export type PageResponse = {
  page: WikiPage;
  backlinks: Backlink[];
  siblings?: Sibling[];
};

export type LogEntry = {
  ts: string;
  kind: string;
  target_kind: string | null;
  target_slug: string | null;
  domain_slug: string | null;
  summary: string;
};

export type LogResponse = {
  entries: LogEntry[];
};
