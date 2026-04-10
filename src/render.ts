import { buildCompiledTemplate } from "./template.js";
import type { CompiledTemplate, Env, GroupInfo, RenderOptions, RendererPayload } from "./types.js";
import { normalizeInviteUrl } from "./qq.js";
import { sha256Hex } from "./utils.js";
import { buildRenderAssetUrl, buildRenderStatusUrl } from "./render-cache.js";

const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  format: "png",
  animated: false,
  width: 1200,
  height: 630,
  fps: 12,
  durationMs: 2400
};

export function parseRenderOptions(url: URL): RenderOptions {
  const format = getEnum(url.searchParams.get("format"), ["png", "webp"]) ?? "png";
  const animated = parseBoolean(url.searchParams.get("animated"));
  const width = clampInt(url.searchParams.get("width"), 200, 2400, DEFAULT_RENDER_OPTIONS.width);
  const height = clampInt(url.searchParams.get("height"), 100, 2400, DEFAULT_RENDER_OPTIONS.height);
  const fps = clampInt(url.searchParams.get("fps"), 1, 30, DEFAULT_RENDER_OPTIONS.fps);
  const durationMs = clampInt(
    url.searchParams.get("duration_ms"),
    500,
    15000,
    DEFAULT_RENDER_OPTIONS.durationMs
  );

  return { format, animated: format === "webp" && animated, width, height, fps, durationMs };
}

export async function fetchTemplateSource(templateUrlInput: string): Promise<{
  templateUrl: string;
  templateHtml: string;
}> {
  const templateUrl = normalizeTemplateUrl(templateUrlInput);
  const response = await fetch(templateUrl, {
    headers: {
      accept: "text/html,text/plain;q=0.9,*/*;q=0.8"
    },
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`Template URL returned ${response.status}`);
  }

  const templateHtml = await response.text();

  return {
    templateUrl: response.url || templateUrl,
    templateHtml
  };
}

export async function prepareCompiledTemplate(
  group: GroupInfo,
  templateUrlInput: string
): Promise<CompiledTemplate> {
  const template = await fetchTemplateSource(templateUrlInput);
  return buildCompiledTemplate(template.templateUrl, template.templateHtml, group);
}

export async function buildRendererPayload(
  env: Env,
  origin: string,
  group: GroupInfo,
  templateUrlInput: string,
  options: RenderOptions
): Promise<RendererPayload> {
  const template = await prepareCompiledTemplate(group, templateUrlInput);
  const renderKey = await sha256Hex(
    JSON.stringify({
      cacheVersion: env.CACHE_VERSION ?? "v1",
      compiledSha256: template.compiledSha256,
      options
    })
  );

  return {
    renderKey,
    templateUrl: template.templateUrl,
    templateSha256: template.templateSha256,
    templateHtml: template.templateHtml,
    compiledHtml: template.compiledHtml,
    compiledSha256: template.compiledSha256,
    variables: template.variables,
    usedVariables: template.usedVariables,
    unresolvedVariables: template.unresolvedVariables,
    group,
    options,
    callback: {
      url: `${origin}/api/render/callback`,
      bearerToken: env.RENDER_CALLBACK_TOKEN
    },
    result: {
      assetUrl: buildRenderAssetUrl(origin, renderKey),
      statusUrl: buildRenderStatusUrl(origin, renderKey)
    }
  };
}

export async function forwardRenderRequest(env: Env, payload: RendererPayload): Promise<Response> {
  if (!env.RENDERER_BASE_URL) {
    return Response.json(
      {
        ok: false,
        error: "renderer_not_configured",
        message: "RENDERER_BASE_URL is not configured yet.",
        render_key: payload.renderKey,
        request: {
          template_url: payload.templateUrl,
          template_sha256: payload.templateSha256,
          compiled_sha256: payload.compiledSha256,
          used_variables: payload.usedVariables,
          unresolved_variables: payload.unresolvedVariables,
          variables: payload.variables,
          group: payload.group,
          options: payload.options
        }
      },
      {
        status: 501,
        headers: {
          "cache-control": "no-store"
        }
      }
    );
  }

  const headers = new Headers({
    "content-type": "application/json"
  });

  if (env.RENDERER_SHARED_TOKEN) {
    headers.set("authorization", `Bearer ${env.RENDERER_SHARED_TOKEN}`);
  }

  return fetch(new URL("/render", env.RENDERER_BASE_URL).toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
}

export function isRendererConfigured(env: Env): boolean {
  return Boolean(env.RENDERER_BASE_URL);
}

export function getInviteUrlOrThrow(url: URL): string {
  const inviteUrl = url.searchParams.get("invite") ?? url.searchParams.get("url");
  if (!inviteUrl) {
    throw new Error("Missing invite query parameter");
  }

  return normalizeInviteUrl(inviteUrl);
}

export function getTemplateUrlOrThrow(url: URL): string {
  const templateUrl = url.searchParams.get("template");
  if (!templateUrl) {
    throw new Error("Missing template query parameter");
  }

  return normalizeTemplateUrl(templateUrl);
}

function normalizeTemplateUrl(templateUrlInput: string): string {
  const url = new URL(templateUrlInput.trim());
  if (!["https:", "http:"].includes(url.protocol)) {
    throw new Error("Template URL must use http or https");
  }
  return url.toString();
}

function clampInt(value: string | null, min: number, max: number, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

function getEnum<T extends string>(value: string | null, allowed: T[]): T | null {
  if (!value) {
    return null;
  }

  return allowed.includes(value as T) ? (value as T) : null;
}

function parseBoolean(value: string | null): boolean {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
