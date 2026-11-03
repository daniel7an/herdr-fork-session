// Right-click menu for a pane header (opened by the `fork-session` mod).
// Props: { result, overlay }, result being fork-session's lookup ({ id, cmd } or { error }).
// Copies the fork command. Enter or click copies, Esc closes.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, theme, exec, notify } from "herdr";

// Copies $1 with the first clipboard tool found (macOS or Linux).
const CLIP = 'for c in pbcopy wl-copy "xclip -selection clipboard" "xsel -b"; do command -v ${c%% *} >/dev/null && { printf %s "$1" | $c; exit; }; done; echo "no clipboard tool (pbcopy, wl-copy, xclip, xsel)" >&2; exit 1';

export default class ForkMenu extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  async copy() {
    const r = props()?.result;
    if (!r?.cmd) return;
    closeOverlay(props()?.overlay);
    const c = await exec("sh", ["-c", CLIP, "sh", r.cmd]);
    notify(c.code === 0
      ? { title: "Fork command copied", body: r.cmd, level: "success", timeout: 4000 }
      : { title: "Couldn't copy fork command", body: c.stderr.trim(), level: "error" });
  }

  render(cx) {
    const t = theme();
    const r = props()?.result;
    return v_flex()
      .id("fork-menu")
      .track_focus(this.handle)
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e) => {
        if (e.key === "enter") this.copy();
        else if (e.key === "escape") closeOverlay(props().overlay);
      })
      .child(h_flex()
        .id("fork-copy")
        .py(5)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .bg(t.selected)
        .when(Boolean(r?.cmd), (el) => el.hover((s) => s.bg(t.hover)).on_click(() => this.copy()))
        .child(svg("mods/workspace-chrome/git-branch.svg").size(14).flex_none().text_color(t.muted))
        .child(v_flex().flex_1().min_w(0)
          .child(div().text_color(r?.cmd ? t.foreground : t.dim).child("Copy fork command"))
          .child(div().truncate().text_size(11).text_color(t.dim).child(r?.error ?? r?.id ?? "No session"))));
  }
}
