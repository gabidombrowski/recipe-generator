"use client";

import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "~/trpc/react";
import { Badge, Button, Empty } from "./ui";

export interface LeftoverView {
  id: number;
  recipeName: string;
  cookedDate: string;
  storage: "fridge" | "freezer";
  portions: number;
  ageDays: number;
  atRisk: boolean;
  dueToday: boolean;
}

/**
 * The standing note is not decoration — it is the rule the whole leftover
 * feature exists to enforce, and it stays on screen rather than living in a
 * tooltip nobody opens.
 */
export const FRIDGE_NOTE =
  "Fridge portions: refrigerate promptly after cooking, eat within 1 day. Need longer? Freeze the same day.";

export function LeftoverList({
  items,
  onChanged,
}: {
  items: readonly LeftoverView[];
  onChanged: () => void;
}) {
  const trpc = useTRPC();
  const eat = useMutation(trpc.kitchen.eatPortion.mutationOptions({ onSuccess: onChanged }));
  const discard = useMutation(
    trpc.kitchen.discardLeftover.mutationOptions({ onSuccess: onChanged }),
  );

  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
        {FRIDGE_NOTE}
      </p>

      {items.length === 0 ? (
        <Empty>Nothing stored right now.</Empty>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{item.recipeName}</p>
                <p className="text-xs text-ink-muted">
                  cooked {item.cookedDate} · {item.ageDays === 0 ? "today" : `${item.ageDays}d ago`} ·{" "}
                  {item.portions} portion{item.portions === 1 ? "" : "s"}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={item.storage === "freezer" ? "accent" : "neutral"}>
                  {item.storage}
                </Badge>
                {item.dueToday && <Badge tone="training">eat today</Badge>}
                {item.atRisk && (
                  <Badge tone="warn">
                    past its safe window: eat today or discard; freeze same-day next
                    time if you need longer
                  </Badge>
                )}
                <Button onClick={() => eat.mutate({ id: item.id })} disabled={eat.isPending}>
                  Ate stored portion
                </Button>
                <Button
                  variant="danger"
                  onClick={() => discard.mutate({ id: item.id })}
                  disabled={discard.isPending}
                >
                  Discard
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
