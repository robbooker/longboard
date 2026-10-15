import ChatIcon from "./ChatIcon";

/** A sending message shows a small clock until the server confirms it (COMPOSER-REST). */
export default function SendingMark() {
  return (
    <span role="img" aria-label="Sending" title="Sending" data-sending-mark style={{ display: "inline-flex", opacity: 0.8 }}>
      <ChatIcon name="clock" size={12} />
    </span>
  );
}
