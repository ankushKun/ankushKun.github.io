import { Page } from "@/pages";
import { TTimeline, timeline } from "@/data";

type YearWise = {
    [year: number]: TTimeline[];
};

export default function Tineline() {
    const yearWiseTimeline: YearWise = timeline.reduce(
        (acc: YearWise, item: TTimeline) => {
            if (acc[item.year]) {
                acc[item.year].push(item);
            } else {
                acc[item.year] = [item];
            }
            return acc;
        },
        {} as YearWise,
    );

    return <Page id="timeline">
        <div className="text-center text-2xl">Timeline</div>

        <div className="md:w-3/4 mx-auto whitespace-normal">
        {Object.keys(yearWiseTimeline)
            .reverse()
            .map((year: string, _: number) => {
                return (
                    <div key={_} className="my-5">
                        <details open={_ == 0}>
                            <summary
                                className={` cursor-pointer ${_ == 0 ? "text-xl font-bold" : ""}`}
                            >
                                {year}
                            </summary>
                            {yearWiseTimeline[year as unknown as number].map(
                                (item: TTimeline, __: number) => {
                                    return (
                                        <div
                                            key={__}
                                            className="py-4 p-2 border-b"
                                        >
                                            <div
                                                className={`md:text-xl ${item.highlight ? " font-bold " : ""}`}
                                            >
                                                {item.title}
                                                {item.highlight && "!"}
                                            </div>
                                            <div className="pl-5 pt-2">
                                                {item.description.map((desc: string, ___: number) => {
                                                    return <div key={___} className="text-sm md:text-base"> - {desc}</div>;
                                                })}
                                            </div>
                                        </div>
                                    );
                                },
                            )}
                        </details>
                    </div>
                );
            })}
        </div>
    </Page>
}
