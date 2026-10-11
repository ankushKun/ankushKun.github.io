{{- /*
Markdown twin of /resume/ (index.md next to its index.html), from
data/resume.yaml through layouts/partials/apps/resume/body.md.
*/ -}}
{{- $o := dict "noHTMLEscape" true -}}
{{- $r := hugo.Data.resume -}}
---
title: {{ .Title | jsonify $o }}
url: {{ .Permalink | jsonify $o }}
{{- with .Description }}
description: {{ . | jsonify $o }}
{{- end }}
author: {{ $r.name | default site.Params.profile.name | jsonify $o }}
---

# {{ $r.name }}

{{ partial "apps/resume/body.md" $r }}
