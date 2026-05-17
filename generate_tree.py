from pathlib import Path

ROOT = Path(r"C:\Users\dmshs\Documents\Eos")
OUTPUT_FILE = ROOT / "eos_file_tree.txt"

EXCLUDE_DIRS = {
    ".git",
    "__pycache__",
    "node_modules",
    ".venv",
    "venv",
    "dist",
    "build"
}

EXCLUDE_FILES = {
    ".DS_Store"
}

def generate_tree(path: Path, prefix: str = ""):
    entries = sorted(
        [p for p in path.iterdir()
         if p.name not in EXCLUDE_DIRS
         and p.name not in EXCLUDE_FILES],
        key=lambda p: (p.is_file(), p.name.lower())
    )

    lines = []

    for i, entry in enumerate(entries):
        connector = "└── " if i == len(entries) - 1 else "├── "
        lines.append(f"{prefix}{connector}{entry.name}")

        if entry.is_dir():
            extension = "    " if i == len(entries) - 1 else "│   "
            lines.extend(generate_tree(entry, prefix + extension))

    return lines

tree_lines = [ROOT.name]
tree_lines.extend(generate_tree(ROOT))

OUTPUT_FILE.write_text("\n".join(tree_lines), encoding="utf-8")

print(f"File tree written to:\n{OUTPUT_FILE}")