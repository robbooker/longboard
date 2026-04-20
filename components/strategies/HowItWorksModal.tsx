"use client";

import React, { useCallback, useEffect, useRef } from "react";

/** Wraps the strategy's pre-rendered MDX spec in a <dialog>. The server
 *  parent renders the MDX with next-mdx-remote/rsc and hands the React
 *  tree in as children — no serialization boundary problem because
 *  children are carried across the RSC boundary as already-rendered UI.
 *
 *  The button to open is rendered here too so the button + dialog live
 *  in one place; the server card just drops <HowItWorksModal> among its
 *  other action buttons. Escape closes, clicking the backdrop closes,
 *  the explicit × button closes. */
export default function HowItWorksModal({
  strategyName,
  buttonClass,
  children,
}: {
  strategyName: string;
  buttonClass?: string;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  const open = useCallback(() => dialogRef.current?.showModal(), []);
  const close = useCallback(() => dialogRef.current?.close(), []);

  const onBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === dialogRef.current) close();
    },
    [close],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => { /* no-op hook for future analytics */ };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, []);

  return (
    <>
      <button
        type="button"
        className={buttonClass ?? "action-btn"}
        onClick={open}
      >
        How it works
      </button>
      <dialog
        ref={dialogRef}
        className="hiw-dialog"
        onClick={onBackdropClick}
        aria-labelledby="hiw-title"
      >
        <div className="hiw-head">
          <h2 id="hiw-title">{strategyName} — How it works</h2>
          <button
            type="button"
            className="hiw-close"
            onClick={close}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="hiw-body">{children}</div>
      </dialog>
    </>
  );
}
