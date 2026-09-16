import { requireChatUser } from '@/lib/chatAuth';
import { createChatAdminClient } from '@/lib/chatAdmin';

export async function featureAccess() {
 const auth = await requireChatUser();
 if (!auth.ok) return null;
 const db = createChatAdminClient();
 if (!db) return null;
 const {data,error} = await db.from('chat_feature_members').select('role').eq('account_id',auth.user.id).maybeSingle();
 if(error || !data) return null;
 return {db, user:auth.user, role:data.role as 'owner'|'participant'};
}
