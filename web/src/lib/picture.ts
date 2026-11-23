// Makes a cover picture small enough to upload: at most 1000 pixels on the longer side,
// as a JPEG, the same as the app does with a photo.

export const MAX_SIDE = 1000;
export const MAX_BYTES = 2 * 1024 * 1024;

/** The size a picture is scaled down to. Small pictures stay as they are. */
export function scaledSize(width: number, height: number, maxSide = MAX_SIDE): [number, number] {
  const longer = Math.max(width, height);
  if (longer <= maxSide) return [width, height];
  const factor = maxSide / longer;
  return [Math.max(1, Math.round(width * factor)), Math.max(1, Math.round(height * factor))];
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/** Null when the file is not a picture the browser can read. */
export async function prepareCover(file: Blob): Promise<Blob | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const [width, height] = scaledSize(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  // JPEG knows no transparency. White is what paper would show through.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.5]) {
    const blob = await toJpeg(canvas, quality);
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  return null;
}
