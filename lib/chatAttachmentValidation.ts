import {voiceDuration,VOICE_MAX_BYTES} from './chatVoice';
export const CHAT_FILE_MAX_BYTES = 10_000_000;
export const CHAT_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'audio/wav'] as const;
export type ChatFileType = typeof CHAT_FILE_TYPES[number];
export type ChatAttachmentScope = {room: string};
export type ChatAttachment = {id: string; filename: string; byte_size: number; mime_type: ChatFileType; duration_seconds?:number|null};
const extensions: Record<ChatFileType, string[]> = {'application/pdf':['pdf'],'image/jpeg':['jpg','jpeg'],'image/png':['png'],'image/gif':['gif'],'audio/wav':['wav']};
export function attachmentMetadata(filename: unknown, mime: unknown, size: unknown) {
  if (typeof filename !== 'string' || !filename.trim() || filename.length > 180 || /[\x00-\x1f\x7f/\\]/.test(filename)) throw Error('Use a filename of 1–180 characters without path separators.');
  if (!CHAT_FILE_TYPES.includes(mime as ChatFileType) || !extensions[mime as ChatFileType].includes(filename.split('.').at(-1)?.toLowerCase() ?? '')) throw Error('Choose a PDF, JPEG, PNG, GIF or WAV voice file.');
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1 || size > CHAT_FILE_MAX_BYTES) throw Error('Files must be between 1 byte and 10 MB.');
  if(mime==='audio/wav'&&size>VOICE_MAX_BYTES)throw Error('Voice clips must be at most 5 MB.');
  return {filename:filename.trim(), mime_type:mime as ChatFileType, byte_size:size};
}
// A filename and browser MIME type are only hints. Check the actual bytes as well.
// This is file-type validation, never a substitute for the malware scanner.
export function attachmentSignature(bytes: Uint8Array, mime: ChatFileType) {
  const starts=(signature:number[])=>signature.every((byte,i)=>bytes[i]===byte);
  if(mime==='audio/wav'){try{voiceDuration(bytes);return true;}catch{return false;}}
  if(mime==='image/png')return starts([137,80,78,71,13,10,26,10]);
  if(mime==='image/jpeg')return starts([255,216,255]);
  if(mime==='image/gif')return starts([71,73,70,56,55,97])||starts([71,73,70,56,57,97]);
  return starts([37,80,68,70,45]);
}
