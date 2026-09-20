'use client';

import dynamic from 'next/dynamic';
import {usePathname} from 'next/navigation';
import {useEffect,useState} from 'react';
import {isPedroHiddenPath} from '@/lib/pedroVisibility';

const PedroChat=dynamic(()=>import('./PedroChat'),{ssr:false});

/** Do not download the assistant on routes where it cannot appear. Once used,
 * keep its instance so cross-route navigation retains conversation state. */
export default function PedroChatLoader(){
 const pathname=usePathname();
 const hidden=isPedroHiddenPath(pathname);
 const [visited,setVisited]=useState(false);
 useEffect(()=>{if(!hidden)setVisited(true);},[hidden]);
 return visited?<PedroChat/>:null;
}
