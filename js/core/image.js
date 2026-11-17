/*
 * Browser-side image engine shared by the Image Compressor and Image Resizer.
 * Everything happens locally with <img> decoding + <canvas> encoding. Nothing is uploaded.
 */
import { sniffImageType } from './logic.js';

export const LIMITS = {
  maxFiles: 20,
  maxBytes: 25 * 1024 * 1024,
  maxInputPixels: 100_000_000,
  maxOutputSide: 10000,
  maxOutputPixels: 64_000_000,
};

export const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
export const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const LABEL = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP' };

/** Validate by size and by real file content (not by name or declared type). */
export async function validateImage(file) {
  if (!file || typeof file.size !== 'number') return { ok: false, code: 'invalid' };
  if (file.size === 0) return { ok: false, code: 'empty' };
  if (file.size > LIMITS.maxBytes) return { ok: false, code: 'too-large' };
  let head;
  try {
    head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  } catch {
    return { ok: false, code: 'read-failed' };
  }
  const type = sniffImageType(head);
  if (!type || !ACCEPTED.includes(type)) return { ok: false, code: 'unsupported', detected: type };
  return { ok: true, type };
}

/**
 * Decode with an <img> element: browsers apply EXIF orientation automatically, so portrait
 * photos come out upright. Returns the decoded image plus a release() to free the blob URL.
 */
export async function loadImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('decode-failed');
  }
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  if (!width || !height) {
    URL.revokeObjectURL(url);
    throw new Error('decode-failed');
  }
  if (width * height > LIMITS.maxInputPixels) {
    URL.revokeObjectURL(url);
    throw new Error('too-many-pixels');
  }
  return { img, width, height, release: () => URL.revokeObjectURL(url) };
}

const encodeSupport = new Map();

/** Can this browser encode `mime` via canvas? (Safari cannot encode WebP, for example.) */
export function canEncode(mime) {
  if (mime === 'image/png' || mime === 'image/jpeg') return Promise.resolve(true);
  if (!encodeSupport.has(mime)) {
    encodeSupport.set(
      mime,
      new Promise((resolve) => {
        try {
          const c = document.createElement('canvas');
          c.width = c.height = 2;
          c.toBlob((b) => resolve(!!b && b.type === mime), mime, 0.8);
        } catch {
          resolve(false);
        }
      })
    );
  }
  return encodeSupport.get(mime);
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas-failed');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

/** Draw `source` into a width×height canvas. Big reductions are done in halving steps for sharper results. */
function render(source, srcW, srcH, dstW, dstH, whiteBackground) {
  let current = source;
  let cw = srcW;
  let ch = srcH;
  let previous = null;
  while (cw >= dstW * 2 && ch >= dstH * 2) {
    const nw = Math.floor(cw / 2);
    const nh = Math.floor(ch / 2);
    const step = makeCanvas(nw, nh);
    step.ctx.drawImage(current, 0, 0, cw, ch, 0, 0, nw, nh);
    if (previous) previous.width = previous.height = 0;
    previous = step.canvas;
    current = step.canvas;
    cw = nw;
    ch = nh;
  }
  const out = makeCanvas(dstW, dstH);
  if (whiteBackground) {
    out.ctx.fillStyle = '#ffffff';
    out.ctx.fillRect(0, 0, dstW, dstH);
  }
  out.ctx.drawImage(current, 0, 0, cw, ch, 0, 0, dstW, dstH);
  if (previous) previous.width = previous.height = 0;
  return out.canvas;
}

/**
 * Encode a loaded image at a given size/format. Throws Error with a short code on failure:
 * 'encode-failed' | 'format-unsupported' | 'canvas-failed'
 */
export async function encodeImage(loaded, { width, height, mime, quality = 0.8 }) {
  const canvas = render(loaded.img, loaded.width, loaded.height, width, height, mime === 'image/jpeg');
  try {
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode-failed'))), mime, mime === 'image/png' ? undefined : quality);
    });
    if (blob.type !== mime) throw new Error('format-unsupported');
    return blob;
  } finally {
    canvas.width = canvas.height = 0;
  }
}

/** Map an internal error code to a user-facing i18n key + English fallback. */
export function describeImageError(code) {
  const map = {
    'decode-failed': ['img.err.decode', 'This image could not be opened. The file may be damaged.'],
    'too-many-pixels': ['img.err.pixels', 'This image has too many pixels for your browser to process.'],
    'canvas-failed': ['img.err.canvas', 'Your browser could not allocate enough memory for this image. Try a smaller image.'],
    'encode-failed': ['img.err.encode', 'Your browser could not save this image. It may be too large for this device.'],
    'format-unsupported': ['img.err.format', 'Your browser cannot save this format. Please choose JPEG.'],
  };
  return map[code] || ['img.err.generic', 'Something went wrong while processing this image.'];
}
