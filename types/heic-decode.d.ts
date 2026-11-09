// #410: heic-decode ships without types. Only the default export is used (lib/chatAvatarImage.ts).
declare module "heic-decode" {
  type DecodedImage = { width: number; height: number; data: Uint8ClampedArray };
  function decode(input: { buffer: ArrayBufferLike | Uint8Array }): Promise<DecodedImage>;
  export default decode;
}
