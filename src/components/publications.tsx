import { Page } from "@/pages"
import { publications } from "@/data"
import { BsJournalText } from "react-icons/bs"
import Link from "next/link"

export default function Publications() {
    return <Page id="publications">
        <div className="text-center text-2xl">Publications</div>

        <div className="w-fit whitespace-normal text-left mx-auto my-5">        {
            publications.map((publication, i) => {
                return <div key={i} className="p-2 my-1">
                    <Link href={publication.link} target={publication.link == "#" ? "" : "_blank"} className=" text-sm md:text-lg font-bold flex gap-2 items-center">
                        <div><BsJournalText size={20} className="block" /></div> {publication.title}
                    </Link>
                </div>
            })
        }
        </div>

    </Page>
}
