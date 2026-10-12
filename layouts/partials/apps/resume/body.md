{{- /*
data/resume.yaml as markdown, for /resume/index.md (layouts/resume/list.md)
and /llms-full.txt. Headings start at level 2; root-relative links are made
absolute so the text still works away from the site. Sections and dates
follow the printed resume (page.html): "Mon YYYY - Mon YYYY".

Usage: {{ partial "apps/resume/body.md" hugo.Data.resume }}
*/ -}}
{{- $r := . -}}
{{- $abs := printf "](%s$1" site.Home.Permalink -}}
{{- $links := slice -}}
{{- range $r.contact }}{{ $links = $links | append (printf "[%s](%s)" (partial "apps/resume/link-text.html" (dict "url" .url "label" .label)) .url) }}{{ end -}}
{{ delimit $links " | " }}
{{- with $r.summary }}

## Summary

{{ . | replaceRE `\]\(/([^/)])` $abs }}
{{- end }}
{{- with $r.experience }}

## Experience
{{- range $job := . }}

### {{ $job.org }}: {{ $job.role }}
{{- with $job.start }} ({{ partial "apps/resume/month.html" . }} - {{ with $job.end }}{{ partial "apps/resume/month.html" . }}{{ else }}Present{{ end }}){{ end }}
{{ range $job.highlights }}
- {{ . | replaceRE `\]\(/([^/)])` $abs }}
{{- end }}
{{- end }}
{{- end }}
{{- with $r.projects }}

## Projects
{{- range $project := . }}

### {{ with $project.url }}[{{ $project.name }}]({{ . }}){{ else }}{{ $project.name }}{{ end }}{{ with $project.tech }} | {{ delimit . ", " }}{{ end }}
{{- with $project.start }} ({{ partial "apps/resume/month.html" . }}{{ with $project.end }} - {{ partial "apps/resume/month.html" . }}{{ end }}){{ end }}
{{ range $project.highlights }}
- {{ . | replaceRE `\]\(/([^/)])` $abs }}
{{- end }}
{{- with $project.more }}
- Read more: {{ absURL . }}
{{- end }}
{{- end }}
{{- end }}
{{- with $r.skills }}

## Skills
{{ range . }}
- {{ .label }}: {{ delimit .items ", " }}
{{- end }}
{{- end }}
{{- with $r.awards }}

## Awards
{{ range . }}
- {{ . | replaceRE `\]\(/([^/)])` $abs }}
{{- end }}
{{- end }}
{{- with $r.education }}

## Education
{{ range . }}
- {{ .school }}{{ with .degree }}, {{ . }}{{ end }}{{ with .field }} in {{ . }}{{ end }}
{{- end }}
{{- end }}
{{- with $r.pdf }}

PDF version: {{ absURL . }}
{{- end }}
