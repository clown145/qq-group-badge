import type { Env, SvgCacheMetaRecord } from "./types.js";
import { sha256Hex } from "./utils.js";

const SVG_CONTENT_TYPE = "image/svg+xml; charset=utf-8";
const DEFAULT_SVG_SOFT_TTL_SECONDS = 5 * 60;
const DEFAULT_SVG_HARD_TTL_SECONDS = 30 * 24 * 60 * 60;
const MIN_TTL_SECONDS = 60;
const STALE_RESPONSE_TTL_SECONDS = 30;

export interface SvgCacheWriteResult {
  bodyKey: string;
  etag: string;
  meta: SvgCacheMetaRecord;
}

export interface CachedSvgHit {
  meta: SvgCacheMetaRecord;
  response: Response;
  stale: boolean;
}

export function isSvgCacheConfigured(env: Env): boolean {
  return Boolean(env.RENDER_BUCKET);
}

export function getSvgCacheSoftTtlSeconds(env: Env): number {
  return parseOptionalTtl(env.SVG_CACHE_SOFT_TTL_SECONDS, DEFAULT_SVG_SOFT_TTL_SECONDS) ?? DEFAULT_SVG_SOFT_TTL_SECONDS;
}

export function getSvgCacheHardTtlSeconds(env: Env): number | null {
  return parseOptionalTtl(env.SVG_CACHE_HARD_TTL_SECONDS, DEFAULT_SVG_HARD_TTL_SECONDS);
}

export async function buildSvgAliasKey(env: Env, payload: unknown): Promise<string> {
  return sha256Hex(
    JSON.stringify({
      cacheVersion: env.CACHE_VERSION ?? "v1",
      svgCacheVersion: "r2-v1",
      payload
    })
  );
}

export async function getCachedSvgHit(
  env: Env,
  aliasKey: string
): Promise<CachedSvgHit | null> {
  if (!env.RENDER_BUCKET) {
    return null;
  }

  const meta = await getSvgCacheMeta(env, aliasKey);
  if (!meta) {
    return null;
  }

  if (meta.expiresAt && Date.now() >= Date.parse(meta.expiresAt)) {
    await env.RENDER_BUCKET.delete(svgMetaKey(aliasKey));
    return null;
  }

  const object = await env.RENDER_BUCKET.get(meta.bodyKey);
  if (!object) {
    await env.RENDER_BUCKET.delete(svgMetaKey(aliasKey));
    return null;
  }

  const stale = Date.now() >= Date.parse(meta.staleAfter);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", SVG_CONTENT_TYPE);
  headers.set("cache-control", stale ? staleSvgCacheControl() : freshSvgCacheControl(env));
  headers.set("etag", `"${meta.etag}"`);
  headers.set("content-length", String(object.size));
  headers.set("x-svg-cache", stale ? "stale" : "hit");

  for (const [key, value] of Object.entries(meta.headers)) {
    headers.set(key, value);
  }

  return {
    meta,
    stale,
    response: new Response(object.body, {
      headers
    })
  };
}

export async function putSvgCache(
  env: Env,
  aliasKey: string,
  svg: string,
  headers: Record<string, string>,
  existingMeta: SvgCacheMetaRecord | null = null
): Promise<SvgCacheWriteResult> {
  if (!env.RENDER_BUCKET) {
    throw new Error("RENDER_BUCKET is not configured");
  }

  const etag = await sha256Hex(svg);
  const bodyKey = svgBodyKey(etag);
  const now = new Date().toISOString();
  const softTtlSeconds = getSvgCacheSoftTtlSeconds(env);
  const hardTtlSeconds = getSvgCacheHardTtlSeconds(env);
  const staleAfter = new Date(Date.now() + softTtlSeconds * 1000).toISOString();
  const expiresAt =
    hardTtlSeconds === null ? null : new Date(Date.now() + hardTtlSeconds * 1000).toISOString();
  const meta: SvgCacheMetaRecord = {
    aliasKey,
    bodyKey,
    etag,
    checkedAt: now,
    staleAfter,
    expiresAt,
    headers
  };

  if (existingMeta?.etag !== etag || existingMeta.bodyKey !== bodyKey) {
    await env.RENDER_BUCKET.put(bodyKey, svg, {
      httpMetadata: {
        contentType: SVG_CONTENT_TYPE,
        cacheControl: freshSvgCacheControl(env)
      },
      customMetadata: {
        etag,
        checked_at: now,
        stale_after: staleAfter,
        expires_at: expiresAt ?? ""
      }
    });
  }

  await env.RENDER_BUCKET.put(svgMetaKey(aliasKey), JSON.stringify(meta), {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
      cacheControl: "no-store"
    }
  });

  return {
    bodyKey,
    etag,
    meta
  };
}

