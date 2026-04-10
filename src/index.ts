import { fetchGroupInfo } from "./qq.js";
import {
  buildRendererPayload,
  forwardRenderRequest,
  getInviteUrlOrThrow,
  prepareCompiledTemplate,
  getTemplateUrlOrThrow,
  isRendererConfigured,
  parseRenderOptions
} from "./render.js";
import {
  buildRenderAssetUrl,
  buildRenderStatusResponse,
  buildRenderStatusUrl,
  getLatestRenderedAssetResponse,
  getRenderState,
  getUsableRenderState,
  getRenderedAssetResponse,
  isRenderStorageConfigured,
  parseRenderKeyOrThrow,
  putLatestRenderAlias,
  putRenderFailed,
  putRenderFailureFromCallback,
  putRenderPending,
  putRenderSuccess,
  verifyCallbackAuth
} from "./render-cache.js";
import { renderBadgeSvg } from "./svg.js";
import { injectPreviewBaseTag } from "./template.js";
import type {
  BadgeOptions,
  Env,
  RenderCallbackFailure,
  RendererPayload,
  RenderOptions,
  RenderStateRecord
} from "./types.js";
import { coalesceString, sha256Hex, toBase64, xmlEscape } from "./utils.js";

type RenderImageFormat = "png" | "webp";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const origin = `${url.protocol}//${url.host}`;

    try {
      if (request.method === "POST" && url.pathname === "/api/render/callback") {
        return await handleRenderCallback(request, env);
      }

      if (request.method !== "GET") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: {
            allow: "GET, POST"
          }
        });
      }

      if (url.pathname === "/") {
        return renderHome(url);
      }

      if (url.pathname === "/badge.svg" || url.pathname === "/badge") {
        return await withCache(request, ctx, () => handleBadge(url));
      }

      const renderImageFormat = getRenderImageFormatFromPath(url.pathname);
      if (renderImageFormat) {
        return await handleRenderImage(env, url, origin, ctx, renderImageFormat);
      }

      if (url.pathname === "/api/group.json") {
        return await withCache(request, ctx, () => handleGroupJson(url));
      }

      if (url.pathname === "/api/render.json") {
        return await handleRender(env, url, origin);
      }

      if (url.pathname === "/api/render-status.json") {
        return await handleRenderStatus(env, url, origin);
      }

      if (url.pathname === "/api/template.json") {
        return await withCache(request, ctx, () => handleTemplateJson(url));
      }

      if (url.pathname === "/preview.html") {
        return await withCache(request, ctx, () => handlePreviewHtml(url));
      }

      if (url.pathname.startsWith("/rendered/")) {
        return await withCache(request, ctx, () => handleRenderedAsset(env, url));
      }

      return Response.json(
        {
          ok: false,
          error: "not_found"
        },
        { status: 404 }
      );
    } catch (error) {
      if (getRenderImageFormatFromPath(url.pathname)) {
        return renderImageStatusPlaceholder({
          title: "Invalid badge request",
          message: error instanceof Error ? error.message : "Unknown render error",
          status: 200,
          renderStatus: "invalid_request"
        });
      }

      return Response.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "unknown_error"
        },
        {
          status: 400,
          headers: {
            "cache-control": "no-store"
          }
        }
      );
    }
  }
} satisfies ExportedHandler<Env>;

async function handleBadge(url: URL): Promise<Response> {
  const inviteUrl = getInviteUrlOrThrow(url);
  const group = await fetchGroupInfo(inviteUrl);
  const options = parseBadgeOptions(url);
  const avatarDataUrl =
    options.includeAvatar && group.avatarUrl ? await fetchAvatarDataUrl(group.avatarUrl) : null;
  const svg = renderBadgeSvg(group, options, avatarDataUrl);
  const etag = `"${await sha256Hex(JSON.stringify({ group, options, hasAvatar: Boolean(avatarDataUrl) }))}"`;

  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
      etag
    }
  });
}

async function handleGroupJson(url: URL): Promise<Response> {
  const inviteUrl = getInviteUrlOrThrow(url);
  const group = await fetchGroupInfo(inviteUrl);
  const cacheKey = await sha256Hex(JSON.stringify(group));

  return Response.json(
    {
      ok: true,
      data: group
    },
    {
      headers: {
        "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
        etag: `"${cacheKey}"`
      }
    }
  );
}

