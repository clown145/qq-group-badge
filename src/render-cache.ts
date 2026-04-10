import type { Env, RenderCallbackFailure, RendererPayload, RenderStateRecord } from "./types.js";

const DEFAULT_PENDING_TTL_SECONDS = 15 * 60;
const DEFAULT_FAILED_TTL_SECONDS = 30 * 60;
const DEFAULT_READY_TTL_SECONDS = 48 * 60 * 60;
const MIN_KV_TTL_SECONDS = 60;

export async function getRenderState(
  env: Env,
  renderKey: string
): Promise<RenderStateRecord | null> {
  if (!env.RENDER_STATE) {
    return null;
  }

  return env.RENDER_STATE.get(renderStateKvKey(renderKey), "json");
}

export function isRenderStorageConfigured(env: Env): boolean {
  return Boolean(env.RENDER_STATE && env.RENDER_BUCKET);
}

export async function getUsableRenderState(
  env: Env,
  renderKey: string
): Promise<RenderStateRecord | null> {
  const state = await getRenderState(env, renderKey);
  if (!state) {
    return null;
  }

  if (state.status !== "ready") {
    return state;
  }

  if (await hasRenderedObject(env, state)) {
    return state;
  }

  await deleteRenderState(env, renderKey);
  return null;
}

export async function putRenderPending(
  env: Env,
  payload: RendererPayload,
  existing: RenderStateRecord | null
): Promise<RenderStateRecord> {
  const now = new Date().toISOString();
  const record: RenderStateRecord = {
    renderKey: payload.renderKey,
    status: "pending",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    request: {
      templateUrl: payload.templateUrl,
      templateSha256: payload.templateSha256,
      compiledSha256: payload.compiledSha256,
      group: {
        name: payload.group.groupName,
        code: payload.group.groupCode,
        memberCount: payload.group.memberCount
      },
      options: payload.options
    },
    job: {
      attempts: (existing?.job?.attempts ?? 0) + 1,
      lastAttemptAt: now
    }
  };

  await putRenderState(env, record, getPendingTtlSeconds(env));
  return record;
}

export async function putRenderFailed(
  env: Env,
  renderKey: string,
  error: { code: string; message: string },
  existing: RenderStateRecord | null
): Promise<RenderStateRecord | null> {
  if (!existing) {
    return null;
  }

  const now = new Date().toISOString();
  const record: RenderStateRecord = {
    ...existing,
    status: "failed",
    updatedAt: now,
    error: {
      code: error.code,
      message: error.message,
      at: now
    }
  };

  await putRenderState(env, record, getFailedTtlSeconds(env));
  return record;
}

export async function putRenderFailureFromCallback(
  env: Env,
  payload: RenderCallbackFailure
): Promise<RenderStateRecord | null> {
  const existing = await getRenderState(env, payload.renderKey);
  return putRenderFailed(env, payload.renderKey, payload.error, existing);
}

export async function putRenderSuccess(
  env: Env,
  renderKey: string,
  contentType: string,
  body: ArrayBuffer,
  existing: RenderStateRecord | null
): Promise<RenderStateRecord> {
  if (!env.RENDER_BUCKET) {
    throw new Error("RENDER_BUCKET is not configured");
  }

  const now = new Date().toISOString();
  const objectKey = renderObjectKey(renderKey);
  const etag = await sha1Hex(body);
  const readyTtlSeconds = getReadyTtlSeconds(env);
  const expiresAt =
    readyTtlSeconds === null
      ? null
      : new Date(Date.now() + readyTtlSeconds * 1000).toISOString();
  const cacheControl = renderedAssetCacheControl(readyTtlSeconds);

  await env.RENDER_BUCKET.put(objectKey, body, {
    httpMetadata: {
      contentType,
      cacheControl
    },
    customMetadata: {
      etag,
      uploaded_at: now,
      expires_at: expiresAt ?? "",
      ttl_seconds: readyTtlSeconds === null ? "0" : String(readyTtlSeconds)
    }
  });

  const baseRecord =
    existing ??
    ({
      renderKey,
      status: "ready",
      createdAt: now,
      updatedAt: now,
      request: {
        templateUrl: "",
        templateSha256: "",
        compiledSha256: "",
        group: {
          name: "",
          code: "",
          memberCount: null
        },
        options: {
          format: contentTypeToFormat(contentType),
          animated: false,
          width: 0,
          height: 0,
          fps: 0,
          durationMs: 0
        }
      }
    } satisfies RenderStateRecord);

  const record: RenderStateRecord = {
    ...baseRecord,
    status: "ready",
    updatedAt: now,
    result: {
      objectKey,
      contentType,
      contentLength: body.byteLength,
      etag,
      uploadedAt: now,
      expiresAt,
      ttlSeconds: readyTtlSeconds
    },
    error: undefined
  };

  await putRenderState(env, record, readyTtlSeconds ?? undefined);
  return record;
}

