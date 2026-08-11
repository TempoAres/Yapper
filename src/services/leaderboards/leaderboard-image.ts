import type { Client } from "discord.js";
import sharp from "sharp";

const IMAGE_WIDTH = 800;
const ROW_HEIGHT = 72;
const ROW_GAP = 5;
const AVATAR_SIZE = ROW_HEIGHT;
const CONTENT_X = AVATAR_SIZE + 12;
const CONTENT_WIDTH = IMAGE_WIDTH - CONTENT_X - 12;
const AVATAR_CACHE_TTL_MS = 60 * 60 * 1_000;
const AVATAR_CACHE_MAX_ENTRIES = 500;

const rankColors = ["#FFD000", "#AEB4BC", "#D9822B"] as const;
const avatarCache = new Map<
  string,
  { dataUri: string; expiresAt: number }
>();

export interface LeaderboardMemberProfile {
  userId: string;
  displayName: string;
  avatarDataUri: string | null;
}

export interface LeaderboardImageRow {
  rank: number;
  userId: string;
  detail: string;
  progress?: number;
}

export interface LeaderboardImageInput {
  rows: readonly LeaderboardImageRow[];
  profiles: ReadonlyMap<string, LeaderboardMemberProfile>;
  emptyMessage: string;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatDisplayName(value: string, detail: string, rank: number): string {
  const clean = value.replace(/[\r\n\t]/g, " ").trim() || "Unknown user";
  const rankCharacters = `#${rank}`.length;
  const approximateAvailableCharacters = Math.floor(CONTENT_WIDTH / 13.5);
  const maximumNameLength = Math.max(
    7,
    approximateAvailableCharacters - detail.length - rankCharacters - 8,
  );

  if (clean.length <= maximumNameLength) {
    return clean;
  }

  return `${clean.slice(0, Math.max(1, maximumNameLength - 1))}…`;
}

function placeholderColor(userId: string): string {
  let hash = 0;

  for (const character of userId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return `hsl(${hash % 360} 58% 40%)`;
}

function avatarMarkup(
  row: LeaderboardImageRow,
  profile: LeaderboardMemberProfile,
  y: number,
): string {
  const clipId = `avatar-${row.rank}-${row.userId}`;

  if (profile.avatarDataUri) {
    return `
      <clipPath id="${escapeXml(clipId)}">
        <rect x="0" y="${y}" width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" rx="6" />
      </clipPath>
      <image href="${escapeXml(profile.avatarDataUri)}" x="0" y="${y}" width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${escapeXml(clipId)})" />`;
  }

  const initial = escapeXml(profile.displayName.trim().charAt(0).toUpperCase() || "?");
  return `
      <rect x="0" y="${y}" width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" rx="6" fill="${placeholderColor(row.userId)}" />
      <text x="${AVATAR_SIZE / 2}" y="${y + 48}" text-anchor="middle" font-family="Arial, Liberation Sans, DejaVu Sans, sans-serif" font-size="38" font-weight="500" fill="#FFFFFF">${initial}</text>`;
}

function rowMarkup(
  row: LeaderboardImageRow,
  profile: LeaderboardMemberProfile,
  index: number,
): string {
  const y = index * (ROW_HEIGHT + ROW_GAP);
  const hasProgress = row.progress !== undefined;
  const textY = y + (hasProgress ? 43 : 46);
  const rankColor = rankColors[row.rank - 1] ?? "#F2F3F5";
  const displayName = escapeXml(
    formatDisplayName(profile.displayName, row.detail, row.rank),
  );
  const detail = escapeXml(row.detail);
  const progress = Math.max(0, Math.min(1, row.progress ?? 0));
  const progressWidth = Math.round(CONTENT_WIDTH * progress);

  return `
    <g>
      <rect x="0" y="${y}" width="${IMAGE_WIDTH}" height="${ROW_HEIGHT}" rx="6" fill="#24282B" />
      ${avatarMarkup(row, profile, y)}
      <text x="${CONTENT_X}" y="${textY}" font-family="Arial, Liberation Sans, DejaVu Sans, sans-serif" font-size="26" font-weight="600" fill="#F2F3F5">
        <tspan fill="${rankColor}" font-weight="700">#${row.rank}</tspan>
        <tspan fill="#AAB8C2"> • </tspan>
        <tspan font-weight="500">@${displayName}</tspan>
        <tspan fill="#AAB8C2"> • </tspan>
        <tspan>${detail}</tspan>
      </text>
      ${
        hasProgress
          ? `<rect x="${CONTENT_X}" y="${y + 61}" width="${CONTENT_WIDTH}" height="4" rx="2" fill="#AEB4B7" />
      <rect x="${CONTENT_X}" y="${y + 61}" width="${progressWidth}" height="4" rx="2" fill="#2EC7C9" />`
          : ""
      }
    </g>`;
}

async function fetchAvatarDataUri(url: string): Promise<string | null> {
  const cached = avatarCache.get(url);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.dataUri;
  }

  if (cached) {
    avatarCache.delete(url);
  }

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });

    if (!response.ok) {
      return null;
    }

    const input = Buffer.from(await response.arrayBuffer());
    const avatar = await sharp(input)
      .resize(AVATAR_SIZE * 2, AVATAR_SIZE * 2, { fit: "cover" })
      .png()
      .toBuffer();
    const dataUri = `data:image/png;base64,${avatar.toString("base64")}`;

    avatarCache.set(url, {
      dataUri,
      expiresAt: Date.now() + AVATAR_CACHE_TTL_MS,
    });

    if (avatarCache.size > AVATAR_CACHE_MAX_ENTRIES) {
      const oldestKey = avatarCache.keys().next().value as string | undefined;

      if (oldestKey) {
        avatarCache.delete(oldestKey);
      }
    }

    return dataUri;
  } catch {
    return null;
  }
}

