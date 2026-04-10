import type { GroupAssetInfo, GroupInfo, MemberDistributionInfo } from "./types.js";
import {
  coalesceNumber,
  coalesceString,
  decodeHtmlEntities,
  dedupeStrings,
  escapeRegex,
  extractDigits,
  isRecord,
  normalizeQqImageUrl,
  normalizeWhitespace,
  stripTags
} from "./utils.js";

const USER_AGENT =
  "Mozilla/5.0 (compatible; qq-group-badge/0.1; +https://github.com/clown145/qq-group-badge)";

interface PartialGroupInfo {
  groupName: string | null;
  groupCode: string | null;
  memberCount: number | null;
  groupDescription: string | null;
  groupLevel: number | null;
  groupTags: string[];
  avatarUrl: string | null;
  backgroundUrls: string[];
  memberAvatarUrls: string[];
  memberDistribution: MemberDistributionInfo[];
  assetInfos: GroupAssetInfo[];
  relationCount: number | null;
  inviteTitle: string | null;
  inviteSubtitle: string | null;
  createdAt: number | null;
}

interface EmbeddedGroupInfo {
  avatar?: unknown;
  name?: unknown;
  memberAvatars?: unknown;
  memberCnt?: unknown;
  groupcode?: unknown;
  description?: unknown;
  createtime?: unknown;
  tags?: unknown;
}

interface EmbeddedBaseInfo {
  groupinfo?: EmbeddedGroupInfo;
  group_level?: unknown;
  groupLevel?: unknown;
  msg_head_portrait?: unknown;
  msgHeadPortrait?: unknown;
  group_relation_num?: unknown;
  groupRelationNum?: unknown;
}

interface EmbeddedMemberInfo {
  member_tags?: unknown;
  memberTags?: unknown;
}

interface EmbeddedAssetInfo {
  resource_infos?: unknown;
  resourceInfos?: unknown;
}

interface EmbeddedCardInfo {
  title?: unknown;
  subtitle?: unknown;
}

interface EmbeddedGroupPayload {
  base_info?: EmbeddedBaseInfo;
  baseInfo?: EmbeddedBaseInfo;
  member_info?: EmbeddedMemberInfo;
  memberInfo?: EmbeddedMemberInfo;
  asset_info?: EmbeddedAssetInfo;
  assetInfo?: EmbeddedAssetInfo;
  card_info?: EmbeddedCardInfo;
  cardInfo?: EmbeddedCardInfo;
}

export async function fetchGroupInfo(inviteUrlInput: string): Promise<GroupInfo> {
  const sourceUrl = normalizeInviteUrl(inviteUrlInput);
  const response = await fetch(sourceUrl, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    },
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`QQ invite page returned ${response.status}`);
  }

  const html = await response.text();
  const parsed = parseGroupInfo(html);

  if (!parsed.groupName || !parsed.groupCode) {
    throw new Error("Failed to extract required QQ group fields from invite page");
  }

  return {
    sourceUrl,
    resolvedUrl: response.url || sourceUrl,
    groupName: parsed.groupName,
    groupCode: parsed.groupCode,
    memberCount: parsed.memberCount,
    groupDescription: parsed.groupDescription,
    groupLevel: parsed.groupLevel,
    groupTags: parsed.groupTags,
    avatarUrl: parsed.avatarUrl,
    backgroundUrl: parsed.backgroundUrls[0] ?? null,
    backgroundUrls: parsed.backgroundUrls,
    memberAvatarUrls: parsed.memberAvatarUrls,
    memberDistribution: parsed.memberDistribution,
    assetInfos: parsed.assetInfos,
    relationCount: parsed.relationCount,
    inviteTitle: parsed.inviteTitle,
    inviteSubtitle: parsed.inviteSubtitle,
    createdAt: parsed.createdAt,
    fetchedAt: new Date().toISOString()
  };
}

export function normalizeInviteUrl(inviteUrlInput: string): string {
  const raw = inviteUrlInput.trim();
  const url = new URL(raw);

  if (url.protocol !== "https:") {
    throw new Error("Invite URL must use https");
  }

  const allowedHosts = new Set(["qm.qq.com", "qun.qq.com"]);
  if (!allowedHosts.has(url.hostname)) {
    throw new Error("Invite URL host must be qm.qq.com or qun.qq.com");
  }

  return url.toString();
}

