import { fetchGroupInfo } from "./qq.js";
import {
  buildRendererPayload,
  fetchTemplateSource,
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
import { buildCompiledTemplate, injectPreviewBaseTag } from "./template.js";
import type {
  BadgeOptions,
  Env,
  GroupInfo,
  RenderCallbackFailure,
  RendererPayload,
  RenderOptions,
  RenderStateRecord,
  TemplateVariables
} from "./types.js";
import { coalesceString, sha256Hex, toBase64, xmlEscape } from "./utils.js";

type RenderImageFormat = "png" | "webp";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const origin = `${url.protocol}//${url.host}`;
    const isHead = request.method === "HEAD";

    try {
      if (request.method === "POST" && url.pathname === "/api/render/callback") {
        return await handleRenderCallback(request, env);
      }

      if (request.method !== "GET" && !isHead) {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: {
            allow: "GET, HEAD, POST"
          }
        });
      }

      if (url.pathname === "/") {
        return finalizeMethodResponse(renderHome(url), isHead);
      }

      if (url.pathname === "/badge.svg" || url.pathname === "/badge") {
        return finalizeMethodResponse(await withCache(request, ctx, () => handleBadge(url)), isHead);
      }

      const renderImageFormat = getRenderImageFormatFromPath(url.pathname);
      if (renderImageFormat) {
        return finalizeMethodResponse(
          await handleRenderImage(env, url, origin, ctx, renderImageFormat),
          isHead
        );
      }

      if (url.pathname === "/api/group.json") {
        return finalizeMethodResponse(await withCache(request, ctx, () => handleGroupJson(url)), isHead);
      }

      if (url.pathname === "/api/render.json") {
        return finalizeMethodResponse(await handleRender(env, url, origin), isHead);
      }

      if (url.pathname === "/api/render-status.json") {
        return finalizeMethodResponse(await handleRenderStatus(env, url, origin), isHead);
      }

      if (url.pathname === "/api/template.json") {
        return finalizeMethodResponse(await withCache(request, ctx, () => handleTemplateJson(url)), isHead);
      }

      if (url.pathname === "/preview.html") {
        return finalizeMethodResponse(await withCache(request, ctx, () => handlePreviewHtml(url)), isHead);
      }

      if (url.pathname.startsWith("/rendered/")) {
        return finalizeMethodResponse(await withCache(request, ctx, () => handleRenderedAsset(env, url)), isHead);
      }

      return finalizeMethodResponse(
        Response.json(
          {
            ok: false,
            error: "not_found"
          },
          { status: 404 }
        ),
        isHead
      );
    } catch (error) {
      if (getRenderImageFormatFromPath(url.pathname)) {
        return finalizeMethodResponse(
          renderImageStatusPlaceholder({
            title: "Invalid badge request",
            message: error instanceof Error ? error.message : "Unknown render error",
            status: 200,
            renderStatus: "invalid_request"
          }),
          isHead
        );
      }

      return finalizeMethodResponse(
        Response.json(
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
        ),
        isHead
      );
    }
  }
} satisfies ExportedHandler<Env>;

