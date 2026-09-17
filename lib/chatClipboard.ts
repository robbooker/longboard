const imageExtensions: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
};

/** Read only clipboard files. Ordinary text/links keep their native paste behavior. */
export function clipboardImages(data: Pick<DataTransfer, 'items' | 'files'>) {
  const items = Array.from(data.items ?? []).filter(item => item.kind === 'file');
  const itemFiles = items.map(item => item.getAsFile()).filter((file): file is File => Boolean(file));
  // Some browsers expose files without usable DataTransferItems. Don't duplicate
  // files when both lists describe the same clipboard contents.
  const files = itemFiles.length ? itemFiles : Array.from(data.files ?? []);
  const images: File[] = [];
  let error = '';
  for (const file of files) {
    const extension = imageExtensions[file.type];
    if (!extension) {
      error = 'Paste a JPEG, PNG or GIF image. For a PDF, use Attach file.';
      continue;
    }
    images.push(file.name ? file : new File([file], `pasted-image.${extension}`, {type: file.type}));
  }
  if (items.length && !files.length) {
    error = 'This browser could not read the clipboard file. Save it, then use Attach file.';
  }
  return {images, error};
}
