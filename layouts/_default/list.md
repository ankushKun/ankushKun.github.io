{{- /*
Markdown twin of a section page (index.md next to its index.html):
the section's intro, then what the HTML window shows as a plain list.
*/ -}}
{{- $o := dict "noHTMLEscape" true -}}
---
title: {{ .Title | jsonify $o }}
url: {{ .Permalink | jsonify $o }}
{{- with .Description }}
description: {{ . | jsonify $o }}
{{- end }}
author: {{ site.Params.profile.name | default site.Params.author.name | jsonify $o }}
---

# {{ .Title }}
{{ with partial "agents/body.md" . }}
{{ . }}
{{ end -}}
{{ if eq .Section "about" }}
{{- with .Params.facts }}
## Quick facts
{{ range . }}
- {{ . }}
{{- end }}
{{ end }}
## Experience
{{ partial "agents/experience.md" . }}

## Elsewhere
{{ partial "agents/socials.md" . }}
{{ else if eq .Section "schedule" }}
{{ with hugo.Data.contact.profile.schedule }}Book a call: {{ . }}{{ end }}
{{ else if .RegularPages }}
{{ range .RegularPages.ByDate.Reverse.GroupByDate "2006" }}
## {{ .Key }}

{{ range .Pages }}{{ partial "agents/line.md" (dict "page" . "tags" true) }}
{{ end }}{{ end }}
{{- end -}}
