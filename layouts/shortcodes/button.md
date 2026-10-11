{{- /* Markdown twin of button.html, used by the index.md and llms-full.txt outputs */ -}}
{{- $href := .Get 0 -}}
{{- $archived := or (eq (.Get 2) "archived") (strings.Contains $href "web.archive.org/") -}}
[{{ .Get 1 | default "View" }}{{ if $archived }} (archived snapshot){{ end }}]({{ $href }})
