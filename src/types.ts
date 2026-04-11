export interface Env {
  CACHE_VERSION?: string;
  SVG_CACHE_SOFT_TTL_SECONDS?: string;
  SVG_CACHE_HARD_TTL_SECONDS?: string;
  RENDERER_BASE_URL?: string;
  RENDERER_SHARED_TOKEN?: string;
  RENDER_CALLBACK_TOKEN?: string;
  RENDER_PENDING_TTL_SECONDS?: string;
  RENDER_FAILED_TTL_SECONDS?: string;
  RENDER_READY_TTL_SECONDS?: string;
  RENDER_STATE?: KVNamespace;
  RENDER_BUCKET?: R2Bucket;
}

export interface GroupInfo {
  sourceUrl: string;
  resolvedUrl: string;
  groupName: string;
  groupCode: string;
  memberCount: number | null;
  groupDescription: string | null;
  groupLevel: number | null;
  groupTags: string[];
  avatarUrl: string | null;
  backgroundUrl: string | null;
  backgroundUrls: string[];
  memberAvatarUrls: string[];
  memberDistribution: MemberDistributionInfo[];
  assetInfos: GroupAssetInfo[];
  relationCount: number | null;
  inviteTitle: string | null;
  inviteSubtitle: string | null;
  createdAt: number | null;
  fetchedAt: string;
}

export interface MemberDistributionInfo {
  id: number | null;
  title: string;
  icon: string;
  percentage: number | null;
  unit: string;
  subtitle: string;
  color: string | null;
}

export interface GroupAssetInfo {
  id: number | null;
  title: string;
  iconUrl: string | null;
  count: number | null;
  unit: string;
}

export interface BadgeOptions {
  includeAvatar: boolean;
  label: string;
}

export interface RenderOptions {
  format: "png" | "webp";
  animated: boolean;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
}

export type RenderStatus = "pending" | "ready" | "failed";

export type TemplateVariableValue = unknown;
export type TemplateVariables = Record<string, TemplateVariableValue>;

export interface CompiledTemplate {
  templateUrl: string;
  templateSha256: string;
  templateHtml: string;
  compiledHtml: string;
  compiledSha256: string;
  variables: TemplateVariables;
  usedVariables: string[];
  unresolvedVariables: string[];
}

export interface RendererPayload {
  renderKey: string;
  templateUrl: string;
  templateSha256: string;
  templateHtml: string;
  compiledHtml: string;
  compiledSha256: string;
  variables: TemplateVariables;
  usedVariables: string[];
  unresolvedVariables: string[];
  group: GroupInfo;
  options: RenderOptions;
  callback: {
    url: string;
    bearerToken?: string;
  };
  result: {
    assetUrl: string;
    statusUrl: string;
  };
}

export interface RenderStateRecord {
  renderKey: string;
  status: RenderStatus;
  createdAt: string;
  updatedAt: string;
  request: {
    templateUrl: string;
    templateSha256: string;
    compiledSha256: string;
    group: {
      name: string;
      code: string;
      memberCount: number | null;
    };
    options: RenderOptions;
  };
  job?: {
    attempts: number;
    lastAttemptAt: string;
  };
  result?: {
    objectKey: string;
    contentType: string;
    contentLength: number;
    etag?: string | null;
    uploadedAt: string;
    expiresAt?: string | null;
    ttlSeconds?: number | null;
  };
  error?: {
    code: string;
    message: string;
    at: string;
  };
}

export interface RenderCallbackFailure {
  renderKey: string;
  status: "failed";
  error: {
    code: string;
    message: string;
  };
}

export interface SvgCacheMetaRecord {
  aliasKey: string;
  bodyKey: string;
  etag: string;
  checkedAt: string;
  staleAfter: string;
  expiresAt: string | null;
  headers: Record<string, string>;
}
