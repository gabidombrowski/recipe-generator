import { describe, expect, it } from "vitest";
import { repairTurns } from "./generator";
import type { Anthropic } from "./client";

/**
 * Pins the conversation shape of a retry, because the API enforces it with a
 * 400: an assistant turn ending in `tool_use` must be answered by a
 * `tool_result` before any other content. The version without the tool_result
 * shipped, and every repair attempt died on it — found by the eval suite's
 * first real run, not by any local test, which is why this one now exists.
 */

function messageWithToolUse(): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-test",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 } as Anthropic.Usage,
    content: [
      {
        type: "tool_use",
        id: "toolu_abc123",
        name: "emit_recipe",
        input: { name: "Bad Recipe" },
      },
    ],
  };
}

describe("repairTurns", () => {
  it("answers the tool_use with a tool_result before instructing", () => {
    const turns = repairTurns(messageWithToolUse(), "rejected: no name", "Try again.");

    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual({
      role: "assistant",
      content: messageWithToolUse().content,
    });

    const user = turns[1]!;
    expect(user.role).toBe("user");
    const blocks = user.content as Anthropic.ContentBlockParam[];
    // Order is the contract: tool_result first, then the instruction.
    expect(blocks[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "toolu_abc123",
      is_error: true,
      content: "rejected: no name",
    });
    expect(blocks[1]).toMatchObject({ type: "text", text: "Try again." });
  });

  it("falls back to plain text when there is no tool_use to answer", () => {
    const message: Anthropic.Message = {
      ...messageWithToolUse(),
      content: [
        {
          type: "text",
          text: "prose instead of a tool call",
          citations: null,
        } as Anthropic.TextBlock,
      ],
    };

    const turns = repairTurns(message, "no tool call", "Call the tool.");
    const blocks = (turns[1]!.content) as Anthropic.ContentBlockParam[];

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe("text");
    // A tool_result with no tool_use to answer is itself a 400.
    expect(blocks.some((b) => b.type === "tool_result")).toBe(false);
  });
});
