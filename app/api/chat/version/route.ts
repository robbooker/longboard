import {NextResponse} from 'next/server';
export const dynamic='force-dynamic';
export function GET(){return NextResponse.json({version:process.env.VERCEL_GIT_COMMIT_SHA||process.env.CHAT_APP_VERSION||'development'},{headers:{'Cache-Control':'no-store'}});}
