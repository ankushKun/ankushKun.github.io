export default function Link({ url, text, newTab = false }: { url: string, text: string, newTab?: boolean }) {
    return <a href={url} target={newTab ? "_blank" : "_self"}>
        <button className="p-2 m-1 w-full bg-black/20 hover:bg-green-300 hover:text-black text-[#78e2a0] ring-1 ring-[#78e2a0]">
            {text}
        </button>
    </a>
}