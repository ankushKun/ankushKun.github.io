import {Page} from "@/pages";
import { FaLink } from "react-icons/fa6";
import Link from "next/link";

export default function Resume() {
    return <Page id="ok">
        <div className="flex flex-col items-center justify-center">
            <Link href="/resume.pdf" download className="text-blue-500 mx-auto flex gap-2 items-center justify-center m-1 text-2xl">Resume <FaLink/></Link>
            <iframe src="/resume.pdf" className="w-full h-screen rounded-lg grow -mx-2 -px-2">
            </iframe>
        </div>
    </Page>
}
