'use client';
import {useEffect,type RefObject} from 'react';
import {watchChatKeyboardDismiss} from '@/lib/chatKeyboardDismiss';

export function useMobileKeyboardDismiss(root:RefObject<HTMLElement|null>){
 useEffect(()=>root.current?watchChatKeyboardDismiss(root.current):undefined,[root]);
}
