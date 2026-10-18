import type { Metadata } from "next";
import { activeChannel, currentUser } from "@/lib/db/app";
import { isNewChatUser, loadPromptPills, pickPills } from "@/lib/chat/pills";
import { NewChatView } from "@/components/chat/NewChatView";

export const metadata: Metadata = { title: "Chat" };

// New chat. /chat?prompt=<text> pre-fills and sends a message (used by other pages);
// add &send=0 to only pre-fill.
export default async function NewChatPage(props: PageProps<"/chat">) {
  const params = await props.searchParams;
  const prompt = typeof params.prompt === "string" && params.prompt.trim() ? params.prompt.trim() : null;
  const { fixed, pills } = loadPromptPills();
  const pinCapabilities = isNewChatUser();
  const firstName = currentUser()?.name?.trim().split(/\s+/)[0] || "there";
  return (
    <NewChatView
      key={prompt ?? "new"}
      firstName={firstName}
      fixedPill={fixed}
      pills={pickPills(pills, pinCapabilities)}
      pinCapabilities={pinCapabilities}
      channelId={activeChannel()?.id ?? null}
      initialPrompt={prompt}
      autoSend={params.send !== "0"}
    />
  );
}
