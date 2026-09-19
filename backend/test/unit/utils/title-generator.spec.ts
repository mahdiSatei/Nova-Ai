import { generateTitle } from '../../../src/utils/title-generator';

describe('titleGenerator', () => {
  it('generates a title by removing stop words and punctuation', () => {
    const msg = 'سلام، این یک پیام آزمایشی است.';
    const title = generateTitle(msg);
    // 'سلام' (keep), 'این' (stop), 'یک' (keep), 'پیام' (keep), 'آزمایشی' (keep), 'است' (stop)
    // Keywords: سلام یک پیام آزمایشی
    expect(title).toBe('سلام یک پیام آزمایشی');
  });

  it('generates a title for English text', () => {
    const msg = 'Hello, this is a test message.';
    const title = generateTitle(msg);
    // 'Hello' (keep), 'this' (stop), 'is' (stop), 'a' (stop), 'test' (keep), 'message' (keep)
    // Keywords: Hello test message
    expect(title).toBe('Hello test message');
  });

  it('handles empty input', () => {
    expect(generateTitle('')).toBe('New Conversation');
  });

  it('handles only stop words', () => {
    expect(generateTitle('و در به')).toBe('New Conversation');
  });

  it('filters out single-character words', () => {
    const msg = 'a b c test message';
    // 'a', 'b', 'c' should be filtered out
    // Keywords: test message
    expect(generateTitle(msg)).toBe('test message');
  });
});
