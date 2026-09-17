import {describe, expect, it} from 'vitest';
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
