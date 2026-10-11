{{- /* A page's markdown body for the text outputs: shortcodes rendered (their
.md variants), root-relative links and media made absolute so the text still
works when read away from the site. Usage: {{ partial "agents/body.md" . }} */ -}}
{{- $base := site.Home.Permalink -}}
{{- $body := .RenderShortcodes | strings.TrimSpace -}}
{{- $body = $body | replaceRE `\]\(/([^/)])` (printf "](%s$1" $base) -}}
{{- $body = $body | replaceRE `(src|href|poster)="/([^/])` (printf `$1="%s$2` $base) -}}
{{- return $body -}}
