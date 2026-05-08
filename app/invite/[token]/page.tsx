import InviteClaimClient from "./InviteClaimClient";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteClaimClient token={token} />;
}
