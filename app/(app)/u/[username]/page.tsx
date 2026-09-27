"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { useApp } from "@/components/AppProvider";
import ProfileView from "@/components/ProfileView";
import { Empty } from "@/components/ui";

export default function MemberPage() {
  const { username } = useParams<{ username: string }>();
  const { members } = useApp();
  const profile = members.find((m) => m.username === username);
  return (
    <div>
      <Link href="/board" className="pt-safe inline-flex items-center gap-1 text-sm font-bold text-mute">
        <ChevronLeft className="h-4 w-4" /> Back
      </Link>
      {profile ? <ProfileView profile={profile} /> : <div className="mt-6"><Empty icon="🤷" title="No one here" sub={`There's no @${username} in the squad.`} /></div>}
    </div>
  );
}