function parseGroupInfo(html: string): PartialGroupInfo {
  const fromNuxt = parseNuxtGroupInfo(html);
  const fromDom = parseDomGroupInfo(html);

  return {
    groupName: coalesceString(fromNuxt.groupName, fromDom.groupName) ?? "",
    groupCode: coalesceString(fromNuxt.groupCode, fromDom.groupCode) ?? "",
    memberCount: coalesceNumber(fromNuxt.memberCount, fromDom.memberCount),
    groupDescription: coalesceString(fromNuxt.groupDescription, fromDom.groupDescription),
    groupLevel: coalesceNumber(fromNuxt.groupLevel, fromDom.groupLevel),
    groupTags: fromNuxt.groupTags.length > 0 ? fromNuxt.groupTags : fromDom.groupTags,
    avatarUrl: coalesceString(fromNuxt.avatarUrl, fromDom.avatarUrl),
    backgroundUrls: dedupeStrings([...fromDom.backgroundUrls, ...fromNuxt.backgroundUrls]),
    memberAvatarUrls:
      fromNuxt.memberAvatarUrls.length > 0 ? fromNuxt.memberAvatarUrls : fromDom.memberAvatarUrls,
    memberDistribution:
      fromNuxt.memberDistribution.length > 0
        ? fromNuxt.memberDistribution
        : fromDom.memberDistribution,
    assetInfos: fromNuxt.assetInfos.length > 0 ? fromNuxt.assetInfos : fromDom.assetInfos,
    relationCount: coalesceNumber(fromNuxt.relationCount, fromDom.relationCount),
    inviteTitle: coalesceString(fromNuxt.inviteTitle, fromDom.inviteTitle),
    inviteSubtitle: coalesceString(fromNuxt.inviteSubtitle, fromDom.inviteSubtitle),
    createdAt: coalesceNumber(fromNuxt.createdAt, fromDom.createdAt)
  };
}

function parseNuxtGroupInfo(html: string): PartialGroupInfo {
  const scriptMatch = html.match(
    /<script[^>]*id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (!scriptMatch) {
    return emptyGroupInfo();
  }

  try {
    const parsed = JSON.parse(scriptMatch[1]) as unknown;
    const embeddedPayload = findEmbeddedPayload(parsed);
    if (!embeddedPayload) {
      return emptyGroupInfo();
    }

    const baseInfo = embeddedPayload.base_info ?? embeddedPayload.baseInfo;
    const groupInfo = baseInfo?.groupinfo;
    const cardInfo = embeddedPayload.card_info ?? embeddedPayload.cardInfo;
    const assetInfo = embeddedPayload.asset_info ?? embeddedPayload.assetInfo;
    const memberInfo = embeddedPayload.member_info ?? embeddedPayload.memberInfo;
    const memberAvatars = Array.isArray(groupInfo?.memberAvatars)
      ? groupInfo.memberAvatars.filter((item): item is string => typeof item === "string")
      : [];

    let inviteSubtitle: string | null = null;
    if (Array.isArray(cardInfo?.subtitle)) {
      for (const item of cardInfo.subtitle) {
        if (isRecord(item) && typeof item.item === "string" && item.item.trim().length > 0) {
          inviteSubtitle = item.item.trim();
          break;
        }
      }
    }

    return {
      groupName: asNonEmptyString(groupInfo?.name),
      groupCode: asDigitsString(groupInfo?.groupcode),
      memberCount: asNumber(groupInfo?.memberCnt),
      groupDescription: cleanOptionalText(groupInfo?.description),
      groupLevel: asNumber(baseInfo?.group_level ?? baseInfo?.groupLevel),
      groupTags: asStringArray(groupInfo?.tags),
      avatarUrl: asImageUrl(groupInfo?.avatar),
      backgroundUrls: extractBackgroundUrlsFromPortraits(
        asDigitsString(groupInfo?.groupcode),
        baseInfo?.msg_head_portrait ?? baseInfo?.msgHeadPortrait
      ),
      memberAvatarUrls: dedupeStrings(memberAvatars.map(normalizeQqImageUrl)),
      memberDistribution: parseMemberDistribution(
        memberInfo?.member_tags ?? memberInfo?.memberTags
      ),
      assetInfos: parseAssetInfos(assetInfo?.resource_infos ?? assetInfo?.resourceInfos),
      relationCount: asNumber(baseInfo?.group_relation_num ?? baseInfo?.groupRelationNum),
      inviteTitle: asNonEmptyString(cardInfo?.title),
      inviteSubtitle,
      createdAt: asNumber(groupInfo?.createtime)
    };
  } catch {
    return emptyGroupInfo();
  }
}

function findEmbeddedPayload(value: unknown): EmbeddedGroupPayload | null {
  const seen = new Set<unknown>();

  function walk(current: unknown): EmbeddedGroupPayload | null {
    if (typeof current === "string") {
      const trimmed = current.trim();
      if (
        (trimmed.includes("\"base_info\"") || trimmed.includes("\"baseInfo\"")) &&
        trimmed.includes("\"groupinfo\"") &&
        trimmed.includes("\"memberCnt\"")
      ) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          if (looksLikeEmbeddedPayload(parsed)) {
            return parsed;
          }
        } catch {
          return null;
        }
      }
      return null;
    }

    if (!isRecord(current) && !Array.isArray(current)) {
      return null;
    }

    if (seen.has(current)) {
      return null;
    }
    seen.add(current);

    if (looksLikeEmbeddedPayload(current)) {
      return current;
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        const match = walk(item);
        if (match) {
          return match;
        }
      }
      return null;
    }

    for (const item of Object.values(current)) {
      const match = walk(item);
      if (match) {
        return match;
      }
    }

    return null;
  }

  return walk(value);
}

