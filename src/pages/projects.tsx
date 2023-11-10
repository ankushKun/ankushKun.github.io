import Page from "../components/page"
import { projects, ProjectItemType } from "../data/projects"
import Link from "../components/link"

const ProjectItem = (item: ProjectItemType) => {
    return <div className="bg-black/20 p-5 relative flex flex-col gap-3 md:flex-row">
        <div className="text-center text-white/50 absolute top-1 right-2">{item.date}</div>
        <img src={item.image || "/laptop.png"} alt={item.name} className="object-contain mx-auto max-w-[60%] md:max-w-[33%] mt-3" />
        <div className="grow flex flex-col justify-evenly gap-5">
            <div className="text-center font-bold text-xl border-b w-fit mx-auto my-2">{item.name}</div>
            <div className="text-center">{item.description}</div>
            <div className="flex gap-2 justify-center my-2">
                {
                    item.tags.map((tag: string, _: number) => {
                        return <div key={_} className="bg-black/20 p-1 px-2 ring-1 ring-white/20">{tag}</div>
                    })
                }
            </div>
            <div className="flex gap-2 justify-center">
                {item.deployment && <Link url={item.deployment} text="Try it yourself" newTab />}
                {item.github && <Link url={item.github} text="Github" newTab />}
            </div>
        </div>
    </div>
}

export default function Projects() {
    const featuredProjects = projects.filter((item: ProjectItemType) => item.featured)
    const otherProjects = projects.filter((item: ProjectItemType) => !item.featured)

    return <Page title="Projects">
        <div className="text-center text-2xl font-bold p-1 border my-10">Featured Projects</div>
        <div className="flex flex-col gap-5">
            {
                featuredProjects.map((item: ProjectItemType, _: number) => {
                    return <ProjectItem key={_} {...item} />
                })
            }
        </div>
        <div className="text-center text-2xl font-bold p-1 border my-10">All Projects</div>
        <div className="flex flex-col gap-5">
            {
                otherProjects.map((item: ProjectItemType, _: number) => {
                    return <ProjectItem key={_} {...item} />
                })
            }
        </div>
    </Page>
}