async function handleRender(env: Env, url: URL, origin: string): Promise<Response> {
  const inviteUrl = getInviteUrlOrThrow(url);
  const templateUrl = getTemplateUrlOrThrow(url);
  const group = await fetchGroupInfo(inviteUrl);
  const payload = await buildRendererPayload(env, origin, group, templateUrl, parseRenderOptions(url));
  const existing = await getUsableRenderState(env, payload.renderKey);

  if (existing?.status === "ready") {
    return buildRenderStatusResponse(existing, payload.result.assetUrl, payload.result.statusUrl);
  }

  if (existing?.status === "pending") {
    return buildRenderStatusResponse(existing, payload.result.assetUrl, payload.result.statusUrl);
  }

  if (existing?.status === "failed" && url.searchParams.get("retry") !== "1") {
    return buildRenderStatusResponse(existing, payload.result.assetUrl, payload.result.statusUrl);
  }

  if (!isRenderStorageConfigured(env)) {
    return Response.json(
      {
        ok: false,
        error: "render_storage_not_configured",
        message: "RENDER_STATE and RENDER_BUCKET must both be configured before render caching can work.",
        render_key: payload.renderKey,
        asset_url: payload.result.assetUrl,
        status_url: payload.result.statusUrl
      },
      {
        status: 501,
        headers: {
          "cache-control": "no-store"
        }
      }
    );
  }

  if (!isRendererConfigured(env)) {
    return Response.json(
      {
        ok: false,
        error: "renderer_not_configured",
        message: "RENDERER_BASE_URL is not configured yet.",
        render_key: payload.renderKey,
        asset_url: payload.result.assetUrl,
        status_url: payload.result.statusUrl,
        request: {
          template_url: payload.templateUrl,
          template_sha256: payload.templateSha256,
          compiled_sha256: payload.compiledSha256,
          used_variables: payload.usedVariables,
          unresolved_variables: payload.unresolvedVariables,
          variables: payload.variables,
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

  const pending = await putRenderPending(env, payload, existing);
  const upstream = await forwardRenderRequest(env, payload);

  if (!upstream.ok) {
    const detail = await readUpstreamBody(upstream);
    const failed = await putRenderFailed(
      env,
      payload.renderKey,
      {
        code: `renderer_${upstream.status}`,
        message: `Renderer request failed with ${upstream.status}`
      },
      pending
    );

    return Response.json(
      {
        ok: false,
        error: "renderer_request_failed",
        render_key: payload.renderKey,
        asset_url: payload.result.assetUrl,
        status_url: payload.result.statusUrl,
        upstream_status: upstream.status,
        upstream_body: detail,
        state: failed
      },
      {
        status: 502,
        headers: {
          "cache-control": "no-store"
        }
      }
    );
  }

  return Response.json(
    {
      ok: true,
      status: "pending",
      render_key: payload.renderKey,
      asset_url: payload.result.assetUrl,
      status_url: payload.result.statusUrl,
      state: pending,
      renderer_response: await readUpstreamBody(upstream)
    },
    {
      status: 202,
      headers: {
        "cache-control": "no-store"
      }
    }
  );
}

async function handleRenderImage(
  env: Env,
  url: URL,
  origin: string,
  ctx: ExecutionContext,
  format: RenderImageFormat
): Promise<Response> {
  const inviteUrl = getInviteUrlOrThrow(url);
  const templateUrl = getTemplateUrlOrThrow(url);
  const options = parseRenderImageOptions(url, format);
  const aliasKey = await buildRenderAliasKey(env, inviteUrl, templateUrl, options);
  const group = await fetchGroupInfo(inviteUrl);
  const payload = await buildRendererPayload(env, origin, group, templateUrl, options);
  const existing = await getUsableRenderState(env, payload.renderKey);

  if (existing?.status === "ready") {
    const response = await getRenderedAssetResponse(env, payload.renderKey);

    if (response) {
      ctx.waitUntil(
        putLatestRenderAlias(
          env,
          aliasKey,
          payload.renderKey,
          existing.result?.contentType ?? contentTypeForFormat(format)
        )
      );
      response.headers.set("x-render-status", "ready");
      response.headers.set("x-render-alias", aliasKey);
      return response;
    }
  }

  let state = existing;
  const retryFailed = url.searchParams.get("retry") === "1";

  if (existing?.status === "failed" && !retryFailed) {
    const stale = await getLatestRenderedAssetResponse(env, aliasKey);
    if (stale) {
      stale.headers.set("x-render-status", "stale");
      return stale;
    }

    return renderImageStatusPlaceholder({
      title: "Render failed",
      message: existing.error?.message ?? "The renderer reported a failure.",
      status: 200,
      renderKey: payload.renderKey,
      renderStatus: "failed"
    });
  }

  if (existing?.status !== "pending") {
    if (!isRenderStorageConfigured(env)) {
      return renderImageStatusPlaceholder({
        title: "Render storage is not configured",
        message: "RENDER_STATE and RENDER_BUCKET are required.",
        status: 200,
        renderKey: payload.renderKey,
        renderStatus: "not_configured"
      });
    }

    if (!isRendererConfigured(env)) {
      return renderImageStatusPlaceholder({
        title: "Renderer is not configured",
        message: "RENDERER_BASE_URL is required.",
        status: 200,
        renderKey: payload.renderKey,
        renderStatus: "not_configured"
      });
    }

    const pending = await putRenderPending(env, payload, existing);
    state = pending;
    ctx.waitUntil(forwardRenderRequestAndRecordFailure(env, payload, pending));
  }

  const stale = await getLatestRenderedAssetResponse(env, aliasKey);
  if (stale) {
    stale.headers.set("x-render-status", "stale");
    return stale;
  }

  return renderImageStatusPlaceholder({
    title: "Rendering badge",
    message: "Refresh this image after the renderer finishes.",
    status: 200,
    renderKey: payload.renderKey,
    renderStatus: state?.status ?? "missing"
  });
}

async function forwardRenderRequestAndRecordFailure(
  env: Env,
  payload: RendererPayload,
  pending: RenderStateRecord
): Promise<void> {
  try {
    const upstream = await forwardRenderRequest(env, payload);

    if (!upstream.ok) {
      await putRenderFailed(
        env,
        payload.renderKey,
        {
          code: `renderer_${upstream.status}`,
          message: `Renderer request failed with ${upstream.status}`
        },
        pending
      );
    }
  } catch (error) {
    await putRenderFailed(
      env,
      payload.renderKey,
      {
        code: "renderer_fetch_failed",
        message: error instanceof Error ? error.message : "Renderer request failed"
      },
      pending
    );
  }
}

async function handleRenderStatus(env: Env, url: URL, origin: string): Promise<Response> {
  const renderKey = parseRenderKeyOrThrow(url);
  const state = await getUsableRenderState(env, renderKey);
  return buildRenderStatusResponse(
    state,
    buildRenderAssetUrl(origin, renderKey),
    buildRenderStatusUrl(origin, renderKey)
  );
}

async function handleRenderedAsset(env: Env, url: URL): Promise<Response> {
  const renderKey = parseRenderKeyFromPath(url.pathname);
  const response = await getRenderedAssetResponse(env, renderKey);

  if (response) {
    return response;
  }

  return Response.json(
    {
      ok: false,
      error: "render_asset_not_found",
      render_key: renderKey
    },
    {
      status: 404,
      headers: {
        "cache-control": "no-store"
      }
    }
  );
}

async function handleRenderCallback(request: Request, env: Env): Promise<Response> {
  await verifyCallbackAuth(request, env);
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.startsWith("application/json")) {
    const payload = (await request.json()) as Record<string, unknown>;
    const status = typeof payload.status === "string" ? payload.status : null;

    if (status === "failed") {
      const failure = parseRenderFailurePayload(payload);
      const state = await putRenderFailureFromCallback(env, failure);
      return Response.json({
        ok: true,
        status: "failed",
        render_key: failure.renderKey,
        state
      });
    }

    if (status === "ready") {
      const renderKey = readRenderKey(payload);
      const bodyBase64 = readStringField(payload, "data_base64", "dataBase64");
      if (!bodyBase64) {
        throw new Error("Callback ready payload is missing data_base64");
      }
      const readyContentType =
        readStringField(payload, "content_type", "contentType") ?? "image/png";
      const body = base64ToArrayBuffer(bodyBase64);
      const state = await putRenderSuccess(
        env,
        renderKey,
        readyContentType,
        body,
        await getRenderState(env, renderKey)
      );

      return Response.json({
        ok: true,
        status: "ready",
        render_key: renderKey,
        state
      });
    }

    throw new Error("Unsupported callback JSON payload");
  }

  const callbackUrl = new URL(request.url);
  const renderKey = parseRenderKeyOrThrow(callbackUrl);
  const callbackContentType =
    callbackUrl.searchParams.get("content_type") ?? request.headers.get("content-type");

  if (!callbackContentType || !callbackContentType.startsWith("image/")) {
    throw new Error("Callback content_type must be an image/* type");
  }

  const state = await putRenderSuccess(
    env,
    renderKey,
    callbackContentType,
    await request.arrayBuffer(),
    await getRenderState(env, renderKey)
  );

  return Response.json({
    ok: true,
    status: "ready",
    render_key: renderKey,
    state
  });
}

async function handleTemplateJson(url: URL): Promise<Response> {
  const inviteUrl = getInviteUrlOrThrow(url);
  const templateUrl = getTemplateUrlOrThrow(url);
  const group = await fetchGroupInfo(inviteUrl);
  const template = await prepareCompiledTemplate(group, templateUrl);

  return Response.json(
    {
      ok: true,
      data: {
        group,
        template: {
          template_url: template.templateUrl,
          template_sha256: template.templateSha256,
          compiled_sha256: template.compiledSha256,
          used_variables: template.usedVariables,
          unresolved_variables: template.unresolvedVariables,
          variables: template.variables
        }
      }
    },
    {
      headers: {
        "cache-control": "public, max-age=180, s-maxage=180, stale-while-revalidate=900",
        etag: `"${template.compiledSha256}"`
      }
    }
  );
}

async function handlePreviewHtml(url: URL): Promise<Response> {
  const inviteUrl = getInviteUrlOrThrow(url);
  const templateUrl = getTemplateUrlOrThrow(url);
  const group = await fetchGroupInfo(inviteUrl);
  const template = await prepareCompiledTemplate(group, templateUrl);
  const html = injectPreviewBaseTag(template.compiledHtml, template.templateUrl);

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=180, s-maxage=180, stale-while-revalidate=900",
      etag: `"${template.compiledSha256}"`,
      "x-template-sha256": template.templateSha256,
      "x-compiled-sha256": template.compiledSha256
    }
  });
}

