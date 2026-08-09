"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTRPC } from "~/trpc/react";
import { Markdown } from "~/components/markdown";
import { Button, Card, PageTitle, Spinner, Textarea } from "~/components/ui";

/**
 * The context bridge.
 *
 * A gitignored markdown file for the things that don't fit a schema, plus a
 * one-click JSON export so the data is portable rather than trapped in a
 * SQLite file on one server.
 */
export default function ContextPage() {
  const trpc = useTRPC();

  const context = useQuery(trpc.context.get.queryOptions());
  const exportData = useQuery(trpc.context.exportData.queryOptions());
  const save = useMutation(trpc.context.save.mutationOptions());

  // The draft overlays the loaded file rather than being seeded from it in an
  // effect — no synchronisation, and a refetch cannot discard unsaved edits.
  const [edited, setEdited] = useState<string | null>(null);
  const draft = edited ?? context.data?.content ?? null;

  // Read is the default: this file is consulted far more often than edited.
  const [mode, setMode] = useState<"read" | "edit">("read");

  const download = () => {
    if (!exportData.data) return;
    const blob = new Blob([JSON.stringify(exportData.data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `nutrition-export-${exportData.data.exportedAt.slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (context.isPending || draft === null) return <Spinner />;

  const dirty = draft !== context.data?.content;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <PageTitle>Context</PageTitle>
          <p className="text-sm text-ink-muted">
            <code>nutrition-context.md</code> — gitignored.{" "}
            {context.data?.exists
              ? "Editing the existing file."
              : "Not created yet; showing the committed example as a starting point."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-warn">unsaved</span>}
          <Button
            variant="primary"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate({ content: draft })}
          >
            {save.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </header>

      <Card
        action={
          <div className="flex gap-1">
            {(["read", "edit"] as const).map((value) => (
              <Button
                key={value}
                variant={mode === value ? "primary" : "ghost"}
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
              >
                {value === "read" ? "Read" : "Edit"}
              </Button>
            ))}
          </div>
        }
      >
        {mode === "read" ? (
          draft.trim() ? (
            <Markdown source={draft} />
          ) : (
            <p className="py-6 text-center text-sm text-ink-muted">
              Nothing written yet. Switch to Edit to start.
            </p>
          )
        ) : (
          <Textarea
            aria-label="Nutrition context"
            value={draft}
            onChange={(event) => setEdited(event.target.value)}
            rows={24}
            className="w-full text-sm"
            spellCheck={false}
          />
        )}
        {save.data && (
          <p className="mt-2 text-xs text-ink-muted">Saved {save.data.bytes} bytes.</p>
        )}
      </Card>

      <Card
        title="Export data"
        action={
          <Button onClick={download} disabled={!exportData.data}>
            Download JSON
          </Button>
        }
      >
        <p className="text-sm text-ink-muted">
          Profile, settings, computed macro plan, favourites, exclude list,
          pantry and leftover inventory, as one JSON document.
        </p>
      </Card>
    </div>
  );
}
