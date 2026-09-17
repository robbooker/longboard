import { notFound } from 'next/navigation';
import { featureAccess } from '@/lib/chatFeatures';
import FeatureChannel from '@/components/chat/FeatureChannel';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{request?:string;view?:string}>}){
 const access=await featureAccess();
 if(!access) notFound();
 const params=await searchParams;
 const id=typeof params.request==='string'&&/^[0-9a-f-]{36}$/i.test(params.request)?params.request:'';
 return <FeatureChannel initialRequestId={id} initialView={params.view==='archive'?'archive':'active'}/>;
}
