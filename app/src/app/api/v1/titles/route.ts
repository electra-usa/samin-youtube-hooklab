import { v1Json, v1Options, v1Raw } from "@/lib/api-v1/http";
import { QueryError } from "@/lib/core/query";
import { origin, v1Route } from "../_lib/route";
import { collectTitles, parseTitlesRequest, startTitles, withChatEvent } from "../_lib/titles";

// POST /api/v1/titles {idea, channelId?, stream?} — title angle cards for a video idea, written by
// the chat pipeline (Claude, grounded in the outlier library). A chat is created for every call,
// so the answer also appears in the app at /chat/<chatId>.
// stream:false (default) waits for the finished cards (~40 s) and returns JSON; stream:true relays
// the pipeline's SSE events (progress, title, card, done) after a leading {chat} event.
export const POST = v1Route(async (req) => {
  const body = await req.json().catch(() => {
    throw new QueryError("Send a JSON body: {\"idea\": \"what your video is about\"}.", { code: "invalid_body" });
  });
  const request = parseTitlesRequest(body);
  const startedAt = Date.now();
  const generation = startTitles(request);
  const chatUrl = `${origin(req)}/chat/${generation.chatId}`;

  if (request.stream) {
    return v1Raw(withChatEvent(generation, chatUrl), "text/event-stream; charset=utf-8", {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Chat-Id": generation.chatId,
      "Access-Control-Expose-Headers": "X-Chat-Id",
    });
  }

  const outcome = await collectTitles(generation, chatUrl, startedAt);
  if ("error" in outcome) {
    const status = outcome.error.code === "no_provider" ? 503 : outcome.error.code === "rate_limit" ? 429 : 502;
    return v1Json({ error: outcome.error, chatId: outcome.chatId, chatUrl: outcome.chatUrl }, { status });
  }
  return v1Json({ data: outcome.result });
});

export const OPTIONS = v1Options;
