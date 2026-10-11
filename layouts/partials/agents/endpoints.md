{{- /* Every machine-readable entry point the site really has */ -}}
- [llms.txt]({{ "llms.txt" | absURL }}): short index of the site for language models
- [llms-full.txt]({{ "llms-full.txt" | absURL }}): everything in one file, including the full text of every blog post
- Markdown version of any page or section: add `index.md` to its URL, e.g. {{ with site.GetPage "/about" }}{{ with .OutputFormats.Get "markdown" }}{{ .Permalink }}{{ end }}{{ end }}
- [Search index]({{ "index.json" | absURL }}): JSON array of every app and page with title, description, date, tags and opening text
- [RSS]({{ "index.xml" | absURL }}): blog posts, projects and timeline entries; blog only at {{ "blogs/index.xml" | absURL }}
- [JSON Feed]({{ "feed.json" | absURL }}): the same items as the RSS feed
- [Sitemap]({{ "sitemap.xml" | absURL }})
- `{{ site.Home.Permalink }}?q=<terms>` opens the desktop with a search for the terms
- `{{ site.Home.Permalink }}?open=<app>` opens the desktop with one app's window, e.g. `?open=projects`
{{- /* MCP server: routes of the site Worker (workers/site-worker/src/mcp.js).
Advertised, and its server card published, only once the Worker is deployed
and its origin is set as params.linkProxy. Keep the card in step with
handleServerCard() in that file. */ -}}
{{- with site.Params.linkProxy | strings.TrimSuffix "/" }}
{{- $mcp := printf "%s/mcp" . }}
{{- $card := dict
  "name" "one.ankush/site"
  "title" "Ankush Singh's site"
  "description" (printf "Read-only tools over the public content of %s: search, blog posts, projects, resume and contact details." (site.Home.Permalink | replaceRE `^https?://` "" | strings.TrimSuffix "/"))
  "version" "1.0.0"
  "websiteUrl" site.Home.Permalink
  "protocolVersions" (slice "2026-07-28" "2025-11-25" "2025-06-18" "2025-03-26" "2024-11-05")
  "remotes" (slice (dict "type" "streamable-http" "url" $mcp))
  "authentication" (dict "required" false)
  "capabilities" (dict "tools" (dict))
}}
{{- $published := (resources.FromString ".well-known/mcp.json" (jsonify (dict "indent" "  ") $card)).Publish }}
- MCP server: `{{ $mcp }}` (Streamable HTTP, no sign-in, read-only). Tools: `search_site`, `list_posts`, `list_projects`, `get_page` (any page as markdown), `get_about`, `get_resume`, `get_contact`. Server card: {{ ".well-known/mcp.json" | absURL }}
- Search as plain text: `{{ . }}/search?q=<terms>` returns ranked results as markdown with an excerpt and the markdown address of each page (`&format=json` for JSON, `&section=blog|project|timeline|page`, `&limit=1..20`)
{{- end }}
