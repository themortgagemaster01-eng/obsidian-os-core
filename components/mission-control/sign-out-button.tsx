"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/** Signs the current user out and returns them to /login. */
export function SignOutButton() {
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground" onClick={handleSignOut}>
      <LogOut className="h-4 w-4" />
      Sign out
    </Button>
  );
}