export async function resolveLeaderboardProfiles(
  client: Client,
  userIds: readonly string[],
): Promise<ReadonlyMap<string, LeaderboardMemberProfile>> {
  const uniqueUserIds = [...new Set(userIds)];
  const resolved = await Promise.all(
    uniqueUserIds.map(async (userId): Promise<LeaderboardMemberProfile> => {
      try {
        const user = client.users.cache.get(userId) ?? (await client.users.fetch(userId));
        const avatarUrl = user.displayAvatarURL({ extension: "png", size: 128 });
        return {
          userId,
          displayName: user.username,
          avatarDataUri: await fetchAvatarDataUri(avatarUrl),
        };
      } catch {
        return {
          userId,
          displayName: `User ${userId.slice(-4)}`,
          avatarDataUri: null,
        };
      }
    }),
  );

  return new Map(resolved.map((profile) => [profile.userId, profile]));
}

export async function renderLeaderboardImage(
  input: LeaderboardImageInput,
): Promise<Buffer> {
  const rows = input.rows.map((row, index) => {
    const profile = input.profiles.get(row.userId) ?? {
      userId: row.userId,
      displayName: `User ${row.userId.slice(-4)}`,
      avatarDataUri: null,
    };
    return rowMarkup(row, profile, index);
  });
  const imageHeight =
    input.rows.length > 0
      ? input.rows.length * ROW_HEIGHT + (input.rows.length - 1) * ROW_GAP
      : 104;
  const content =
    rows.length > 0
      ? rows.join("")
      : `<rect x="0" y="0" width="${IMAGE_WIDTH}" height="${imageHeight}" rx="6" fill="#24282B" />
    <text x="${IMAGE_WIDTH / 2}" y="62" text-anchor="middle" font-family="Arial, Liberation Sans, DejaVu Sans, sans-serif" font-size="23" font-weight="500" fill="#AEB4BC">${escapeXml(input.emptyMessage)}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="${imageHeight}" viewBox="0 0 ${IMAGE_WIDTH} ${imageHeight}">
    ${content}
  </svg>`;

  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

export const leaderboardImageDimensions = {
  width: IMAGE_WIDTH,
  rowHeight: ROW_HEIGHT,
  rowGap: ROW_GAP,
} as const;
