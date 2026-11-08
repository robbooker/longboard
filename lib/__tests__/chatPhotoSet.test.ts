import { describe, expect, it } from "vitest";
import {
  photoAttributes,
  photoPosition,
  photosFromSlots,
  photoStep,
  photosToPreload,
  swipeStep,
  type ChatPhoto,
  type PhotoDataset,
} from "@/lib/chatPhotoSet";

const photo = (n: number): ChatPhoto => ({
  id: `id-${n}`,
  src: `/api/chat/attachments/id-${n}?preview=1`,
  alt: `photo-${n}.png`,
  downloadHref: `/api/chat/attachments/id-${n}`,
});
// What a slot's element.dataset holds for the attributes photoAttributes() writes.
const slot = (p: ChatPhoto): PhotoDataset => {
  const attrs = photoAttributes(p);
  return {
    chatPhoto: attrs["data-chat-photo"],
    photoSrc: attrs["data-photo-src"],
    photoAlt: attrs["data-photo-alt"],
    photoDownload: attrs["data-photo-download"],
  };
};
const twelve = Array.from({ length: 12 }, (_, i) => photo(i + 1));

describe("photosFromSlots", () => {
  it("keeps the view's (chronological) order", () => {
    expect(photosFromSlots([photo(1), photo(2), photo(3)].map(slot)).map((p) => p.id)).toEqual([
      "id-1",
      "id-2",
      "id-3",
    ]);
  });
  it("counts an attachment shown twice once, where it first appears", () => {
    expect(photosFromSlots([photo(1), photo(2), photo(1), photo(3)].map(slot)).map((p) => p.id)).toEqual([
      "id-1",
      "id-2",
      "id-3",
    ]);
  });
  it("skips slots without an id or address and fills a missing name and download", () => {
    const photos = photosFromSlots([
      { chatPhoto: "a" },
      { photoSrc: "/x" },
      { chatPhoto: "b", photoSrc: "/b?preview=1" },
    ]);
    expect(photos).toEqual([{ id: "b", src: "/b?preview=1", alt: "Photo", downloadHref: "/b?preview=1" }]);
  });
});

describe("photoPosition", () => {
  it("labels the position as 'n of total'", () => {
    const at = photoPosition(twelve, "id-3", photo(3));
    expect(at.label).toBe("3 of 12");
    expect(at.index).toBe(2);
    expect(at.previous?.id).toBe("id-2");
    expect(at.next?.id).toBe("id-4");
  });
  it("has no previous on the first and no next on the last (no wrap)", () => {
    expect(photoPosition(twelve, "id-1", photo(1)).previous).toBeNull();
    expect(photoPosition(twelve, "id-1", photo(1)).next?.id).toBe("id-2");
    expect(photoPosition(twelve, "id-12", photo(12)).next).toBeNull();
    expect(photoPosition(twelve, "id-12", photo(12)).previous?.id).toBe("id-11");
  });
  it("shows a photo missing from the set on its own, with no label", () => {
    const alone = photoPosition(twelve, "elsewhere", photo(99));
    expect(alone).toMatchObject({ index: 0, total: 1, label: "", previous: null, next: null });
    expect(alone.photo.id).toBe("id-99");
    expect(photoPosition([], "id-1", photo(1)).total).toBe(1);
  });
  it("a single photo has no label and no steps", () => {
    expect(photoPosition([photo(1)], "id-1", photo(1))).toMatchObject({ label: "", previous: null, next: null });
  });
});

describe("photoStep", () => {
  it("steps forward and back", () => {
    expect(photoStep(twelve, "id-2", 1)?.id).toBe("id-3");
    expect(photoStep(twelve, "id-2", -1)?.id).toBe("id-1");
  });
  it("stops at either end and for an unknown photo", () => {
    expect(photoStep(twelve, "id-1", -1)).toBeNull();
    expect(photoStep(twelve, "id-12", 1)).toBeNull();
    expect(photoStep(twelve, "missing", 1)).toBeNull();
  });
});

describe("photosToPreload", () => {
  it("loads the next and previous photos ahead", () => {
    expect(photosToPreload(photoPosition(twelve, "id-5", photo(5)))).toEqual([photo(6).src, photo(4).src]);
  });
  it("loads only the neighbour that exists at the ends", () => {
    expect(photosToPreload(photoPosition(twelve, "id-1", photo(1)))).toEqual([photo(2).src]);
    expect(photosToPreload(photoPosition(twelve, "id-12", photo(12)))).toEqual([photo(11).src]);
    expect(photosToPreload(photoPosition([photo(1)], "id-1", photo(1)))).toEqual([]);
  });
});

describe("swipeStep", () => {
  it("a swipe left shows the next photo, a swipe right the previous", () => {
    expect(swipeStep({ dx: -120, dy: 10, multiTouch: false })).toBe(1);
    expect(swipeStep({ dx: 120, dy: -10, multiTouch: false })).toBe(-1);
  });
  it("short or mostly vertical drags do not step", () => {
    expect(swipeStep({ dx: -30, dy: 0, multiTouch: false })).toBe(0);
    expect(swipeStep({ dx: -80, dy: 90, multiTouch: false })).toBe(0);
  });
  it("pinches and drags while zoomed in do not step", () => {
    expect(swipeStep({ dx: -200, dy: 0, multiTouch: true })).toBe(0);
    expect(swipeStep({ dx: -200, dy: 0, multiTouch: false, zoom: 2 })).toBe(0);
    expect(swipeStep({ dx: -200, dy: 0, multiTouch: false, zoom: 1 })).toBe(1);
  });
});
