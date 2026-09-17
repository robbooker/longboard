# Compact chat header

On viewports below 1100px, Features notifications and the Inbox launcher move into the room navigation. Search, the regular activity bell, and settings remain in the header. Feature access rules remain unchanged. Desktop keeps its existing header controls.

Each notification/inbox component remains mounted once. Portals relocate controls without creating duplicate polling or resetting conversation state. Inbox retains its mobile dialog; closing it focuses the visible navigation arrow when its launcher is hidden. Feature notifications expand within the navigation width.

Validation: TypeScript and targeted ESLint pass. `chat-mobile-header-browser.mjs` checks 320/390/768/1099px layouts, notification bounds, popup close focus, and desktop/mobile resizing. The existing header/cards browser suite passes, including request acceptance, sending fixture messages, room and DM draft preservation. All browser checks use isolated fixture data; no production messages are sent. No migration or configuration change.

Production build passed (existing unrelated lint warnings only).
