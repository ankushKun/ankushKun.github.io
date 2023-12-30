import Page from "../components/page"
import { timeline, TimelineItemType } from "../data/timeline"

type YearWise = {
    [year: number]: TimelineItemType[]
}

export default function Timeline() {
    const yearWiseTimeline: YearWise = timeline.reduce((acc: YearWise, item: TimelineItemType) => {
        if (acc[item.year]) {
            acc[item.year].push(item)
        } else {
            acc[item.year] = [item]
        }
        return acc
    }, {} as YearWise)

    return <Page title="Timeline">
        <div className="text-center text-2xl font-bold p-1 border my-10">Timeline</div>
        <div className="my-10">This page contains a list of <span className="text-sm opacity-50">(hopefully)</span> all of my experiences, participations, wins and loses</div>

        {
            Object.keys(yearWiseTimeline).reverse().map((year: string, _: number) => {
                return <div key={_} className="my-5">
                    <details open={_ == 0}>
                        <summary className={` cursor-pointer ${_ == 0 ? "font-bold text-xl" : ""}`}>{year}</summary>
                        {
                            yearWiseTimeline[year as unknown as number].map((item: TimelineItemType, __: number) => {
                                return <div key={__} className="my-4 bg-black/20 p-2">
                                    <div className={`text-xl ${item.highlight ? "text-green-300 font-medium" : ""}`}>{item.title}{item.highlight && "!"}</div>
                                    <div className="pl-9 pt-2">
                                        {
                                            item.description.map((desc: string, ___: number) => {
                                                return <div key={___}> - {desc}</div>
                                            })
                                        }
                                    </div>
                                </div>
                            })
                        }
                    </details>
                </div>
            })
        }

    </Page>
}
