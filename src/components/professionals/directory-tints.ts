/**
 * Soft backgrounds for a professional without a portrait on « Nos professionnels », taken in turn.
 * Shared by the server page (hero cluster) and the client grid, so it lives outside both.
 */
export const DIRECTORY_TINTS = [
  { from: "#DCEBEA", to: "#BFD9D7", ink: "#17505F" },
  { from: "#F1E4D8", to: "#E4CCB8", ink: "#7A4B2E" },
  { from: "#E3EBDD", to: "#CCDBC1", ink: "#3F5A3A" },
  { from: "#DFE7F1", to: "#C6D6E8", ink: "#2F4E6F" },
  { from: "#EBE1EA", to: "#D9C7D8", ink: "#5C3F5E" },
] as const;

export const directoryTint = (index: number) => DIRECTORY_TINTS[Math.abs(index) % DIRECTORY_TINTS.length]!;
