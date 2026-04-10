import type { CompiledTemplate, GroupInfo, TemplateVariableValue, TemplateVariables } from "./types.js";
import { sha256Hex, xmlEscape } from "./utils.js";

const PLACEHOLDER_PATTERN =
  /\{\{\{\s*([a-zA-Z0-9_]+)\s*\}\}\}|\{\{\s*(?:(raw|json):)?([a-zA-Z0-9_]+)\s*\}\}/g;

export function buildTemplateVariables(
  group: GroupInfo,
  extraVariables: Partial<TemplateVariables> = {}
): TemplateVariables {
  const createdAtIso = group.createdAt ? new Date(group.createdAt * 1000).toISOString() : "";
  const createdAtDate = createdAtIso ? createdAtIso.slice(0, 10) : "";
  const fetchedAtUnix = Math.floor(Date.parse(group.fetchedAt) / 1000);
  const groupLevelText = group.groupLevel === null ? "" : String(group.groupLevel);
  const fileAsset = findAssetInfo(group, "群文件");
  const albumAsset = findAssetInfo(group, "群相册");
  const essenceAsset = findAssetInfo(group, "群精华");
  const assetIconUrls = group.assetInfos
    .map((asset) => asset.iconUrl ?? "")
    .filter((url) => url.length > 0);
  const memberDistributionText = group.memberDistribution.map(formatMemberDistribution).join(" · ");
  const groupAssetsText = group.assetInfos
    .map((asset) => `${asset.title} ${asset.count === null ? "" : asset.count}${asset.unit}`.trim())
    .join(" · ");

  return {
    group_name: group.groupName,
    group_code: group.groupCode,
    group_id: group.groupCode,
    member_count: group.memberCount,
    member_count_text: group.memberCount === null ? "" : String(group.memberCount),
    group_description: group.groupDescription ?? "",
    group_level: group.groupLevel,
    group_level_text: groupLevelText,
    group_level_badge: groupLevelText ? `LV${groupLevelText}` : "",
    group_tags: group.groupTags,
    group_tags_csv: group.groupTags.join(","),
    group_tags_text: group.groupTags.join(" · "),
    group_tag_count: group.groupTags.length,
    group_tag_1: group.groupTags[0] ?? "",
    group_tag_2: group.groupTags[1] ?? "",
    group_tag_3: group.groupTags[2] ?? "",
    avatar_url: group.avatarUrl ?? "",
    avatar_data_url: "",
    group_background_url: group.backgroundUrl ?? "",
    group_background_data_url: "",
    group_background_urls: group.backgroundUrls,
    group_background_urls_csv: group.backgroundUrls.join(","),
    group_background_data_urls: [],
    group_background_data_urls_csv: "",
    group_background_count: group.backgroundUrls.length,
    group_background_1_url: group.backgroundUrls[0] ?? "",
    group_background_1_data_url: "",
    group_background_2_url: group.backgroundUrls[1] ?? "",
    group_background_2_data_url: "",
    group_background_3_url: group.backgroundUrls[2] ?? "",
    group_background_3_data_url: "",
    member_avatar_urls: group.memberAvatarUrls,
    member_avatar_urls_csv: group.memberAvatarUrls.join(","),
    member_avatar_data_urls: [],
    member_avatar_data_urls_csv: "",
    member_avatar_count: group.memberAvatarUrls.length,
    member_avatar_1_url: group.memberAvatarUrls[0] ?? "",
    member_avatar_1_data_url: "",
    member_avatar_2_url: group.memberAvatarUrls[1] ?? "",
    member_avatar_2_data_url: "",
    member_avatar_3_url: group.memberAvatarUrls[2] ?? "",
    member_avatar_3_data_url: "",
    member_distribution: group.memberDistribution,
    member_distribution_text: memberDistributionText,
    member_distribution_count: group.memberDistribution.length,
    member_distribution_titles: group.memberDistribution.map((item) => item.title),
    member_distribution_titles_csv: group.memberDistribution.map((item) => item.title).join(","),
    group_assets: group.assetInfos,
    group_assets_text: groupAssetsText,
    group_asset_count: group.assetInfos.length,
    group_asset_icon_urls: assetIconUrls,
    group_asset_icon_urls_csv: assetIconUrls.join(","),
    group_asset_icon_data_urls: [],
    group_asset_icon_data_urls_csv: "",
    group_assets_with_icon_data_urls: group.assetInfos.map((asset) => ({
      ...asset,
      iconDataUrl: ""
    })),
    group_file_count: fileAsset?.count ?? null,
    group_file_count_text: formatNullableNumber(fileAsset?.count),
    group_file_unit: fileAsset?.unit ?? "",
    group_file_icon_url: fileAsset?.iconUrl ?? "",
    group_file_icon_data_url: "",
    group_album_count: albumAsset?.count ?? null,
    group_album_count_text: formatNullableNumber(albumAsset?.count),
    group_album_unit: albumAsset?.unit ?? "",
    group_album_icon_url: albumAsset?.iconUrl ?? "",
    group_album_icon_data_url: "",
    group_essence_count: essenceAsset?.count ?? null,
    group_essence_count_text: formatNullableNumber(essenceAsset?.count),
    group_essence_unit: essenceAsset?.unit ?? "",
    group_essence_icon_url: essenceAsset?.iconUrl ?? "",
    group_essence_icon_data_url: "",
    group_relation_count: group.relationCount,
    group_relation_count_text: group.relationCount === null ? "" : String(group.relationCount),
    invite_url: group.sourceUrl,
    resolved_invite_url: group.resolvedUrl,
    invite_title: group.inviteTitle ?? "",
    invite_subtitle: group.inviteSubtitle ?? "",
    created_at_unix: group.createdAt,
    created_at_iso: createdAtIso,
    created_at_date: createdAtDate,
    created_at_text: createdAtDate,
    fetched_at: group.fetchedAt,
    fetched_at_unix: Number.isFinite(fetchedAtUnix) ? fetchedAtUnix : null,
    ...extraVariables
  };
}

function findAssetInfo(group: GroupInfo, title: string): GroupInfo["assetInfos"][number] | null {
  return group.assetInfos.find((asset) => asset.title === title) ?? null;
}

function formatMemberDistribution(item: GroupInfo["memberDistribution"][number]): string {
  return [item.title, item.subtitle].filter((value) => value.length > 0).join(" ");
}

function formatNullableNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
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

  if (Array.isArray(value) || typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}
