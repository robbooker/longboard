import { notFound } from 'next/navigation';
import { featureAccess } from '@/lib/chatFeatures';
import FeatureChannel from '@/components/chat/FeatureChannel';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{request?:string;view?:string;order?:string;q?:string;page?:string}>}){
 const access=await featureAccess();
 if(!access) notFound();
 const params=await searchParams;
 const id=typeof params.request==='string'&&/^[0-9a-f-]{36}$/i.test(params.request)?params.request:'';
 const page=Number(params.page??0),search=typeof params.q==='string'?params.q.trim().slice(0,200):'';
 return <FeatureChannel key={access.user.id} viewerId={access.user.id} initialOrder={params.order==='asc'?'asc':'desc'} initialSearch={search} initialPage={Number.isSafeInteger(page)&&page>=0&&page<=100000?page:0} initialRequestId={id} initialView={params.view==='archive'?'archive':'active'}/>;
}
