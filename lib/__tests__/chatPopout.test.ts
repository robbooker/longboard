import {afterEach,expect,it,vi} from 'vitest';
import {chatPopoutName,chatPopoutPath,chatPopoutTitle,openChatPopout} from '@/lib/chatPopout';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

it('#438: every room, DM and page has its own window name', ()=>{
  const names=[
    chatPopoutName({kind:'room',room:'main'}),
    chatPopoutName({kind:'room',room:'gainers'}),
    chatPopoutName({kind:'dm',room:'main',conversationId:'0b785d41-7f0b-4365-8ce5-594c45dd956c'}),
    chatPopoutName({kind:'dm',room:'main',conversationId:'11111111-1111-4111-8111-111111111111'}),
    chatPopoutName({kind:'page',room:'main',page:'news-feed'}),
    chatPopoutName({kind:'page',room:'gainers',page:'gainers-table'}),
  ];
  expect(new Set(names).size).toBe(names.length);
  // The room name is unchanged, so the Gainers pop-out in the quad view still shares its window.
  expect(chatPopoutName({kind:'room',room:'gainers'})).toBe('rb-chat-gainers');
  expect(chatPopoutName({kind:'page',room:'main',page:'a b/c'})).toBe('rb-chat-page-a_b_c');
});

it('#438: the pop-out address opens the same DM or page', ()=>{
  expect(chatPopoutPath({kind:'room',room:'social'})).toBe('/chat?popout=1&room=social');
  expect(chatPopoutPath({kind:'dm',room:'main',conversationId:'abc'})).toBe('/chat?popout=1&room=main&dm=abc');
  expect(chatPopoutPath({kind:'page',room:'main',page:'news-feed'})).toBe('/chat?popout=1&room=main&page=news-feed');
  expect(chatPopoutTitle('News Feed')).toBe('News Feed · Rob Booker Chat');
});

it('#438: popping out an open chat again only brings its window forward', ()=>{
  const windows=new Map<string,{closed:boolean;focus:ReturnType<typeof vi.fn>;opener:unknown;location:{href:string;replace:ReturnType<typeof vi.fn>}}>();
  const open=vi.fn();
  vi.stubGlobal('window',{open,screen:{availWidth:1920,availHeight:1080},screenX:0,screenY:0,outerWidth:1440,location:{origin:'https://longboard.example'}});
  open.mockImplementation(((_url:string,name:string)=>{
    let w=windows.get(name);
    if(!w){w={closed:false,focus:vi.fn(),opener:window,location:{href:'about:blank',replace:vi.fn(function(this:{href:string},href:string){this.href=href;})}};windows.set(name,w);}
    return w as unknown as Window;
  }) as typeof window.open);
  expect(openChatPopout({kind:'dm',room:'main',conversationId:'abc'})).toBe(true);
  expect(openChatPopout({kind:'page',room:'main',page:'news-feed'})).toBe(true);
  expect(windows.size).toBe(2);
  const dm=windows.get('rb-chat-dm-abc')!;
  expect(dm.location.replace).toHaveBeenCalledTimes(1);
  expect(openChatPopout({kind:'dm',room:'main',conversationId:'abc'})).toBe(true);
  expect(open).toHaveBeenCalledTimes(2);
  expect(dm.focus).toHaveBeenCalledTimes(2);
  expect(dm.location.replace).toHaveBeenCalledTimes(1);
  // Closed: a new window opens in its place.
  dm.closed=true;windows.delete('rb-chat-dm-abc');
  expect(openChatPopout({kind:'dm',room:'main',conversationId:'abc'})).toBe(true);
  expect(open).toHaveBeenCalledTimes(3);
  // Blocked by the browser.
  open.mockReturnValue(null);
  expect(openChatPopout({kind:'room',room:'social'})).toBe(false);
});
