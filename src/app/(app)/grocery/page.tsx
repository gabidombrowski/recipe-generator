"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "~/trpc/react";
import { Badge, Button, Card, Empty, Spinner, cx } from "~/components/ui";
import { type GroceryLine } from "~/lib/schemas";

/**
 * The grocery list.
 *
 * Derived live from the week's plan — there is deliberately no "generate"
 * button here, only "clear checks". If a line looks wrong, the plan is wrong.
 */
export default function GroceryPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const list = useQuery(trpc.grocery.list.queryOptions({}));
  const asText = useQuery(trpc.grocery.asText.queryOptions({}));

  const invalidate = () => queryClient.invalidateQueries();
  const setChecked = useMutation(trpc.grocery.setChecked.mutationOptions({ onSuccess: invalidate }));
  const clearChecks = useMutation(trpc.grocery.clearChecks.mutationOptions({ onSuccess: invalidate }));

  if (list.isPending) return <Spinner />;
  if (list.isError) return <Empty>Could not build the list: {list.error.message}</Empty>;

  const data = list.data;

  const Line = ({ line }: { line: GroceryLine }) => (
    <li className="flex items-center gap-2.5 py-1">
      <input
        type="checkbox"
        id={`line-${line.key}`}
        checked={line.checked}
        onChange={(event) =>
          setChecked.mutate({
            weekStart: data.weekStart,
            key: line.key,
            checked: event.target.checked,
          })
        }
        className="size-4 shrink-0 accent-[var(--color-accent)]"
      />
      <label
        htmlFor={`line-${line.key}`}
        className={cx(
          "flex flex-1 flex-wrap items-center gap-2 text-sm",
          line.checked && "text-ink-muted line-through",
        )}
      >
        <span className="font-mono text-xs tabular-nums text-ink-muted">
          {line.qty} {line.unit}
        </span>
        <span>{line.name}</span>
        {line.flaggedTags.map((tag) => (
          <Badge key={tag} tone="flagged">
            {tag}
          </Badge>
        ))}
        <span className="text-xs text-ink-muted">{line.sources.join(", ")}</span>
      </label>
    </li>
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Shopping day: {data.shoppingDay}</h1>
          <p className="text-sm text-ink-muted">
            Week of {data.weekStart} · updates the moment the plan changes.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={async () => {
              if (!asText.data) return;
              await navigator.clipboard.writeText(asText.data);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            disabled={!asText.data}
          >
            {copied ? "Copied" : "Copy as text"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => clearChecks.mutate({ weekStart: data.weekStart })}
            disabled={clearChecks.isPending}
          >
            Clear checks
          </Button>
        </div>
      </header>

      {data.sections.length === 0 && data.buyLater.length === 0 ? (
        <Empty>
          Nothing to buy — the week has no recipes assigned yet.
        </Empty>
      ) : (
        data.sections.map((group) => (
          <Card key={group.section} title={group.section}>
            <ul className="divide-y divide-border">
              {group.lines.map((line) => (
                <Line key={line.key} line={line} />
              ))}
            </ul>
          </Card>
        ))
      )}

      {data.buyLater.length > 0 && (
        <Card title="Buy later in the week">
          <p className="mb-2 text-xs text-ink-muted">
            Buy day-of or day-before cooking.
          </p>
          <ul className="divide-y divide-border">
            {data.buyLater.map((line) => (
              <Line key={line.key} line={line} />
            ))}
          </ul>
        </Card>
      )}

      {data.checkYourSupply.length > 0 && (
        <Card title="Check your supply">
          <p className="mb-2 text-xs text-ink-muted">
            Marked on hand in the pantry, so not on the list — glance at them
            before you go.
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {data.checkYourSupply.map((name) => (
              <li key={name}>
                <Badge>{name}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
