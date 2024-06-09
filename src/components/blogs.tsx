import Image from "next/image"
import { Page } from "@/pages"
import {blogs} from "@/data"
import Link from "next/link"
import { FaLink } from "react-icons/fa6"

export default function Blogs(){
    return <Page id="blogs">
        <div className="text-center text-2xl">Blogs</div>

        <div className="flex flex-col gap-4 p-2 w-[80%] mx-auto">
        {
            blogs.map((b) => <Link href={b.link} target="_blank" key={b.title} className="p-2 flex gap-2 break-inside-auto overflow-clip">
                {/* <Image src={b.image!} alt={b.title} width={250} height={200} className="w-1/4 md:w-[250px] rounded-lg aspect-video object-cover" /> */}
                <div className="py-1">
                    <div className="text-xs md:text-2xl whitespace-break-spaces flex items-center gap-2"><FaLink/> {b.title}</div>
                    <div className="text-gray-400 text-xs">{b.date}</div>
                    <p>{b.description}</p>
                </div>
            </Link>)
            
            }
        </div>
    </Page>
}