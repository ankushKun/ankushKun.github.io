{{- /* data/contact.yaml as a markdown list */ -}}
{{- $c := hugo.Data.contact -}}
{{- range $c.socials }}
- {{ .platform }}: [{{ .handle }}]({{ .url }})
{{- end }}
{{- with $c.profile.email }}
- Email: {{ . }}
{{- end }}
{{- with $c.profile.schedule }}
- Schedule a call: {{ . }}
{{- end -}}
