# bitRAKE.github.io

Static GitHub Pages content for <https://bitrake.github.io/>.

## Page inventory

- `index.html` - landing page with a Mermaid divide-by-three state diagram.
- `windows-terminal-esc-codes.html` - Windows Terminal escape/control sequence reference.
- `x86_encoding.html` and `x86_encoding_static.html` - x86 encoding visualizations.
- `com_forensics_workbench.html`, `lineweaver_patel.html`, and `uwpchar.html` - standalone reference/experiment pages.
- `sprite_tester/` - browser-based forest sprite frame tester and its assets.

## Local maintenance check

Run the dependency-free checker before publishing structural edits:

```sh
python3 tools/check_site.py
```

The check validates local `href`/`src` targets, fragment anchors, duplicate HTML IDs, and XML well-formedness. It intentionally avoids network requests so it is safe to run offline and in lightweight CI or cron environments.
