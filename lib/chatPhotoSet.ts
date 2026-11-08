/**
 * #375: the photos the open image viewer can step through.
 *
 * The set is the image attachments of the conversation view the photo was opened from (a room's
 * message log, a replies thread, or a DM), as that view has them loaded right now. Every image slot
 * in those views carries `data-chat-photo` attributes; the views render oldest first, so document
 * order is chronological order. Nothing here fetches older history.
 */
export type ChatPhoto = { id: string; src: string; alt: string; downloadHref: string };

/** The attribute that marks a conversation view (room log, replies panel, DM thread). */
export const PHOTO_SET_ATTRIBUTE = "data-photo-set";
/** The attribute every image slot carries (its attachment id). */
export const PHOTO_ATTRIBUTE = "data-chat-photo";

/** What a photo slot's dataset looks like (`data-chat-photo`, `data-photo-src`, …). */
export type PhotoDataset = {
  chatPhoto?: string;
  photoSrc?: string;
  photoAlt?: string;
  photoDownload?: string;
};

/**
 * An image whose file details have not loaded yet (it is off screen): its addresses follow from the
 * id alone (the same routes the loaded preview uses), so the viewer can still step onto it.
 */
export function placeholderPhoto(id: string): ChatPhoto {
  return {
    id,
    src: `/api/chat/attachments/${id}?preview=1`,
    alt: "Photo",
    downloadHref: `/api/chat/attachments/${id}`,
  };
}

/** The data attributes for one image slot. */
export function photoAttributes(photo: ChatPhoto) {
  return {
    [PHOTO_ATTRIBUTE]: photo.id,
    "data-photo-src": photo.src,
    "data-photo-alt": photo.alt,
    "data-photo-download": photo.downloadHref,
  };
}

/**
 * Photos from image slots in document (chronological) order. Slots without an id or address are
 * skipped, and an attachment shown twice in one view (it should not be) counts once, where it first
 * appears.
 */
export function photosFromSlots(slots: Iterable<PhotoDataset>): ChatPhoto[] {
  const seen = new Set<string>(),
    photos: ChatPhoto[] = [];
  for (const slot of slots) {
    const id = slot.chatPhoto,
      src = slot.photoSrc;
    if (!id || !src || seen.has(id)) continue;
    seen.add(id);
    photos.push({ id, src, alt: slot.photoAlt || "Photo", downloadHref: slot.photoDownload || src });
  }
  return photos;
}

export type PhotoPosition = {
  index: number;
  total: number;
  photo: ChatPhoto;
  previous: ChatPhoto | null;
  next: ChatPhoto | null;
  /** "3 of 12"; empty when the set is one photo. */
  label: string;
};

/**
 * Where `id` sits in `photos`. A photo missing from the set (the view lost it, or it was opened
 * outside a marked view) is shown on its own. No wrap: the first has no previous, the last no next.
 */
export function photoPosition(photos: ChatPhoto[], id: string, fallback: ChatPhoto): PhotoPosition {
  const found = photos.findIndex((photo) => photo.id === id);
  const set = found < 0 ? [fallback] : photos,
    index = Math.max(0, found);
  return {
    index,
    total: set.length,
    photo: set[index],
    previous: set[index - 1] ?? null,
    next: set[index + 1] ?? null,
    label: set.length > 1 ? `${index + 1} of ${set.length}` : "",
  };
}

/** The photo one step back (-1) or forward (1) from `id`, or null at either end. */
export function photoStep(photos: ChatPhoto[], id: string, direction: -1 | 1): ChatPhoto | null {
  const index = photos.findIndex((photo) => photo.id === id);
  if (index < 0) return null;
  return photos[index + direction] ?? null;
}

/** The neighbours worth loading ahead of time (previous and next), without duplicates. */
export function photosToPreload(position: PhotoPosition): string[] {
  return [position.next, position.previous]
    .filter((photo): photo is ChatPhoto => !!photo && photo.src !== position.photo.src)
    .map((photo) => photo.src);
}

/**
 * A finished one-finger touch as a step: a swipe left shows the next photo (1), a swipe right the
 * previous one (-1), anything else is 0. Pinches (more than one finger at any point) and drags
 * while the page is zoomed in (the finger is panning the zoomed photo) never step.
 */
export function swipeStep({
  dx,
  dy,
  multiTouch,
  zoom = 1,
}: {
  dx: number;
  dy: number;
  multiTouch: boolean;
  zoom?: number;
}): -1 | 0 | 1 {
  if (multiTouch || zoom > 1.01) return 0;
  if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}
