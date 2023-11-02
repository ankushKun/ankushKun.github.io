import Page from "../components/page"
import Link from "../components/link"

const links = [
    {
        name: "Github",
        url: "https://github.com/ankushKun"
    },
    {
        name: "Twitter",
        url: "https://twitter.com/ankushKun_"
    },
    {
        name: "LinkedIn",
        url: "https://www.linkedin.com/in/ankushkun/"
    },
    {
        name: "Devpost",
        url: "https://devpost.com/ankushKun"
    },
    {
        name: "DeSo",
        url: "https://diamondapp.com/u/weeblet"
    },
    {
        name: "Instagram",
        url: "https://www.instagram.com/ankushkun_/"
    },
    {
        name: "Youtube",
        url: "https://www.youtube.com/ankushKun"
    },
    {
        name: "Reddit",
        url: "https://reddit.com/u/TECHIE6023"
    }
]

export default function Links() {
    return <Page title="Links">
        <div className="text-center text-2xl font-bold p-1 border my-10">Links</div>
        <div className="w-[50%] mx-auto">
            {
                links.map((link, _) => {
                    return <Link key={_} url={link.url} text={link.name} newTab />
                })
            }
        </div>
    </Page>
}