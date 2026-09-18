import { requireChatUser } from '@/lib/chatAuth';
import { readCounts } from '@/lib/chatReads/counts';
import { NextRequest } from 'next/server';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest) {return readCounts(req,await requireChatUser(req));}