export function buildFreshSvgResponse(
  env: Env,
  svg: string,
  etag: string,
  headers: Record<string, string>,
  cacheState: string
): Response {
  return buildSvgResponse(svg, etag, headers, freshSvgCacheControl(env), cacheState);
}

export function buildBypassSvgResponse(
  env: Env,
  svg: string,
  etag: string,
  headers: Record<string, string>,
  cacheState = "bypass"
): Response {
  return buildSvgResponse(svg, etag, headers, freshSvgCacheControl(env), cacheState);
}

async function getSvgCacheMeta(env: Env, aliasKey: string): Promise<SvgCacheMetaRecord | null> {
  if (!env.RENDER_BUCKET) {
    return null;
  }

  const object = await env.RENDER_BUCKET.get(svgMetaKey(aliasKey));
  if (!object) {
    return null;
  }

  try {
    const parsed = (await object.json()) as Partial<SvgCacheMetaRecord>;
    if (
      typeof parsed.aliasKey !== "string" ||
      typeof parsed.bodyKey !== "string" ||
      typeof parsed.etag !== "string" ||
      typeof parsed.checkedAt !== "string" ||
      typeof parsed.staleAfter !== "string" ||
      (parsed.expiresAt !== null && typeof parsed.expiresAt !== "string") ||
      !isRecord(parsed.headers)
    ) {
      await env.RENDER_BUCKET.delete(svgMetaKey(aliasKey));
      return null;
    }

    return {
      aliasKey: parsed.aliasKey,
      bodyKey: parsed.bodyKey,
      etag: parsed.etag,
      checkedAt: parsed.checkedAt,
      staleAfter: parsed.staleAfter,
      expiresAt: parsed.expiresAt ?? null,
      headers: Object.fromEntries(
        Object.entries(parsed.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string")
      )
    };
  } catch {
    await env.RENDER_BUCKET.delete(svgMetaKey(aliasKey));
    return null;
  }
}

function buildSvgResponse(
  svg: string,
  etag: string,
  extraHeaders: Record<string, string>,
  cacheControl: string,
  cacheState: string
): Response {
  const headers = new Headers({
    "content-type": SVG_CONTENT_TYPE,
    "cache-control": cacheControl,
    etag: `"${etag}"`,
    "x-svg-cache": cacheState
  });

  for (const [key, value] of Object.entries(extraHeaders)) {
    headers.set(key, value);
  }

  return new Response(svg, {
    headers
  });
}

function freshSvgCacheControl(env: Env): string {
  const softTtlSeconds = getSvgCacheSoftTtlSeconds(env);
  return `public, max-age=${softTtlSeconds}, s-maxage=${softTtlSeconds}, stale-while-revalidate=3600`;
}

function staleSvgCacheControl(): string {
  return `public, max-age=${STALE_RESPONSE_TTL_SECONDS}, s-maxage=${STALE_RESPONSE_TTL_SECONDS}, stale-while-revalidate=300`;
}

function svgMetaKey(aliasKey: string): string {
  return `svg-meta/${aliasKey}.json`;
}

function svgBodyKey(etag: string): string {
  return `svg-body/${etag}.svg`;
}

function parseOptionalTtl(value: string | undefined, fallback: number): number | null {
  if (value === undefined) {
    return fallback;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (parsed <= 0) {
    return null;
  }

  return Math.max(parsed, MIN_TTL_SECONDS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
