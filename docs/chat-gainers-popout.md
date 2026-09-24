# Gainers pop-out

Gainers now has a visible pop-out arrow in its regular room header and in its Quad View pane header. The regular three-dot menu also labels the action “Pop out Gainers.” Each room uses its own named popup so opening Gainers does not replace another room's popup.

The popup reuses the existing authenticated `/chat?popout=1&room=gainers` page, read-only permissions, and live update coordinator. Close the window to leave the original view intact, or choose “Return to Gainers” in its menu to use the full chat layout in that window. Browser popup blocking shows a retry hint. Phones may open a browser tab instead of a floating window. Quad layouts and drafts are not changed by opening a popup.

Validation: TypeScript and targeted ESLint passed; 785 unit tests passed. The actual-component Chromium fixture opened a real popup, confirmed a subsequent synthetic alert arrived through the existing update transport, checked no composer/opener, exercised return navigation and blocked popup feedback, and verified 320px full-view overflow plus the existing 320/390/900/1440 quad matrix. Fixtures use synthetic users and messages, never production data. Physical phone popup behavior is not tested.

No migrations, secrets, or authorization changes. Publish only through the dedicated release service after approval of the registered PR head.