async function handleBadge(url: URL): Promise<Response> {
  if (url.searchParams.has("template")) {
    return handleSvgTemplateBadge(url);
  }

  const inviteUrl = getInviteUrlOrThrow(url);
  const group = await fetchGroupInfo(inviteUrl);
  const options = parseBadgeOptions(url);
  const avatarDataUrl =
    options.includeAvatar && group.avatarUrl ? await fetchImageDataUrl(group.avatarUrl) : null;
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

async function handleSvgTemplateBadge(url: URL): Promise<Response> {
  const inviteUrl = getInviteUrlOrThrow(url);
  const templateUrl = getTemplateUrlOrThrow(url);
  const group = await fetchGroupInfo(inviteUrl);
  const source = await fetchTemplateSource(templateUrl);
  const imageDataVariables = await buildSvgImageDataVariables(source.templateHtml, group, {
    includeAvatar: url.searchParams.get("avatar") !== "0",
    includeBackground: url.searchParams.get("background") !== "0"
  });
  const template = await buildCompiledTemplate(
    source.templateUrl,
    source.templateHtml,
    group,
    imageDataVariables
  );
  const svg = normalizeSvgTemplateOutput(template.compiledHtml);

  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
      etag: `"${template.compiledSha256}"`,
      "x-template-sha256": template.templateSha256,
      "x-compiled-sha256": template.compiledSha256
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
      return finalizeRenderImageResponse(response, "ready", aliasKey);
    }
  }

  let state = existing;
  const retryFailed = url.searchParams.get("retry") === "1";

  if (existing?.status === "failed" && !retryFailed) {
    const stale = await getLatestRenderedAssetResponse(env, aliasKey);
    if (stale) {
      return finalizeRenderImageResponse(stale, "stale", aliasKey);
    }

    return renderSvgFallbackBadge(group, "failed", aliasKey, payload.renderKey);
  }

  if (existing?.status !== "pending") {
    if (!isRenderStorageConfigured(env)) {
      return renderSvgFallbackBadge(group, "not_configured", aliasKey, payload.renderKey);
    }

    if (!isRendererConfigured(env)) {
      return renderSvgFallbackBadge(group, "not_configured", aliasKey, payload.renderKey);
    }

    const pending = await putRenderPending(env, payload, existing);
    state = pending;
    ctx.waitUntil(forwardRenderRequestAndRecordFailure(env, payload, pending));
  }

  const stale = await getLatestRenderedAssetResponse(env, aliasKey);
  if (stale) {
    return finalizeRenderImageResponse(stale, "stale", aliasKey);
  }

  return renderSvgFallbackBadge(group, state?.status ?? "missing", aliasKey, payload.renderKey);
}

function finalizeRenderImageResponse(
  response: Response,
  renderStatus: "ready" | "stale",
  aliasKey: string
): Response {
  response.headers.set("cache-control", "public, max-age=300, s-maxage=300, stale-while-revalidate=3600");
  response.headers.set("x-render-status", renderStatus);
  response.headers.set("x-render-alias", aliasKey);
  return response;
}

