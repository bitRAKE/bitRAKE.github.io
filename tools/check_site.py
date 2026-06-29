#!/usr/bin/env python3
"""Small dependency-free checks for the static GitHub Pages site.

The script intentionally stays conservative: it validates local file references,
fragment links, duplicate IDs, and XML well-formedness without requiring network
access or a browser runtime.
"""
from __future__ import annotations

import argparse
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
import sys
import xml.etree.ElementTree as ET

REMOTE_SCHEMES = {"http", "https", "mailto", "tel", "data", "javascript"}


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.ids: list[str] = []
        self.links: list[tuple[int, str, str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {key: value for key, value in attrs if value is not None}
        if "id" in attr_map:
            self.ids.append(attr_map["id"])
        for attr in ("href", "src"):
            if attr in attr_map:
                self.links.append((self.getpos()[0], tag, attr, attr_map[attr]))


def parse_html(path: Path) -> LinkParser:
    parser = LinkParser()
    parser.feed(path.read_text(encoding="utf-8", errors="replace"))
    return parser


def is_remote(url: str) -> bool:
    scheme = urlsplit(url).scheme.lower()
    return scheme in REMOTE_SCHEMES or url.startswith("//")


def check_html(root: Path) -> list[str]:
    errors: list[str] = []
    parsed: dict[Path, LinkParser] = {}

    def get_parser(path: Path) -> LinkParser:
        if path not in parsed:
            parsed[path] = parse_html(path)
        return parsed[path]

    for html_path in sorted(root.rglob("*.html")):
        rel = html_path.relative_to(root)
        parser = get_parser(html_path)
        seen_ids: set[str] = set()
        for id_value in parser.ids:
            if id_value in seen_ids:
                errors.append(f"{rel}: duplicate id #{id_value}")
            seen_ids.add(id_value)

        for line, tag, attr, url in parser.links:
            if not url or is_remote(url):
                continue
            if url.startswith("#"):
                target_path = html_path
                fragment = url[1:]
            else:
                without_query = urlsplit(url)
                if without_query.scheme:
                    continue
                target_path = (html_path.parent / unquote(without_query.path)).resolve()
                fragment = without_query.fragment
                try:
                    target_path.relative_to(root.resolve())
                except ValueError:
                    continue
                if without_query.path and not target_path.exists():
                    errors.append(
                        f"{rel}:{line}: missing local {attr} target {url!r} from <{tag}>"
                    )
                    continue
            if fragment:
                target_parser = get_parser(target_path)
                if unquote(fragment) not in set(target_parser.ids):
                    target_rel = target_path.relative_to(root)
                    errors.append(
                        f"{rel}:{line}: missing fragment #{fragment} in {target_rel}"
                    )
    return errors


def check_xml(root: Path) -> list[str]:
    errors: list[str] = []
    for xml_path in sorted(root.rglob("*.xml")):
        try:
            ET.parse(xml_path)
        except ET.ParseError as exc:
            errors.append(f"{xml_path.relative_to(root)}: XML parse error: {exc}")
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", default=".", help="site root to check")
    args = parser.parse_args(argv)

    root = Path(args.root).resolve()
    errors = check_html(root) + check_xml(root)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    html_count = sum(1 for _ in root.rglob("*.html"))
    xml_count = sum(1 for _ in root.rglob("*.xml"))
    print(f"OK: checked {html_count} HTML file(s) and {xml_count} XML file(s) under {root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
