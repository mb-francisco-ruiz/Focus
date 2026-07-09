import React from "react";

/**
 * Tiny Markdown renderer for assistant replies — handles the subset the model
 * actually emits (headings, bullets, bold, inline code). Builds React nodes
 * (never innerHTML), so task/email text in a reply can't inject markup.
 */

function inline(text: string, keyBase: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) parts.push(<strong key={`${keyBase}-${i++}`}>{tok.slice(2, -2)}</strong>);
    else parts.push(<code key={`${keyBase}-${i++}`}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function Markdown({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  let bullets: React.ReactNode[] = [];
  const flushBullets = (key: string) => {
    if (bullets.length) {
      out.push(
        <ul key={`ul-${key}`}>{bullets}</ul>,
      );
      bullets = [];
    }
  };

  text.split("\n").forEach((line, i) => {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      bullets.push(<li key={i}>{inline(bullet[1]!, `li-${i}`)}</li>);
      return;
    }
    flushBullets(String(i));
    if (heading) {
      out.push(
        <div key={i} className="md-h">
          {inline(heading[2]!, `h-${i}`)}
        </div>,
      );
    } else if (line.trim() !== "") {
      out.push(<p key={i}>{inline(line, `p-${i}`)}</p>);
    }
  });
  flushBullets("end");

  return <div className="md">{out}</div>;
}
