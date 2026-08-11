import sharp from "sharp";

import type { LeaderboardMemberProfile } from "./leaderboard-image.js";

const IMAGE_WIDTH = 800;
const IMAGE_HEIGHT = 194;
const AVATAR_SIZE = 118;
const CONTENT_X = 158;
const CONTENT_WIDTH = IMAGE_WIDTH - CONTENT_X - 24;

export interface RankImageInput {
  profile: LeaderboardMemberProfile;
  rank: number | null;
  level: number;
  totalXp: number;
  xpInCurrentLevel: number;
  xpForNextLevel: number;
  xpNeededForNextLevel: number;
  progress: number;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatXp(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function placeholderColor(userId: string): string {
  let hash = 0;

  for (const character of userId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return `hsl(${hash % 360} 58% 40%)`;
}

function rankColor(rank: number | null): string {
  if (rank === 1) return "#FFD000";
  if (rank === 2) return "#AEB4BC";
  if (rank === 3) return "#D9822B";
  return "#F2F3F5";
}

function avatarMarkup(profile: LeaderboardMemberProfile): string {
  if (profile.avatarDataUri) {
    return `
      <clipPath id="rank-avatar">
        <rect x="20" y="20" width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" rx="10" />
      </clipPath>
      <image href="${escapeXml(profile.avatarDataUri)}" x="20" y="20" width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" preserveAspectRatio="xMidYMid slice" clip-path="url(#rank-avatar)" />`;
  }

  const initial = escapeXml(
    Array.from(profile.displayName.trim())[0]?.toUpperCase() ?? "?",
  );
  return `
    <rect x="20" y="20" width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" rx="10" fill="${placeholderColor(profile.userId)}" />
    <text x="${20 + AVATAR_SIZE / 2}" y="94" text-anchor="middle" font-family="Arial, Liberation Sans, DejaVu Sans, sans-serif" font-size="56" font-weight="500" fill="#FFFFFF">${initial}</text>`;
}

function truncateName(value: string): string {
  const clean = value.replace(/[\r\n\t]/g, " ").trim() || "Unknown user";
  return clean.length <= 24 ? clean : `${clean.slice(0, 23)}…`;
}

export async function renderRankImage(input: RankImageInput): Promise<Buffer> {
  const progress = Math.max(0, Math.min(1, input.progress));
  const progressWidth = Math.round(CONTENT_WIDTH * progress);
  const displayName = escapeXml(truncateName(input.profile.displayName));
  const rank = input.rank === null ? "Unranked" : `#${input.rank}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" viewBox="0 0 ${IMAGE_WIDTH} ${IMAGE_HEIGHT}">
    <rect x="0" y="0" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" rx="10" fill="#24282B" />
    ${avatarMarkup(input.profile)}
    <text x="${CONTENT_X}" y="54" font-family="Arial, Liberation Sans, DejaVu Sans, sans-serif" font-size="32" font-weight="600" fill="#F2F3F5">
      <tspan fill="${rankColor(input.rank)}" font-weight="700">${rank}</tspan>
      <tspan fill="#AAB8C2"> • </tspan>
      <tspan font-weight="500">@${displayName}</tspan>
      <tspan fill="#AAB8C2"> • </tspan>
      <tspan>LVL: ${input.level}</tspan>
    </text>
    <text x="${CONTENT_X}" y="92" font-family="Arial, Liberation Sans, DejaVu Sans, sans-serif" font-size="24" font-weight="500" fill="#F2F3F5">Total XP: ${formatXp(input.totalXp)}</text>
    <text x="${CONTENT_X}" y="126" font-family="Arial, Liberation Sans, DejaVu Sans, sans-serif" font-size="21" font-weight="500" fill="#AAB8C2">Level ${input.level + 1} • ${formatXp(input.xpInCurrentLevel)} / ${formatXp(input.xpForNextLevel)} XP</text>
    <rect x="${CONTENT_X}" y="142" width="${CONTENT_WIDTH}" height="7" rx="3.5" fill="#AEB4B7" />
    <rect x="${CONTENT_X}" y="142" width="${progressWidth}" height="7" rx="3.5" fill="#2EC7C9" />
    <text x="${CONTENT_X}" y="178" font-family="Arial, Liberation Sans, DejaVu Sans, sans-serif" font-size="20" font-weight="500" fill="#AAB8C2">${formatXp(input.xpNeededForNextLevel)} XP to go</text>
  </svg>`;

  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

export const rankImageDimensions = {
  width: IMAGE_WIDTH,
  height: IMAGE_HEIGHT,
} as const;
