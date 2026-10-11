{{- /* YAML front matter for a page's markdown twin. Values go through jsonify,
which is valid YAML and keeps quotes and colons in titles from breaking it. */ -}}
{{- $o := dict "noHTMLEscape" true -}}
---
title: {{ .Title | jsonify $o }}
url: {{ .Permalink | jsonify $o }}
{{- with .Params.canonical }}
canonical: {{ . | jsonify $o }}
{{- end }}
{{- /* A front-matter summary may carry inline markdown; this is plain text */ -}}
{{- $desc := .Description -}}
{{- if not $desc }}{{ with .Params.summary }}{{ $desc = . | markdownify }}{{ end }}{{ end -}}
{{- with $desc }}
description: {{ . | plainify | htmlUnescape | jsonify $o }}
{{- end }}
author: {{ site.Params.profile.name | default site.Params.author.name | jsonify $o }}
{{- if not .Date.IsZero }}
date: {{ if eq .Params.date_precision "year" }}{{ .Date.Format "2006" }}{{ else }}{{ .Date.Format "2006-01-02" }}{{ end }}
{{- end }}
{{- if not .Lastmod.IsZero }}
lastmod: {{ .Lastmod.Format "2006-01-02" }}
{{- end }}
{{- with .Params.tags }}
tags: {{ . | jsonify $o }}
{{- end }}
{{- with .Params.status }}
status: {{ . | jsonify $o }}
{{- end }}
{{- with .Params.website }}
website: {{ . | jsonify $o }}
{{- end }}
{{- with .Params.github }}
repository: {{ printf "https://github.com/%s" . | jsonify $o }}
{{- end }}
{{- /* Every resource of the links bar (website, demo, repos, npm, extra links) */ -}}
{{- with partial "apps/doc/links-data.html" . }}
links:
{{- range . }}
  - {{ dict "label" .label "url" .url "archived" .archived | jsonify $o }}
{{- end }}
{{- end }}
---
