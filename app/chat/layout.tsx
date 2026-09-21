import type {Metadata} from 'next';
export const metadata:Metadata={manifest:'/chat/manifest.webmanifest',appleWebApp:{capable:true,title:'Rob Booker Chat',statusBarStyle:'default'},icons:{apple:'/chat-rb-icon-v1-192.png'}};
export default function ChatLayout({children}:{children:React.ReactNode}){return children;}