function looksLikeEmbeddedPayload(value: unknown): value is EmbeddedGroupPayload {
  return (
    isRecord(value) &&
    ((isRecord(value.base_info) && isRecord(value.base_info.groupinfo)) ||
      (isRecord(value.baseInfo) && isRecord(value.baseInfo.groupinfo)))
  );
}

function parseDomGroupInfo(html: string): PartialGroupInfo {
  const groupName = extractClassText(html, "group-name");
  const memberCountText = extractClassText(html, "member-count");
  const groupCodeText = extractClassText(html, "normal-code");

  return {
    groupName,
    groupCode: groupCodeText ? extractDigits(groupCodeText) : null,
    memberCount: memberCountText ? toNullableNumber(extractDigits(memberCountText)) : null,
    groupDescription: cleanOptionalText(extractClassText(html, "group-description__content")),
    groupLevel: extractGroupLevelFromTags(extractAllClassText(html, "group-tag-item")),
    groupTags: extractGroupTagsFromDom(html),
    avatarUrl: extractClassImageSrc(html, "avatar"),
    backgroundUrls: extractBackgroundImageUrls(html),
    memberAvatarUrls: extractMemberAvatarUrls(html),
    memberDistribution: [],
    assetInfos: [],
    relationCount: null,
    inviteTitle: extractMetaContent(html, "og:title"),
    inviteSubtitle: extractMetaContent(html, "description"),
    createdAt: null
  };
}

function extractClassText(html: string, className: string): string | null {
  const pattern = new RegExp(
    `<[^>]*class=["'][^"']*\\b${escapeRegex(className)}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`,
    "i"
  );
  const match = pattern.exec(html);
  if (!match) {
    return null;
  }

  return normalizeWhitespace(decodeHtmlEntities(stripTags(match[1])));
}

function extractAllClassText(html: string, className: string): string[] {
  const pattern = new RegExp(
    `<[^>]*class=["'][^"']*\\b${escapeRegex(className)}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`,
    "gi"
  );
  const values: string[] = [];

  for (const match of html.matchAll(pattern)) {
    const value = normalizeWhitespace(decodeHtmlEntities(stripTags(match[1])));
    if (value.length > 0) {
      values.push(value);
    }
  }

  return dedupeStrings(values);
}

function extractGroupTagsFromDom(html: string): string[] {
  return extractAllClassText(html, "group-tag-item").filter((item) => !/^LV\d+$/i.test(item));
}

function extractGroupLevelFromTags(tags: string[]): number | null {
  for (const tag of tags) {
    const match = /^LV(\d+)$/i.exec(tag.trim());
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }

  return null;
}

