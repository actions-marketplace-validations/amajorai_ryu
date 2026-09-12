// @ts-nocheck - termcn compatibility surface; host-owned lifecycle fixes are protected by scripts/vendor-termcn.ts
/* @jsxImportSource @opentui/react */
import { useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";

import { useTheme } from "@/components/ui/theme-provider";
import { useAnimation } from "@/hooks/use-animation";
import { useInputFocused } from "@/src/core/InputFocusContext";
import { Diff, toolDiffLines } from "@/components/ui/diff";

export type ToolCallStatus = "pending" | "running" | "success" | "error";

export interface ToolCallProps {
  name: string;
  args?: Record<string, unknown>;
  status: ToolCallStatus;
  result?: unknown;
  duration?: number;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export const ToolCall = ({
  name,
  args,
  status,
  result,
  duration,
  collapsible = true,
  defaultCollapsed = true,
}: ToolCallProps) => {
  const theme = useTheme();
  const diffLines = toolDiffLines(name, args);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());
  const frame = useAnimation(status === "running" ? 12 : 0);

  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const spinnerIcon = spinnerFrames[frame % spinnerFrames.length] ?? "⠋";


  useEffect(() => {
    if (status === "running") {
      startRef.current = Date.now();
      setElapsed(0);
    }
  }, [status]);

  useEffect(() => {
    if (status !== "running" || duration !== undefined) {
      return;
    }
    const updateElapsed = () => setElapsed(Date.now() - startRef.current);
    updateElapsed();
    const id = setInterval(updateElapsed, 100);
    return () => clearInterval(id);
  }, [status, duration]);



  const statusIcon = () => {
    switch (status) {
      case "pending": {
        return <text fg="#666">○</text>;
      }
      case "running": {
        return <text fg={theme.colors.primary}>{spinnerIcon}</text>;
      }
      case "success": {
        return <text fg={theme.colors.success ?? "green"}>✓</text>;
      }
      case "error": {
        return <text fg={theme.colors.error ?? "red"}>✗</text>;
      }
      default: {
        break;
      }
    }
  };

  let durationText: string | null;
  if (duration === undefined) {
    durationText = status === "running" ? `${elapsed}ms` : null;
  } else {
    durationText = `${duration}ms`;
  }

  let nameColor: string;
  if (status === "error") {
    nameColor = theme.colors.error ?? "red";
  } else if (status === "success") {
    nameColor = theme.colors.success ?? "green";
  } else if (status === "running") {
    nameColor = theme.colors.primary;
  } else {
    nameColor = theme.colors.mutedForeground;
  }

  return (
    <box flexDirection="column">
      {collapsible ? <ToolCallKeys toggle={() => setCollapsed((value) => !value)} /> : null}
      <box flexDirection="row" gap={1}>
        {statusIcon()}
        <text fg={nameColor}>
          {status !== "pending" ? <b>{name}</b> : name}
        </text>
        {durationText && (
          <text fg={theme.colors.mutedForeground}>{`(${durationText})`}</text>
        )}
        {collapsible && <text fg="#666">{collapsed ? "▶" : "▼"}</text>}
      </box>

      {!collapsed && (
        <box flexDirection="column" paddingLeft={2}>
          {diffLines ? <Diff lines={diffLines} /> : null}
          {args && Object.keys(args).length > 0 && (
            <box flexDirection="column">
              <text fg="#666">Args:</text>
              {...Object.entries(args).map(([k, v]) => (
                <box key={k} gap={1}>
                  <text fg={theme.colors.accent}>{`${k}:`}</text>
                  <text fg="#666">{JSON.stringify(v)}</text>
                </box>
              ))}
            </box>
          )}
          {result !== undefined && (
            <box flexDirection="column">
              <text fg="#666">Result:</text>
              <text fg="#666">
                {typeof result === "string"
                  ? result
                  : JSON.stringify(result, null, 2)}
              </text>
            </box>
          )}
        </box>
      )}
    </box>
  );
};


function ToolCallKeys({ toggle }: { toggle: () => void }) {
  const focused = useInputFocused();
  return focused ? null : <ActiveToolCallKeys toggle={toggle} />;
}

function ActiveToolCallKeys({ toggle }: { toggle: () => void }) {
  useKeyboard((key) => {
    if (key.name === "return" || key.name === " ") toggle();
  });
  return null;
}
