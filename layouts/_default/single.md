{{- /*
Markdown twin of a content page, published next to it as index.md
(hugo.toml: outputs.page). The body is the page's own markdown with its
shortcodes rendered through their .md variants (layouts/shortcodes/*.md).
*/ -}}
{{ partial "agents/frontmatter.md" . }}
# {{ .Title }}
{{ with partial "apps/doc/links.md" . }}
{{ . }}
{{ end }}
{{ partial "agents/body.md" . }}
