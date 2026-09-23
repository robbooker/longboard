import {describe, expect, it} from 'vitest';
import {attachmentMetadata, attachmentSignature} from '../chatAttachmentValidation';
import {clipboardImages} from '../chatClipboard';

function clipboard(files: File[], itemFiles: (File | null)[] = files) {
  return {
    items: itemFiles.map(file => ({kind: 'file', getAsFile: () => file})) as unknown as DataTransferItemList,
    files: files as unknown as FileList,
  };
}
describe('clipboard image extraction', () => {
  it('accepts each supported image without duplicating the files list', () => {
    const files = ['jpeg', 'png', 'gif'].map(type => new File(['bytes'], `image.${type}`, {type: `image/${type}`}));
    expect(clipboardImages(clipboard(files))).toEqual({images: files, error: ''});
  });
  it('falls back to files when items are absent or unreadable', () => {
    const file = new File(['bytes'], 'image.png', {type: 'image/png'});
    expect(clipboardImages(clipboard([file], [])).images).toEqual([file]);
    expect(clipboardImages(clipboard([file], [null])).images).toEqual([file]);
  });
  it('leaves ordinary text/link paste alone', () => {
    expect(clipboardImages(clipboard([]))).toEqual({images: [], error: ''});
  });
  it('provides a file-picker fallback for unreadable files', () => {
    expect(clipboardImages(clipboard([], [null]))).toEqual({images: [], error: expect.stringContaining('use Attach file')});
  });
  it('reports unsupported formats while keeping supported images', () => {
    const png = new File(['bytes'], 'image.png', {type: 'image/png'});
    for (const type of ['image/webp', 'image/svg+xml', 'application/pdf', '']) {
      const result = clipboardImages(clipboard([png, new File(['bytes'], 'other', {type})]));
      expect(result.images).toEqual([png]);
      expect(result.error).toContain('JPEG, PNG or GIF');
    }
  });
  it('gives unnamed clipboard images a compatible filename', () => {
    const result = clipboardImages(clipboard([new File(['bytes'], '', {type: 'image/png'})]));
    expect(result.images[0].name).toBe('pasted-image.png');
    expect(result.images[0].type).toBe('image/png');
    expect(result.images[0].size).toBe(5);
  });
});

describe('clipboard filenames at the upload boundary', () => {
  it.each(['image', 'blob', 'image.tiff', 'image.jpg', 'Screenshot/Today.png', 'a'.repeat(181) + '.png'])(
    'normalizes native clipboard name %s without changing the image bytes', async name => {
      const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      const original = new File([bytes], name, {type: 'image/png', lastModified: 123});
      const {images, error} = clipboardImages(clipboard([original]));
      expect(error).toBe('');
      expect(images).toHaveLength(1);
      const image = images[0];
      expect(attachmentMetadata(image.name, image.type, image.size)).toEqual({filename: 'pasted-image.png', mime_type: 'image/png', byte_size: 8});
      expect(new Uint8Array(await image.arrayBuffer())).toEqual(bytes);
      expect(image.lastModified).toBe(123);
      expect(attachmentSignature(new Uint8Array(await image.arrayBuffer()), 'image/png')).toBe(true);
    },
  );
  it('keeps compatible named images, including JPEG aliases and uppercase extensions', () => {
    for (const name of ['Screenshot.PNG', 'photo.jpeg', 'photo.JPG']) {
      const original = new File(['bytes'], name, {type: name.endsWith('PNG') ? 'image/png' : 'image/jpeg'});
      expect(clipboardImages(clipboard([original])).images[0]).toBe(original);
    }
  });
  it('does not relabel unsupported native formats or bypass size and signature checks', () => {
    const native = new File(['tiff'], 'image', {type: 'image/tiff'});
    expect(clipboardImages(clipboard([native]))).toEqual({images: [], error: expect.stringContaining('JPEG, PNG or GIF')});
    const bad = clipboardImages(clipboard([new File(['not png'], 'image', {type: 'image/png'})])).images[0];
    expect(attachmentSignature(new Uint8Array([1, 2, 3]), 'image/png')).toBe(false);
    expect(() => attachmentMetadata(bad.name, bad.type, 10_000_001)).toThrow('10 MB');
  });
});
