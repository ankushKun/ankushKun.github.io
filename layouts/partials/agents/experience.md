{{- /* Work history from hugo.toml [params.profile.experience], as a markdown list */ -}}
{{- range site.Params.profile.experience }}
- {{ .role }}, [{{ .org }}]({{ .url }}){{ if .current }} (current){{ end }}
{{- end -}}
