"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTRPC } from "~/trpc/react";
import { Badge, Button, Input } from "./ui";

/**
 * Accept / reject controls on AI-generated recipes.
 *
 * A rejection with a reason is the raw material for an eval fixture — "Promote
 * to eval fixture" writes it into `/evals/fixtures`, so the golden set grows
 * from real failures instead of imagined ones.
 */
export function AiFeedbackControls({
  recipeId,
  onChanged,
}: {
  recipeId: number;
  onChanged: () => void;
}) {
  const trpc = useTRPC();
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  const feedback = useQuery(trpc.generation.feedback.queryOptions({ recipeId }));
  const submit = useMutation(
    trpc.generation.submitFeedback.mutationOptions({
      onSuccess: () => {
        setRejecting(false);
        setReason("");
        void feedback.refetch();
        onChanged();
      },
    }),
  );
  const promote = useMutation(
    trpc.generation.promoteToFixture.mutationOptions({
      onSuccess: () => void feedback.refetch(),
    }),
  );

  const entries = feedback.data ?? [];
  const latest = entries[0];

  if (rejecting) {
    return (
      <div className="flex w-full flex-wrap items-center gap-2">
        <Input
          autoFocus
          aria-label="Why is this recipe wrong?"
          placeholder="What's wrong with it?"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="min-w-0 flex-1"
        />
        <Button
          variant="danger"
          disabled={submit.isPending}
          onClick={() => submit.mutate({ recipeId, verdict: "rejected", reason })}
        >
          Save rejection
        </Button>
        <Button variant="ghost" onClick={() => setRejecting(false)}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        disabled={submit.isPending}
        onClick={() => submit.mutate({ recipeId, verdict: "accepted", reason: "" })}
      >
        Accept
      </Button>
      <Button variant="danger" onClick={() => setRejecting(true)}>
        Reject
      </Button>

      {latest && (
        <Badge tone={latest.verdict === "accepted" ? "accent" : "warn"}>
          {latest.verdict}
        </Badge>
      )}

      {latest?.verdict === "rejected" && !latest.promotedToFixture && (
        <Button
          variant="ghost"
          disabled={promote.isPending}
          onClick={() => promote.mutate({ feedbackId: latest.id })}
        >
          Promote to eval fixture
        </Button>
      )}
      {latest?.promotedToFixture && <Badge tone="accent">fixture written</Badge>}
      {promote.isError && (
        <span role="alert" className="text-xs text-warn">
          {promote.error.message}
        </span>
      )}
    </div>
  );
}
