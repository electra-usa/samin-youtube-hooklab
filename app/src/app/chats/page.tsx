import type { Metadata } from "next";
import { ChatsList } from "@/components/chat/ChatsList";

export const metadata: Metadata = { title: "Chats" };

export default function ChatsPage() {
  return <ChatsList />;
}
