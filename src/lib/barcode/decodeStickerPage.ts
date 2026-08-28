"use client";

import { BinaryBitmap, DataMatrixReader, HybridBinarizer, RGBLuminanceSource, NotFoundException } from "@zxing/library";
import { parseGs1, type Gs1Fields } from "./gs1";

export interface DecodedSticker extends Gs1Fields {
  raw: string;
}

/**
 * @zxing/library (the JS port of ZXing) has no multi-barcode-per-image
 * reader -- that's a Java/C++-only utility upstream, never ported. A page of
 * stickers needs more than one DataMatrix read from a single photo, so this
 * tiles the image into overlapping regions and decodes each independently,
 * on top of a whole-image attempt. Good enough for reasonably separated
 * stickers on a page; a dense or overlapping layout can still miss some --
 * that's the known tradeoff of the free/open-source path over a commercial
 * multi-symbol SDK.
 */
export async function decodeStickerPage(file: File | Blob): Promise<DecodedSticker[]> {
  const bitmap = await loadImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  ctx.drawImage(bitmap, 0, 0);

  const reader = new DataMatrixReader();
  const found = new Map<string, DecodedSticker>();

  function tryDecode(x: number, y: number, w: number, h: number) {
    if (w < 40 || h < 40) return;
    let imageData: ImageData;
    try {
      imageData = ctx!.getImageData(x, y, w, h);
    } catch {
      return;
    }
    try {
      const result = reader.decode(new BinaryBitmap(new HybridBinarizer(imageDataToLuminanceSource(imageData))));
      const raw = result.getText();
      if (!found.has(raw)) {
        found.set(raw, { raw, ...parseGs1(raw) });
      }
    } catch (err) {
      if (!(err instanceof NotFoundException)) {
        // Decoding errors (checksum/format) are expected on empty/blank
        // tiles constantly -- only NotFoundException is the "normal" case,
        // anything else is worth knowing about during development.
      }
    }
  }

  // Whole image first -- the fast path when there's just one clear code.
  tryDecode(0, 0, canvas.width, canvas.height);

  // Then a tiled sweep: a grid of overlapping windows, since stickers on a
  // page are typically laid out in rows (sometimes columns) with real
  // spacing between them, not packed edge to edge. Tuned against two real
  // photographed sticker pages: a coarse 3x6 grid missed a code entirely
  // that only a finer 6x12 grid (with more overlap) picked up -- a
  // DataMatrix needs to land with enough margin inside its crop to decode,
  // and a bigger tile dilutes a small code with too much surrounding label
  // text/background.
  const cols = 6;
  const rows = 12;
  const tileW = (canvas.width / cols) * 1.8;
  const tileH = (canvas.height / rows) * 1.8;
  const stepX = canvas.width / cols;
  const stepY = canvas.height / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = Math.max(0, Math.floor(c * stepX - (tileW - stepX) / 2));
      const y = Math.max(0, Math.floor(r * stepY - (tileH - stepY) / 2));
      const w = Math.min(canvas.width - x, Math.ceil(tileW));
      const h = Math.min(canvas.height - y, Math.ceil(tileH));
      tryDecode(x, y, w, h);
    }
  }

  return Array.from(found.values());
}

function imageDataToLuminanceSource(imageData: ImageData): RGBLuminanceSource {
  const { data, width, height } = imageData;
  const packed = new Int32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    packed[p] = (0xff << 24) | (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
  }
  return new RGBLuminanceSource(packed, width, height);
}

function loadImage(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not load image."));
    };
    img.src = url;
  });
}
