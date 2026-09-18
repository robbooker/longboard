import { createChatAdminClient } from '@/lib/chatAdmin';
import { type ChatAuthResult,requireChatUser } from '@/lib/chatAuth';

export async function featureAccess(verified?: ChatAuthResult) {
 const auth = verified ?? await requireChatUser();
 if (!auth.ok) return null;
 const db = createChatAdminClient();
 if (!db) return null;
 const {data,error} = await db.from('chat_feature_members').select('role').eq('account_id',auth.user.id).maybeSingle();
 if(error || !data) return null;
 return {db, user:auth.user, role:data.role as 'owner'|'participant'};
}
