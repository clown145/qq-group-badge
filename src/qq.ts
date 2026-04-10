import type { GroupInfo } from "./types.js";
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
  avatarUrl: string | null;
  memberAvatarUrls: string[];
  inviteTitle: string | null;
  inviteSubtitle: string | null;
  createdAt: number | null;
}

interface EmbeddedGroupPayload {
  base_info?: {
    groupinfo?: {
      avatar?: unknown;
      name?: unknown;
      memberAvatars?: unknown;
      memberCnt?: unknown;
      groupcode?: unknown;
      createtime?: unknown;
    };
  };
  card_info?: {
    title?: unknown;
    subtitle?: unknown;
  };
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
    avatarUrl: parsed.avatarUrl,
    memberAvatarUrls: parsed.memberAvatarUrls,
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
    avatarUrl: coalesceString(fromNuxt.avatarUrl, fromDom.avatarUrl),
    memberAvatarUrls:
      fromNuxt.memberAvatarUrls.length > 0 ? fromNuxt.memberAvatarUrls : fromDom.memberAvatarUrls,
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

    const groupInfo = embeddedPayload.base_info?.groupinfo;
    const cardInfo = embeddedPayload.card_info;
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
      avatarUrl: asImageUrl(groupInfo?.avatar),
      memberAvatarUrls: dedupeStrings(memberAvatars.map(normalizeQqImageUrl)),
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
        trimmed.includes("\"base_info\"") &&
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
  return isRecord(value) && isRecord(value.base_info) && isRecord(value.base_info.groupinfo);
}

function parseDomGroupInfo(html: string): PartialGroupInfo {
  const groupName = extractClassText(html, "group-name");
  const memberCountText = extractClassText(html, "member-count");
  const groupCodeText = extractClassText(html, "normal-code");

  return {
    groupName,
    groupCode: groupCodeText ? extractDigits(groupCodeText) : null,
    memberCount: memberCountText ? toNullableNumber(extractDigits(memberCountText)) : null,
    avatarUrl: extractClassImageSrc(html, "avatar"),
    memberAvatarUrls: extractMemberAvatarUrls(html),
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
    avatarUrl: null,
    memberAvatarUrls: [],
    inviteTitle: null,
    inviteSubtitle: null,
    createdAt: null
  };
}
