{{- /*
One llms.txt list item for a page: "- [Title](url): description (date)".
Links to the page's markdown twin when it has one.
Usage: {{ partial "agents/line.md" . }} or (dict "page" . "tags" true)
*/ -}}
{{- $page := . -}}
{{- $tags := false -}}
{{- if reflect.IsMap . }}{{ $page = .page }}{{ $tags = .tags }}{{ end -}}
{{- $url := $page.Permalink -}}
{{- with $page.OutputFormats.Get "markdown" }}{{ $url = .Permalink }}{{ end -}}
{{- $desc := $page.Description | default $page.Params.summary | default "" | plainify | htmlUnescape | replaceRE `\s+` " " | strings.TrimSpace -}}
{{- $when := "" -}}
{{- if not $page.Date.IsZero -}}
{{- $when = $page.Date.Format "2006-01-02" -}}
{{- if eq $page.Params.date_precision "year" }}{{ $when = $page.Date.Format "2006" }}{{ end -}}
{{- end -}}
- [{{ $page.Title | replaceRE `[\[\]]` "" }}]({{ $url }})
{{- with $desc }}: {{ . }}{{ end -}}
{{- if eq $page.Params.status "archived" }} Archived, no longer maintained.{{ end -}}
{{- if and $tags $page.Params.tags }} Tags: {{ delimit $page.Params.tags ", " }}.{{ end -}}
{{- with $when }} ({{ . }}){{ end -}}
