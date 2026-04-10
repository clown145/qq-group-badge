import type { BadgeOptions, GroupInfo } from "./types.js";
import { xmlEscape } from "./utils.js";

interface BadgeRenderContext {
  width: number;
  height: number;
  label: string;
  title: string;
  subtitle: string;
}

export function renderBadgeSvg(
  group: GroupInfo,
  options: BadgeOptions,
  avatarDataUrl: string | null
): string {
  const context = buildBadgeContext(group, options);
  const avatarMarkup =
    options.includeAvatar && avatarDataUrl
      ? `<clipPath id="avatar-clip"><circle cx="44" cy="48" r="24" /></clipPath>
         <circle cx="44" cy="48" r="24" fill="#ffffff" fill-opacity="0.2" />
         <image href="${xmlEscape(avatarDataUrl)}" x="20" y="24" width="48" height="48" clip-path="url(#avatar-clip)" preserveAspectRatio="xMidYMid slice" />`
      : `<circle cx="44" cy="48" r="24" fill="#ffffff" fill-opacity="0.14" />
         <text x="44" y="53" text-anchor="middle" font-size="20" font-weight="700" fill="#ffffff">${xmlEscape(
           firstGlyph(group.groupName)
         )}</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${context.width}" height="${context.height}" viewBox="0 0 ${context.width} ${context.height}" role="img" aria-labelledby="title desc">
  <title id="title">${xmlEscape(context.title)}</title>
  <desc id="desc">${xmlEscape(context.subtitle)}</desc>
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0d1b2a" />
      <stop offset="55%" stop-color="#1b3a4b" />
      <stop offset="100%" stop-color="#2a6f97" />
    </linearGradient>
    <linearGradient id="pill" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.28" />
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.12" />
    </linearGradient>
  </defs>
  <rect width="${context.width}" height="${context.height}" rx="18" fill="url(#bg)" />
  <rect x="12" y="12" width="${context.width - 24}" height="${context.height - 24}" rx="14" fill="#ffffff" fill-opacity="0.07" />
  ${avatarMarkup}
  <text x="84" y="34" font-size="11" font-weight="700" fill="#d7ecff" letter-spacing="0.12em">${xmlEscape(
    context.label
  )}</text>
  <text x="84" y="57" font-size="21" font-weight="700" fill="#ffffff">${xmlEscape(context.title)}</text>
  <g transform="translate(84 68)">
    <rect x="0" y="0" width="${approximateTextWidth(context.subtitle, 7.1) + 20}" height="18" rx="9" fill="url(#pill)" />
    <text x="10" y="12.5" font-size="10.5" font-weight="600" fill="#eff8ff">${xmlEscape(context.subtitle)}</text>
  </g>
</svg>`;
}

function buildBadgeContext(group: GroupInfo, options: BadgeOptions): BadgeRenderContext {
  const label = options.label || "QQ GROUP";
  const title = truncate(group.groupName, 22);
  const memberText = group.memberCount !== null ? `${group.memberCount} members` : "members unknown";
  const subtitle = truncate(`${group.groupCode} · ${memberText}`, 40);
  const width = Math.max(330, 112 + approximateTextWidth(title, 12.6));

  return {
    width,
    height: 96,
    label,
    title,
    subtitle
  };
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function approximateTextWidth(value: string, unitWidth: number): number {
  let total = 0;

  for (const char of value) {
    total += /[\u0000-\u00ff]/.test(char) ? unitWidth : unitWidth * 1.65;
  }

  return Math.ceil(total);
}

function firstGlyph(value: string): string {
  const glyph = value.trim().charAt(0);
  return glyph.length > 0 ? glyph.toUpperCase() : "Q";
}
