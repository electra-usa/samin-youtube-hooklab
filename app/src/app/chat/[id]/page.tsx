import type { Metadata } from "next";
import { ChatThreadView } from "@/components/chat/ChatThreadView";
import { getChatRow } from "@/lib/chat/store";

export async function generateMetadata(props: PageProps<"/chat/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  return { title: getChatRow(id)?.title ?? "Chat" };
}

export default async function ChatThreadPage(props: PageProps<"/chat/[id]">) {
  const { id } = await props.params;
  return <ChatThreadView key={id} chatId={id} />;
}
