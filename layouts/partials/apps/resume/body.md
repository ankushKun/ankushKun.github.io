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
{{- $intro := slice -}}
{{- with $r.location }}{{ $intro = $intro | append . }}{{ end -}}
{{- $intro = $intro | append $links -}}
{{- with $r.headline }}**{{ . }}**

{{ end -}}
{{ delimit $intro " | " }}
{{- with $r.summary }}

## Summary

{{ . | replaceRE `\]\(/([^/)])` $abs }}
{{- end }}
{{- with $r.experience }}

## Experience
{{- range $job := . }}

### {{ $job.role }}, {{ $job.org }}

{{- $meta := slice -}}
{{- with $job.location }}{{ $meta = $meta | append . }}{{ end -}}
{{- with $job.start }}{{ $meta = $meta | append (printf "%s - %s" (partial "apps/resume/month.html" .) (cond (ne $job.end nil) (partial "apps/resume/month.html" ($job.end | default "")) "Present")) }}{{ end }}
{{ delimit $meta " | " }}
{{- with $job.about }}

_{{ . | replaceRE `\]\(/([^/)])` $abs }}_
{{- end }}

{{ range $job.highlights }}- {{ . | replaceRE `\]\(/([^/)])` $abs }}
{{ end -}}
{{- with $job.tech }}- Tech: {{ delimit . ", " }}{{ end }}
{{- end }}
{{- end }}
{{- with $r.skills }}

## Skills
{{ range . }}
- {{ .label }}: {{ delimit .items ", " }}
{{- end }}
{{- end }}
{{- with $r.projects }}

## Projects
{{- range $project := . }}

### {{ with $project.url }}[{{ $project.name }}]({{ . }}){{ else }}{{ $project.name }}{{ end }}
{{- $meta := slice -}}
{{- with $project.context }}{{ $meta = $meta | append . }}{{ end -}}
{{- with $project.start }}{{ $meta = $meta | append (cond (ne $project.end nil) (printf "%s - %s" (partial "apps/resume/month.html" .) (partial "apps/resume/month.html" ($project.end | default ""))) (partial "apps/resume/month.html" .)) }}{{ end }}
{{- with $meta }}

{{ delimit . " | " }}
{{- end }}
{{- with $project.summary }}

_{{ . | replaceRE `\]\(/([^/)])` $abs }}_
{{- end }}

{{ range $project.highlights }}- {{ . | replaceRE `\]\(/([^/)])` $abs }}
{{ end -}}
{{- with $project.tech }}- Tech: {{ delimit . ", " }}{{ end }}
{{- with $project.more }}
- Read more: {{ absURL . }}{{ end }}
{{- end }}
{{- end }}
{{- with $r.awards }}

## Awards
{{ range . }}
- **{{ .title }}**, {{ .event }}{{ with .date }}, {{ partial "apps/resume/month.html" . }}{{ end }}
{{- end }}
{{- end }}
{{- with $r.publications }}

## Publications & Talks
{{ range . }}
- **{{ .title }}**{{ with .detail }}: {{ . | replaceRE `\]\(/([^/)])` $abs }}.{{ end }}{{ with .url }} {{ . }}{{ end }}{{ with .date }}, {{ partial "apps/resume/month.html" . }}{{ end }}
{{- end }}
{{- end }}
{{- with $r.education }}

## Education
{{ range . }}
- {{ .degree }}{{ with .field }} in {{ . }}{{ end }}{{ with .school }}, {{ . }}{{ end }}{{ with .location }}, {{ . }}{{ end }}
{{- if or .start .end .expected }} | {{ with .start }}{{ partial "apps/resume/month.html" . }}{{ end }}{{ if and .start (or .end .expected) }} - {{ end }}{{ with .end }}{{ partial "apps/resume/month.html" . }}{{ end }}{{ with .expected }}Expected {{ partial "apps/resume/month.html" . }}{{ end }}{{ end }}
{{- end }}
{{- end }}
{{- with $r.pdf }}

PDF version: {{ absURL . }}
{{- end }}
