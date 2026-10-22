#!/usr/bin/env python3
"""AI Review — turns Claude's JSON verdict into the pass/fail check.

Fails (holds the deploy) when the review found anything critical or high, when the
verdict says block, or when no usable verdict came back at all (fail closed).
Writes a findings table to the job summary and inline annotations on the files.
"""
import json
import os
import sys

BLOCKING = {"critical", "high"}
ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}
LEVEL = {"critical": "error", "high": "error", "medium": "warning", "low": "notice"}


def esc_data(value):
    return str(value).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def esc_prop(value):
    return esc_data(value).replace(":", "%3A").replace(",", "%2C")


def cell(value):
    return str(value).replace("|", "\\|").replace("\r", " ").replace("\n", " ").strip()


def write_summary(lines):
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    text = "\n".join(lines) + "\n"
    if path:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(text)
    else:
        sys.stdout.write(text)


def hold(reason):
    write_summary([
        "## AI Review: deploy held",
        "",
        reason,
        "",
        "Re-run this job from the Actions tab. If you need to ship before it passes, "
        "promote the deployment by hand in Vercel or use Deploy Latest Commit in Railway.",
    ])
    print(f"::error title=AI Review::{esc_data(reason)}")
    sys.exit(1)


def main():
    raw = (os.environ.get("REVIEW_JSON") or "").strip()
    scope = os.environ.get("REVIEW_RANGE") or ""
    if not raw:
        hold("The review finished without returning a verdict, so this commit was not approved.")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        hold("The review returned a verdict that could not be read, so this commit was not approved.")
    if not isinstance(data, dict):
        hold("The review returned an unexpected result, so this commit was not approved.")

    findings = [f for f in (data.get("findings") or []) if isinstance(f, dict)]
    findings.sort(key=lambda f: ORDER.get(str(f.get("severity", "")).lower(), 9))
    blocking = [f for f in findings if str(f.get("severity", "")).lower() in BLOCKING]
    verdict = str(data.get("verdict", "")).lower()
    blocked = bool(blocking) or verdict == "block"

    for f in findings:
        sev = str(f.get("severity", "low")).lower()
        props = []
        if f.get("file"):
            props.append(f"file={esc_prop(f['file'])}")
            try:
                line = int(f.get("line") or 0)
            except (TypeError, ValueError):
                line = 0
            if line > 0:
                props.append(f"line={line}")
        props.append(f"title={esc_prop(sev.upper() + ': ' + str(f.get('title', '')))}")
        message = f"{f.get('detail', '')}  Fix: {f.get('fix', '')}"
        print(f"::{LEVEL.get(sev, 'notice')} {','.join(props)}::{esc_data(message)}")

    counts = {s: sum(1 for f in findings if str(f.get("severity", "")).lower() == s) for s in ORDER}
    headline = "Deploy held" if blocked else "Approved"
    icon = "🛑" if blocked else "✅"
    lines = [
        f"## {icon} AI Review: {headline}",
        "",
        f"**Reviewed:** {cell(scope) or 'this push'}  ",
        f"**Findings:** {counts['critical']} critical · {counts['high']} high · "
        f"{counts['medium']} medium · {counts['low']} low",
        "",
        cell(data.get("summary", "")),
        "",
    ]
    if blocked and not blocking:
        lines += ["The reviewer marked this push as blocked without a critical or high finding; "
                  "read its summary above.", ""]
    if findings:
        lines += ["| Severity | Where | Problem | Fix |", "|---|---|---|---|"]
        for f in findings:
            where = cell(f.get("file", ""))
            try:
                if int(f.get("line") or 0) > 0:
                    where += f":{int(f['line'])}"
            except (TypeError, ValueError):
                pass
            problem = f"**{cell(f.get('title', ''))}** — {cell(f.get('detail', ''))}"
            lines.append(f"| {cell(f.get('severity', '')).upper()} | `{where}` | {problem} | {cell(f.get('fix', ''))} |")
        lines.append("")
    if blocked:
        lines.append("Critical and high findings hold the deploy. Fix them and push again — "
                     "the next run re-checks everything since the last approved commit.")
    else:
        lines.append("Nothing critical or high. The deploy can go live.")
    write_summary(lines)
    sys.exit(1 if blocked else 0)


if __name__ == "__main__":
    main()
