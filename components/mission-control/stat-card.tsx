import type { LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  caption?: string;
  className?: string;
}

/**
 * A single Mission Control stat tile. When `caption` is provided it renders
 * as a small note under the value (used for the honest "Coming in a future
 * sprint" empty states — never a fake loading shimmer).
 */
export function StatCard({ label, value, icon: Icon, caption, className }: StatCardProps) {
  return (
    <Card className={cn("transition-colors duration-200 ease-in-out hover:bg-panel-hover", className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle>{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold text-foreground">{value}</div>
        {caption && <p className="mt-1 text-xs text-muted-foreground">{caption}</p>}
      </CardContent>
    </Card>
  );
}
