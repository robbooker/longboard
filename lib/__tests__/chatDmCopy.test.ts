import {expect,it,vi} from 'vitest';
import {copyDirectMessageText} from '../chatDmCopy';

it.each(['  original spaces  ','First line\n\nSecond\tline 😃','**bold** <b>original</b> & "quotes"','https://media.giphy.com/media/abc/giphy.gif','https://example.test/a?x=1&y=2#fragment'])('copies the original body without rendering or normalization: %s',async body=>{
 const clipboard={writeText:vi.fn().mockResolvedValue(undefined)};
 await copyDirectMessageText(body,clipboard);
 expect(clipboard.writeText).toHaveBeenCalledExactlyOnceWith(body);
});
it.each(['',' \n\t'])('does not copy an attachment-only/empty message',async body=>{
 const clipboard={writeText:vi.fn()};await expect(copyDirectMessageText(body,clipboard)).rejects.toThrow('no text to copy');expect(clipboard.writeText).not.toHaveBeenCalled();
});
it('reports unavailable clipboard instead of success',async()=>{
 await expect(copyDirectMessageText('message',undefined)).rejects.toThrow('Copy is unavailable');
});
it('reports a denied write without exposing browser error details or pretending it copied',async()=>{
 const clipboard={writeText:vi.fn().mockRejectedValue(new Error('NotAllowedError'))};
 await expect(copyDirectMessageText('message',clipboard)).rejects.toThrow('Could not copy');expect(clipboard.writeText).toHaveBeenCalledTimes(1);
});
