"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "~/trpc/react";
import { Badge, Button, Empty, PageTitle, Spinner } from "~/components/atoms";
import { Card, InfoHint } from "~/components/molecules";
import { cx } from "~/components/cx";
import { formatLongDate } from "~/lib/days";
import { type GroceryLine } from "~/lib/schemas";

/**
 * The grocery list.
 *
 * Derived live from the week's plan — there is deliberately no "generate"
 * button here, only "reset list", which drops every tick and leaves the full
 * list. If a line looks wrong, the plan is wrong.
 */
export default function GroceryPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const list = useQuery(trpc.grocery.list.queryOptions({}));
  const copyable = useQuery(trpc.grocery.copyText.queryOptions({}));

  const invalidate = () => queryClient.invalidateQueries();
  const setChecked = useMutation(
    trpc.grocery.setChecked.mutationOptions({ onSuccess: invalidate }),
  );
  const clearChecks = useMutation(
    trpc.grocery.clearChecks.mutationOptions({ onSuccess: invalidate }),
  );

  if (list.isPending) return <Spinner />;
  if (list.isError)
    return <Empty>Could not build the list: {list.error.message}</Empty>;

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
        className="size-4 shrink-0 accent-accent"
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
        <span className="text-xs text-ink-muted">
          {line.sources.join(", ")}
        </span>
      </label>
    </li>
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <PageTitle>Grocery</PageTitle>
          <p className="text-sm text-ink-muted">
            Shopping day: <strong>{data.shoppingDay}</strong>,{" "}
            {formatLongDate(data.weekStart)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={async () => {
              if (!copyable.data) return;
              await navigator.clipboard.writeText(copyable.data.content);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            disabled={!copyable.data}
          >
            {copied
              ? "Copied"
              : `Copy as ${copyable.data?.format === "markdown" ? "Markdown" : "text"}`}
          </Button>
          <InfoHint>
            Change the format between plain text and Markdown under Settings →
            Grocery copy format. Markdown pastes into GitHub, Obsidian or Notion
            as tickable checkboxes.
          </InfoHint>
          <Button
            variant="ghost"
            onClick={() => clearChecks.mutate({ weekStart: data.weekStart })}
            disabled={clearChecks.isPending}
          >
            Reset list
          </Button>
        </div>
      </header>

      {data.sections.length === 0 && data.buyLater.length === 0 ? (
        <Empty>Nothing to buy — the week has no recipes assigned yet.</Empty>
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
