export const MAX_FILE_BYTES = 150 * 1024 * 1024;
export function validateFile(name: string, size: number) {
  if (!/\.(ply|usdz)$/i.test(name)) throw new Error('Choose a .ply or .usdz file.');
  if (!size) throw new Error('This file is empty. Choose another model.');
  if (size > MAX_FILE_BYTES) throw new Error('This model is larger than 150 MB. Export a smaller model for this browser.');
}
