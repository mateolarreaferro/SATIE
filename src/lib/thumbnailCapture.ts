/**
 * Capture a thumbnail from the Three.js canvas for sketch previews.
 * Returns a small JPEG blob suitable for storage/display.
 */

const THUMB_WIDTH = 400;
const THUMB_HEIGHT = 300;

/**
 * Capture the current Three.js canvas as a thumbnail.
 * Returns null if no canvas is found.
 */
export function captureCanvasThumbnail(): Promise<Blob | null> {
  return new Promise((resolve) => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) {
      resolve(null);
      return;
    }

    // Create a small offscreen canvas for the thumbnail
    const thumb = document.createElement('canvas');
    thumb.width = THUMB_WIDTH;
    thumb.height = THUMB_HEIGHT;
    const ctx = thumb.getContext('2d');
    if (!ctx) {
      resolve(null);
      return;
    }

    // Draw the source canvas scaled down
    ctx.drawImage(canvas, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);

    // Convert to blob
    thumb.toBlob(
      (blob) => resolve(blob),
      'image/jpeg',
      0.7,
    );
  });
}

/**
 * Upload a thumbnail to Supabase Storage.
 */
export async function uploadThumbnail(
  supabase: { storage: { from: (bucket: string) => { upload: (path: string, data: Blob, opts?: Record<string, unknown>) => Promise<{ error: unknown }> } } },
  userId: string,
  sketchId: string,
  blob: Blob,
): Promise<string | null> {
  const path = `${userId}/${sketchId}/thumbnail.jpg`;

  const { error } = await supabase.storage
    .from('thumbnails')
    .upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (error) {
    console.warn('[thumbnail] Upload failed:', error);
    return null;
  }

  return path;
}