function renderSvgFallbackBadge(
  group: GroupInfo,
  renderStatus: string,
  aliasKey: string,
  renderKey: string
): Response {
  const svg = renderBadgeSvg(group, { includeAvatar: false, label: "QQ GROUP" }, null);

  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
      "x-render-status": renderStatus,
      "x-render-alias": aliasKey,
      "x-render-key": renderKey
    }
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
  const initialInvite = coalesceString(url.searchParams.get("invite"), "") ?? "";
  const staticTemplate =
    "https://raw.githubusercontent.com/clown145/qq-group-badge/main/examples/group-badge-template.svg";
  const animatedTemplate =
    "https://raw.githubusercontent.com/clown145/qq-group-badge/main/examples/group-animated-badge-template.svg";
  const requestedTemplate = coalesceString(url.searchParams.get("template"), "") ?? "";
  const initialTemplatePreset =
    requestedTemplate === animatedTemplate
      ? "animated"
      : requestedTemplate.length > 0 && requestedTemplate !== staticTemplate
        ? "custom"
        : "static";
  const initialCustomTemplate = initialTemplatePreset === "custom" ? requestedTemplate : "";
  const originJson = jsonForInlineScript(origin);
  const staticTemplateJson = jsonForInlineScript(staticTemplate);
  const animatedTemplateJson = jsonForInlineScript(animatedTemplate);
  const initialTemplatePresetJson = jsonForInlineScript(initialTemplatePreset);
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>QQ Group Badge Generator</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f2ead9;
      --ink: #17231f;
      --muted: #66736c;
      --line: rgba(23, 35, 31, 0.14);
      --card: rgba(255, 251, 240, 0.86);
      --accent: #d78a24;
      --accent-ink: #281606;
      --green: #1d6b56;
      --shadow: 0 24px 80px rgba(31, 48, 42, 0.18);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink);
      font-family: Georgia, "Noto Serif SC", "Songti SC", serif;
      background:
        radial-gradient(circle at 12% 8%, rgba(215, 138, 36, 0.28), transparent 30rem),
        radial-gradient(circle at 88% 12%, rgba(29, 107, 86, 0.2), transparent 28rem),
        linear-gradient(135deg, #fbf3df 0%, #e8ead7 48%, #d4e0d6 100%);
    }

    main {
      width: min(1120px, calc(100% - 32px));
      margin: 0 auto;
      padding: 48px 0;
    }

    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1.05fr) minmax(320px, 0.95fr);
      gap: 22px;
      align-items: stretch;
    }

    .panel {
      border: 1px solid var(--line);
      border-radius: 28px;
      background: var(--card);
      box-shadow: var(--shadow);
      backdrop-filter: blur(18px);
    }

    .intro {
      padding: 34px;
      position: relative;
      overflow: hidden;
    }

    .intro::after {
      content: "";
      position: absolute;
      right: -70px;
      bottom: -90px;
      width: 230px;
      height: 230px;
      border-radius: 999px;
      background: rgba(215, 138, 36, 0.22);
    }

    .eyebrow {
      margin: 0 0 14px;
      color: var(--green);
      font: 800 12px/1.2 "Trebuchet MS", sans-serif;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      max-width: 680px;
      font-size: clamp(36px, 7vw, 74px);
      line-height: 0.95;
      letter-spacing: -0.055em;
    }

    .lead {
      max-width: 620px;
      margin: 22px 0 0;
      color: var(--muted);
      font-size: 17px;
      line-height: 1.75;
    }

    .form {
      padding: 24px;
      display: grid;
      gap: 16px;
    }

    label {
      display: grid;
      gap: 8px;
      color: var(--muted);
      font: 700 13px/1.4 "Trebuchet MS", sans-serif;
      letter-spacing: 0.02em;
    }

    select,
    input[type="url"],
    input[type="text"] {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 13px 14px;
      color: var(--ink);
      background: rgba(255, 255, 255, 0.72);
      font: 600 14px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      outline: none;
    }

    select {
      appearance: none;
      background:
        linear-gradient(45deg, transparent 50%, var(--green) 50%),
        linear-gradient(135deg, var(--green) 50%, transparent 50%),
        rgba(255, 255, 255, 0.72);
      background-position: calc(100% - 18px) 50%, calc(100% - 12px) 50%, 0 0;
      background-size: 6px 6px, 6px 6px, 100% 100%;
      background-repeat: no-repeat;
    }

    input:focus,
    select:focus {
      border-color: rgba(29, 107, 86, 0.55);
      box-shadow: 0 0 0 4px rgba(29, 107, 86, 0.12);
    }

    input:disabled {
      color: rgba(23, 35, 31, 0.58);
      background: rgba(255, 255, 255, 0.42);
      cursor: not-allowed;
    }

    .checkline {
      display: flex;
      align-items: center;
      gap: 9px;
      color: var(--muted);
      font: 700 13px/1.4 "Trebuchet MS", sans-serif;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 2px;
    }

    button,
    .link-button {
      appearance: none;
      border: 0;
      border-radius: 999px;
      padding: 12px 16px;
      cursor: pointer;
      color: var(--accent-ink);
      background: var(--accent);
      font: 900 13px/1 "Trebuchet MS", sans-serif;
      text-decoration: none;
      box-shadow: 0 10px 28px rgba(215, 138, 36, 0.28);
    }

    button.secondary,
    .link-button.secondary {
      color: var(--ink);
      background: rgba(255, 255, 255, 0.72);
      border: 1px solid var(--line);
      box-shadow: none;
    }

    .output-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(320px, 0.9fr);
      gap: 22px;
      margin-top: 22px;
    }

    .section {
      padding: 24px;
    }

    h2 {
      margin: 0 0 14px;
      font-size: 22px;
      letter-spacing: -0.025em;
    }

    .result {
      display: grid;
      gap: 14px;
    }

    .codebox {
      display: grid;
      gap: 8px;
    }

    .codehead {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
      color: var(--muted);
      font: 800 12px/1.2 "Trebuchet MS", sans-serif;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    textarea {
      width: 100%;
      min-height: 78px;
      resize: vertical;
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 13px 14px;
      color: #20312c;
      background: rgba(255, 255, 255, 0.78);
      font: 600 12.5px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .preview-box {
      min-height: 220px;
      display: grid;
      place-items: center;
      border: 1px dashed rgba(29, 107, 86, 0.32);
      border-radius: 20px;
      background:
        linear-gradient(45deg, rgba(255, 255, 255, 0.36) 25%, transparent 25%),
        linear-gradient(-45deg, rgba(255, 255, 255, 0.36) 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, rgba(255, 255, 255, 0.36) 75%),
        linear-gradient(-45deg, transparent 75%, rgba(255, 255, 255, 0.36) 75%);
      background-size: 24px 24px;
      background-position: 0 0, 0 12px, 12px -12px, -12px 0;
    }

    .preview-box img {
      max-width: min(100%, 620px);
      height: auto;
      border-radius: 12px;
    }

    .status {
      margin-top: 14px;
      color: var(--muted);
      font: 700 13px/1.6 "Trebuchet MS", sans-serif;
      overflow-wrap: anywhere;
    }

    .notes {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
      margin-top: 22px;
    }

    .note {
      padding: 18px;
      border: 1px solid var(--line);
      border-radius: 20px;
      background: rgba(255, 251, 240, 0.58);
      color: var(--muted);
      line-height: 1.65;
    }

    .note strong {
      display: block;
      margin-bottom: 6px;
      color: var(--ink);
    }

    @media (max-width: 860px) {
      main {
        padding: 24px 0;
      }

      .hero,
      .output-grid,
      .notes {
        grid-template-columns: 1fr;
      }

      .intro,
      .form,
      .section {
        padding: 20px;
      }
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div class="panel intro">
        <p class="eyebrow">QQ Group Badge</p>
        <h1>README 徽章生成器</h1>
        <p class="lead">输入 QQ 群邀请链接，选择静态或动画 SVG 模板，一键生成 Markdown、HTML 和图片直链。也可以切到自定义模板 URL。</p>
      </div>

      <form class="panel form" id="generator">
        <label>
          QQ 群邀请链接
          <input id="invite" type="url" autocomplete="off" required value="${xmlEscape(initialInvite)}" placeholder="https://qm.qq.com/q/xxxx">
        </label>

        <label>
          预制 SVG 模板
          <select id="templatePreset">
            <option value="static">静态模板</option>
            <option value="animated">动画模板</option>
            <option value="custom">自定义 URL</option>
          </select>
        </label>

        <label>
          自定义 SVG 模板 URL
          <input id="template" type="url" autocomplete="off" value="${xmlEscape(initialCustomTemplate)}" placeholder="选择自定义 URL 时填写">
        </label>

        <label>
          图片 alt 文本
          <input id="alt" type="text" autocomplete="off" value="QQ群徽章">
        </label>

        <label class="checkline">
          <input id="avatar" type="checkbox" checked>
          内联群头像 base64
        </label>

        <label class="checkline">
          <input id="cacheBust" type="checkbox">
          生成时追加缓存刷新参数
        </label>

        <div class="actions">
          <button type="submit">生成代码</button>
          <button class="secondary" type="button" id="test">测试预览</button>
          <a class="link-button secondary" href="https://github.com/clown145/qq-group-badge/blob/main/docs/svg-template-badges.md" id="docLink" rel="noreferrer">查看文档</a>
        </div>
      </form>
    </section>

    <section class="output-grid">
      <div class="panel section">
        <h2>复制代码</h2>
        <div class="result">
          <div class="codebox">
            <div class="codehead"><span>Markdown（推荐）</span><button class="secondary copy" data-copy="markdown" type="button">复制</button></div>
            <textarea id="markdown" readonly></textarea>
          </div>

          <div class="codebox">
            <div class="codehead"><span>HTML</span><button class="secondary copy" data-copy="htmlCode" type="button">复制</button></div>
            <textarea id="htmlCode" readonly></textarea>
          </div>

          <div class="codebox">
            <div class="codehead"><span>图片直链</span><button class="secondary copy" data-copy="imageUrl" type="button">复制</button></div>
            <textarea id="imageUrl" readonly></textarea>
          </div>
        </div>
      </div>

      <div class="panel section">
        <h2>测试预览</h2>
        <div class="preview-box">
          <img id="preview" alt="生成的 QQ 群徽章预览">
        </div>
        <div class="status" id="status">点击“测试预览”后会在这里显示 HTTP 状态和 Content-Type。</div>
      </div>
    </section>

    <section class="notes">
      <div class="note"><strong>模板要求</strong>模板必须是公开可访问的 SVG 原文链接，例如 raw.githubusercontent.com，不要用 GitHub 的 blob 页面。</div>
      <div class="note"><strong>图片建议</strong>SVG 模板里优先用 {{avatar_data_url}}、{{group_background_data_url}} 这类 data URL 占位符，更适合 GitHub README。</div>
      <div class="note"><strong>SVG 动图</strong>浏览器支持 CSS / SMIL SVG 动画，但 README 平台不一定稳定。需要稳定动图时仍建议用 WebP 渲染入口。</div>
    </section>
  </main>

  <script>
    const origin = ${originJson};
    const templatePresets = {
      static: ${staticTemplateJson},
      animated: ${animatedTemplateJson}
    };
    const initialTemplatePreset = ${initialTemplatePresetJson};
    const fields = {
      invite: document.querySelector("#invite"),
      templatePreset: document.querySelector("#templatePreset"),
      template: document.querySelector("#template"),
      alt: document.querySelector("#alt"),
      avatar: document.querySelector("#avatar"),
      cacheBust: document.querySelector("#cacheBust"),
      markdown: document.querySelector("#markdown"),
      htmlCode: document.querySelector("#htmlCode"),
      imageUrl: document.querySelector("#imageUrl"),
      preview: document.querySelector("#preview"),
      status: document.querySelector("#status")
    };

    fields.templatePreset.value = initialTemplatePreset;
    updateTemplateInputState();

    function getSelectedTemplateUrl() {
      if (fields.templatePreset.value === "custom") {
        return fields.template.value.trim();
      }

      return templatePresets[fields.templatePreset.value] || templatePresets.static;
    }

    function updateTemplateInputState() {
      const isCustom = fields.templatePreset.value === "custom";
      fields.template.disabled = !isCustom;
      fields.template.placeholder = isCustom
        ? "https://raw.githubusercontent.com/.../template.svg"
        : "当前使用：" + (fields.templatePreset.value === "animated" ? "动画模板" : "静态模板");
    }

    function buildBadgeUrl(forPreview = false) {
      const invite = fields.invite.value.trim();
      const template = getSelectedTemplateUrl();

      if (!invite) {
        throw new Error("请先输入 QQ 群邀请链接");
      }

      if (!template) {
        throw new Error("请先填写自定义 SVG 模板 URL，或选择预制模板");
      }

      const badgeUrl = new URL("/badge.svg", origin);
      badgeUrl.searchParams.set("invite", invite);
      badgeUrl.searchParams.set("template", template);

      if (!fields.avatar.checked) {
        badgeUrl.searchParams.set("avatar", "0");
      }

      if (fields.cacheBust.checked || forPreview) {
        badgeUrl.searchParams.set("v", String(Date.now()));
      }

      return badgeUrl.toString();
    }

    function buildOutputs() {
      const badgeUrl = buildBadgeUrl(false);
      const invite = fields.invite.value.trim();
      const alt = fields.alt.value.trim() || "QQ群徽章";

      fields.imageUrl.value = badgeUrl;
      fields.markdown.value = "[![" + alt + "](" + badgeUrl + ")](" + invite + ")";
      fields.htmlCode.value = '<a href="' + escapeHtmlAttribute(invite) + '"><img src="' + escapeHtmlAttribute(badgeUrl) + '" alt="' + escapeHtmlAttribute(alt) + '"></a>';

      return badgeUrl;
    }

    async function testPreview() {
      try {
        const badgeUrl = buildOutputs();
        const previewUrl = buildBadgeUrl(true);
        fields.status.textContent = "正在请求 HEAD...";
        fields.preview.src = previewUrl;

        const response = await fetch(previewUrl, { method: "HEAD", cache: "no-store" });
        const contentType = response.headers.get("content-type") || "unknown";
        fields.status.textContent = "HTTP " + response.status + " · " + contentType + " · " + badgeUrl;
      } catch (error) {
        fields.status.textContent = error instanceof Error ? error.message : "生成失败";
      }
    }

    async function copyValue(id, button) {
      const target = fields[id];
      if (!target) {
        return;
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(target.value);
      } else {
        target.focus();
        target.select();
        document.execCommand("copy");
      }
      const previous = button.textContent;
      button.textContent = "已复制";
      setTimeout(() => {
        button.textContent = previous;
      }, 1200);
    }

    function escapeHtmlAttribute(value) {
      return value
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
    }

    document.querySelector("#generator").addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        buildOutputs();
        fields.status.textContent = "已生成代码。需要看效果就点“测试预览”。";
      } catch (error) {
        fields.status.textContent = error instanceof Error ? error.message : "生成失败";
      }
    });

    document.querySelector("#test").addEventListener("click", () => {
      void testPreview();
    });

    for (const button of document.querySelectorAll(".copy")) {
      button.addEventListener("click", () => {
        void copyValue(button.dataset.copy, button);
      });
    }

    fields.templatePreset.addEventListener("change", () => {
      updateTemplateInputState();
      try {
        buildOutputs();
      } catch {
        // Keep the current output until the user finishes typing a valid invite URL.
      }
    });

    for (const input of [fields.invite, fields.template, fields.alt, fields.avatar, fields.cacheBust]) {
      input.addEventListener("input", () => {
        try {
          buildOutputs();
        } catch {
          // Keep the current output until the user finishes typing a valid invite URL.
        }
      });
      input.addEventListener("change", () => {
        try {
          buildOutputs();
        } catch {
          // Same as input: avoid clearing useful generated snippets while editing.
        }
      });
    }

    try {
      buildOutputs();
    } catch {
      fields.status.textContent = "先输入 QQ 群邀请链接，然后生成代码或测试预览。";
    }
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300"
    }
  });
}

