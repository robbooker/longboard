import { requireChatUser } from '@/lib/chatAuth';
import { readHistory } from '@/lib/chatReads/history';
import { NextRequest } from 'next/server';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest) {return readHistory(req,await requireChatUser(req));}