function extractBackgroundImageUrls(html: string): string[] {
  const urls: string[] = [];
  const pattern = /background-image\s*:\s*url\((['"]?)([^'")]+)\1\)/gi;

  for (const match of html.matchAll(pattern)) {
    const url = decodeHtmlEntities(match[2]).trim();
    if (/^https?:\/\//i.test(url) && /\/gh\//i.test(url)) {
      urls.push(normalizeQqImageUrl(url));
    }
  }

  return dedupeStrings(urls);
}

function extractClassImageSrc(html: string, className: string): string | null {
  const pattern = new RegExp(
    `<img[^>]*class=["'][^"']*\\b${escapeRegex(className)}\\b[^"']*["'][^>]*src=["']([^"']+)["'][^>]*>`,
    "i"
  );
  const match = pattern.exec(html);
  if (!match) {
    return null;
  }

  return normalizeQqImageUrl(decodeHtmlEntities(match[1]));
}

function extractMemberAvatarUrls(html: string): string[] {
  const pattern =
    /<div[^>]*class=["'][^"']*\bmember-avatar\b[^"']*["'][^>]*>[\s\S]*?<img[^>]*src=["']([^"']+)["'][^>]*>[\s\S]*?<\/div>/gi;
  const urls: string[] = [];

  for (const match of html.matchAll(pattern)) {
    urls.push(normalizeQqImageUrl(decodeHtmlEntities(match[1])));
  }

  return dedupeStrings(urls);
}

function extractMetaContent(html: string, name: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]*(?:name|property)=["']${escapeRegex(name)}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    "i"
  );
  const match = pattern.exec(html);
  return match ? normalizeWhitespace(decodeHtmlEntities(match[1])) : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function cleanOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = normalizeWhitespace(value).replace(/(?:收起|展开)$/u, "").trim();
  return text.length > 0 ? text : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return dedupeStrings(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => normalizeWhitespace(item))
  );
}

function asDigitsString(value: unknown): string | null {
  if (typeof value === "string") {
    return extractDigits(value);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      return Number.parseInt(trimmed, 10);
    }
  }

  return null;
}

function asImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  return normalizeQqImageUrl(value.trim());
}

function parseAssetInfos(value: unknown): GroupAssetInfo[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const assets: GroupAssetInfo[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const title = asNonEmptyString(item.title);
    if (!title) {
      continue;
    }

    assets.push({
      id: asNumber(item.id),
      title,
      iconUrl: asImageUrl(item.icon),
      count: asNumber(item.count),
      unit: asNonEmptyString(item.unit) ?? ""
    });
  }

  return assets;
}

function parseMemberDistribution(value: unknown): MemberDistributionInfo[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const distribution: MemberDistributionInfo[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const title = asNonEmptyString(item.title);
    if (!title) {
      continue;
    }

    distribution.push({
      id: asNumber(item.id),
      title,
      icon: asNonEmptyString(item.icon) ?? "",
      percentage: asNumber(item.percentage),
      unit: asNonEmptyString(item.unit) ?? "",
      subtitle: firstSubtitleItem(item.subtitle) ?? "",
      color: asNonEmptyString(item.color)
    });
  }

  return distribution;
}

function firstSubtitleItem(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }

  for (const item of value) {
    if (isRecord(item)) {
      const text = asNonEmptyString(item.item);
      if (text) {
        return text;
      }
    }
  }

  return null;
}

function extractBackgroundUrlsFromPortraits(
  groupCode: string | null,
  value: unknown
): string[] {
  if (!groupCode || !Array.isArray(value)) {
    return [];
  }

  const ids: string[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const defaultId = asDigitsString(item.uint32_default_id ?? item.uint32DefaultId);
    if (defaultId) {
      ids.push(defaultId);
    }

    const messages = item.rpt_msg_info ?? item.rptMsgInfo;
    if (Array.isArray(messages)) {
      for (const message of messages) {
        if (!isRecord(message)) {
          continue;
        }

        const id = asDigitsString(message.rpt_uint32_pic_id ?? message.rptUint32PicId);
        if (id) {
          ids.push(id);
        }
      }
    }
  }

  return dedupeStrings(ids).map((id) => `https://p.qlogo.cn/gh/${groupCode}/${groupCode}_${id}/640`);
}

function toNullableNumber(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function emptyGroupInfo(): PartialGroupInfo {
  return {
    groupName: null,
    groupCode: null,
    memberCount: null,
    groupDescription: null,
    groupLevel: null,
    groupTags: [],
    avatarUrl: null,
    backgroundUrls: [],
    memberAvatarUrls: [],
    memberDistribution: [],
    assetInfos: [],
    relationCount: null,
    inviteTitle: null,
    inviteSubtitle: null,
    createdAt: null
  };
}
