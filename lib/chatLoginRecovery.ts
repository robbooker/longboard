const reasons={
 identity_mismatch:"Please sign in with the ShortScout account used for your original chat profile. A different ShortScout account is currently signed in.",
 identity_already_linked:'Your ShortScout sign-in already belongs to a separate chat profile that could not be connected. Your messages and memberships are safe.',
 insufficient_membership:'ShortScout chat requires Mastermind membership. Other paid ShortScout memberships can use Social.',
 link_session_changed:'Your Longboard login changed while connecting. Please start again from the Longboard profile you want to use.',
 login_expired:'This sign-in link expired. Please start again.',
 login_unavailable:'Chat sign-in is temporarily unavailable. Please try again.',
 invalid_login_handoff:'This sign-in could not be verified. Please start again.',
} as const;
export type ChatLoginRecoveryReason=keyof typeof reasons;
export function chatLoginRecoveryReason(value:unknown):ChatLoginRecoveryReason{return typeof value==='string'&&Object.hasOwn(reasons,value)?value as ChatLoginRecoveryReason:'invalid_login_handoff';}
export function chatLoginRecoveryMessage(value:unknown){return reasons[chatLoginRecoveryReason(value)];}
