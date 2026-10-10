import { describe, expect, it } from "vitest";
import { matchVoucherFormHotkey } from "./accounts-hotkeys";

function key(
  k: string,
  mods: { ctrl?: boolean; alt?: boolean; meta?: boolean; typing?: boolean } = {}
): KeyboardEvent {
  const target = mods.typing
    ? ({ tagName: "INPUT", isContentEditable: false } as HTMLElement)
    : ({ tagName: "DIV", isContentEditable: false, closest: () => null } as unknown as HTMLElement);
  return {
    key: k,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
    altKey: !!mods.alt,
    target,
  } as KeyboardEvent;
}

describe("matchVoucherFormHotkey", () => {
  it("maps Ctrl/Cmd+S to save and Ctrl+Enter to add line", () => {
    expect(matchVoucherFormHotkey(key("s", { ctrl: true }))).toBe("save");
    expect(matchVoucherFormHotkey(key("s", { meta: true }))).toBe("save");
    expect(matchVoucherFormHotkey(key("Enter", { ctrl: true }))).toBe("add-line");
    expect(matchVoucherFormHotkey(key("Insert", { alt: true }))).toBe("add-line");
  });

  it("maps Alt+Delete to remove line", () => {
    expect(matchVoucherFormHotkey(key("Delete", { alt: true }))).toBe("remove-line");
    expect(matchVoucherFormHotkey(key("d", { alt: true }))).toBe("remove-line");
  });
});