function renderHome(url: URL): Response {
  const origin = `${url.protocol}//${url.host}`;
  const sampleInvite = "https://qm.qq.com/q/oTzIrdDBIc";
  const sampleBadge = `${origin}/badge.svg?invite=${encodeURIComponent(sampleInvite)}`;
  const sampleJson = `${origin}/api/group.json?invite=${encodeURIComponent(sampleInvite)}`;
  const sampleTemplate = "https://example.com/template.html";
  const sampleTemplateImage = `${origin}/badge.webp?invite=${encodeURIComponent(sampleInvite)}&template=${encodeURIComponent(sampleTemplate)}&animated=1`;
  const sampleTemplateJson = `${origin}/api/template.json?invite=${encodeURIComponent(sampleInvite)}&template=${encodeURIComponent(sampleTemplate)}`;
  const samplePreview = `${origin}/preview.html?invite=${encodeURIComponent(sampleInvite)}&template=${encodeURIComponent(sampleTemplate)}`;
  const sampleRender = `${origin}/api/render.json?invite=${encodeURIComponent(sampleInvite)}&template=${encodeURIComponent(sampleTemplate)}&format=png`;
  const sampleRenderStatus = `${origin}/api/render-status.json?render_key=${"0".repeat(64)}`;
  const sampleRenderedAsset = `${origin}/rendered/${"0".repeat(64)}`;

  return Response.json(
    {
      ok: true,
      service: "qq-group-badge",
      endpoints: {
        badge_svg: sampleBadge,
        badge_webp: sampleTemplateImage,
        group_json: sampleJson,
        template_json: sampleTemplateJson,
        preview_html: samplePreview,
        render_proxy: sampleRender,
        render_status: sampleRenderStatus,
        rendered_asset: sampleRenderedAsset
      },
      markdown_example: `[![QQ群徽章](${sampleBadge})](${sampleInvite})`
    },
    {
      headers: {
        "cache-control": "public, max-age=60"
      }
    }
  );
}

