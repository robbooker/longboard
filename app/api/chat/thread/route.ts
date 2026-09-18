import { requireChatUser } from '@/lib/chatAuth';
import { readThread } from '@/lib/chatReads/thread';
import { NextRequest } from 'next/server';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest) {return readThread(req,await requireChatUser(req));}
