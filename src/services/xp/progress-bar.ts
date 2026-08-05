export function buildProgressBar(progress: number, width = 12): string {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new RangeError("progress must be between 0 and 1.");
  }

  if (!Number.isSafeInteger(width) || width < 1 || width > 40) {
    throw new RangeError("width must be an integer between 1 and 40.");
  }

  const filledSegments = Math.floor(progress * width);
  return `${"█".repeat(filledSegments)}${"░".repeat(width - filledSegments)}`;
}
