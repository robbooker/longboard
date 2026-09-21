# Rob Booker Chat installed-app branding

Installed-app metadata, the install guide, and push notification titles now say Rob Booker Chat. The short app name is RB Chat. Versioned 192px and 512px RB icons replace the installed-app LB icon references; old asset URLs remain available for existing clients. The notification badge is unchanged because it is an unlettered speech bubble. Room-specific LB/SS branding remains unchanged.

The manifest id, start_url, and scope remain /chat so this update does not create a new app identity or migrate origins. Existing phones may keep OS-cached home-screen names/icons; refreshing updates application code but cannot guarantee replacing installed icons. The install guide explains removing/reinstalling the app and re-enabling notifications if needed.

## Validation

- 14 focused push/browser tests passed.
- TypeScript and focused ESLint passed.
- Production Next.js build passed with network access for fonts.
- Executed manifest and service-worker checks: unchanged app identity, valid PNG dimensions and paths, Rob Booker Chat notification title, unchanged preview body and click destination.
- Inspected generated RB icon and unlettered notification badge.

Physical iOS/Android installation and OS icon-refresh behavior need device acceptance testing. No production publishing performed.
