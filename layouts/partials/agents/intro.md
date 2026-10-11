{{- /* Opening of llms.txt and llms-full.txt: title, summary quote, who this is.
Facts come from hugo.toml [params.profile]. */ -}}
{{- $p := site.Params.profile -}}
{{- $name := $p.name | default site.Params.author.name -}}
# {{ $name }} — {{ site.Home.Permalink | replaceRE `^https?://` "" | strings.TrimSuffix "/" }}

> {{ $p.description }}

{{ $name }}{{ with $p.alternateName }} (also known as {{ delimit . ", " " and " }}){{ end }} is {{ $p.jobTitle }}{{ with $p.worksFor }} of [{{ .name }}]({{ .url }}){{ end }}. This is his personal site: portfolio, blog, timeline and hackathon record. It is built as an interactive OS X Mavericks-style desktop, but every window is also a plain page, and every page has a markdown version at `<page url>index.md`.
