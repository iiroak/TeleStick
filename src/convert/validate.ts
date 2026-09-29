import {
  STICKER_MAX_BYTES,
  STICKER_SIZE_PX,
  STICKER_STATIC_MAX_BYTES,
} from "./sticker.js";

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Baileys does not validate sticker dimensions, size, or duration before
 * sending. WhatsApp may silently reject or corrupt a non-compliant sticker,
 * so this check runs before every send.
 */
export function validateWebpSticker(buffer: Buffer, animated: boolean): ValidationResult {
  if (buffer.byteLength < 20 || buffer.toString("ascii", 0, 4) !== "RIFF") {
    return { valid: false, reason: "not a valid RIFF/WebP container" };
  }
  if (buffer.toString("ascii", 8, 12) !== "WEBP") {
    return { valid: false, reason: "not a WebP file" };
  }

  const maxBytes = animated ? STICKER_MAX_BYTES : STICKER_STATIC_MAX_BYTES;
  if (buffer.byteLength > maxBytes) {
    return {
      valid: false,
      reason: `sticker is ${buffer.byteLength} bytes, over the ${maxBytes} byte limit`,
    };
  }

  const { width, height, hasAnim } = readWebpMetadata(buffer);
  if (width !== STICKER_SIZE_PX || height !== STICKER_SIZE_PX) {
    return {
      valid: false,
      reason: `sticker is ${width}x${height}, WhatsApp requires exactly ${STICKER_SIZE_PX}x${STICKER_SIZE_PX}`,
    };
  }

  if (animated && !hasAnim) {
    return { valid: false, reason: "expected an animated WebP but no ANIM chunk was found" };
  }

  return { valid: true };
}

function readWebpMetadata(buffer: Buffer): {
  width: number;
  height: number;
  hasAnim: boolean;
} {
  let offset = 12;
  let width = 0;
  let height = 0;
  let hasAnim = false;

  while (offset + 8 <= buffer.byteLength) {
    const fourCc = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const payloadStart = offset + 8;

    if (fourCc === "VP8X" && payloadStart + 10 <= buffer.byteLength) {
      hasAnim = (buffer.readUInt8(payloadStart) & 0x02) !== 0;
      width = buffer.readUIntLE(payloadStart + 4, 3) + 1;
      height = buffer.readUIntLE(payloadStart + 7, 3) + 1;
    } else if (fourCc === "VP8L" && payloadStart + 5 <= buffer.byteLength) {
      const b1 = buffer.readUInt8(payloadStart + 1);
      const b2 = buffer.readUInt8(payloadStart + 2);
      const b3 = buffer.readUInt8(payloadStart + 3);
      const b4 = buffer.readUInt8(payloadStart + 4);
      const bits = b1 | (b2 << 8) | (b3 << 16) | (b4 << 24);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (fourCc === "VP8 " && payloadStart + 10 <= buffer.byteLength) {
      width = buffer.readUInt16LE(payloadStart + 6) & 0x3fff;
      height = buffer.readUInt16LE(payloadStart + 8) & 0x3fff;
    }

    if (fourCc === "ANIM") hasAnim = true;
    offset = payloadStart + chunkSize + (chunkSize % 2);
  }

  return { width, height, hasAnim };
}
