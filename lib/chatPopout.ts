import type {ChatRoom} from './publicChat';

/** Open synchronously from a user click so popup blockers can recognize it. */
export function openChatPopout(room: ChatRoom): boolean {
  const width = Math.min(460, Math.max(340, window.screen.availWidth - 32));
  const height = Math.min(780, Math.max(560, window.screen.availHeight - 48));
  const left = Math.max(0, window.screenX + window.outerWidth - width - 24);
  const top = Math.max(0, window.screenY + 36);
  const url = new URL(`/chat?popout=1&room=${room}`, window.location.origin);
  const opened = window.open(url.toString(), `rb-chat-${room}`,
    `popup=yes,width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes`);
  if (!opened) return false;
  opened.opener = null;
  opened.focus();
  return true;
}
