import type { ContentPack } from "./schema";

export type VersionStatus = "draft" | "published" | "archived";

export interface VersionSummary {
  id: string;
  version: number;
  status: VersionStatus;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface DraftVersion extends VersionSummary {
  pack: ContentPack;
}

export interface AuditEntry {
  id: string;
  action: string;
  target: string | null;
  details: string | null;
  actorEmail: string | null;
  createdAt: string;
}

export interface ActiveContentSummary {
  source: "remote" | "bundled";
  version: number | null;
  fallbackReason: string | null;
}

export interface AdminState {
  draft: DraftVersion | null;
  published: VersionSummary | null;
  baseline: ContentPack;
  baselineSource: "draft" | "published" | "bundled";
  history: VersionSummary[];
  audit: AuditEntry[];
  active: ActiveContentSummary;
}

export interface ContentSnapshot {
  source: "remote" | "bundled";
  version: number | null;
  pack: ContentPack;
  fallbackReason: string | null;
  publishedAt: string | null;
}

export interface ExportPayload {
  kind: "codequest-content-pack";
  exportedAt: string;
  source: "remote" | "bundled";
  version: number | null;
  pack: ContentPack;
}
