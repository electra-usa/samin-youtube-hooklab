import type { PromptPill } from "./pills";

// HookLab's own starter prompts for the new-chat page. Canned pills answer instantly
// without a model call; the rest send their prompt to the pipeline.

const ASK_TOPIC = "Love it. What's the video about? Give me the topic, who it's for, and anything that makes your take different.";

export const FIXED_PILL: PromptPill = {
  id: "generate_titles",
  label: "Generate titles",
  prompt: "Generate titles",
  canned: { response: ASK_TOPIC },
};

export const DEFAULT_PILLS: PromptPill[] = [
  {
    id: "chat_capabilities",
    label: "Show me what this chat can do",
    prompt: "Show me what this chat can do",
    canned: {
      response: [
        "I write YouTube titles and thumbnail text grounded in real outliers, videos that beat their channel's average, and I can help you plan, compare and research.",
        "",
        "A few things to try:",
        "",
        "- **Titles:** My next video is about [topic]. Give me titles.",
        "- **Pick a winner:** Which is stronger, [Title A] or [Title B]? Why?",
        "- **Riffs:** I like this title: [title]. Write versions of it for my channel.",
        "- **Thumbnail text:** What should the thumbnail say for a video about [topic]?",
        "- **Ideas:** Based on my best videos, what should I make next?",
        "- **Competitors:** Which channels in my niche should I study that I don't follow yet?",
        "- **What's working:** Which title patterns are winning in my niche this month?",
        "- **Review:** How did my latest video do, and what would you change?",
        "- **Writing:** Outline my next video, or write the first 30 seconds.",
        "",
        "Where do you want to start?",
      ].join("\n"),
    },
  },
  {
    id: "brainstorm_ideas",
    label: "Brainstorm ideas",
    prompt: "Brainstorm ideas",
    canned: {
      response: "Do you already have a topic in mind, or should I look at what's working right now and pitch you some ideas?",
      cards: { suggestedFollowups: ["Pitch me ideas based on what's working"] },
    },
  },
  {
    id: "analyze_latest_video",
    label: "Analyze my latest video",
    prompt:
      "Review my latest video: how it compares with my recent uploads, what the title did well or badly, and what viewers seem to have liked or disliked.",
    canned: null,
  },
  {
    id: "youtube_now",
    label: "What's working on YouTube now?",
    prompt:
      "Which title patterns have been winning over the last month, both in my niche and in channels with a similar style outside it? Show 3-4 real examples for each pattern.",
    canned: null,
  },
  {
    id: "study_channels",
    label: "Which channels should I study?",
    prompt:
      "Suggest 5 channels in my niche that I don't follow yet, and 5 channels outside my niche with a similar format I could learn from.",
    canned: null,
  },
  { id: "outline_next_video", label: "Outline my next video", prompt: "Outline my next video", canned: { response: ASK_TOPIC } },
  { id: "write_next_intro", label: "Write an intro for my next video", prompt: "Write an intro for my next video", canned: { response: ASK_TOPIC } },
  {
    id: "audience_psychology",
    label: "Analyze my audience's psychology",
    prompt:
      "Based on which of my videos over- and under-performed, what does my audience want, fear and get excited by? How should that change my titles and topics?",
    canned: null,
  },
  { id: "next_video", label: "What video should I make next?", prompt: "What video should I make next?", canned: null },
  { id: "grow_channel", label: "How can I grow my channel?", prompt: "How can I grow my channel?", canned: null },
  { id: "underserved_topics", label: "What topics are under-served in my niche?", prompt: "What topics are under-served in my niche?", canned: null },
  { id: "channel_holdup", label: "What's holding my channel back?", prompt: "What's holding my channel back?", canned: null },
  { id: "growth_opportunity", label: "What's my biggest growth opportunity?", prompt: "What's my biggest growth opportunity?", canned: null },
  { id: "competitors_beating_me", label: "Why are my competitors beating me?", prompt: "Why are my competitors beating me?", canned: null },
];
