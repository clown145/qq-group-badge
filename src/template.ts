import type { CompiledTemplate, GroupInfo, TemplateVariableValue, TemplateVariables } from "./types.js";
import { sha256Hex, xmlEscape } from "./utils.js";

const PLACEHOLDER_PATTERN =
  /\{\{\{\s*([a-zA-Z0-9_]+)\s*\}\}\}|\{\{\s*(?:(raw|json):)?([a-zA-Z0-9_]+)\s*\}\}/g;

export function buildTemplateVariables(
  group: GroupInfo,
  extraVariables: Partial<TemplateVariables> = {}
): TemplateVariables {
  const createdAtIso = group.createdAt ? new Date(group.createdAt * 1000).toISOString() : "";
  const fetchedAtUnix = Math.floor(Date.parse(group.fetchedAt) / 1000);

  return {
    group_name: group.groupName,
    group_code: group.groupCode,
    group_id: group.groupCode,
    member_count: group.memberCount,
    member_count_text: group.memberCount === null ? "" : String(group.memberCount),
    avatar_url: group.avatarUrl ?? "",
    avatar_data_url: "",
    member_avatar_urls: group.memberAvatarUrls,
    member_avatar_urls_csv: group.memberAvatarUrls.join(","),
    member_avatar_count: group.memberAvatarUrls.length,
    invite_url: group.sourceUrl,
    resolved_invite_url: group.resolvedUrl,
    invite_title: group.inviteTitle ?? "",
    invite_subtitle: group.inviteSubtitle ?? "",
    created_at_unix: group.createdAt,
    created_at_iso: createdAtIso,
    fetched_at: group.fetchedAt,
    fetched_at_unix: Number.isFinite(fetchedAtUnix) ? fetchedAtUnix : null,
    ...extraVariables
  };
}

export function compileTemplateHtml(templateHtml: string, variables: TemplateVariables): {
  compiledHtml: string;
  usedVariables: string[];
  unresolvedVariables: string[];
} {
  const usedVariables = new Set<string>();
  const unresolvedVariables = new Set<string>();

  const compiledHtml = templateHtml.replace(
    PLACEHOLDER_PATTERN,
    (match, tripleName: string | undefined, mode: string | undefined, name: string | undefined) => {
      const variableName = tripleName ?? name;
      if (!variableName) {
        return match;
      }

      usedVariables.add(variableName);

      if (!(variableName in variables)) {
        unresolvedVariables.add(variableName);
        return match;
      }

      const value = variables[variableName];

      if (mode === "json") {
        return JSON.stringify(value ?? null);
      }

      if (mode === "raw" || tripleName) {
        return variableValueToString(value);
      }

      return xmlEscape(variableValueToString(value));
    }
  );

  return {
    compiledHtml,
    usedVariables: [...usedVariables],
    unresolvedVariables: [...unresolvedVariables]
  };
}

export async function buildCompiledTemplate(
  templateUrl: string,
  templateHtml: string,
  group: GroupInfo,
  extraVariables: Partial<TemplateVariables> = {}
): Promise<CompiledTemplate> {
  const templateSha256 = await sha256Hex(templateHtml);
  const variables = buildTemplateVariables(group, extraVariables);
  const compiled = compileTemplateHtml(templateHtml, variables);
  const compiledSha256 = await sha256Hex(compiled.compiledHtml);

  return {
    templateUrl,
    templateSha256,
    templateHtml,
    compiledHtml: compiled.compiledHtml,
    compiledSha256,
    variables,
    usedVariables: compiled.usedVariables,
    unresolvedVariables: compiled.unresolvedVariables
  };
}

export function injectPreviewBaseTag(compiledHtml: string, baseHref: string): string {
  if (/<base\b/i.test(compiledHtml)) {
    return compiledHtml;
  }

  const baseTag = `<base href="${xmlEscape(baseHref)}">`;

  if (/<head\b[^>]*>/i.test(compiledHtml)) {
    return compiledHtml.replace(/<head\b[^>]*>/i, (match) => `${match}${baseTag}`);
  }

  if (/<html\b[^>]*>/i.test(compiledHtml)) {
    return compiledHtml.replace(/<html\b[^>]*>/i, (match) => `${match}<head>${baseTag}</head>`);
  }

  return `<!doctype html><html><head>${baseTag}</head><body>${compiledHtml}</body></html>`;
}

function variableValueToString(value: TemplateVariableValue): string {
  if (value === null) {
    return "";
  }

  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }

  return String(value);
}
