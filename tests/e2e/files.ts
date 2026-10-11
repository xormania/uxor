/*
 * Files the specs give a file input (`setInputFiles`): a real image the server accepts as a PNG, and a text file.
 */

/** A 1×1 PNG. */
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

/** A PNG named `name`; with `size` (bytes), the image padded with zeros to that size, still a valid PNG. */
export const png = (name: string, size = PNG.length) => ({ name, mimeType: 'image/png', buffer: Buffer.concat([PNG, Buffer.alloc(Math.max(0, size - PNG.length))]) });

/** A text file named `name`, holding its name and a newline. */
export const text = (name: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(`${name}\n`) });
