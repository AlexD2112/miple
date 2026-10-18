/**
 * The real format of an uploaded image, read from its first bytes. Upload labels can't be trusted:
 * expo-image-picker returns library photos in their original HEIC form even with `quality < 1`
 * (ios/ImageUtils.swift returns rawData for UTType.heic), while the app labels uploads as JPEG.
 */
export type ImageFormat = "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "image/heic" | "image/heif";

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis"]);
const HEIF_BRANDS = new Set(["mif1", "msf1", "heif"]);

export function sniffImageFormat(bytes: Buffer): ImageFormat | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.toString("ascii", 0, 4) === "GIF8") return "image/gif";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.toString("ascii", 4, 8) === "ftyp") {
    const brand = bytes.toString("ascii", 8, 12);
    if (HEIC_BRANDS.has(brand)) return "image/heic";
    if (HEIF_BRANDS.has(brand)) return "image/heif";
  }
  return null;
}

/** HEIC/HEIF go straight to Gemini, which reads them; Perceptron is only sent formats we know it takes. */
export const isHeif = (format: ImageFormat) => format === "image/heic" || format === "image/heif";
