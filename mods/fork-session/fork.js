// Finds the agent session running in a terminal and copies a command that forks it:
//   Claude Code: ~/.claude/sessions/<pid>.json -> claude --resume <id> --fork-session
//   Codex:       ~/.codex/state_*.sqlite threads (matched by cwd + terminal title) -> codex fork <id>
// Used by the fork-session header: its fork button copies directly; right-click looks up,
// then opens the fork-session-menu popup with the result.

import { exec, hc, notify, spaces, panes } from "herdr";

// Copies $1 with the first clipboard tool found (macOS or Linux).
const CLIP = 'for c in pbcopy wl-copy "xclip -selection clipboard" "xsel -b"; do command -v ${c%% *} >/dev/null && { printf %s "$1" | $c; exit; }; done; echo "no clipboard tool (pbcopy, wl-copy, xclip, xsel)" >&2; exit 1';

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const sql = (s) => `'${String(s).replace(/'/g, "''")}'`;

// The machine the pane's space lives on (null: this computer).
function machineOf(pane) {
  const tab = panes().find((p) => p.pane === pane)?.tab;
  return spaces().find((s) => (s.tabs ?? []).some((c) => c.id === tab))?.machine ?? null;
}

// "[[dd-]hh:]mm:ss" from `ps -o etime=` in seconds.
function seconds(etime) {
  const [d, rest] = etime.trim().includes("-") ? etime.trim().split("-") : [0, etime.trim()];
  return Number(d) * 86400 + rest.split(":").reduce((a, n) => a * 60 + Number(n), 0);
}

async function sh(script, args, on) {
  return exec("sh", ["-c", script, "sh", ...args.map(String)], { on });
}

async function claudeSession(fg, on) {
  const r = await sh('cat "$HOME/.claude/sessions/$1.json"', [fg.pid], on);
  if (r.code !== 0) return null;
  const id = JSON.parse(r.stdout).sessionId;
  return id && { id, cmd: `cd ${q(fg.cwd)} && claude --resume ${id} --fork-session` };
}

async function codexSession(fg, title, on) {
  const age = await exec("ps", ["-o", "etime=", "-p", String(fg.pid)], { on });
  const started = age.code === 0 ? Math.floor(Date.now() / 1000) - seconds(age.stdout) - 5 : 0;
  const query = `select id, title, name, created_at from threads where cwd = ${sql(fg.cwd)} and archived = 0 order by updated_at desc limit 50`;
  const r = await sh('db=$(ls -t "$HOME"/.codex/state_*.sqlite 2>/dev/null | head -1) && sqlite3 -json "$db" "$1"', [query], on);
  if (r.code !== 0 || !r.stdout.trim()) return null;
  const rows = JSON.parse(r.stdout);
  // Codex titles its terminal "<thread title> | <folder>"; prefer that thread, else the
  // newest one started since this process did.
  const want = (title ?? "").split(" | ")[0].trim().toLowerCase();
  const hit = (want && rows.find((t) => [t.name, t.title].some((s) => s && s.trim().toLowerCase() === want)))
    || rows.find((t) => t.created_at >= started);
  return hit && { id: hit.id, cmd: `cd ${q(fg.cwd)} && codex fork ${hit.id}` };
}

export async function lookup(terminal, pane) {
  const on = machineOf(pane);
  if (!terminal) return { error: "Not a terminal pane" };
  const r = await hc(["get", terminal, "--json"]);
  if (r.code !== 0) return { error: "Terminal not found" };
  const t = JSON.parse(r.stdout);
  const fg = t.foreground;
  const app = t.status?.app ?? "";
  const bin = (fg?.argv?.[0] ?? "").split("/").pop();
  if (!fg?.pid) return { error: "No agent running here" };
  const found = app === "claude-code" || bin === "claude" ? await claudeSession(fg, on)
    : app === "codex" || bin === "codex" ? await codexSession(fg, t.title, on)
    : undefined;
  if (found === undefined) return { error: "Not a Claude Code or Codex pane" };
  return found ?? { error: "Session not found" };
}

// Copies r.cmd (from lookup) and says so in a toast.
export async function copy(r) {
  if (!r?.cmd) return notify({ title: "Can't fork this pane", body: r?.error, level: "warning", timeout: 4000 });
  const c = await sh(CLIP, [r.cmd], null);
  notify(c.code === 0
    ? { title: "Fork command copied", body: r.cmd, level: "success", timeout: 4000 }
    : { title: "Couldn't copy fork command", body: c.stderr.trim(), level: "error" });
}
