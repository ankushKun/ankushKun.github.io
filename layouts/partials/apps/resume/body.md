{{- /*
data/resume.yaml as markdown, for /resume/index.md (layouts/resume/list.md)
and /llms-full.txt. Headings start at level 2; root-relative links are made
absolute so the text still works away from the site.

Usage: {{ partial "apps/resume/body.md" hugo.Data.resume }}
*/ -}}
{{- $r := . -}}
{{- $abs := printf "](%s$1" site.Home.Permalink -}}
{{- $links := slice -}}
{{- range $r.contact }}{{ $links = $links | append (printf "[%s](%s)" .label .url) }}{{ end -}}
{{- $intro := slice -}}
{{- with $r.headline }}{{ $intro = $intro | append . }}{{ end -}}
{{- $intro = $intro | append $links -}}
{{ delimit $intro " · " }}
{{- with $r.experience }}

## Experience
{{- range $job := . }}

### {{ $job.org }}, {{ $job.role }}{{ with $job.team }} ({{ . }}){{ end }}
{{- with $job.start }} ({{ . }} – {{ $job.end | default "present" }}){{ end }}

{{ range $job.highlights }}- {{ . | replaceRE `\]\(/([^/)])` $abs }}
{{ end -}}
{{- with $job.tech }}- Tech used: {{ delimit . ", " }}{{ end }}
{{- end }}
{{- end }}
{{- with $r.projects }}

## Projects
{{- range $project := . }}

### {{ with $project.url }}[{{ $project.name }}]({{ . }}){{ else }}{{ $project.name }}{{ end }}{{ with $project.summary }}: {{ . }}{{ end }}

{{ range $project.highlights }}- {{ . | replaceRE `\]\(/([^/)])` $abs }}
{{ end -}}
{{- with $project.more }}- Read more: {{ absURL . }}{{ end }}
{{- end }}
{{- end }}
{{- if or $r.skills $r.interests }}

## Skills & Interests

{{ range $r.skills }}- {{ .label }}: {{ delimit .items ", " }}
{{ end -}}
{{- with $r.interests }}- Interests: {{ delimit . ", " }}{{ end }}
{{- end }}
{{- with $r.education }}

## Education
{{ range . }}
- {{ .degree }}{{ with .field }}, {{ . }}{{ end }}{{ with .school }}, {{ . }}{{ end }}{{ with .location }}, {{ . }}{{ end }}
{{- end }}
{{- end }}
{{- with $r.pdf }}

PDF version: {{ absURL . }}
{{- end }}
