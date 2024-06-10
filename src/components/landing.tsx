import Image from "next/image";
import Link from "next/link";
import { FaCode, FaGithub, FaInstagram, FaLinkedin, FaMedium, FaMicroblog, FaReddit, FaTwitter, FaYoutube } from "react-icons/fa"
import { Page } from "@/pages"
import ankush from "@/assets/ankush.png";

const socials = [
    { name: "Github", link: "https://github.com/ankushKun", icon: FaGithub },
    { name: "Twitter", link: "https://twitter.com/ankushKun_", icon: FaTwitter },
    { name: "Youtube", link: "https://youtube.com/ankushKun", icon: FaYoutube },
    { name: "Linkedin", link: "https://linkedin.com/in/ankushKun", icon: FaLinkedin },
    { name: "Instagram", link: "https://instagram.com/ankushKun_", icon: FaInstagram },
    { name: "Reddit", link: "https://reddit.com/u/TECHIE6023", icon: FaReddit },
    // { name: "Medium", link: "https://ankushkun.medium.com", icon: FaMedium },
]

export default function Landing() {
    return <Page id="main">
        <div className=" bg-white ring-black p-4 px-4 md:px-10 md:pt-6 flex flex-col justify-center md:bottom-10">
            <span className="text-3xl md:text-5xl ">Hi, I am</span>
            <span className="text-5xl md:text-8xl lg:text-9xl flex py-2.5">Ankush Singh</span>
        </div>
        <div className="md:absolute bottom-0 left-0 md:p-5 md:text-2xl text-lg grid grid-cols-2 md:grid-cols-1 gap-y-1 gap-2 justify-center items-center md:items-start">
            {/* <Link href="#blogs" className="">Blogs</Link> */}
            <Link href="#projects" className="w-fit ml-auto md:mx-0">Projects</Link>
            <Link href="#timeline" className="w-fit mr-auto md:mx-0">Timeline</Link>
            <Link href="#publications" className="w-fit ml-auto md:mx-0">Publications</Link>
            <Link href="#achievements" className="w-fit mr-auto md:mx-0">Achievements</Link>
        </div>
        <div className="m-5 text-sm md:text-xl flex flex-col gap-1 items-center justify-center rounded-xl p-2 md:w-2/3">
            <div>Community Manager @ <Link href="https://arweaveindia.com" target="_blank">ArweaveIndia</Link></div>
            <div>Building <Link href="https://betteridea.dev" target="_blank" >BetterIDEa</Link> & <Link href="https://clickoor.arweave.dev" target="_blank">Clickoor</Link></div>
            <div>ArweaveIndia Hackerhouse '23 Winner</div>
            <div>Ex Developer intern @ Physics Wallah</div>
        </div>
        <div className="md:absolute top-0 right-0 flex flex-row md:flex-col items-center mx-auto gap-1 p-1 w-fit">
            {
                socials.map(({ name, link, icon }) => <Link href={link} key={name} target="_blank" className="p-0.5 z-20"> {icon({ size: 30 })} </Link>)
            }
        </div>
        <Image src={ankush} alt="Ankush" width={450} height={450} className="md:absolute -mb-2 md:mb-0 ml-auto right-0 bottom-0 pl-6 w-[350px] md:w-[450px] z-10" />
    </Page>
}
