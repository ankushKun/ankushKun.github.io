import Navbar from "./navbar"

export default function Page({ children, title = "Ankush Singh" }: { children: React.ReactNode, title: string }) {
    return <div className="bg-[#1f222a] text-white/90 min-h-screen font-mono flex items-center justify-center">
        <title>{title}</title>
        <div className="absolute top-0 left-0 w-screen h-screen background"></div>
        <main className="w-[95vw] min-h-[95vh] sm:min-h-[80vh] shadow-black md:max-w-[69vw] mx-auto p-10 bg-black/20 relative">
            <Navbar />
            {children}
        </main>
    </div>
}