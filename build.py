#!/usr/bin/env python3
"""Збирає extension/app.js з частин у src/app/.

Інтерфейс — одна функція mount() зі спільним станом, тому частини не можна
підключити окремими <script>: вони вставляються в її тіло по порядку імен.
  00-helpers.js  — константи й допоміжні функції поза mount()
  10-…99-*.js    — розділи тіла mount() (стан, розмітка, каталог, план, звіт, ШІ…)

Запуск: python3 build.py          — зібрати
        python3 build.py --check  — перевірити, що extension/app.js актуальний
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src" / "app"
OUT = ROOT / "extension" / "app.js"
BANNER = "// ЗГЕНЕРОВАНО з src/app/*.js командою `python3 build.py`. Не редагуйте цей файл — редагуйте частини в src/app/."


def build():
    parts = sorted(SRC.glob("*.js"))
    helpers, body = parts[0], parts[1:]
    assert helpers.name.startswith("00-"), "перша частина має бути 00-helpers.js"
    head = helpers.read_text().rstrip("\n").split("\n")
    n_doc = next(i for i, l in enumerate(head) if not l.startswith("//"))
    lines = [BANNER, *head[:n_doc], "(function () {", *head[n_doc:], "", "  function mount(root, D, env = {}) {"]
    for i, p in enumerate(body):
        chunk = p.read_text().rstrip("\n").split("\n")
        if i:
            lines.append("")                      # порожній рядок між частинами
        lines += chunk
    lines += ["  }", "", "  window.ElectivesApp = { mount };", "})();", ""]
    return "\n".join(lines)


if __name__ == "__main__":
    out = build()
    if "--check" in sys.argv:
        ok = OUT.exists() and OUT.read_text() == out
        print("extension/app.js актуальний" if ok else "extension/app.js застарів — запустіть python3 build.py")
        sys.exit(0 if ok else 1)
    OUT.write_text(out)
    print(f"Зібрано {OUT.relative_to(ROOT)} з {len(list(SRC.glob('*.js')))} частин")
