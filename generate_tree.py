from pathlib import Path

ROOT = Path(r"C:\Users\dmshs\Documents\VCAS")
OUT = ROOT / "VCAS_file_tree.txt"

EXCLUDE_DIRS = {
    ".git",
    "__pycache__",
    "node_modules",
    ".venv",
    "venv",
    "dist",
    "build",
}

EXCLUDE_FILES = {
    ".DS_Store",
    "VCAS_file_tree.txt",
}

def tree(path: Path, prefix: str = ""):
    entries = sorted(
        [p for p in path.iterdir() if p.name not in EXCLUDE_DIRS and p.name not in EXCLUDE_FILES],
        key=lambda p: (p.is_file(), p.name.lower())
    )

    lines = []
    for i, entry in enumerate(entries):
        connector = "└── " if i == len(entries) - 1 else "├── "
        lines.append(f"{prefix}{connector}{entry.name}")

        if entry.is_dir():
            extension = "    " if i == len(entries) - 1 else "│   "
            lines.extend(tree(entry, prefix + extension))

    return lines

lines = [ROOT.name]
lines.extend(tree(ROOT))

OUT.write_text("\n".join(lines), encoding="utf-8")
print(f"Written: {OUT}")