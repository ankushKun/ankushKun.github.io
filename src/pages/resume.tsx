import Page from "../components/page"

export default function Resume() {
    return <Page title="Timeline">
        <object data="https://ankushKun.github.io/resume.pdf" type="application/pdf" className="w-full min-h-[77vh]">
            {/* <p>Resume file missing</p> */}
            <iframe src="https://ankushKun.github.io/resume.pdf" className="w-full min-h-[77vh]"></iframe>
        </object>
        <a href="/resume.pdf" target="_blank" className="hover:text-green-400 text-center block">Open in a new tab</a>
    </Page>
}