function jsonForInlineScript(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function parseBadgeOptions(url: URL): BadgeOptions {
  const includeAvatar = url.searchParams.get("avatar") !== "0";
  const label = coalesceString(url.searchParams.get("label"), "QQ GROUP") ?? "QQ GROUP";

  return {
    includeAvatar,
    label
  };
}

function templateUsesVariable(templateSource: string, variableName: string): boolean {
  const escaped = variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\{\\{\\{?\\s*(?:(?:raw|json):)?${escaped}\\s*\\}?\\}\\}`).test(
    templateSource
  );
}

function templateUsesAnyVariable(templateSource: string, variableNames: string[]): boolean {
  return variableNames.some((variableName) => templateUsesVariable(templateSource, variableName));
}

async function buildSvgImageDataVariables(
  templateSource: string,
  group: GroupInfo,
  options: {
    includeAvatar: boolean;
    includeBackground: boolean;
  }
): Promise<Partial<TemplateVariables>> {
  const variables: Partial<TemplateVariables> = {};

  if (
    options.includeAvatar &&
    group.avatarUrl &&
    templateUsesVariable(templateSource, "avatar_data_url")
  ) {
    variables.avatar_data_url = (await fetchImageDataUrl(group.avatarUrl)) ?? "";
  }

  if (options.includeBackground && group.backgroundUrls.length > 0) {
    const needsBackgroundList = templateUsesAnyVariable(templateSource, [
      "group_background_data_urls",
      "group_background_data_urls_csv"
    ]);
    const needsBackgroundPrimary = templateUsesVariable(templateSource, "group_background_data_url");
    const needsBackground1 = templateUsesVariable(templateSource, "group_background_1_data_url");
    const needsBackground2 = templateUsesVariable(templateSource, "group_background_2_data_url");
    const needsBackground3 = templateUsesVariable(templateSource, "group_background_3_data_url");

    if (
      needsBackgroundList ||
      needsBackgroundPrimary ||
      needsBackground1 ||
      needsBackground2 ||
      needsBackground3
    ) {
      const backgroundDataUrls = await fetchSelectedImageDataUrls(
        group.backgroundUrls,
        needsBackgroundList
          ? allIndexes(group.backgroundUrls)
          : [
              ...(needsBackgroundPrimary || needsBackground1 ? [0] : []),
              ...(needsBackground2 ? [1] : []),
              ...(needsBackground3 ? [2] : [])
            ],
        1_500_000
      );

      if (needsBackgroundPrimary) {
        variables.group_background_data_url = backgroundDataUrls[0] ?? "";
      }

      if (needsBackgroundList) {
        variables.group_background_data_urls = backgroundDataUrls;
        variables.group_background_data_urls_csv = backgroundDataUrls.join(",");
      }

      if (needsBackground1) {
        variables.group_background_1_data_url = backgroundDataUrls[0] ?? "";
      }

      if (needsBackground2) {
        variables.group_background_2_data_url = backgroundDataUrls[1] ?? "";
      }

      if (needsBackground3) {
        variables.group_background_3_data_url = backgroundDataUrls[2] ?? "";
      }
    }
  }

  if (group.memberAvatarUrls.length > 0) {
    const needsMemberAvatarList = templateUsesAnyVariable(templateSource, [
      "member_avatar_data_urls",
      "member_avatar_data_urls_csv"
    ]);
    const needsMemberAvatar1 = templateUsesVariable(templateSource, "member_avatar_1_data_url");
    const needsMemberAvatar2 = templateUsesVariable(templateSource, "member_avatar_2_data_url");
    const needsMemberAvatar3 = templateUsesVariable(templateSource, "member_avatar_3_data_url");

    if (needsMemberAvatarList || needsMemberAvatar1 || needsMemberAvatar2 || needsMemberAvatar3) {
      const memberAvatarDataUrls = await fetchSelectedImageDataUrls(
        group.memberAvatarUrls,
        needsMemberAvatarList
          ? allIndexes(group.memberAvatarUrls)
          : [
              ...(needsMemberAvatar1 ? [0] : []),
              ...(needsMemberAvatar2 ? [1] : []),
              ...(needsMemberAvatar3 ? [2] : [])
            ],
        512_000
      );

      if (needsMemberAvatarList) {
        variables.member_avatar_data_urls = memberAvatarDataUrls;
        variables.member_avatar_data_urls_csv = memberAvatarDataUrls.join(",");
      }

      if (needsMemberAvatar1) {
        variables.member_avatar_1_data_url = memberAvatarDataUrls[0] ?? "";
      }

      if (needsMemberAvatar2) {
        variables.member_avatar_2_data_url = memberAvatarDataUrls[1] ?? "";
      }

      if (needsMemberAvatar3) {
        variables.member_avatar_3_data_url = memberAvatarDataUrls[2] ?? "";
      }
    }
  }

  if (group.assetInfos.length > 0) {
    const needsAssetIconList = templateUsesAnyVariable(templateSource, [
      "group_asset_icon_data_urls",
      "group_asset_icon_data_urls_csv",
      "group_assets_with_icon_data_urls"
    ]);
    const needsFileIcon = templateUsesVariable(templateSource, "group_file_icon_data_url");
    const needsAlbumIcon = templateUsesVariable(templateSource, "group_album_icon_data_url");
    const needsEssenceIcon = templateUsesVariable(templateSource, "group_essence_icon_data_url");

    if (needsAssetIconList) {
      const iconUrls = group.assetInfos
        .map((asset) => asset.iconUrl ?? "")
        .filter((iconUrl) => iconUrl.length > 0);
      const iconDataUrls = await fetchImageDataUrls(iconUrls, 512_000);
      let iconIndex = 0;
      const assetsWithIconDataUrls = group.assetInfos.map((asset) => {
        const iconDataUrl = asset.iconUrl ? iconDataUrls[iconIndex++] ?? "" : "";
        return {
          ...asset,
          iconDataUrl
        };
      });

      variables.group_asset_icon_data_urls = iconDataUrls;
      variables.group_asset_icon_data_urls_csv = iconDataUrls.join(",");
      variables.group_assets_with_icon_data_urls = assetsWithIconDataUrls;

      if (needsFileIcon) {
        variables.group_file_icon_data_url = findAssetIconDataUrl(
          assetsWithIconDataUrls,
          "群文件"
        );
      }

      if (needsAlbumIcon) {
        variables.group_album_icon_data_url = findAssetIconDataUrl(
          assetsWithIconDataUrls,
          "群相册"
        );
      }

      if (needsEssenceIcon) {
        variables.group_essence_icon_data_url = findAssetIconDataUrl(
          assetsWithIconDataUrls,
          "群精华"
        );
      }
    } else {
      if (needsFileIcon) {
        variables.group_file_icon_data_url = await fetchAssetIconDataUrl(group, "群文件");
      }

      if (needsAlbumIcon) {
        variables.group_album_icon_data_url = await fetchAssetIconDataUrl(group, "群相册");
      }

      if (needsEssenceIcon) {
        variables.group_essence_icon_data_url = await fetchAssetIconDataUrl(group, "群精华");
      }
    }
  }

  return variables;
}

async function fetchAssetIconDataUrl(group: GroupInfo, title: string): Promise<string> {
  const iconUrl = group.assetInfos.find((asset) => asset.title === title)?.iconUrl;
  return iconUrl ? (await fetchImageDataUrl(iconUrl, 512_000)) ?? "" : "";
}

function findAssetIconDataUrl(
  assets: Array<GroupInfo["assetInfos"][number] & { iconDataUrl: string }>,
  title: string
): string {
  return assets.find((asset) => asset.title === title)?.iconDataUrl ?? "";
}

function normalizeSvgTemplateOutput(compiledSvg: string): string {
  const svg = compiledSvg.trim();

  if (!/<svg(?:\s|>)/i.test(svg)) {
    throw new Error("SVG template must render an <svg> document");
  }

  if (/<script(?:\s|>)/i.test(svg)) {
    throw new Error("SVG template must not include script tags");
  }

  if (/\son[a-z]+\s*=/i.test(svg)) {
    throw new Error("SVG template must not include inline event handlers");
  }

  return svg.startsWith("<?xml") ? svg : `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`;
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

async function fetchImageDataUrl(imageUrl: string, maxBytes = 512_000): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(imageUrl, {
      headers: {
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      }
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get("content-type");
  if (!contentType || !contentType.startsWith("image/")) {
    return null;
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0 || buffer.byteLength > maxBytes) {
    return null;
  }

  return `data:${contentType};base64,${toBase64(buffer)}`;
}

async function fetchImageDataUrls(imageUrls: string[], maxBytes: number): Promise<string[]> {
  return fetchSelectedImageDataUrls(imageUrls, allIndexes(imageUrls), maxBytes);
}

async function fetchSelectedImageDataUrls(
  imageUrls: string[],
  indexes: number[],
  maxBytes: number
): Promise<string[]> {
  const dataUrls = imageUrls.map(() => "");
  const uniqueIndexes = [...new Set(indexes)].filter((index) => index in imageUrls);
  await Promise.all(
    uniqueIndexes.map(async (index) => {
      dataUrls[index] = (await fetchImageDataUrl(imageUrls[index], maxBytes)) ?? "";
    })
  );
  return dataUrls;
}

function allIndexes(values: unknown[]): number[] {
  return values.map((_, index) => index);
}

async function withCache(
  request: Request,
  ctx: ExecutionContext,
  producer: () => Promise<Response>
): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(request.url, {
    headers: request.headers,
    method: "GET"
  });
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

function finalizeMethodResponse(response: Response, isHead: boolean): Response {
  if (!isHead) {
    return response;
  }

  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
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
