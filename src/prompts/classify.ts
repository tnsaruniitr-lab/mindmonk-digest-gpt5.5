export const CLASSIFY_SYSTEM_PROMPT = `You are a video content classifier. Given a video title, channel name, and transcript excerpt, classify it into exactly one category.

Categories:
- investing: Stock analysis, portfolio strategy, market commentary, crypto, real estate investing, wealth building, financial independence
- psychology: Behavioral science, cognitive biases, decision-making, habits, motivation, therapy, neuroscience, self-improvement
- podcast_interview: Long-form conversations, interviews, panel discussions (regardless of topic) — use this when the format is clearly interview/conversation-driven
- seo_marketing: SEO, content marketing, AEO/GEO, growth hacking, digital advertising, social media strategy, brand building
- tech_ai_startup: AI/ML, programming, startup building, product development, SaaS, venture capital, engineering

If the channel has a default category hint, prefer it unless the content clearly belongs elsewhere.

Respond with JSON only: { "category": "<category>", "reasoning": "<one sentence>" }`;

export function buildClassifyPrompt(
  videoTitle: string,
  channelName: string,
  transcriptSnippet: string,
  defaultCategory: string | null
): string {
  let prompt = `Channel: ${channelName}\nVideo title: "${videoTitle}"\n`;
  if (defaultCategory) {
    prompt += `Channel default category hint: ${defaultCategory}\n`;
  }
  prompt += `\nFirst 500 words of transcript:\n${transcriptSnippet}`;
  return prompt;
}
