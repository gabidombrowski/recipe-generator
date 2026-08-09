import { Fragment, type ReactNode } from "react";

/**
 * A deliberately small Markdown renderer.
 *
 * It builds React elements directly rather than producing an HTML string, so
 * there is no `dangerouslySetInnerHTML` and therefore no injection surface to
 * sanitise — which is why this exists instead of `marked` + `DOMPurify`.
 *
 */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|_[^_]+_)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text
    .split(INLINE)
    .filter(Boolean)
    .map((token, index) => {
      const key = `${keyPrefix}-${index}`;

      if (token.startsWith("**") && token.endsWith("**")) {
        return <strong key={key}>{token.slice(2, -2)}</strong>;
      }
      if (token.startsWith("`") && token.endsWith("`")) {
        return (
          <code
            key={key}
            className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-[0.9em]"
          >
            {token.slice(1, -1)}
          </code>
        );
      }
      if (
        (token.startsWith("*") && token.endsWith("*")) ||
        (token.startsWith("_") && token.endsWith("_"))
      ) {
        return <em key={key}>{token.slice(1, -1)}</em>;
      }
      return <Fragment key={key}>{token}</Fragment>;
    });
}

const HEADING_CLASS: Record<number, string> = {
  1: "mt-6 mb-2 text-xl font-semibold first:mt-0",
  2: "mt-6 mb-2 text-lg font-semibold first:mt-0",
  3: "mt-5 mb-1.5 text-base font-semibold first:mt-0",
};

export function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  const lines = source.split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    if (line.trim() === "---") {
      blocks.push(<hr key={index} className="my-6 border-border" />);
      index += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const Tag = `h${level}` as "h1" | "h2" | "h3";
      blocks.push(
        <Tag key={index} className={HEADING_CLASS[level]}>
          {renderInline(heading[2]!, `h${index}`)}
        </Tag>,
      );
      index += 1;
      continue;
    }

    const isBullet = (value: string) => /^\s*[-*+]\s+/.test(value);
    const isOrdered = (value: string) => /^\s*\d+[.)]\s+/.test(value);

    if (isBullet(line) || isOrdered(line)) {
      const ordered = isOrdered(line);
      const matches = ordered ? isOrdered : isBullet;
      const items: string[] = [];

      while (index < lines.length && matches(lines[index]!)) {
        items.push(lines[index]!.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ""));
        index += 1;
      }

      const ListTag = ordered ? "ol" : "ul";
      blocks.push(
        <ListTag
          key={`list-${index}`}
          className={`my-3 ml-5 space-y-1 ${ordered ? "list-decimal" : "list-disc"}`}
        >
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>
              {renderInline(item, `li-${index}-${itemIndex}`)}
            </li>
          ))}
        </ListTag>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index]!.trim() !== "" &&
      !/^#{1,3}\s/.test(lines[index]!) &&
      !isBullet(lines[index]!) &&
      !isOrdered(lines[index]!) &&
      lines[index]!.trim() !== "---"
    ) {
      paragraph.push(lines[index]!);
      index += 1;
    }

    blocks.push(
      <p key={`p-${index}`} className="my-3 leading-relaxed">
        {renderInline(paragraph.join(" "), `p${index}`)}
      </p>,
    );
  }

  return <div className="text-sm">{blocks}</div>;
}
