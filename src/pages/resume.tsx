import Page from "../components/page"

export default function Resume() {
    return <Page title="Timeline">
        <object data="/resume.pdf" type="application/pdf" className="w-full min-h-[75vh]">
            <p>Resume file missing</p>
        </object>
    </Page>
}