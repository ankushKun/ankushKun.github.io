{{- /*
The links bar for the text outputs: the same resources as apps/doc/links.html
(data: apps/doc/links-data.html) as a markdown list, so the markdown twin,
llms-full.txt and the feed keep every link that lives in front matter.

  Links:

  - [Website](https://...)
  - [App Store](https://web.archive.org/...) (archived snapshot)

Usage: {{ partial "apps/doc/links.md" . }} where . is a Page; returns "" when
the page has no links.
*/ -}}
{{- $out := "" -}}
{{- with partial "apps/doc/links-data.html" . -}}
{{- $out = "Links:\n" -}}
{{- range . -}}
{{- $out = printf "%s\n- [%s](%s)%s" $out (.label | replaceRE `[\[\]]` "") .url (cond .archived " (archived snapshot)" "") -}}
{{- end -}}
{{- end -}}
{{- return $out -}}
