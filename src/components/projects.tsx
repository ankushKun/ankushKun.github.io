import { TProject, projects } from "@/data";
import { Page } from "@/pages";
import Link from "next/link";

const ProjectItem = (item: TProject) => {
    return (
        <div className="relative flex gap-3 p-2 text-left  whitespace-normal">
            <div className="w-[100px] max-w-[100px] pt-0.5 text-right text-black/50">
                {item.date}
            </div>
            <div className="flex w-full flex-col justify-evenly items-start">
                <div className="text-xl font-bold">
                    {item.name}
                </div>
                <div className="text-justify">{item.description}</div>
                <div className="flex flex-col md:flex-row items-start justify-between w-full mt-3">
                    <div className="flex justify-center gap-2">
                        {item.deployment && (
                            <Link href={item.deployment} target="_blank" >Try it yourself</Link>
                        )}|
                        {item.github && <Link href={item.github} target="_blank" >Github</Link>}
                    </div>
                    <div className="flex justify-center text-black/50 gap-1 text-sm">
                        [{item.tags.map((tag: string, _: number) => {
                            return (
                                <div key={_} className="">
                                    {`${tag}${_ < item.tags.length-1 ? ", ":""}`}
                                </div>
                            );
                        })}]
                    </div>
                </div>
            </div>
        </div>
    );
};


export default function Projects() {
    const featuredProjects = projects.filter(
        (item: TProject) => item.featured,
    );
    const otherProjects = projects.filter(
        (item: TProject) => !item.featured,
    );

    return <Page id="projects">
        <div className="text-center text-2xl">Projects</div>

        <div className="flex flex-col gap-5 md:w-[80%] mx-auto">
            {featuredProjects.map((item: TProject, _: number) => {
                return <><ProjectItem key={_} {...item} /><hr/></>;
            })}
            {otherProjects.map((item: TProject, _: number) => {
                return <><ProjectItem key={_} {...item} /><hr/></>;
            })}
        </div>
    </Page>
}