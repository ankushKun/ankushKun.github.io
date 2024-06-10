import Link from "next/link";
import { Page } from "@/pages";
import { achieveCerts, participCerts } from "@/data/achievements"

export default function Achievements() {
    return <Page id="achievements">
        <div className="text-center text-2xl">Achievements ({achieveCerts.length})</div>

        <div className="w-fit whitespace-normal text-left mx-auto my-5">
            {
                achieveCerts.map((cert, i) => {
                    return <div key={i} className="p-2 my-1 flex items-center">
                        {/* <div className="text-black/50 w-[50px] text-center">{cert.year}</div> */}
                        <div className="text-black/50 w-[100px] md:w-[180px] text-xs md:text-base text-left">{cert.year} {cert.position}</div>
                        <div className=" text-sm md:text-lg font-bold flex gap-2 items-center">
                            {
                                cert.link ? <Link href={cert.link} target="_blank">{cert.title}</Link> :
                                    <div>{cert.title}</div>
                            }
                        </div>
                    </div>
                })
            }
        </div>

        <div className="text-center text-2xl">Participations ({participCerts.length}) </div>
        <span className="text-xs text-center block mx-auto text-black/50">non exhaustive</span>

        <div className="w-fit whitespace-normal text-left mx-auto my-5">
            {
                participCerts.map((cert, i) => {
                    return <div key={i} className="p-2 my-1 flex items-center">
                        {/* <div className="text-black/50 w-[50px] text-center">{cert.year}</div> */}
                        <div className="text-black/50 w-[69px] text-left">{cert.year}</div>
                        <div className=" text-sm md:text-lg font-bold flex gap-2 items-center">
                            {
                                cert.link ? <Link href={cert.link} target="_blank">{cert.title}</Link> :
                                    <div>{cert.title}</div>
                            }
                        </div>
                    </div>
                })
            }
        </div>


    </Page>
}
