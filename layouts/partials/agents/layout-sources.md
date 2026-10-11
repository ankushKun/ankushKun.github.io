{{- /* Returns the concatenated source of every template under a layouts
directory (recursive). Used by index.externalhosts.json to find links that
are hard-coded in templates. Usage: {{ partial "agents/layout-sources.md" "layouts" }} */ -}}
{{- $out := "" -}}
{{- range os.ReadDir . -}}
{{- $path := printf "%s/%s" $ .Name -}}
{{- if .IsDir -}}
{{- $out = print $out (partial "agents/layout-sources.md" $path) -}}
{{- else if findRE `\.(html|xml|txt|md|json)$` .Name 1 -}}
{{- $out = print $out "\n" (os.ReadFile $path) -}}
{{- end -}}
{{- end -}}
{{- return $out -}}
