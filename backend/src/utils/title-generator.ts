export function generateTitle(message: string): string {
  // Common stop words for English and Persian
  const stopWords = new Set([
    // English
    'the', 'is', 'at', 'and', 'a', 'an', 'to', 'in', 'on', 'of', 'for', 'with', 'by', 'it', 'that', 'this',
    // Persian
    'و', 'در', 'به', 'از', 'که', 'این', 'است', 'با', 'را', 'برای', 'آن', 'بر', 'هم', 'نیز', 'ما', 'شما'
  ]);

  // Clean message: remove punctuation
  const cleaned = message
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
    .replace(/[،؛؟«»]/g, "");

  // Tokenize and filter
  const tokens = cleaned.split(/\s+/).filter(token => {
    const lowerToken = token.toLowerCase();
    // Improved filter: ignore stop words and words with length <= 1
    return lowerToken.length > 1 && !stopWords.has(lowerToken);
  });

  // Select first 3-4 keywords
  const title = tokens.slice(0, 4).join(" ");

  return title.length > 0 ? title : "New Conversation";
}
