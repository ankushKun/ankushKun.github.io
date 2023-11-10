import Page from "../components/page"

export default function Resume() {
    return <Page title="Timeline">
        {/* <object data="https://ankushKun.github.io/resume.pdf" type="application/pdf" className="w-full min-h-[75vh]">
            <p>Resume file missing</p>
        </object> */}
        <iframe src="https://ankushKun.github.io/resume.pdf" className="w-full min-h-[77vh]"></iframe>
    </Page>
}