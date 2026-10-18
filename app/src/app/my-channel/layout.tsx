import type { ReactNode } from "react";
import { TrophyPopup } from "@/components/channel/TrophyPopup";

// The original shows its "New Trophy" popup app-wide; here it lives with the My Channel pages.
export default function MyChannelLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <TrophyPopup />
    </>
  );
}