function parseBadgeOptions(url: URL): BadgeOptions {
  const includeAvatar = url.searchParams.get("avatar") !== "0";
  const label = coalesceString(url.searchParams.get("label"), "QQ GROUP") ?? "QQ GROUP";

  return {
    includeAvatar,
    label
  };
}

function getRenderImageFormatFromPath(pathname: string): RenderImageFormat | null {
  if (pathname === "/badge.png" || pathname === "/render.png") {
    return "png";
  }

  if (pathname === "/badge.webp" || pathname === "/render.webp") {
    return "webp";
  }

  return null;
}

function parseRenderImageOptions(url: URL, format: RenderImageFormat): RenderOptions {
  const options = parseRenderOptions(url);

  return {
    ...options,
    format,
    animated: format === "webp" && parseQueryBoolean(url.searchParams.get("animated"))
  };
}

function parseQueryBoolean(value: string | null): boolean {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

async function buildRenderAliasKey(
  env: Env,
  inviteUrl: string,
  templateUrl: string,
  options: RenderOptions
): Promise<string> {
  return sha256Hex(
    JSON.stringify({
      cacheVersion: env.CACHE_VERSION ?? "v1",
      inviteUrl,
      templateUrl,
      options
    })
  );
}

function contentTypeForFormat(format: RenderImageFormat): string {
  return format === "webp" ? "image/webp" : "image/png";
}

function renderImageStatusPlaceholder(options: {
  title: string;
  message: string;
  status: number;
  renderKey?: string;
  renderStatus: string;
}): Response {
  const title = xmlEscape(options.title);
  const message = xmlEscape(options.message);
  const renderKey = options.renderKey ? xmlEscape(options.renderKey.slice(0, 12)) : "";
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="500" viewBox="0 0 1000 500" role="img" aria-label="${title}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#e7f2ff" />
      <stop offset="52%" stop-color="#f6faf7" />
      <stop offset="100%" stop-color="#e9f5ef" />
    </linearGradient>
  </defs>
  <rect width="1000" height="500" fill="url(#bg)" />
  <rect x="80" y="100" width="840" height="300" rx="42" fill="rgba(255,255,255,0.82)" stroke="rgba(16,32,51,0.12)" />
  <circle cx="170" cy="250" r="58" fill="#d7eaff" />
  <text x="260" y="230" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="#102033">${title}</text>
  <text x="260" y="282" font-family="Arial, sans-serif" font-size="24" font-weight="600" fill="#63738a">${message}</text>
  <text x="260" y="330" font-family="Arial, sans-serif" font-size="18" font-weight="600" fill="#0c7ff2">${renderKey ? `render ${renderKey}` : "qq-group-badge"}</text>
</svg>`;

  return new Response(svg, {
    status: options.status,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "no-store",
      "x-render-status": options.renderStatus
    }
  });
}

async function fetchAvatarDataUrl(avatarUrl: string): Promise<string | null> {
  const response = await fetch(avatarUrl, {
    headers: {
      accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
    }
  });

  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get("content-type");
  if (!contentType || !contentType.startsWith("image/")) {
    return null;
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0 || buffer.byteLength > 512_000) {
    return null;
  }

  return `data:${contentType};base64,${toBase64(buffer)}`;
}

async function withCache(
  request: Request,
  ctx: ExecutionContext,
  producer: () => Promise<Response>
): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(request.url, request);
  const cached = await cache.match(cacheKey);

  if (cached) {
    return cached;
  }

  const response = await producer();
  if (response.ok && response.headers.get("cache-control")?.includes("max-age")) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }

  return response;
}

function parseRenderKeyFromPath(pathname: string): string {
  const renderKey = pathname.slice("/rendered/".length);
  if (!/^[a-f0-9]{64}$/i.test(renderKey)) {
    throw new Error("Rendered asset path must include a 64-character hex render key");
  }

  return renderKey.toLowerCase();
}

async function readUpstreamBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      return await response.clone().json();
    }

    const text = await response.clone().text();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

function parseRenderFailurePayload(payload: Record<string, unknown>): RenderCallbackFailure {
  const renderKey = readRenderKey(payload);
  const errorNode = payload.error;

  if (
    !errorNode ||
    typeof errorNode !== "object" ||
    typeof (errorNode as Record<string, unknown>).code !== "string" ||
    typeof (errorNode as Record<string, unknown>).message !== "string"
  ) {
    throw new Error("Invalid callback failure payload");
  }

  return {
    renderKey,
    status: "failed",
    error: {
      code: (errorNode as Record<string, string>).code,
      message: (errorNode as Record<string, string>).message
    }
  };
}

function readRenderKey(payload: Record<string, unknown>): string {
  const value = readStringField(payload, "render_key", "renderKey");
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error("Invalid render key in callback payload");
  }

  return value.toLowerCase();
}

function readStringField(
  payload: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    if (typeof payload[key] === "string" && payload[key]!.trim().length > 0) {
      return payload[key] as string;
    }
  }

  return null;
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return bytes.buffer;
}