export async function getRenderedAssetResponse(
  env: Env,
  renderKey: string
): Promise<Response | null> {
  const state = await getRenderState(env, renderKey);
  if (!state || state.status !== "ready" || !state.result || !env.RENDER_BUCKET) {
    return null;
  }

  const object = await env.RENDER_BUCKET.get(state.result.objectKey);
  if (!object) {
    await deleteRenderState(env, renderKey);
    return null;
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", `"${state.result.etag ?? object.httpEtag}"`);
  headers.set("cache-control", renderedAssetCacheControl(state.result.ttlSeconds ?? null));
  headers.set("content-length", String(object.size));
  headers.set("x-render-key", renderKey);

  return new Response(object.body, {
    headers
  });
}

export function buildRenderStatusResponse(
  state: RenderStateRecord | null,
  assetUrl: string,
  statusUrl: string
): Response {
  if (!state) {
    return Response.json(
      {
        ok: true,
        status: "missing",
        asset_url: assetUrl,
        status_url: statusUrl
      },
      {
        status: 404,
        headers: {
          "cache-control": "no-store"
        }
      }
    );
  }

  const responseBody = {
    ok: true,
    status: state.status,
    render_key: state.renderKey,
    asset_url: assetUrl,
    status_url: statusUrl,
    state
  };

  return Response.json(responseBody, {
    status: state.status === "ready" ? 200 : state.status === "pending" ? 202 : 200,
    headers: {
      "cache-control": state.status === "ready" ? "public, max-age=60" : "no-store"
    }
  });
}

export function buildRenderAssetUrl(origin: string, renderKey: string): string {
  return `${origin}/rendered/${encodeURIComponent(renderKey)}`;
}

export function buildRenderStatusUrl(origin: string, renderKey: string): string {
  return `${origin}/api/render-status.json?render_key=${encodeURIComponent(renderKey)}`;
}

export function parseRenderKeyOrThrow(url: URL): string {
  const renderKey = url.searchParams.get("render_key")?.trim();
  if (!renderKey) {
    throw new Error("Missing render_key query parameter");
  }

  if (!/^[a-f0-9]{64}$/i.test(renderKey)) {
    throw new Error("render_key must be a 64-character hex string");
  }

  return renderKey.toLowerCase();
}

export async function verifyCallbackAuth(request: Request, env: Env): Promise<void> {
  if (!env.RENDER_CALLBACK_TOKEN) {
    return;
  }

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${env.RENDER_CALLBACK_TOKEN}`) {
    throw new Error("Invalid callback authorization");
  }
}

export function renderStateKvKey(renderKey: string): string {
  return `render-state:${renderKey}`;
}

export function renderObjectKey(renderKey: string): string {
  return `renders/${renderKey}`;
}

export async function deleteRenderState(env: Env, renderKey: string): Promise<void> {
  if (!env.RENDER_STATE) {
    return;
  }

  await env.RENDER_STATE.delete(renderStateKvKey(renderKey));
}

async function hasRenderedObject(env: Env, state: RenderStateRecord): Promise<boolean> {
  if (!env.RENDER_BUCKET || !state.result) {
    return false;
  }

  const object = await env.RENDER_BUCKET.head(state.result.objectKey);
  return Boolean(object);
}

async function putRenderState(
  env: Env,
  record: RenderStateRecord,
  expirationTtl?: number
): Promise<void> {
  if (!env.RENDER_STATE) {
    return;
  }

  if (expirationTtl === undefined) {
    await env.RENDER_STATE.put(renderStateKvKey(record.renderKey), JSON.stringify(record));
    return;
  }

  await env.RENDER_STATE.put(renderStateKvKey(record.renderKey), JSON.stringify(record), {
    expirationTtl: Math.max(expirationTtl, MIN_KV_TTL_SECONDS)
  });
}

function getPendingTtlSeconds(env: Env): number {
  return parsePositiveInt(env.RENDER_PENDING_TTL_SECONDS, DEFAULT_PENDING_TTL_SECONDS);
}

function getFailedTtlSeconds(env: Env): number {
  return parsePositiveInt(env.RENDER_FAILED_TTL_SECONDS, DEFAULT_FAILED_TTL_SECONDS);
}

function getReadyTtlSeconds(env: Env): number | null {
  const parsed = parseNonNegativeInt(env.RENDER_READY_TTL_SECONDS, DEFAULT_READY_TTL_SECONDS);
  return parsed === 0 ? null : parsed;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(parsed, MIN_KV_TTL_SECONDS) : fallback;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed === 0 ? 0 : Math.max(parsed, MIN_KV_TTL_SECONDS);
}

function renderedAssetCacheControl(ttlSeconds: number | null): string {
  if (ttlSeconds === null) {
    return "public, max-age=31536000, immutable";
  }

  return `public, max-age=${ttlSeconds}`;
}

function contentTypeToFormat(contentType: string): "png" | "webp" {
  if (contentType.includes("webp")) {
    return "webp";
  }

  return "png";
}

async function sha1Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", buffer);
  return [...new Uint8Array(digest)]
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}
