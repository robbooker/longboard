import { notFound } from 'next/navigation';
import { featureAccess } from '@/lib/chatFeatures';
import FeatureChannel from '@/components/chat/FeatureChannel';
export const dynamic='force-dynamic';
export default async function Page(){
 const access=await featureAccess();
 if(!access) notFound();
 return <FeatureChannel />;
}
