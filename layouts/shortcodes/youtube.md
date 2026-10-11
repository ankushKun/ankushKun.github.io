{{- /* Markdown twin of youtube.html (positional or named parameters) */ -}}
{{- $id := cond .IsNamedParams (.Get "id") (.Get 0) -}}
{{- $title := cond .IsNamedParams (.Get "title" | default "") (.Get 1 | default "") -}}
{{- $caption := cond .IsNamedParams (.Get "caption" | default "") "" -}}
{{- $label := $title | default ($caption | markdownify | plainify | htmlUnescape) -}}
[{{ with $label }}Video: {{ . }}{{ else }}YouTube video{{ end }}](https://youtu.be/{{ $id }})
