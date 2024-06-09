import { DM_Sans } from "next/font/google"
import Landing  from "@/components/landing";
import Blogs from "@/components/blogs";
import Projects from "@/components/projects";
import Timeline from "@/components/timeline";
import Publications from "@/components/publications";
import Link from "next/link";
import Achievements from "@/components/achievements";

const dmMono = DM_Sans({ subsets: ["latin"], weight: "400" })

export const Page = ({ children, id }:{children: React.ReactNode, id:string}) => {
  return <section
    id={id} className={`relative rounded-lg scroll-mx-10 overflow-y-scroll snap-center m-[15px] md:m-[30px] inline-block w-[calc(100vw-30px)] text-base md:w-[calc(100vw-60px)] h-[calc(100vh-30px)] md:h-[calc(100vh-60px)] bg-white shadow-lg p-2 ring- ring-black`}>
      {id!="main"&&<Link href="#main" className="absolute left-2 top-1">back</Link>}
    {children}
  </section>
}

export default function Home() {
  return (
    <main className={`relative snap-both snap-mandatory h-screen max-h-[100vh] flex-grow whitespace-nowrap overflow-y-clip overflow-x-scroll ${dmMono.className}`}>
      <Landing  />
      {/* <Blogs /> */}
      <Projects />
      <Timeline />
      <Publications />
      <Achievements/>
    </main>

  );
}
