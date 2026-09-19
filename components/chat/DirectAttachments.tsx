'use client';
import {useAttachmentMetadata} from './AttachmentMetadata';
import ChatAudioAttachment from './ChatAudioAttachment';
import ChatImagePreview from './ChatImagePreview';
import styles from './DirectInbox.module.css';

export default function DirectAttachments({ids,conversationId}:{ids?:string[];conversationId:string}){
 const key=(ids??[]).join(',');
 const {files,error,retry,anchor}=useAttachmentMetadata({conversationId},ids);
 if(!key)return null;
 return <div ref={anchor} className={styles.attachments} style={{gridTemplateColumns:"minmax(0,1fr)",maxWidth:"100%"}} aria-label="Shared files">
  {(ids??[]).map(id=>{const file=files.find(file=>file.id===id);return <div key={id} style={{gridTemplateColumns:"minmax(0,1fr)",maxWidth:"100%"}}>{file?<>
   {file.mime_type==='audio/wav'&&<ChatAudioAttachment file={file}/>}
   {file.mime_type.startsWith('image/')&&<ChatImagePreview previewWidth={file.preview_width} previewHeight={file.preview_height} thumbnailSrc={file.thumbnail_available===false?undefined:`/api/chat/attachments/${file.id}?thumbnail=1`} src={`/api/chat/attachments/${file.id}?preview=1`} alt={file.filename} downloadHref={`/api/chat/attachments/${file.id}`}/>}
   <a style={file.mime_type.startsWith("image/")?{minHeight:40}:undefined} href={`/api/chat/attachments/${file.id}`} download>{file.filename} · {(file.byte_size/1024).toFixed(0)} KB ↓</a>
  </>:!error?<><div style={{width:320,maxWidth:"100%",height:220}} role="status">Loading attachment…</div><span style={{minHeight:40}}/></>:null}</div>;})}
  {error?<p role="alert">{error} <button type="button" onClick={retry}>Retry files</button></p>:null}
 </div>;
}
